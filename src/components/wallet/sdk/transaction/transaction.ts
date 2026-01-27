/**
 * Transaction building and signing
 *
 * Pure functions for creating SegWit transactions.
 * No browser APIs - can run anywhere.
 */

import CryptoJS from 'crypto-js';
import elliptic from 'elliptic';
import { createScriptPubKey } from '../address/script';
import type {
  L1UTXO,
  L1TxOutput,
  L1PlannedTx,
  L1TxPlanResult,
} from '../types';

const ec = new elliptic.ec('secp256k1');

// ==========================================
// Transaction-specific Types
// ==========================================

/**
 * Transaction input for building (uses tx_hash/tx_pos format)
 */
export interface TxInput {
  tx_hash: string;
  tx_pos: number;
  value: number;
}

/**
 * Transaction output for building
 */
export interface TxOutput {
  address: string;
  value: number;
}

/**
 * Transaction plan for building
 */
export interface TxPlan {
  input: TxInput;
  outputs: TxOutput[];
}

/**
 * Built transaction result
 */
export interface BuiltTransaction {
  hex: string;
  txid: string;
}

// Re-export L1 types for UTXO selection (with local aliases for backwards compatibility)
export type UTXOInput = L1UTXO;
export type TransactionOutput = L1TxOutput;
export type PlannedTransaction = L1PlannedTx;
export type TransactionPlanResult = L1TxPlanResult;

// ==========================================
// Constants
// ==========================================

export const TX_FEE = 10_000; // sats per transaction
export const DUST_THRESHOLD = 546; // dust threshold
export const SATS_PER_COIN = 100_000_000; // sats in 1 ALPHA

// ==========================================
// Signature hash (BIP143)
// ==========================================

/**
 * Create signature hash for SegWit (BIP143)
 */
export function createSignatureHash(txPlan: TxPlan, publicKey: string): string {
  let preimage = '';

  // 1. nVersion (4 bytes, little-endian)
  preimage += '02000000';

  // 2. hashPrevouts (32 bytes)
  const txidBytes = txPlan.input.tx_hash.match(/../g)!.reverse().join('');
  const voutBytes = ('00000000' + txPlan.input.tx_pos.toString(16)).slice(-8).match(/../g)!.reverse().join('');
  const prevouts = txidBytes + voutBytes;
  const hashPrevouts = CryptoJS.SHA256(CryptoJS.SHA256(CryptoJS.enc.Hex.parse(prevouts))).toString();
  preimage += hashPrevouts;

  // 3. hashSequence (32 bytes)
  const sequence = 'feffffff';
  const hashSequence = CryptoJS.SHA256(CryptoJS.SHA256(CryptoJS.enc.Hex.parse(sequence))).toString();
  preimage += hashSequence;

  // 4. outpoint (36 bytes)
  preimage += txPlan.input.tx_hash.match(/../g)!.reverse().join('');
  preimage += ('00000000' + txPlan.input.tx_pos.toString(16)).slice(-8).match(/../g)!.reverse().join('');

  // 5. scriptCode for P2WPKH (includes length prefix)
  const pubKeyHash = CryptoJS.RIPEMD160(CryptoJS.SHA256(CryptoJS.enc.Hex.parse(publicKey))).toString();
  const scriptCode = '1976a914' + pubKeyHash + '88ac';
  preimage += scriptCode;

  // 6. amount (8 bytes, little-endian)
  const amountHex = txPlan.input.value.toString(16).padStart(16, '0');
  preimage += amountHex.match(/../g)!.reverse().join('');

  // 7. nSequence (4 bytes, little-endian)
  preimage += sequence;

  // 8. hashOutputs (32 bytes)
  let outputs = '';
  for (const output of txPlan.outputs) {
    const outAmountHex = output.value.toString(16).padStart(16, '0');
    outputs += outAmountHex.match(/../g)!.reverse().join('');
    const scriptPubKey = createScriptPubKey(output.address);
    const scriptLength = (scriptPubKey.length / 2).toString(16).padStart(2, '0');
    outputs += scriptLength;
    outputs += scriptPubKey;
  }
  const hashOutputs = CryptoJS.SHA256(CryptoJS.SHA256(CryptoJS.enc.Hex.parse(outputs))).toString();
  preimage += hashOutputs;

  // 9. nLocktime (4 bytes, little-endian)
  preimage += '00000000';

  // 10. sighash type (4 bytes, little-endian)
  preimage += '01000000'; // SIGHASH_ALL

  // Double SHA256
  const hash1 = CryptoJS.SHA256(CryptoJS.enc.Hex.parse(preimage));
  const hash2 = CryptoJS.SHA256(hash1);
  return hash2.toString();
}

// ==========================================
// Witness data
// ==========================================

/**
 * Create witness data for the transaction
 */
