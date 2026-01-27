/**
 * Wallets Module (Platform-Independent)
 *
 * Provides unified wallet classes:
 * - L1Wallet: Alpha blockchain operations
 * - L3Wallet: Unicity token network operations
 * - L3TransferService: Token transfer orchestration
 * - UnityWallet: Combined L1 + L3 wallet
 * - KeyManager: Platform-independent key management utilities
 */

// ==========================================
// Key Manager (Platform-Independent)
// ==========================================

export {
  // Validation functions
  validatePrivateKey,
  normalizePrivateKey,
  // File parsing
  parseWalletFileContent,
  // Export formatting
  formatWalletExport,
  // Address derivation
  deriveAddressFromPath,
  getDefaultAddressPath,
  // State utilities
  getWalletInfo,
  isWalletInitialized,
  createEmptyState,
  createStateFromFileData,
  // Types
  type WalletSource,
  type DerivedAddress,
  type WalletInfo,
  type WalletFileData,
  type WalletExportOptions,
  type KeyManagerState,
} from './KeyManager';

// ==========================================
// L1 Wallet
// ==========================================

export { L1Wallet } from './L1Wallet';
export type { L1WalletConfig, SendResult } from './L1Wallet';

// ==========================================
// L3 Wallet
// ==========================================

export { L3Wallet } from './L3Wallet';
export type { L3WalletConfig, L3Identity } from './L3Wallet';

// ==========================================
// L3 Transfer Service
// ==========================================

export {
  L3TransferService,
  DefaultL3RandomBytesProvider,
  createL3TransferService,
} from './L3TransferService';

export type {
  L3TokenStorageProvider,
  L3NostrProvider,
  L3RandomBytesProvider,
  L3TransferResult,
  L3TransferRequest,
  L3TransferServiceConfig,
} from './L3TransferService';

// ==========================================
// Unified Wallet
// ==========================================

export { UnityWallet } from './UnityWallet';
export type { UnityWalletConfig } from './UnityWallet';
