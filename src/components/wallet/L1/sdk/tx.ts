/**
 * Transaction handling - Strict copy of index.html logic
 */
import { getUtxo, broadcast } from "./network";
import { decodeBech32 } from "./bech32";
import CryptoJS from "crypto-js";
import elliptic from "elliptic";
import type { Wallet, TransactionPlan, Transaction, UTXO } from "./types";

const ec = new elliptic.ec("secp256k1");

// Constants
const FEE = 10_000; // sats per transaction
const DUST = 546; // dust threshold
const SAT = 100_000_000; // sats in 1 ALPHA

/**
 * Create scriptPubKey for address (P2WPKH for bech32)
 * Exact copy from index.html
 */
export function createScriptPubKey(address: string): string {
  if (!address || typeof address !== "string") {
    throw new Error("Invalid address: must be a string");
  }

  const decoded = decodeBech32(address);
  if (!decoded) {
    throw new Error("Invalid bech32 address: " + address);
  }

  // Convert data array to hex string
  const dataHex = Array.from(decoded.data)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  // P2WPKH scriptPubKey: OP_0 <20-byte-key-hash>
  return "0014" + dataHex;
}

/**
 * Create signature hash for SegWit (BIP143)
 * Exact copy from index.html createSignatureHash()
 */
function createSignatureHash(
  txPlan: { input: { tx_hash: string; tx_pos: number; value: number }; outputs: Array<{ value: number; address: string }> },
  publicKey: string
): string {
  let preimage = "";

  // 1. nVersion (4 bytes, little-endian)
  preimage += "02000000";

  // 2. hashPrevouts (32 bytes)
  const txidBytes = txPlan.input.tx_hash.match(/../g)!.reverse().join("");
  const voutBytes = ("00000000" + txPlan.input.tx_pos.toString(16)).slice(-8).match(/../g)!.reverse().join("");
  const prevouts = txidBytes + voutBytes;
  const hashPrevouts = CryptoJS.SHA256(CryptoJS.SHA256(CryptoJS.enc.Hex.parse(prevouts))).toString();
  preimage += hashPrevouts;

  // 3. hashSequence (32 bytes)
  const sequence = "feffffff";
  const hashSequence = CryptoJS.SHA256(CryptoJS.SHA256(CryptoJS.enc.Hex.parse(sequence))).toString();
  preimage += hashSequence;

  // 4. outpoint (36 bytes)
  preimage += txPlan.input.tx_hash.match(/../g)!.reverse().join("");
  preimage += ("00000000" + txPlan.input.tx_pos.toString(16)).slice(-8).match(/../g)!.reverse().join("");

  // 5. scriptCode for P2WPKH (includes length prefix)
  const pubKeyHash = CryptoJS.RIPEMD160(CryptoJS.SHA256(CryptoJS.enc.Hex.parse(publicKey))).toString();
  const scriptCode = "1976a914" + pubKeyHash + "88ac";
  preimage += scriptCode;

  // 6. amount (8 bytes, little-endian)
  const amountHex = txPlan.input.value.toString(16).padStart(16, "0");
  preimage += amountHex.match(/../g)!.reverse().join("");

  // 7. nSequence (4 bytes, little-endian)
  preimage += sequence;

  // 8. hashOutputs (32 bytes)
  let outputs = "";
  for (const output of txPlan.outputs) {
    const outAmountHex = output.value.toString(16).padStart(16, "0");
    outputs += outAmountHex.match(/../g)!.reverse().join("");
    const scriptPubKey = createScriptPubKey(output.address);
    const scriptLength = (scriptPubKey.length / 2).toString(16).padStart(2, "0");
    outputs += scriptLength;
    outputs += scriptPubKey;
  }
  const hashOutputs = CryptoJS.SHA256(CryptoJS.SHA256(CryptoJS.enc.Hex.parse(outputs))).toString();
  preimage += hashOutputs;

  // 9. nLocktime (4 bytes, little-endian)
  preimage += "00000000";

  // 10. sighash type (4 bytes, little-endian)
  preimage += "01000000"; // SIGHASH_ALL

  // Double SHA256
  const hash1 = CryptoJS.SHA256(CryptoJS.enc.Hex.parse(preimage));
  const hash2 = CryptoJS.SHA256(hash1);
  return hash2.toString();
}

/**
 * Create witness data for the transaction
 * Exact copy from index.html createWitnessData()
 */
