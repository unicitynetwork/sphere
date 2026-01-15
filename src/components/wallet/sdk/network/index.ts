/**
 * Network Module (Platform-Independent)
 *
 * Provides network interfaces and utilities:
 * - WebSocket adapter interface for platform-specific implementations
 * - Network provider interface for blockchain operations
 * - Utility functions for balance and UTXO operations
 */

// WebSocket adapter interface
export type {
  WebSocketAdapter,
  WebSocketState,
  MessageHandler,
  CloseHandler,
  ErrorHandler,
} from './websocket';

// Network provider interface and utilities
export {
  getTotalBalance,
  getAllUtxos,
  waitForConfirmation,
} from './network';

export type {
  L1NetworkProviderFull,
  BlockHeader,
  TransactionHistoryItem,
  TransactionDetail,
} from './network';