export function createWitnessData(
  txPlan: TxPlan,
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

  const derSig = signature.toDER('hex') + '01'; // SIGHASH_ALL

  // Build witness
  let witness = '';
  witness += '02'; // 2 stack items

  // Signature
  const sigLen = (derSig.length / 2).toString(16).padStart(2, '0');
  witness += sigLen;
  witness += derSig;

  // Public key
  const pubKeyLen = (publicKey.length / 2).toString(16).padStart(2, '0');
  witness += pubKeyLen;
  witness += publicKey;

  return witness;
}

// ==========================================
// Transaction building
// ==========================================

/**
 * Build a proper SegWit transaction
 *
 * @param txPlan - Transaction plan with input and outputs
 * @param keyPair - Elliptic key pair for signing
 * @param publicKey - Compressed public key hex
 * @returns Built transaction with hex and txid
 */
export function buildSegWitTransaction(
  txPlan: TxPlan,
  keyPair: elliptic.ec.KeyPair,
  publicKey: string
): BuiltTransaction {
  let txHex = '';

  // Version (4 bytes, little-endian)
  txHex += '02000000'; // version 2

  // Marker and flag for SegWit
  txHex += '00'; // marker
  txHex += '01'; // flag

  // Number of inputs (varint)
  txHex += '01'; // 1 input

  // Input - Previous tx hash (32 bytes, reversed for little-endian)
  const prevTxHash = txPlan.input.tx_hash;
  const reversedHash = prevTxHash.match(/../g)!.reverse().join('');
  txHex += reversedHash;

  // Previous output index (4 bytes, little-endian)
  const vout = txPlan.input.tx_pos;
  txHex += ('00000000' + vout.toString(16)).slice(-8).match(/../g)!.reverse().join('');

  // Script length (varint) - 0 for witness transactions
  txHex += '00';

  // Sequence (4 bytes)
  txHex += 'feffffff';

  // Number of outputs (varint)
  const outputCount = txPlan.outputs.length;
  txHex += ('0' + outputCount.toString(16)).slice(-2);

  // Outputs
  for (const output of txPlan.outputs) {
    // Amount (8 bytes, little-endian)
    const amountHex = output.value.toString(16).padStart(16, '0');
    txHex += amountHex.match(/../g)!.reverse().join('');

    // Script pubkey
    const scriptPubKey = createScriptPubKey(output.address);
    const scriptLength = (scriptPubKey.length / 2).toString(16).padStart(2, '0');
    txHex += scriptLength;
    txHex += scriptPubKey;
  }

  // Witness data
  const witnessData = createWitnessData(txPlan, keyPair, publicKey);
  txHex += witnessData;

  // Locktime (4 bytes)
  txHex += '00000000';

  // Calculate transaction ID (double SHA256 of tx without witness data)
  let txForId = '';

  // Version (4 bytes)
  txForId += '02000000';

  // Input count (1 byte)
  txForId += '01';

  // Input: txid (32 bytes reversed) + vout (4 bytes)
  const inputTxidBytes = txPlan.input.tx_hash.match(/../g)!.reverse().join('');
  txForId += inputTxidBytes;
  txForId += ('00000000' + txPlan.input.tx_pos.toString(16)).slice(-8).match(/../g)!.reverse().join('');

  // Script sig (empty for P2WPKH)
  txForId += '00';

  // Sequence (4 bytes)
  txForId += 'feffffff';

  // Output count
  txForId += ('0' + txPlan.outputs.length.toString(16)).slice(-2);

  // Add all outputs
  for (const output of txPlan.outputs) {
    const amountHex = ('0000000000000000' + output.value.toString(16)).slice(-16);
    const amountLittleEndian = amountHex.match(/../g)!.reverse().join('');
    txForId += amountLittleEndian;

    const scriptPubKey = createScriptPubKey(output.address);
    const scriptLength = ('0' + (scriptPubKey.length / 2).toString(16)).slice(-2);
    txForId += scriptLength;
    txForId += scriptPubKey;
  }

  // Locktime (4 bytes)
  txForId += '00000000';

  // Calculate the correct txid
  const hash1 = CryptoJS.SHA256(CryptoJS.enc.Hex.parse(txForId));
  const hash2 = CryptoJS.SHA256(hash1);
  const txid = hash2.toString().match(/../g)!.reverse().join('');

  return {
    hex: txHex,
    txid: txid,
  };
}

/**
 * Sign a transaction with a private key
 *
 * @param txPlan - Transaction plan
 * @param privateKeyHex - Private key in hex format
 * @returns Built and signed transaction
 */
export function signTransaction(
  txPlan: TxPlan,
  privateKeyHex: string
): BuiltTransaction {
  const keyPair = ec.keyFromPrivate(privateKeyHex, 'hex');
  const publicKey = keyPair.getPublic(true, 'hex'); // compressed
  return buildSegWitTransaction(txPlan, keyPair, publicKey);
}

// ==========================================
// UTXO selection
// ==========================================

