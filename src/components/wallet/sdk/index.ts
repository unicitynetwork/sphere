/**
 * Unicity Wallet SDK
 *
 * Pure, portable wallet functions that can run anywhere:
 * - Browser (web app, extension)
 * - Node.js (CLI tools, server)
 * - React Native (mobile apps)
 *
 * No localStorage, no React, no browser APIs.
 */

// Wallet creation
export { createWallet, restoreFromMnemonic, validateMnemonic } from './wallet';

// Key derivation
export {
  generateMasterKeyFromSeed,
  deriveChildKeyBIP32,
  deriveKeyAtPath,
  deriveChildKeyLegacy,
  deriveKeyWifHmac,
} from './derivation';

// Address generation (L1)
export {
  computeHash160,
  hash160ToBytes,
  publicKeyToAddress,
  privateKeyToAddressInfo,
  generateAddressInfo,
  generateHDAddressBIP32,
  generateAddressFromMasterKey,
  generateHDAddress,
  deriveChildKey,
  ec,
  // Address key recovery
  recoverKeyWifHmac,
  recoverKeyBIP32AtPath,
  recoverKeyBIP32Scan,
} from './address';

// Address key recovery types
export type { RecoveredAddressKey, RecoverKeyResult } from './address';

// Unified address derivation (L1 + L3)
export {
  deriveL1Address,
  deriveDefaultL1Address,
  deriveNextL1Address,
  deriveL3Address,
  deriveUnifiedAddress,
  deriveDefaultUnifiedAddress,
  deriveNextUnifiedAddress,
  parsePathComponents,
  getAddressPath,
} from './unified';

// Bech32 encoding
export { createBech32, decodeBech32, convertBits, CHARSET } from './bech32';

// Crypto utilities
export { hexToWIF } from './crypto';

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

// Wallet JSON serialization
export {
  serializeWalletToJSON,
  stringifyWalletJSON,
  parseWalletJSON,
  isJSONWalletFormat,
  generateAddressForJSON,
  determineDerivationMode,
  determineSource,
} from './wallet-json';

// Wallet Text serialization
export {
  serializeWalletToText,
  serializeEncryptedWalletToText,
  parseWalletText,
  isWalletTextFormat,
  encryptForTextFormat,
  decryptFromTextFormat,
} from './wallet-text';

// Wallet.dat parsing and decryption
export {
  isSQLiteDatabase,
  findAllCMasterKeys,
  isEncryptedWalletDat,
  findWpkhDescriptor,
  extractChainCodeFromXpub,
  findMasterChainCode,
  extractDescriptorKeys,
  extractLegacyKeys,
  hasHDChain,
  parseWalletDat,
  findEncryptedKeyForDescriptor,
  decryptCMasterKey,
  decryptPrivateKey,
  decryptWalletDat,
} from './wallet-dat';

// Types
export type {
  DerivationMode,
  WalletSource,
  WalletKeys,
  L1Address,
  L3Address,
  UnifiedAddress,
  WalletConfig,
  WalletJSON,
  WalletJSONAddress,
  WalletJSONDerivationMode,
  WalletJSONSource,
  WalletJSONExportOptions,
  WalletJSONImportResult,
} from './types';

// Wallet.dat types
export type {
  CMasterKeyData,
  WalletDatInfo,
  WalletDatParseResult,
  DecryptionProgressCallback,
  DecryptWalletDatResult,
} from './wallet-dat';

// Wallet Text types
export type {
  WalletTextData,
  WalletTextExportOptions,
  WalletTextExportParams,
  WalletTextParseResult,
} from './wallet-text';

export {
  DEFAULT_BASE_PATH,
  DEFAULT_DERIVATION_MODE,
  UNICITY_TOKEN_TYPE_HEX,
} from './types';