function createWitnessData(
  txPlan: { input: { tx_hash: string; tx_pos: number; value: number }; outputs: Array<{ value: number; address: string }> },
  keyPair: elliptic.ec.KeyPair,
  publicKey: string
): string {
  // Create signature hash for witness
  const sigHash = createSignatureHash(txPlan, publicKey);

  // Sign the hash
  const signature = keyPair.sign(sigHash);

  // Ensure low-S canonical signature (BIP62)
  const halfOrder = ec.curve.n!.shrn(1);
  if (signature.s.cmp(halfOrder) > 0) {
    signature.s = ec.curve.n!.sub(signature.s);
  }

  const derSig = signature.toDER("hex") + "01"; // SIGHASH_ALL

  // Build witness
  let witness = "";
  witness += "02"; // 2 stack items

  // Signature
  const sigLen = (derSig.length / 2).toString(16).padStart(2, "0");
  witness += sigLen;
  witness += derSig;

  // Public key
  const pubKeyLen = (publicKey.length / 2).toString(16).padStart(2, "0");
  witness += pubKeyLen;
  witness += publicKey;

  return witness;
}

/**
 * Build a proper SegWit transaction
 * Exact copy from index.html buildSegWitTransaction()
 */
export function buildSegWitTransaction(
  txPlan: { input: { tx_hash: string; tx_pos: number; value: number }; outputs: Array<{ value: number; address: string }> },
  keyPair: elliptic.ec.KeyPair,
  publicKey: string
): { hex: string; txid: string } {
  let txHex = "";

  // Version (4 bytes, little-endian)
  txHex += "02000000"; // version 2

  // Marker and flag for SegWit
  txHex += "00"; // marker
  txHex += "01"; // flag

  // Number of inputs (varint)
  txHex += "01"; // 1 input

  // Input - Previous tx hash (32 bytes, reversed for little-endian)
  const prevTxHash = txPlan.input.tx_hash;
  const reversedHash = prevTxHash.match(/../g)!.reverse().join("");
  txHex += reversedHash;

  // Previous output index (4 bytes, little-endian)
  const vout = txPlan.input.tx_pos;
  txHex += ("00000000" + vout.toString(16)).slice(-8).match(/../g)!.reverse().join("");

  // Script length (varint) - 0 for witness transactions
  txHex += "00";

  // Sequence (4 bytes)
  txHex += "feffffff";

  // Number of outputs (varint)
  const outputCount = txPlan.outputs.length;
  txHex += ("0" + outputCount.toString(16)).slice(-2);

  // Outputs
  for (const output of txPlan.outputs) {
    // Amount (8 bytes, little-endian)
    const amountHex = output.value.toString(16).padStart(16, "0");
    txHex += amountHex.match(/../g)!.reverse().join("");

    // Script pubkey
    const scriptPubKey = createScriptPubKey(output.address);
    const scriptLength = (scriptPubKey.length / 2).toString(16).padStart(2, "0");
    txHex += scriptLength;
    txHex += scriptPubKey;
  }

  // Witness data
  const witnessData = createWitnessData(txPlan, keyPair, publicKey);
  txHex += witnessData;

  // Locktime (4 bytes)
  txHex += "00000000";

  // Calculate transaction ID (double SHA256 of tx without witness data)
  let txForId = "";

  // Version (4 bytes)
  txForId += "02000000";

  // Input count (1 byte)
  txForId += "01";

  // Input: txid (32 bytes reversed) + vout (4 bytes)
  const inputTxidBytes = txPlan.input.tx_hash.match(/../g)!.reverse().join("");
  txForId += inputTxidBytes;
  txForId += ("00000000" + txPlan.input.tx_pos.toString(16)).slice(-8).match(/../g)!.reverse().join("");

  // Script sig (empty for P2WPKH)
  txForId += "00";

  // Sequence (4 bytes)
  txForId += "feffffff";

  // Output count
  txForId += ("0" + txPlan.outputs.length.toString(16)).slice(-2);

  // Add all outputs
  for (const output of txPlan.outputs) {
    const amountHex = ("0000000000000000" + output.value.toString(16)).slice(-16);
    const amountLittleEndian = amountHex.match(/../g)!.reverse().join("");
    txForId += amountLittleEndian;

    const scriptPubKey = createScriptPubKey(output.address);
    const scriptLength = ("0" + (scriptPubKey.length / 2).toString(16)).slice(-2);
    txForId += scriptLength;
    txForId += scriptPubKey;
  }

  // Locktime (4 bytes)
  txForId += "00000000";

  // Calculate the correct txid
  const hash1 = CryptoJS.SHA256(CryptoJS.enc.Hex.parse(txForId));
  const hash2 = CryptoJS.SHA256(hash1);
  const txid = hash2.toString().match(/../g)!.reverse().join("");

  return {
    hex: txHex,
    txid: txid,
  };
}

