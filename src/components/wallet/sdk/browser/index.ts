/**
 * Browser-specific implementations for Unicity Wallet SDK
 *
 * This module contains all browser-specific code that depends on:
 * - WebSocket API
 * - localStorage
 * - IndexedDB
 * - FileReader / Blob / File API
 * - document.createElement (for downloads)
 *
 * Usage:
 * ```typescript
 * import { L1Wallet } from '@unicity/wallet-sdk';
 * import {
 *   BrowserWSAdapter,
 *   IndexedDBVestingCache,
 *   getBrowserProvider,
 *   getVestingState,
 * } from '@unicity/wallet-sdk/browser';
 *
 * // Use singleton providers
 * const provider = getBrowserProvider();
 * await provider.connect();
 *
 * // Or create custom instances
 * const wallet = new L1Wallet(
 *   new BrowserWSAdapter(),
 *   new IndexedDBVestingCache()
 * );
 * ```
 */

// ==========================================
// WebSocket Adapter
// ==========================================

export { BrowserWSAdapter } from './BrowserWSAdapter';

// ==========================================
// Network Provider
// ==========================================

export {
  BrowserNetworkProvider,
  getBrowserProvider,
  disposeBrowserProvider,
} from './BrowserNetworkProvider';

// ==========================================
// Vesting
// ==========================================

export { IndexedDBVestingCache } from './IndexedDBVestingCache';

export {
  BrowserVestingClassifier,
  getVestingClassifier,
  VESTING_THRESHOLD,
  type ClassificationResult,
  type ClassifiedUTXO,
  type ClassifyUtxosResult,
} from './BrowserVestingClassifier';

export {
  VestingStateManager,
  getVestingState,
  type VestingMode,
  type VestingBalances,
} from './VestingStateManager';

// ==========================================
// Storage
// ==========================================

export {
  BrowserWalletStorage,
  saveToStorage,
  loadFromStorage,
  deleteFromStorage,
  hasInStorage,
  type StorageKeyConfig,
  type StoredWalletEntry,
} from './storage';

// ==========================================
// Wallet Operations
// ==========================================

export {
  BrowserWalletFactory,
  createWallet,
  generateAddress,
  type BrowserWallet,
} from './wallet';

// ==========================================
// Transactions
// ==========================================

export {
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
} from './tx';

// ==========================================
// Import/Export
// ==========================================

export {
  // File reading
  readBinaryFile,
  readTextFile,
  yieldToMain,
  // Import
  importWalletFromFile,
  importWalletFromJSON,
  // Export
  exportWalletToText,
  exportWalletToJSON,
  // Download
  downloadTextFile,
  downloadWalletText,
  downloadWalletJSON,
  downloadJSON,
  // Detection
  isJSONWalletFormat,
  detectWalletFileFormat,
  // Types
  type ImportWalletResult,
  type ImportWalletOptions,
  type ExportToTextOptions,
  type ExportToJSONOptions,
} from './import-export';
