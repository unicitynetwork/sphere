/**
 * Browser Storage Submodule
 *
 * Browser-specific storage implementations:
 * - localStorage utilities
 * - IndexedDB vesting cache
 * - Key management with encryption
 * - Storage key constants
 */

// Storage utilities
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

// Storage keys
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
} from './storage-keys';

// Key Manager (browser-specific with encryption)
export {
  BrowserKeyManager,
  getBrowserKeyManager,
  type BrowserKeyManagerStorageKeys,
  type BrowserKeyManagerConfig,
  type WalletSource,
  type DerivedAddress,
  type WalletInfo,
  type KeyManagerState,
} from './BrowserKeyManager';

// IndexedDB Vesting Cache
export { IndexedDBVestingCache } from './IndexedDBVestingCache';

// NOTE: BrowserTokenRepository has been replaced by WalletRepository
// which uses KeyValueStorage interface for platform independence.
// Import from sdk/storage instead:
// import { WalletRepository, LocalStorageProvider } from './sdk/storage';
