/**
 * L1 Wallet SDK - Application adapter layer
 *
 * This module provides backwards-compatible exports from the portable SDK.
 * All implementation is in ../../sdk/browser/
 *
 * Exports:
 * - Wallet operations (create, load, delete, generateAddress)
 * - Storage utilities
 * - Transaction functions
 * - Vesting classification
 * - Network provider
 * - Import/Export functions
 */

// ============================================================================
// SDK CORE FUNCTIONS
// ============================================================================

// Address functions from SDK
export {
  generateMasterKeyFromSeed,
  deriveChildKeyBIP32,
  deriveKeyAtPath,
  deriveChildKeyLegacy,
  deriveKeyWifHmac,
  generateAddressInfo,
  generateHDAddressBIP32,
  generateAddressFromMasterKey,
  generateHDAddress,
  deriveChildKey,
} from '../../sdk';

// Crypto functions from SDK
export {
  hexToWIF,
  encrypt,
  decrypt,
  generatePrivateKey,
  encryptWallet,
  decryptWallet,
} from '../../sdk';

// ============================================================================
// NETWORK PROVIDER
// ============================================================================

export {
  BrowserNetworkProvider,
  getBrowserProvider,
  disposeBrowserProvider,
} from '../../sdk/browser';

// Backwards-compatible singleton
import { getBrowserProvider, disposeBrowserProvider } from '../../sdk/browser';

/** @deprecated Use getBrowserProvider() instead */
export const browserProvider = getBrowserProvider();

// HMR cleanup
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    disposeBrowserProvider();
  });
}

// Network types
export type { BlockHeader, TransactionHistoryItem, TransactionDetail } from '../../sdk/network/network';

// ============================================================================
// VESTING
// ============================================================================

export {
  BrowserVestingClassifier,
  getVestingClassifier,
  VESTING_THRESHOLD,
  type ClassificationResult,
  type ClassifiedUTXO,
  type ClassifyUtxosResult,
} from '../../sdk/browser';

// Backwards-compatible singleton
import { getVestingClassifier } from '../../sdk/browser';

/** @deprecated Use getVestingClassifier() instead */
export const vestingClassifier = getVestingClassifier();

// ============================================================================
// VESTING STATE
// ============================================================================

export {
  VestingStateManager,
  getVestingState,
  type VestingMode,
  type VestingBalances,
} from '../../sdk/browser';

// Backwards-compatible singleton
import { getVestingState } from '../../sdk/browser';

/** @deprecated Use getVestingState() instead */
export const vestingState = getVestingState();

// ============================================================================
// STORAGE
// ============================================================================

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

// ============================================================================
// WALLET OPERATIONS
// ============================================================================

export {
  // Factory class
  BrowserWalletFactory,
  getDefaultWalletFactory,
  // Functions with default storage (backwards compatible names)
  createAndSaveWallet as createWallet,
  loadWallet,
  deleteWallet,
  generateAndSaveAddress as generateAddress,
  // Types
  type BrowserWallet,
} from '../../sdk/browser/wallet';

// ============================================================================
// TRANSACTIONS
// ============================================================================

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

// ============================================================================
// L1-SPECIFIC TYPES
// ============================================================================

export * from './types';

// ============================================================================
// IMPORT/EXPORT (L1-specific type conversions)
// ============================================================================

export * from './import-export';

// ============================================================================
// SCAN (has L3 dependencies, located in L1/services)
// ============================================================================

export * from '../services/scan';
