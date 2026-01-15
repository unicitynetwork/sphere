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

// ============================================================================
// UNICITY SDK RE-EXPORTS
// ============================================================================

// Re-export commonly used types/classes from @unicitylabs/state-transition-sdk
// This centralizes external SDK dependencies for easier management
export {
  // Signing
  SigningService,
  // Addresses
  AddressScheme,
  ProxyAddress,
  // Tokens
  Token,
  TokenId,
  TokenType,
  TokenState,
  CoinId,
  TokenCoinData,
  // Transactions
  TransferCommitment,
  TransferTransaction,
  MintCommitment,
  MintTransactionData,
  TokenSplitBuilder,
  // Predicates
  UnmaskedPredicate,
  UnmaskedPredicateReference,
  // Hashing
  HashAlgorithm,
  // Clients
  StateTransitionClient,
  AggregatorClient,
  RootTrustBase,
  // Utilities
  waitInclusionProof,
} from './unicity-sdk';

export type {
  DirectAddress,
  IAddress,
} from './unicity-sdk';

// Nostr SDK re-exports - import and re-export to ensure proper value exports
import {
  NostrClient as _NostrClient,
  NostrKeyManager as _NostrKeyManager,
  EventKinds as _EventKinds,
  TokenTransferProtocol as _TokenTransferProtocol,
  PaymentRequestProtocol as _PaymentRequestProtocol,
  NostrFilter as _NostrFilter,
} from './unicity-sdk';

export const NostrClient = _NostrClient;
export const NostrKeyManager = _NostrKeyManager;
export const EventKinds = _EventKinds;
export const TokenTransferProtocol = _TokenTransferProtocol;
export const PaymentRequestProtocol = _PaymentRequestProtocol;
export const NostrFilter = _NostrFilter;

export type {
  NostrEvent,
} from './unicity-sdk';

// ============================================================================
// TXF (TOKEN EXCHANGE FORMAT) TYPES
// ============================================================================

// TXF types and utilities for token serialization
export {
  // Key utility functions
  isArchivedKey,
  isForkedKey,
  isActiveTokenKey,
  isTokenKey,
  tokenIdFromKey,
  keyFromTokenId,
  archivedKeyFromTokenId,
  tokenIdFromArchivedKey,
  forkedKeyFromTokenIdAndState,
  parseForkedKey,
  isValidTokenId,
  getCurrentStateHash,
  countProofs,
} from './types/txf';

export type {
  // Base types (generic, platform-independent)
  NametagDataBase,
  TombstoneEntry,
  OutboxStatus,      // Re-exported from outbox.ts via txf.ts (alias for OutboxEntryStatus)
  OutboxEntryBase,   // Re-exported from outbox.ts via txf.ts
  TxfMeta,
  TxfStorageDataBase,
  // Token structure
  TxfToken,
  TxfGenesis,
  TxfGenesisData,
  TxfState,
  TxfTransaction,
  TxfInclusionProof,
  TxfAuthenticator,
  TxfMerkleTreePath,
  TxfMerkleStep,
  TxfIntegrity,
  // Conflict resolution
  TokenConflict,
  MergeResult,
} from './types/txf';

// TXF Zod schemas for runtime validation
export {
  // Schemas
  TxfMerkleStepSchema,
  TxfMerkleTreePathSchema,
  TxfAuthenticatorSchema,
  TxfInclusionProofSchema,
  TxfGenesisDataSchema,
  TxfGenesisSchema,
  TxfStateSchema,
  TxfTransactionSchema,
  TxfIntegritySchema,
  TxfTokenSchema,
  TxfMetaSchema,
  NametagDataBaseSchema,
  TombstoneEntrySchema,
  OutboxEntryBaseSchema,
  TxfStorageDataBaseSchema,
  // Validation functions
  parseTxfToken,
  safeParseTxfToken,
  parseTxfStorageData,
  safeParseTxfStorageData,
  parseTxfMeta,
  safeParseTxfMeta,
  validateTokenEntry,
} from './types/txf-schemas';

export type {
  ValidatedTxfToken,
  ValidatedTxfMeta,
  ValidatedTxfStorageData,
  ValidatedTxfGenesis,
  ValidatedTxfTransaction,
  ValidatedTxfInclusionProof,
  ValidatedNametagDataBase,
  ValidatedTombstoneEntry,
  ValidatedOutboxEntryBase,
} from './types/txf-schemas';

