/**
 * Serialization Module (Platform-Independent)
 *
 * Provides wallet serialization and import/export:
 * - Universal import/export (text, JSON, wallet.dat)
 * - Wallet JSON format serialization
 * - Wallet text format serialization
 * - Wallet.dat parsing and decryption
 * - TXF (Token eXchange Format) serialization
 * - HD wallet address scanning utilities
 */

// ==========================================
// Universal Import/Export
// ==========================================

export {
  importWalletFromContent,
  exportWallet,
  exportWalletToText,
  exportWalletToJSON,
  isJSONWalletFormat,
} from './import-export';

export type {
  ImportWalletResult,
  ImportWalletOptions,
  ExportWalletOptions,
  ExportWalletParams,
} from './import-export';

// ==========================================
// Wallet JSON Format
// ==========================================

export {
  serializeWalletToJSON,
  stringifyWalletJSON,
  parseWalletJSON,
  generateAddressForJSON,
  determineDerivationMode,
  determineSource,
} from './wallet-json';

// ==========================================
// Wallet Text Format
// ==========================================

export {
  serializeWalletToText,
  serializeEncryptedWalletToText,
  parseWalletText,
  isWalletTextFormat,
  encryptForTextFormat,
  decryptFromTextFormat,
} from './wallet-text';

export type {
  WalletTextData,
  WalletTextExportOptions,
  WalletTextExportParams,
  WalletTextParseResult,
} from './wallet-text';

// ==========================================
// Wallet.dat Parsing and Decryption
// ==========================================

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

export type {
  CMasterKeyData,
  WalletDatInfo,
  WalletDatParseResult,
  DecryptionProgressCallback,
  DecryptWalletDatResult,
} from './wallet-dat';

// ==========================================
// TXF Serializer
// ==========================================

export {
  // Storage data building
  buildTxfStorageData,
  // Storage data parsing
  parseTxfStorageDataGeneric,
  // File export/import
  buildTxfExportFile,
  parseTxfFile,
  // Utility functions
  isValidTxfToken,
  countCommittedTransactions,
  hasUncommittedTransactions,
  getTotalAmount,
  getPrimaryCoinId,
  computeGenesisHash,
  normalizeTxfToken,
  // Re-exported key utilities
  isTokenKey,
  isArchivedKey,
  isForkedKey,
  tokenIdFromKey,
  tokenIdFromArchivedKey,
  parseForkedKey,
  keyFromTokenId,
  archivedKeyFromTokenId,
  forkedKeyFromTokenIdAndState,
  getCurrentStateHash,
} from './txf-serializer';

export type {
  ParseTxfStorageResult,
  BuildTxfStorageOptions,
} from './txf-serializer';

// ==========================================
// Scan Utilities
// ==========================================

export {
  generateAddressAtPath,
  generateAddresses,
  ACTIVE_SYNC_LIMIT,
  DEFAULT_BASE_PATH_SCAN,
} from './scan';

export type {
  GeneratedAddressInfo,
  ScannedAddress,
  ScanProgress,
  ScanResult,
} from './scan';
