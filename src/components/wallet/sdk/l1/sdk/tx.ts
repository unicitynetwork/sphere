// sdk/l1/tx.ts

import { getUtxo, broadcast } from "./network";
import CryptoJS from "crypto-js";
import elliptic from "elliptic";
import { decodeBech32 } from "./bech32";
import type { Wallet } from "./types";

const ec = new elliptic.ec("secp256k1");

// -------------------------------------
// CONSTANTS (как в index.html)
// -------------------------------------
const FEE = 10000;
const DUST = 546;
const SAT = 100000000;

// -------------------------------------
// HELPERS
// -------------------------------------

function alphaToSats(alpha: number) {
  return Math.floor(alpha * SAT);
}

function toLittleEndianHex(value: number | bigint, bytes: number) {
  const hex = BigInt(value).toString(16).padStart(bytes * 2, "0");
  return hex.match(/../g)!.reverse().join("");
}

function pickUtxo(utxos: any[], amountSats: number) {
  for (const u of utxos) {
    if (u.value >= amountSats + FEE) return u;
  }
  throw new Error("Insufficient funds");
}

// -------------------------------------
// SCRIPT PUBKEY (P2WPKH)
// -------------------------------------
export function createScriptPubKey(address: string): string {
  const decoded = decodeBech32(address);
  if (!decoded) throw new Error("Invalid bech32 address: " + address);

  const programHex = decoded.data
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return "0014" + programHex;
}

// -------------------------------------
// SIGNATURE HASH
// -------------------------------------
export function createSignatureHash(txPlan: any, publicKeyHex: string): string {
  let preimage = "";

  preimage += "02000000";

  const prevout =
    txPlan.input.tx_hash.match(/../g).reverse().join("") +
    toLittleEndianHex(txPlan.input.tx_pos, 4);

  const hashPrevouts = CryptoJS.SHA256(
    CryptoJS.SHA256(CryptoJS.enc.Hex.parse(prevout))
  ).toString();
  preimage += hashPrevouts;

  const sequence = "feffffff";
  const hashSequence = CryptoJS.SHA256(
    CryptoJS.SHA256(CryptoJS.enc.Hex.parse(sequence))
  ).toString();
  preimage += hashSequence;

  preimage += txPlan.input.tx_hash.match(/../g).reverse().join("");
  preimage += toLittleEndianHex(txPlan.input.tx_pos, 4);

  const pubKeyHash = CryptoJS.RIPEMD160(
    CryptoJS.SHA256(CryptoJS.enc.Hex.parse(publicKeyHex))
  ).toString();

  const scriptCode = "1976a914" + pubKeyHash + "88ac";
  preimage += scriptCode;

  preimage += toLittleEndianHex(txPlan.input.value, 8);

  preimage += sequence;

  let outputs = "";
  for (const o of txPlan.outputs) {
    outputs += toLittleEndianHex(o.value, 8);
    const spk = createScriptPubKey(o.address);
    outputs += (spk.length / 2).toString(16).padStart(2, "0");
    outputs += spk;
  }

  const hashOutputs = CryptoJS.SHA256(
    CryptoJS.SHA256(CryptoJS.enc.Hex.parse(outputs))
  ).toString();
  preimage += hashOutputs;

  preimage += "00000000";

  preimage += "01000000";

  const hash1 = CryptoJS.SHA256(CryptoJS.enc.Hex.parse(preimage));
  const hash2 = CryptoJS.SHA256(hash1);

  return hash2.toString();
}

// -------------------------------------
// WITNESS BUILDER
// -------------------------------------
export function createWitness(
  txPlan: any,
  publicKey: string,
  privateKey: elliptic.ec.KeyPair
): string {
  const sigHash = createSignatureHash(txPlan, publicKey);

  const signature = privateKey.sign(sigHash);

  const n = privateKey.ec.curve.n!;
  const halfN = n.shrn(1);

  if (signature.s.cmp(halfN) > 0) {
    signature.s = n.sub(signature.s);
  }

  const der = signature.toDER("hex") + "01";

  const derLen = (der.length / 2).toString(16).padStart(2, "0");
  const pubLen = (publicKey.length / 2).toString(16).padStart(2, "0");

  return "02" + derLen + der + pubLen + publicKey;
}

