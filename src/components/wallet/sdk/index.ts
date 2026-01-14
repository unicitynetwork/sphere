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
export { createWallet, restoreFromMnemonic, validateMnemonic } from './core/wallet';

// Key derivation
export {
  generateMasterKeyFromSeed,
  deriveChildKeyBIP32,
  deriveKeyAtPath,
  deriveChildKeyLegacy,
  deriveKeyWifHmac,
  extractBasePathFromFullPath,
} from './core/derivation';

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
} from './address/address';

// Address key recovery types
export type { RecoveredAddressKey, RecoverKeyResult } from './address/address';

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
} from './address/unified';

// Bech32 encoding
export { createBech32, decodeBech32, convertBits, CHARSET } from './address/bech32';

// Script utilities
export { addressToScriptHash, createScriptPubKey } from './address/script';

// Address helpers
export { WalletAddressHelper } from './address/addressHelpers';

// Transaction building
export {
  createSignatureHash,
  createWitnessData,
  buildSegWitTransaction,
  signTransaction,
  selectUtxos,
  TX_FEE,
  DUST_THRESHOLD,
  SATS_PER_COIN,
} from './transaction/transaction';

// Crypto utilities
export {
  hexToWIF,
  encrypt,
  decrypt,
  generatePrivateKey,
  encryptWallet,
  decryptWallet,
} from './core/crypto';

// Common utilities
export {
  bytesToHex,
  hexToBytes,
  findPattern,
  isValidPrivateKey,
  base58Encode,
  base58Decode,
  extractFromText,
} from './core/utils';

// Wallet JSON serialization
export {
  serializeWalletToJSON,
  stringifyWalletJSON,
  parseWalletJSON,
  isJSONWalletFormat,
  generateAddressForJSON,
  determineDerivationMode,
  determineSource,
} from './serialization/wallet-json';

// Wallet Text serialization
export {
  serializeWalletToText,
  serializeEncryptedWalletToText,
  parseWalletText,
  isWalletTextFormat,
  encryptForTextFormat,
  decryptFromTextFormat,
} from './serialization/wallet-text';

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
} from './serialization/wallet-dat';

// Types
export type {
  // Base wallet types
  BaseWallet,
  BaseWalletAddress,
  // L1 types
  L1UTXO,
  L1TxInput,
  L1TxOutput,
  L1PlannedTx,
  L1TxPlanResult,
  L1NetworkProvider,
  // Legacy aliases (deprecated)
  UTXO,
  TxInput,
  TxOutput,
  PlannedTx,
  TxPlanResult,
  NetworkProvider,
  // Storage provider
  StorageProvider,
  // Key derivation
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

// Transaction types
export type {
  TxPlan,
  BuiltTransaction,
  UTXOInput,
  TransactionOutput,
  PlannedTransaction,
  TransactionPlanResult,
} from './transaction/transaction';

// Wallet.dat types
export type {
  CMasterKeyData,
  WalletDatInfo,
  WalletDatParseResult,
  DecryptionProgressCallback,
  DecryptWalletDatResult,
} from './serialization/wallet-dat';

// Wallet Text types
export type {
  WalletTextData,
  WalletTextExportOptions,
  WalletTextExportParams,
  WalletTextParseResult,
} from './serialization/wallet-text';

// Universal import/export
export {
  importWalletFromContent,
  exportWallet,
  exportWalletToText,
  exportWalletToJSON,
} from './serialization/import-export';

// Import/export types
export type {
  ImportWalletResult,
  ImportWalletOptions,
  ExportWalletOptions,
  ExportWalletParams,
} from './serialization/import-export';

// Network provider interface and utilities
export {
  getTotalBalance,
  getAllUtxos,
  waitForConfirmation,
} from './network/network';

// Network types
export type {
  L1NetworkProviderFull,
  BlockHeader,
  TransactionHistoryItem,
  TransactionDetail,
} from './network/network';

export {
  DEFAULT_BASE_PATH,
  DEFAULT_DERIVATION_MODE,
  UNICITY_TOKEN_TYPE_HEX,
} from './types';

// Scan utilities
export {
  generateAddressAtPath,
  generateAddresses,
  ACTIVE_SYNC_LIMIT,
  DEFAULT_BASE_PATH_SCAN,
} from './serialization/scan';

export type {
  GeneratedAddressInfo,
  ScannedAddress,
  ScanProgress,
  ScanResult,
} from './serialization/scan';

// Vesting classification
export {
  VestingClassifier,
  InMemoryCacheProvider,
  VESTING_THRESHOLD,
} from './transaction/vesting';

export type {
  ClassificationResult,
  ClassifiedUTXO,
  ClassifyUtxosResult,
  ClassificationProgressCallback,
} from './transaction/vesting';

// Vesting cache types (from types.ts)
export type {
  VestingCacheEntry,
  VestingCacheProvider,
} from './types';

// L1 Wallet
export { L1Wallet } from './wallets/L1Wallet';
export type { L1WalletConfig, SendResult } from './wallets/L1Wallet';

// WebSocket adapter interface
export type {
  WebSocketAdapter,
  WebSocketState,
  MessageHandler,
  CloseHandler,
  ErrorHandler,
} from './network/websocket';

// L3 Wallet
export { L3Wallet } from './wallets/L3Wallet';
export type { L3WalletConfig, L3Identity } from './wallets/L3Wallet';

// Unified L1 + L3 Wallet
export { UnityWallet } from './wallets/UnityWallet';
export type { UnityWalletConfig } from './wallets/UnityWallet';
