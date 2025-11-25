// sdk/l1/tx.ts
import { getUtxo, broadcast } from "./network";
import CryptoJS from "crypto-js";
import elliptic from "elliptic";
import { decodeBech32 } from "./bech32";
import type { Wallet } from "./types";

const ec = new elliptic.ec("secp256k1");

// --------------------------------------------------
// CONSTANTS
// --------------------------------------------------
const FEE = 10_000; // sats
const DUST = 546; // sats
const SAT = 100_000_000; // sats in 1 ALPHA
const SEQUENCE = "feffffff"; // default sequence
const VERSION_LE = "02000000";
const LOCKTIME_LE = "00000000";

// --------------------------------------------------
// UTILS
// --------------------------------------------------
function alphaToSats(alpha: number) {
  return Math.floor(alpha * SAT);
}

function toLE(value: number | bigint, bytes: number) {
  const hex = BigInt(value)
    .toString(16)
    .padStart(bytes * 2, "0");
  return hex.match(/../g)!.reverse().join("");
}

function varInt(n: number | bigint) {
  const v = Number(n);
  if (v < 0xfd) return v.toString(16).padStart(2, "0");
  if (v <= 0xffff) return "fd" + toLE(v, 2);
  if (v <= 0xffffffff) return "fe" + toLE(v, 4);
  return "ff" + toLE(v, 8);
}

// P2WPKH scriptPubKey from bech32 address
export function createScriptPubKey(address: string): string {
  const decoded = decodeBech32(address);
  if (!decoded) throw new Error("Invalid bech32 address: " + address);
  if (decoded.witnessVersion !== 0) throw new Error("Only v0 P2WPKH supported");

  const programHex = Array.from(decoded.data)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // OP_0 (00) + PUSH20 (14) + pubkeyhash(20 bytes)
  return "0014" + programHex;
}

function sha256d(hex: string) {
  const h1 = CryptoJS.SHA256(CryptoJS.enc.Hex.parse(hex));
  const h2 = CryptoJS.SHA256(h1);
  return h2.toString();
}

// --------------------------------------------------
// BIP143 SIG-HASH (single-input P2WPKH)
// --------------------------------------------------
function createSignatureHashBIP143(
  txPlan: {
    input: { txid: string; vout: number; value: number };
    outputs: Array<{ value: number; address: string }>;
  },
  publicKeyHex: string
) {
  // 1) nVersion
  let preimage = VERSION_LE;

  // 2) hashPrevouts (all inputs)
  const prevouts =
    txPlan.input.txid.match(/../g)!.reverse().join("") +
    toLE(txPlan.input.vout, 4);

  const hashPrevouts = sha256d(prevouts);
  preimage += hashPrevouts;

  // 3) hashSequence
  const hashSequence = sha256d(SEQUENCE);
  preimage += hashSequence;

  // 4) outpoint of current input
  preimage += txPlan.input.txid.match(/../g)!.reverse().join("");
  preimage += toLE(txPlan.input.vout, 4);

  // 5) scriptCode = 0x19 76 a9 14 <20-byte pubKeyHash> 88 ac
  const pubKeyHash = CryptoJS.RIPEMD160(
    CryptoJS.SHA256(CryptoJS.enc.Hex.parse(publicKeyHex))
  ).toString();
  const scriptCode = "19" + "76a914" + pubKeyHash + "88ac";
  preimage += scriptCode;

  // 6) amount (8 bytes LE)
  preimage += toLE(txPlan.input.value, 8);

  // 7) nSequence
  preimage += SEQUENCE;

  // 8) hashOutputs
  let outputsSerial = "";
  for (const o of txPlan.outputs) {
    const amountLE = toLE(o.value, 8);
    const spk = createScriptPubKey(o.address);
    const spkLen = varInt(spk.length / 2);
    outputsSerial += amountLE + spkLen + spk;
  }
  const hashOutputs = sha256d(outputsSerial);
  preimage += hashOutputs;

  // 9) nLockTime
  preimage += LOCKTIME_LE;

  // 10) sighash type (SIGHASH_ALL = 0x01_000000)
  preimage += "01000000";

  // Double SHA256 of preimage
  return sha256d(preimage);
}

// --------------------------------------------------
// WITNESS (P2WPKH): [signature+hashtype, pubkey]
// --------------------------------------------------
function buildWitness(
  sigHashHex: string,
  keyPair: elliptic.ec.KeyPair,
  publicKeyHex: string
) {
  // Der-encode, enforce low-S
  const sig = keyPair.sign(sigHashHex, { canonical: true });
  let der = sig.toDER("hex");

  // append sighash type 0x01
  der = der + "01";

  const derLen = (der.length / 2).toString(16).padStart(2, "0");
  const pubLen = (publicKeyHex.length / 2).toString(16).padStart(2, "0");

  // 02 <len(sig)> <sig+01> <len(pub)> <pub>
  return "02" + derLen + der + pubLen + publicKeyHex;
}