// Outbox types for transfer recovery
export {
  // Utility functions
  isTerminalStatus,
  isPendingStatus,
  isRetryableStatus,
  getNextStatus,
  validateOutboxEntryBase,
} from './types/outbox';

export type {
  OutboxEntryStatus,
  OutboxEntryType,
  // OutboxEntryBase is re-exported from ./types/txf for backwards compatibility
  OutboxSplitGroup,
  RecoveryResult,
  RecoveryDetail,
} from './types/outbox';

// TXF Serializer (platform-independent)
export {
  // Storage data building
  buildTxfStorageData as buildTxfStorageDataGeneric,
  // Storage data parsing
  parseTxfStorageDataGeneric,
  // File export/import
  buildTxfExportFile as buildTxfExportFileGeneric,
  parseTxfFile as parseTxfFileGeneric,
  // Utility functions
  isValidTxfToken,
  countCommittedTransactions,
  hasUncommittedTransactions,
  getTotalAmount,
  getPrimaryCoinId,
  computeGenesisHash,
  normalizeTxfToken,
} from './serialization/txf-serializer';

export type {
  ParseTxfStorageResult,
  BuildTxfStorageOptions,
} from './serialization/txf-serializer';

// ============================================================================
// TOKEN STORAGE
// ============================================================================

// Storage Provider Interface and Types
export type {
  // Event types
  StorageEventType,
  StorageEvent,
  StorageEventCallback,
  // Result types
  SaveResult,
  LoadResult,
  SyncResult,
  StorageStatus,
  // Provider interface
  TokenStorageProvider,
  // Options types
  StorageProviderOptions,
  FileStorageOptions,
  IpfsStorageOptions,
  InMemoryStorageOptions,
  // Factory type
  StorageProviderFactory,
} from './storage';

// Conflict Resolution Service
export {
  ConflictResolutionService,
  createConflictResolutionService,
} from './storage';

// Storage Providers (browser-safe)
export {
  // In-Memory (browser & Node.js)
  InMemoryStorageProvider,
  createInMemoryStorageProvider,
} from './storage';

// NOTE: FileStorageProvider uses Node.js fs/path modules and is NOT exported here.
// For Node.js/CLI usage, import directly:
// import { FileStorageProvider, createFileStorageProvider } from './sdk/storage/file-storage';

// ============================================================================
// IPNS UTILITIES
// ============================================================================

// IPNS name derivation from wallet keys
export {
  // Constants
  IPNS_HKDF_INFO,
  // IPNS derivation
  deriveEd25519KeyMaterial,
  deriveIpnsNameFromPrivateKey,
  deriveEd25519KeyPair,
  derivePeerIdFromPrivateKey,
} from './ipns';

// ============================================================================
// API SERVICES
// ============================================================================

// HTTP Client abstraction
export {
  createFetchHttpClient,
  createAxiosHttpClient,
  getDefaultHttpClient,
  setDefaultHttpClient,
} from './api';

export type {
  HttpClient,
  HttpResponse,
  HttpRequestOptions,
} from './api';

// Price API
export {
  COINGECKO_API_URL,
  DEFAULT_PRICES,
  fetchPrices,
  getPrice,
  calculateUsdValue,
  formatPrice,
} from './api';

export type {
  CryptoPriceData,
  PriceMap,
} from './api';

// Token Registry API
export {
  UNICITY_REGISTRY_URL,
  fetchRegistry,
  getBestIconUrl,
  findTokenByCoinId,
  findTokenBySymbol,
  filterByNetwork,
  filterByAssetKind,
} from './api';

export type {
  TokenDefinition,
  ApiServiceConfig,
} from './api';

// ============================================================================
// TOKEN VALIDATION
// ============================================================================

// Validation types
export type {
  ValidationAction,
  TokenValidationResult,
  ValidationIssue,
  ValidationResult,
  SpentTokenInfo,
  SpentTokenResult,
  PendingTransactionCheckResult,
  PendingTransactionsSummary,
  BatchValidationOptions,
  ProofProvider,
  TokenStateProvider,
} from './validation';

// TXF validation functions
export {
  // Structure validation
  hasValidTxfStructure,
  hasValidGenesis,
  hasValidState,
  // Transaction validation
  getUncommittedTransactions,
  getCommittedTransactions,
  hasUncommittedTxs,
  getTransactionAtIndex,
  // State hash utilities
  getPreviousStateHash,
  getCurrentState,
  // Split token detection
  isSplitToken,
  extractBurnTxHash,
  // Validation summary
  getValidationSummary,
} from './validation';