/**
 * Collect UTXOs for required amount
 *
 * Strategy: First try to find a single UTXO that can cover amount + fee.
 * If not found, fall back to combining multiple UTXOs.
 *
 * @param utxoList - List of available UTXOs
 * @param amountSats - Amount to send in satoshis
 * @param recipientAddress - Recipient address
 * @param senderAddress - Sender address for change
 * @param fee - Transaction fee (default: TX_FEE)
 * @param dust - Dust threshold (default: DUST_THRESHOLD)
 * @returns Transaction plan result
 */
export function selectUtxos(
  utxoList: UTXOInput[],
  amountSats: number,
  recipientAddress: string,
  senderAddress: string,
  fee: number = TX_FEE,
  dust: number = DUST_THRESHOLD
): TransactionPlanResult {
  const totalAvailable = utxoList.reduce((sum, u) => sum + u.value, 0);

  if (totalAvailable < amountSats + fee) {
    return {
      success: false,
      transactions: [],
      error: `Insufficient funds. Available: ${totalAvailable / SATS_PER_COIN}, Required: ${(amountSats + fee) / SATS_PER_COIN} (including fee)`,
    };
  }

  // Strategy 1: Find a single UTXO that covers amount + fee
  // Sort by value ascending to find the smallest sufficient UTXO
  const sortedByValue = [...utxoList].sort((a, b) => a.value - b.value);
  const sufficientUtxo = sortedByValue.find(u => u.value >= amountSats + fee);

  if (sufficientUtxo) {
    const changeAmount = sufficientUtxo.value - amountSats - fee;
    const tx: PlannedTransaction = {
      input: {
        txid: sufficientUtxo.txid ?? sufficientUtxo.tx_hash ?? '',
        vout: sufficientUtxo.vout ?? sufficientUtxo.tx_pos ?? 0,
        value: sufficientUtxo.value,
        address: sufficientUtxo.address ?? senderAddress,
      },
      outputs: [{ address: recipientAddress, value: amountSats }],
      fee: fee,
      changeAmount: changeAmount,
      changeAddress: senderAddress,
    };

    // Add change output if above dust
    if (changeAmount > dust) {
      tx.outputs.push({ value: changeAmount, address: senderAddress });
    }

    return {
      success: true,
      transactions: [tx],
    };
  }

  // Strategy 2: No single UTXO is sufficient, combine multiple UTXOs
  // Sort descending to use larger UTXOs first (fewer transactions)
  const sortedDescending = [...utxoList].sort((a, b) => b.value - a.value);

  const transactions: PlannedTransaction[] = [];
  let remainingAmount = amountSats;

  for (const utxo of sortedDescending) {
    if (remainingAmount <= 0) break;

    const utxoValue = utxo.value;
    let txAmount = 0;
    let changeAmount = 0;

    if (utxoValue >= remainingAmount + fee) {
      // This UTXO covers the remaining amount plus fee
      txAmount = remainingAmount;
      changeAmount = utxoValue - remainingAmount - fee;
      remainingAmount = 0;
    } else {
      // Use entire UTXO minus fee
      txAmount = utxoValue - fee;
      if (txAmount <= 0) continue; // Skip UTXOs too small to cover fee
      remainingAmount -= txAmount;
    }

    const tx: PlannedTransaction = {
      input: {
        txid: utxo.txid ?? utxo.tx_hash ?? '',
        vout: utxo.vout ?? utxo.tx_pos ?? 0,
        value: utxo.value,
        address: utxo.address ?? senderAddress,
      },
      outputs: [{ address: recipientAddress, value: txAmount }],
      fee: fee,
      changeAmount: changeAmount,
      changeAddress: senderAddress,
    };

    // Add change output if above dust
    if (changeAmount > dust) {
      tx.outputs.push({ value: changeAmount, address: senderAddress });
    }

    transactions.push(tx);
  }

  if (remainingAmount > 0) {
    return {
      success: false,
      transactions: [],
      error: `Unable to collect enough UTXOs. Short by ${remainingAmount / SATS_PER_COIN} after fees.`,
    };
  }

  return {
    success: true,
    transactions,
  };
}

// ==========================================
// Broadcast utilities
// ==========================================

/**
 * Result of broadcasting a signed transaction
 */
export interface BroadcastResult {
  txid: string;
  raw: string;
  broadcastResult: string;
}

/**
 * Broadcast signed transactions
 *
 * Pure function - takes broadcast function as parameter.
 * Platform implementations provide the actual broadcast method.
 *
 * @param signedTxs - Array of signed transactions (hex and txid)
 * @param broadcast - Broadcast function from network provider
 * @returns Array of broadcast results
 */
export async function broadcastTransactions(
  signedTxs: Array<{ raw: string; txid: string }>,
  broadcast: (rawHex: string) => Promise<string>
): Promise<BroadcastResult[]> {
  const results: BroadcastResult[] = [];

  for (const tx of signedTxs) {
    const result = await broadcast(tx.raw);
    results.push({
      txid: tx.txid,
      raw: tx.raw,
      broadcastResult: result,
    });
  }

  return results;
}
