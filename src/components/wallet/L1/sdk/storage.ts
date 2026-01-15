/**
 * L1 Wallet Storage - Re-exports from SDK browser module
 *
 * This file provides backwards compatibility.
 * All implementation is now in ../../sdk/browser/storage.ts
 */

// Re-export everything from SDK browser storage
export {
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
  // Classes and types
  BrowserWalletStorage,
  createWalletStorage,
  DEFAULT_WALLET_STORAGE_CONFIG,
  type StorageKeyConfig,
  type StoredWalletEntry,
} from '../../sdk/browser/storage';

// Note: StoredWallet interface is defined in ./types.ts for backwards compatibility