// --------------------------------------------------
// Build SegWit TX (single input, N outputs)
// --------------------------------------------------
export function buildSegWitTransaction(
  txPlan: {
    input: { txid: string; vout: number; value: number };
    outputs: Array<{ value: number; address: string }>;
  },
  keyPair: elliptic.ec.KeyPair,
  publicKeyHex: string
) {
  // ----- witness signature hash -----
  const sigHash = createSignatureHashBIP143(txPlan, publicKeyHex);

  // ----- non-witness serialization (for txid) -----
  let noWit = "";
  noWit += VERSION_LE;
  noWit += varInt(1); // inputs
  // input
  noWit += txPlan.input.txid.match(/../g)!.reverse().join("");
  noWit += toLE(txPlan.input.vout, 4);
  noWit += "00"; // empty scriptsig
  noWit += SEQUENCE;
  // outputs
  noWit += varInt(txPlan.outputs.length);
  for (const o of txPlan.outputs) {
    const amountLE = toLE(o.value, 8);
    const spk = createScriptPubKey(o.address);
    const spkLen = varInt(spk.length / 2);
    noWit += amountLE + spkLen + spk;
  }
  noWit += LOCKTIME_LE;

  const txid = sha256d(noWit).match(/../g)!.reverse().join("");

  // ----- full segwit serialization -----
  let full = "";
  full += VERSION_LE;
  full += "00"; // marker
  full += "01"; // flag
  full += varInt(1); // inputs
  // input
  full += txPlan.input.txid.match(/../g)!.reverse().join("");
  full += toLE(txPlan.input.vout, 4);
  full += "00"; // scriptSig length = 0
  full += SEQUENCE;
  // outputs
  full += varInt(txPlan.outputs.length);
  for (const o of txPlan.outputs) {
    const amountLE = toLE(o.value, 8);
    const spk = createScriptPubKey(o.address);
    const spkLen = varInt(spk.length / 2);
    full += amountLE + spkLen + spk;
  }
  // witness for each input
  full += buildWitness(sigHash, keyPair, publicKeyHex);
  // locktime
  full += LOCKTIME_LE;

  return { raw: full, txid };
}

// --------------------------------------------------
// TX PLAN
// utxos come from getUtxo(address) and must be:
// { txid, vout, value, height, address }
// --------------------------------------------------

export interface TransactionPlan {
  success: boolean;
  transactions: Array<{
    input: { txid: string; vout: number; value: number; address: string };
    outputs: Array<{ value: number; address: string }>;
    fee: number;
    changeAmount: number;
    changeAddress: string;
  }>;
  error?: string;
}

function rebalanceDustOutputs(
  transactions: any[],
  recipientAddress: string,
  senderAddress: string,
  availableUtxos: any[],
  feePerTx: number
) {
  // First pass: rebalance recipient dust outputs across transactions
  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i];
    const recipientOutput = tx.outputs.find((o: any) => o.address === recipientAddress);

    if (recipientOutput && recipientOutput.value < DUST && transactions.length > 1) {
      // Find another transaction to rebalance with
      for (let j = 0; j < transactions.length; j++) {
        if (i === j) continue;

        const otherTx = transactions[j];
        const otherRecipientOutput = otherTx.outputs.find((o: any) => o.address === recipientAddress);

        if (otherRecipientOutput) {
          // Calculate how much we need to move to make both outputs non-dust
          const totalAmount = recipientOutput.value + otherRecipientOutput.value;
          const halfAmount = Math.floor(totalAmount / 2);

          if (halfAmount > DUST) {
            // Rebalance the outputs
            recipientOutput.value = halfAmount;
            otherRecipientOutput.value = totalAmount - halfAmount;
            break;
          }
        }
      }
    }
  }

  // Second pass: handle dust change outputs
  const finalTransactions = [];
  const usedUtxos = new Set(transactions.map((tx) => `${tx.input.txid}:${tx.input.vout}`));

  for (const tx of transactions) {
    finalTransactions.push(tx);

    // Check if we have dust change that needs to be handled
    if (tx.changeAmount > 0 && tx.changeAmount <= DUST) {
      const recipientOutput = tx.outputs.find((o: any) => o.address === recipientAddress);

      if (recipientOutput && recipientOutput.value > DUST * 2) {
        // Find an unused UTXO first
        const nextUtxo = availableUtxos.find(
          (utxo) => !usedUtxos.has(`${utxo.txid}:${utxo.vout}`)
        );

        if (nextUtxo) {
          // Split the recipient output to create non-dust change
          const halfRecipientAmount = Math.floor(recipientOutput.value / 2);
          const remainingRecipientAmount = recipientOutput.value - halfRecipientAmount;
          recipientOutput.value = halfRecipientAmount;

          // Create proper change output
          const newChangeAmount = tx.input.value - halfRecipientAmount - tx.fee;
          if (newChangeAmount > DUST) {
            tx.outputs.push({
              address: senderAddress,
              value: newChangeAmount,
            });
            tx.changeAmount = newChangeAmount;
          } else {
            // If for some reason new change is invalid, we might have an issue, 
            // but math suggests it should be > DUST.
            // We'll proceed with creating follow-up.
          }

          // Create follow-up transaction
          const followUpTx: any = {
            input: {
              txid: nextUtxo.txid ?? nextUtxo.tx_hash,
              vout: nextUtxo.vout ?? nextUtxo.tx_pos,
              value: nextUtxo.value,
            },
            outputs: [
              { address: recipientAddress, value: remainingRecipientAmount },
            ],
            fee: feePerTx,
            changeAmount: nextUtxo.value - remainingRecipientAmount - feePerTx,
            changeAddress: senderAddress,
          };

          if (followUpTx.changeAmount > DUST) {
            followUpTx.outputs.push({
              address: senderAddress,
              value: followUpTx.changeAmount,
            });
          }

          finalTransactions.push(followUpTx);
          usedUtxos.add(`${nextUtxo.txid}:${nextUtxo.vout}`);
          usedUtxos.add(`${nextUtxo.tx_hash}:${nextUtxo.tx_pos}`);
        }
      }
    }
  }
  return finalTransactions;
}

