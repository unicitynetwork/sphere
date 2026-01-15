/**
 * Transaction handling for L1 wallet - Re-exports from SDK browser module
 *
 * This file provides backwards compatibility.
 * All implementation is now in ../../sdk/browser/tx.ts
 */

// Re-export all transaction functions from SDK browser
export {
  // Transaction building
  buildSegWitTransaction,
  signTransaction,
  selectUtxos,
  TX_FEE,
  DUST_THRESHOLD,
  SATS_PER_COIN,
  // Browser-specific functions
  createAndSignTransaction,
  collectUtxosForAmount,
  createTransactionPlan,
  sendAlpha,
  broadcastTransaction,
  // Types
  type TransactionInput,
  type TransactionOutput,
  type Transaction,
  type TransactionPlan,
  type SignedTransaction,
  type SendResult,
} from '../../sdk/browser/tx';
