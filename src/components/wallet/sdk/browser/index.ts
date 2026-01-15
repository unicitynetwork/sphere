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
  createWalletStorage,
  DEFAULT_WALLET_STORAGE_CONFIG,
  // Generic utilities
  saveToStorage,
  loadFromStorage,
  deleteFromStorage,
  hasInStorage,
  // Wallet-specific functions
  saveWalletToStorage,
  loadWalletFromStorage,
  deleteWalletFromStorage,
  getAllStoredWallets,
  // Types
  type StorageKeyConfig,
  type StoredWalletEntry,
} from './storage';

// ==========================================
// Storage Keys
// ==========================================

export {
  DEFAULT_STORAGE_PREFIX,
  WALLET_STORAGE_KEYS,
  WALLET_KEY_GENERATORS,
  WALLET_KEY_PREFIXES,
  INDEXEDDB_NAMES,
  buildStorageKey,
  buildWalletStorageKeys,
  buildWalletKeyGenerators,
  buildWalletKeyPrefixes,
  type WalletStorageKey,
  type WalletKeyPrefix,
} from './storageKeys';

// ==========================================
// Wallet Operations
// ==========================================

export {
  BrowserWalletFactory,
  getDefaultWalletFactory,
  // Pure functions (without storage)
  createWallet,
  generateAddress,
  // Functions with default storage
  createAndSaveWallet,
  loadWallet,
  deleteWallet,
  generateAndSaveAddress,
  // Types
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