/**
 * Create and sign a transaction
 * Uses the private key for the specific address being spent from
 */
export function createAndSignTransaction(
  wallet: Wallet,
  txPlan: Transaction
): { raw: string; txid: string } {
  // Find the address entry that matches the input address
  const fromAddress = txPlan.input.address;
  const addressEntry = wallet.addresses.find(a => a.address === fromAddress);

  // Use the private key from the address entry, or fall back to childPrivateKey/masterPrivateKey
  let privateKeyHex: string | undefined;

  if (addressEntry?.privateKey) {
    // Use the specific private key for this address
    privateKeyHex = addressEntry.privateKey;
  } else if (wallet.childPrivateKey) {
    // Fall back to childPrivateKey (first address)
    privateKeyHex = wallet.childPrivateKey;
  } else {
    // Last resort: use master key
    privateKeyHex = wallet.masterPrivateKey;
  }

  if (!privateKeyHex) {
    throw new Error("No private key available for address: " + fromAddress);
  }

  const keyPair = ec.keyFromPrivate(privateKeyHex, "hex");
  const publicKey = keyPair.getPublic(true, "hex"); // compressed

  // Convert Transaction to the format expected by buildSegWitTransaction
  const txPlanForBuild = {
    input: {
      tx_hash: txPlan.input.txid,
      tx_pos: txPlan.input.vout,
      value: txPlan.input.value,
    },
    outputs: txPlan.outputs,
  };

  const tx = buildSegWitTransaction(txPlanForBuild, keyPair, publicKey);

  return {
    raw: tx.hex,
    txid: tx.txid,
  };
}

/**
 * Collect UTXOs for required amount
 * Based on index.html collectUtxosForAmount()
 */
export function collectUtxosForAmount(
  utxoList: UTXO[],
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

  const transactions: Transaction[] = [];
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

    const tx: Transaction = {
      input: {
        txid: utxo.txid ?? utxo.tx_hash ?? "",
        vout: utxo.vout ?? utxo.tx_pos ?? 0,
        value: utxo.value,
        address: utxo.address ?? senderAddress,
      },
      outputs: [{ address: recipientAddress, value: txAmount }],
      fee: FEE,
      changeAmount: changeAmount,
      changeAddress: senderAddress,
    };

    // Add change output if above dust
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

  return {
    success: true,
    transactions,
  };
}

/**
 * Create transaction plan from wallet
 * @param wallet - The wallet
 * @param toAddress - Recipient address
 * @param amountAlpha - Amount in ALPHA
 * @param fromAddress - Optional: specific address to send from (defaults to first address)
 */
export async function createTransactionPlan(
  wallet: Wallet,
  toAddress: string,
  amountAlpha: number,
  fromAddress?: string
): Promise<TransactionPlan> {
  if (!decodeBech32(toAddress)) {
    throw new Error("Invalid recipient address");
  }

  // Use specified fromAddress or default to first address
  const senderAddress = fromAddress || wallet.addresses[0].address;
  const amountSats = Math.floor(amountAlpha * SAT);

  const utxos = await getUtxo(senderAddress);
  if (!Array.isArray(utxos) || utxos.length === 0) {
    throw new Error("No UTXOs available for address: " + senderAddress);
  }

  return collectUtxosForAmount(utxos, amountSats, toAddress, senderAddress);
}

/**
 * Send ALPHA to address
 * @param wallet - The wallet
 * @param toAddress - Recipient address
 * @param amountAlpha - Amount in ALPHA
 * @param fromAddress - Optional: specific address to send from
 */
export async function sendAlpha(
  wallet: Wallet,
  toAddress: string,
  amountAlpha: number,
  fromAddress?: string
) {
  const plan = await createTransactionPlan(wallet, toAddress, amountAlpha, fromAddress);

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
