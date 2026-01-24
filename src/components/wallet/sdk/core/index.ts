/**
 * Core Module (Platform-Independent)
 *
 * Provides core wallet functionality:
 * - Wallet creation and restoration from mnemonic
 * - Key derivation (BIP32 and legacy HMAC)
 * - Cryptographic utilities
 * - Identity derivation for L3
 */

// Wallet creation and restoration
export {
  createWallet,
  restoreFromMnemonic,
  validateMnemonic,
} from './wallet';

// Key derivation
export {
  generateMasterKeyFromSeed,
  deriveChildKeyBIP32,
  deriveKeyAtPath,
  deriveChildKeyLegacy,
  deriveKeyWifHmac,
  extractBasePathFromFullPath,
} from './derivation';

// Cryptographic utilities
export {
  hexToWIF,
  encrypt,
  decrypt,
  generatePrivateKey,
  encryptWallet,
  decryptWallet,
} from './crypto';

// Common utilities
export {
  bytesToHex,
  hexToBytes,
  findPattern,
  isValidPrivateKey,
  base58Encode,
  base58Decode,
  extractFromText,
} from './utils';

// Identity derivation (L3)
export {
  deriveIdentityFromPrivateKey,
  deriveIdentityFromMnemonic,
  getWalletDirectAddress,
} from './identity';

export type {
  UserIdentity,
  L3DerivedAddress,
} from './identity';

// Wallet Repository (token storage, tombstones, archives)
export {
  WalletRepository,
  WALLET_REPOSITORY_KEYS,
  type WalletRepositoryConfig,
} from './wallet-repository';

// Token Repository (interface and pure functions)
export {
  // Types
  type StoredToken,
  type StoredWalletData,
  type TransactionHistoryEntry,
  type TokenRepository,
  type NametagDataBase,

  // Pure functions - token comparison
  isIncrementalUpdate,
  getTokenCurrentStateHash,
  countCommittedTxns,

  // Pure functions - token ID extraction
  extractTokenIdFromJsonData,
  extractStateHashFromJsonData,
  isSameStoredToken,

  // Pure functions - tombstone
  createTombstoneFromStoredToken,

  // Pure functions - validation
  validateL3Address,
  validateStoredWalletData,
  parseTombstones,
  parseArchivedTokens,
  parseForkedTokens,

  // Pure functions - pruning
  pruneTombstonesByAge,
  pruneMapByCount,
  findBestTokenVersion,
} from './token-repository';
