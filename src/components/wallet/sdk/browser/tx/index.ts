/**
 * Browser Transaction Submodule
 *
 * Browser-specific transaction helpers:
 * - Transaction planning with vesting support
 * - Transaction signing and broadcasting
 * - Send ALPHA functionality
 */

export {
  // Browser-specific functions
  createAndSignTransaction,
  collectUtxosForAmount,
  createTransactionPlan,
  sendAlpha,
  broadcastTransaction,
  // Re-exports from SDK
  buildSegWitTransaction,
  signTransaction,
  selectUtxos,
  TX_FEE,
  DUST_THRESHOLD,
  SATS_PER_COIN,
  // Types
  type TransactionInput,
  type TransactionOutput,
  type Transaction,
  type TransactionPlan,
  type SignedTransaction,
  type SendResult,
} from './transaction';