export function collectUtxosForAmount(
  utxoList: any[],
  amountSats: number,
  recipientAddress: string,
  senderAddress: string
): TransactionPlan {
  // Sort UTXOs by value (ascending)
  const sortedUtxos = [...utxoList].sort((a, b) => a.value - b.value);

  const totalAvailable = sortedUtxos.reduce((sum, u) => sum + u.value, 0);

  if (totalAvailable < amountSats) {
    return {
      success: false,
      transactions: [],
      error: `Insufficient funds. Available: ${totalAvailable / SAT} ALPHA, Required: ${amountSats / SAT} ALPHA`,
    };
  }

  const transactions = [];
  let remainingAmount = amountSats;

  for (const utxo of sortedUtxos) {
    if (remainingAmount <= 0) break;

    const utxoValue = utxo.value;
    let txAmount = 0;
    let changeAmount = 0;

    if (utxoValue >= remainingAmount + FEE) {
      // Covers remaining + fee
      txAmount = remainingAmount;
      changeAmount = utxoValue - remainingAmount - FEE;
      remainingAmount = 0;
    } else {
      // Use entire UTXO minus fee
      txAmount = utxoValue - FEE;
      remainingAmount -= txAmount;

      if (txAmount <= 0) continue;
    }

    const tx: any = {
      input: {
        txid: utxo.txid ?? utxo.tx_hash,
        vout: utxo.vout ?? utxo.tx_pos,
        value: utxo.value,
        address: utxo.address,
      },
      outputs: [
        { address: recipientAddress, value: txAmount }
      ],
      fee: FEE,
      changeAmount: changeAmount,
      changeAddress: senderAddress
    };

    if (changeAmount > DUST) {
      tx.outputs.push({ value: changeAmount, address: senderAddress });
    }

    transactions.push(tx);
  }

  if (remainingAmount > 0) {
    return {
      success: false,
      transactions: [],
      error: `Unable to collect enough UTXOs. Short by ${remainingAmount / SAT} ALPHA after fees.`,
    };
  }

  const rebalanced = rebalanceDustOutputs(transactions, recipientAddress, senderAddress, sortedUtxos, FEE);

  return {
    success: true,
    transactions: rebalanced,
  };
}

export async function createTransactionPlan(
  wallet: Wallet,
  toAddress: string,
  amountAlpha: number
): Promise<TransactionPlan> {
  // Validate address early
  if (!decodeBech32(toAddress)) throw new Error("Invalid recipient address");

  const fromAddress = wallet.addresses[0].address;
  const amountSats = alphaToSats(amountAlpha);

  const utxos = await getUtxo(fromAddress);
  if (!Array.isArray(utxos) || utxos.length === 0) {
    throw new Error("No UTXOs available");
  }

  return collectUtxosForAmount(utxos, amountSats, toAddress, fromAddress);
}

// --------------------------------------------------
// SIGN (uses childPrivateKey or masterPrivateKey)
// --------------------------------------------------
export function createAndSignTransaction(wallet: Wallet, txPlan: any) {
  const inputAddress = txPlan.input.address;
  const walletAddress = wallet.addresses.find((a) => a.address === inputAddress);

  if (!walletAddress) {
    throw new Error(`Address ${inputAddress} not found in wallet`);
  }

  const privHex = walletAddress.privateKey;

  if (!privHex) throw new Error("No private key in wallet address");

  const keyPair = ec.keyFromPrivate(privHex, "hex");
  const publicKey = keyPair.getPublic(true, "hex");

  return buildSegWitTransaction(txPlan, keyPair, publicKey);
}

// --------------------------------------------------
// FINAL SEND
// --------------------------------------------------
export async function sendAlpha(
  wallet: Wallet,
  toAddress: string,
  amountAlpha: number
) {
  const plan = await createTransactionPlan(wallet, toAddress, amountAlpha);

  if (!plan.success) {
    throw new Error(plan.error || "Transaction planning failed");
  }

  const results = [];

  for (const tx of plan.transactions) {
    const signed = createAndSignTransaction(wallet, tx);
    const result = await broadcast(signed.raw);
    results.push({
      txid: signed.txid,
      raw: signed.raw,
      broadcastResult: result,
    });
  }

  return results;
}
