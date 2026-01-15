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
  UNICITY_TOKEN_TYPE_HEX,
} from './identity';

export type {
  UserIdentity,
  L3DerivedAddress,
} from './identity';