// -------------------------------------
// BUILD FULL SEGWIT TRANSACTION
// -------------------------------------
export function buildSegWitTransaction(
  txPlan: any,
  keyPair: elliptic.ec.KeyPair,
  publicKey: string
) {
  let hex = "";

  hex += "02000000";
  hex += "00" + "01";
  hex += "01";

  hex += txPlan.input.tx_hash.match(/../g).reverse().join("");
  hex += toLittleEndianHex(txPlan.input.tx_pos, 4);
  hex += "00";
  hex += "feffffff";

  hex += txPlan.outputs.length.toString(16).padStart(2, "0");

  for (const o of txPlan.outputs) {
    hex += toLittleEndianHex(o.value, 8);
    const spk = createScriptPubKey(o.address);
    hex += (spk.length / 2).toString(16).padStart(2, "0");
    hex += spk;
  }

  hex += createWitness(txPlan, publicKey, keyPair);

  hex += "00000000";

  let txNoWitness = "";

  txNoWitness += "02000000";
  txNoWitness += "01";
  txNoWitness += txPlan.input.tx_hash.match(/../g).reverse().join("");
  txNoWitness += toLittleEndianHex(txPlan.input.tx_pos, 4);
  txNoWitness += "00";
  txNoWitness += "feffffff";
  txNoWitness += txPlan.outputs.length.toString(16).padStart(2, "0");

  for (const o of txPlan.outputs) {
    txNoWitness += toLittleEndianHex(o.value, 8);
    const spk = createScriptPubKey(o.address);
    txNoWitness += (spk.length / 2).toString(16).padStart(2, "0");
    txNoWitness += spk;
  }

  txNoWitness += "00000000";

  const txid = CryptoJS.SHA256(
    CryptoJS.SHA256(CryptoJS.enc.Hex.parse(txNoWitness))
  )
    .toString()
    .match(/../g)!
    .reverse()
    .join("");

  return { raw: hex, txid };
}

// -------------------------------------
// TOP-LEVEL SIGN FUNCTION
// -------------------------------------
export function createAndSignTransaction(wallet: Wallet, txPlan: any) {
  const priv = wallet.addresses[0].privateKey;
  const keyPair = ec.keyFromPrivate(priv, "hex");
  const publicKey = keyPair.getPublic(true, "hex");

  return buildSegWitTransaction(txPlan, keyPair, publicKey);
}

// -------------------------------------
// TX PLAN
// -------------------------------------
export async function createTransactionPlan(
  wallet: Wallet,
  toAddress: string,
  amountAlpha: number
) {
  const fromAddress = wallet.addresses[0].address;
  const amountSats = alphaToSats(amountAlpha);

  const utxos = await getUtxo(fromAddress);
  if (!utxos.length) throw new Error("No UTXOs available");

  const input = pickUtxo(utxos, amountSats);

  const change = input.value - amountSats - FEE;

  const outputs = [{ value: amountSats, address: toAddress }];

  if (change > DUST) {
    outputs.push({
      value: change,
      address: fromAddress,
    });
  }

  return {
    input: {
      tx_hash: input.tx_hash,
      tx_pos: input.tx_pos,
      value: input.value,
    },
    outputs,
  };
}

// -------------------------------------
// FINAL SEND FUNCTION
// -------------------------------------
export async function sendAlpha(
  wallet: Wallet,
  toAddress: string,
  amountAlpha: number
) {
  const txPlan = await createTransactionPlan(wallet, toAddress, amountAlpha);

  const signed = createAndSignTransaction(wallet, txPlan);

  const result = await broadcast(signed.raw);

  return {
    txid: signed.txid,
    raw: signed.raw,
    broadcastResult: result,
  };
}
