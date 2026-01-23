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
// Network (WebSocket, HTTP)
// ==========================================

export {
  BrowserWSAdapter,
  BrowserNetworkProvider,
  getBrowserProvider,
  disposeBrowserProvider,
} from './network';

// ==========================================
// Vesting (Classification)
// ==========================================

export {
  BrowserVestingClassifier,
  getVestingClassifier,
  VESTING_THRESHOLD,
  type ClassificationResult,
  type ClassifiedUTXO,
  type ClassifyUtxosResult,
  VestingStateManager,
  getVestingState,
  type VestingMode,
  type VestingBalances,
} from './vesting';

// ==========================================
// Storage (localStorage, IndexedDB, Keys)
// ==========================================

export {
  // Storage utilities
  BrowserWalletStorage,
  createWalletStorage,
  DEFAULT_WALLET_STORAGE_CONFIG,
  saveToStorage,
  loadFromStorage,
  deleteFromStorage,
  hasInStorage,
  saveWalletToStorage,
  loadWalletFromStorage,
  deleteWalletFromStorage,
  getAllStoredWallets,
  type StorageKeyConfig,
  type StoredWalletEntry,
  // Storage keys
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
  // Key Manager
  BrowserKeyManager,
  getBrowserKeyManager,
  type BrowserKeyManagerStorageKeys,
  type BrowserKeyManagerConfig,
  type WalletSource,
  type DerivedAddress,
  type WalletInfo,
  type KeyManagerState,
  // IndexedDB Cache
  IndexedDBVestingCache,
} from './storage';

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

// ==========================================
// IPFS Storage
// ==========================================

export {
  // Types
  type IpnsGatewayResult,
  type IpnsProgressiveResult,
  type IpnsPublishResult,
  type IpfsStorageConfig,
  type IpfsStorageStatus,
  type IpfsContentResult,
  type GatewayHealthResult,
  DEFAULT_IPFS_CONFIG,
  // IPNS Client
  deriveIpnsKeyPair,
  createSignedIpnsRecord,
  publishIpnsToGateway,
  publishIpnsToGateways,
  resolveIpnsFromGateway,
  resolveIpnsViaPath,
  resolveIpnsProgressively,
  fetchIpfsContent,
  uploadIpfsContent,
  uint8ArrayToBase64,
  // IPFS Storage Provider
  IpfsStorageProvider,
  createIpfsStorageProvider,
  // Browser State Persistence
  BrowserIpfsStatePersistence,
  createBrowserIpfsStatePersistence,
  // Nametag Fetcher
  fetchNametagFromIpns,
  fetchNametagsForKeys,
  type IpnsNametagResult,
  type IpnsNametagConfig,
} from './ipfs';

// ==========================================
// Browser Wallet State Persistence
// ==========================================

export {
  BrowserWalletStatePersistence,
  createBrowserWalletStatePersistence,
} from './wallet-state-persistence-browser';

// ==========================================
// Tab Coordination
// ==========================================

export {
  SyncCoordinator,
  getSyncCoordinator,
  type SyncCoordinatorConfig,
} from './sync-coordinator';

// ==========================================
// Wallet Repository Singleton
// ==========================================

export {
  getWalletRepository,
  disposeWalletRepository,
  dispatchWalletLoaded,
  waitForInit,
  isRepositoryInitialized,
  type BrowserWalletRepositoryConfig,
} from './wallet-repository-singleton';
