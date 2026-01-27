/**
 * Unicity Wallet SDK
 *
 * Pure, portable wallet functions that can run anywhere:
 * - Browser (web app, extension)
 * - Node.js (CLI tools, server)
 * - React Native (mobile apps)
 *
 * No localStorage, no React, no browser APIs.
 *
 * Module structure:
 * - core/       - Wallet creation, key derivation, cryptography
 * - address/    - Address generation, bech32 encoding, scripts
 * - network/    - WebSocket adapter, network provider interfaces
 * - transaction/ - Transaction building, vesting, token splits
 * - serialization/ - Import/export, TXF format
 * - wallets/    - L1Wallet, L3Wallet, UnityWallet classes
 * - storage/    - Token storage providers, conflict resolution
 * - validation/ - Token validation, proof verification
 * - api/        - HTTP client, price API, registry API
 * - nostr/      - Nostr client, token transfers, nametags
 * - ipns/       - IPNS utilities for wallet sync
 * - browser/    - Browser-specific implementations (separate import)
 * - types/      - TypeScript type definitions
 */

// ============================================================================
// CORE MODULE
// ============================================================================

export {
  // Wallet creation
  createWallet,
  restoreFromMnemonic,
  validateMnemonic,
  // Key derivation
  generateMasterKeyFromSeed,
  deriveChildKeyBIP32,
  deriveKeyAtPath,
  deriveChildKeyLegacy,
  deriveKeyWifHmac,
  extractBasePathFromFullPath,
  // Crypto utilities
  hexToWIF,
  encrypt,
  decrypt,
  generatePrivateKey,
  encryptWallet,
  decryptWallet,
  // Common utilities
  bytesToHex,
  hexToBytes,
  findPattern,
  isValidPrivateKey,
  base58Encode,
  base58Decode,
  extractFromText,
  // Identity derivation (L3)
  deriveIdentityFromPrivateKey,
  deriveIdentityFromMnemonic,
  getWalletDirectAddress,
} from './core';

// Re-export UNICITY_TOKEN_TYPE_HEX from types (canonical source)
export { UNICITY_TOKEN_TYPE_HEX } from './types';

export type {
  UserIdentity,
  L3DerivedAddress,
} from './core';

// ============================================================================
// ADDRESS MODULE
// ============================================================================

export {
  // Address generation
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
  // Unified address derivation (L1 + L3)
  deriveL1Address,
  deriveDefaultL1Address,
  deriveNextL1Address,
  deriveL3Address,
  deriveUnifiedAddress,
  deriveDefaultUnifiedAddress,
  deriveNextUnifiedAddress,
  parsePathComponents,
  getAddressPath,
  // Bech32 encoding
  createBech32,
  decodeBech32,
  convertBits,
  CHARSET,
  // Script utilities
  addressToScriptHash,
  createScriptPubKey,
  // Address helpers
  WalletAddressHelper,
} from './address';

export type {
  RecoveredAddressKey,
  RecoverKeyResult,
} from './address';

// ============================================================================
// NETWORK MODULE
// ============================================================================

export {
  getTotalBalance,
  getAllUtxos,
  waitForConfirmation,
} from './network';

export type {
  WebSocketAdapter,
  WebSocketState,
  MessageHandler,
  CloseHandler,
  ErrorHandler,
  L1NetworkProviderFull,
  BlockHeader,
  TransactionHistoryItem,
  TransactionDetail,
} from './network';

// ============================================================================
// TRANSACTION MODULE
// ============================================================================

export {
  // L1 Transaction building
  signTransaction,
  selectUtxos,
  buildSegWitTransaction,
  createSignatureHash,
  createWitnessData,
  broadcastTransactions,
  TX_FEE,
  DUST_THRESHOLD,
  SATS_PER_COIN,
  // Vesting classification
  VestingClassifier,
  InMemoryCacheProvider,
  VESTING_THRESHOLD,
  // Token split calculator (L3)
  TokenSplitCalculator,
  createTokenSplitCalculator,
  // Split executor
  TokenSplitExecutor,
  createTokenSplitExecutor,
  DefaultSha256Provider,
  DefaultUuidProvider,
} from './transaction';

export type {
  // Transaction types
  TxPlan,
  TransactionOutput,
  PlannedTransaction,
  TransactionPlanResult,
  BuiltTransaction,
  UTXOInput,
  BroadcastResult,
  // Vesting types
  ClassificationResult,
  ClassifiedUTXO,
  ClassifyUtxosResult,
  ClassificationProgressCallback,
  VestingCacheProvider,
  VestingCacheEntry,
  // Token split types
  SplittableToken,
  TokenWithAmount,
  SplitPlan,
  // Split transfer types
  MintedTokenInfo,
  SplitTokenResult,
  SplitPlanResult,
  SplitOutboxStatus,
  SplitTransferEntry,
  SplitGroup,
  SplitOutboxProvider,
  SplitOutboxContext,
  OnTokenBurnedCallback,
  // Split executor types
  TokenSplitExecutorConfig,
  Sha256Provider,
  UuidProvider,
} from './transaction';

// ============================================================================
// SERIALIZATION MODULE
// ============================================================================

export {
  // Universal import/export
  importWalletFromContent,
  exportWallet,
  exportWalletToText,
  exportWalletToJSON,
  isJSONWalletFormat,
  // Wallet JSON format
  serializeWalletToJSON,
  stringifyWalletJSON,
  parseWalletJSON,
  generateAddressForJSON,
  determineDerivationMode,
  determineSource,
  // Wallet text format
  serializeWalletToText,
  serializeEncryptedWalletToText,
  parseWalletText,
  isWalletTextFormat,
  encryptForTextFormat,
  decryptFromTextFormat,
  // Wallet.dat parsing
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
  // TXF serializer
  buildTxfStorageData,
  parseTxfStorageDataGeneric,
  buildTxfExportFile,
  parseTxfFile,
  isValidTxfToken,
  countCommittedTransactions,
  hasUncommittedTransactions,
  getTotalAmount,
  getPrimaryCoinId,
  computeGenesisHash,
  normalizeTxfToken,
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
  // Scan utilities
  generateAddressAtPath,
  generateAddresses,
  ACTIVE_SYNC_LIMIT,
  DEFAULT_BASE_PATH_SCAN,
} from './serialization';

export type {
  // Import/export types
  ImportWalletResult,
  ImportWalletOptions,
  ExportWalletOptions,
  ExportWalletParams,
  // Wallet text types
  WalletTextData,
  WalletTextExportOptions,
  WalletTextExportParams,
  WalletTextParseResult,
  // Wallet.dat types
  CMasterKeyData,
  WalletDatInfo,
  WalletDatParseResult,
  DecryptionProgressCallback,
  DecryptWalletDatResult,
  // TXF serializer types
  ParseTxfStorageResult,
  BuildTxfStorageOptions,
  // Scan types
  GeneratedAddressInfo,
  ScannedAddress,
  ScanProgress,
  ScanResult,
} from './serialization';

// ============================================================================
// WALLETS MODULE
// ============================================================================

export {
  // L1 Wallet
  L1Wallet,
  // L3 Wallet
  L3Wallet,
  // L3 Transfer Service
  L3TransferService,
  DefaultL3RandomBytesProvider,
  createL3TransferService,
  // Unified Wallet
  UnityWallet,
} from './wallets';

export type {
  // L1 Wallet types
  L1WalletConfig,
  SendResult,
  // L3 Wallet types
  L3WalletConfig,
  L3Identity,
  // L3 Transfer Service types
  L3TokenStorageProvider,
  L3NostrProvider,
  L3RandomBytesProvider,
  L3TransferResult,
  L3TransferRequest,
  L3TransferServiceConfig,
  // Unified Wallet types
  UnityWalletConfig,
} from './wallets';

// ============================================================================
// STORAGE MODULE
// ============================================================================

export {
  // Conflict Resolution
  ConflictResolutionService,
  createConflictResolutionService,
  // Token Comparison
  compareTokenVersions,
  compareTokenVersionsSimple,
  isLocalBetter,
  isRemoteBetter,
  areTokensEqual,
  countCommittedTransactions as countStorageCommittedTransactions,
  countPendingTransactions,
  hasPendingTransactions,
  getTokenTransactionStats,
  // Tombstone Utilities
  buildTombstoneKeySet,
  buildTombstoneMap,
  isTombstoned,
  isTokenTombstoned,
  createTombstone,
  createTombstoneFromToken,
  mergeTombstones,
  filterTombstonesByTokenIds,
  getTombstonesForToken,
  findNewTombstones,
  removeExpiredTombstones,
  extractTombstonedTokenIds,
  findMatchingTombstone,
  validateTombstones,
  // Sync Orchestrator
  SyncOrchestrator,
  createSyncOrchestrator,
  // In-Memory Storage
  InMemoryStorageProvider,
  createInMemoryStorageProvider,
  // IPFS State Persistence
  InMemoryIpfsStatePersistence,
  createInMemoryIpfsStatePersistence,
  // Wallet State Persistence
  WALLET_STATE_KEYS,
  InMemoryWalletStatePersistence,
  createInMemoryWalletStatePersistence,
  // Token Repository (pure functions)
  isIncrementalUpdate,
  getTokenCurrentStateHash,
  countCommittedTxns,
  extractTokenIdFromJsonData,
  extractStateHashFromJsonData,
  isSameStoredToken,
  createTombstoneFromStoredToken,
  validateL3Address,
  validateStoredWalletData,
  parseTombstones,
  parseArchivedTokens,
  parseForkedTokens,
  // Wallet Repository
  WalletRepository,
  createWalletRepository,
  WALLET_REPOSITORY_KEYS,
  // Storage Providers
  PROVIDER_IDS,
  LocalStorageProvider,
  createLocalStorageProvider,
  InMemoryProvider,
  createInMemoryProvider,
  // Sync Manager
  DefaultSyncManager,
  createSyncManager,
  // IPFS Sync Provider
  IpfsSyncProvider,
  createIpfsSyncProvider,
} from './storage';

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
  // Token Comparison types
  TokenComparisonResult,
  TokenTransactionStats,
  // Tombstone types
  TombstoneValidationResult,
  TombstoneCheckResult,
  // Sync Orchestrator types
  SyncAction,
  SyncDecision,
  DiffResult,
  SyncOrchestratorOptions,
  // IPFS State Persistence types
  IpfsPersistedState,
  IpfsStatePersistence,
  // Wallet State Persistence types
  WalletStatePersistence,
  // Token Repository types
  StoredToken,
  StoredWalletData,
  TransactionHistoryEntry,
  // Wallet Repository types
  WalletRepositoryConfig,
  TokenRepository,
  // Storage Provider types (aliased to avoid conflict with types/wallet.ts)
  StorageProvider as AsyncStorageProvider,
  StorageProviderConfig as AsyncStorageProviderConfig,
  ProviderStatus,
  ProviderType,
  ProviderMetadata,
  ProviderId,
  // Sync Provider types
  SyncProvider,
  SyncProviderConfig,
  SyncManager,
  SyncManagerConfig,
  SyncStrategy,
  SyncResult as AsyncSyncResult,
  SyncEvent,
  SyncEventType,
  SyncEventCallback,
  WalletSnapshot,
  // Async Provider Config types
  LocalStorageProviderConfig,
  InMemoryProviderConfig,
  IpfsSyncProviderConfig,
  IpnsKeyPair,
} from './storage';

// ============================================================================
// VALIDATION MODULE
// ============================================================================

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
  // Proof Provider
  AggregatorProofProvider,
  FetchHttpClient,
  fetchProofFromAggregator,
  createAggregatorProofProvider,
  // Trust Base Provider
  CachedTrustBaseProvider,
  InMemoryTrustBaseProvider,
  createCachedTrustBaseProvider,
  createInMemoryTrustBaseProvider,
  // Token Validator
  TokenValidator,
  createTokenValidator,
  // Spent Token Checker
  SpentTokenChecker,
  SdkTokenStateProvider,
  createSpentTokenChecker,
  createSdkTokenStateProvider,
} from './validation';

export type {
  // Validation types
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
  // Proof Provider types
  HttpClient as ValidationHttpClient,
  HttpClientOptions,
  ProofFetchResult,
  AggregatorProofProviderConfig,
  // Trust Base Provider types
  TrustBaseProvider,
  TrustBaseProviderConfig,
  TrustBaseLoader,
  // Token Validator types
  TokenValidatorConfig,
  ValidatableToken,
  BurnVerificationResult,
  // Spent Token Checker types
  SpentTokenCheckerConfig,
  SpentCheckableToken,
} from './validation';

// ============================================================================
// API MODULE
// ============================================================================

export {
  // HTTP Client
  createFetchHttpClient,
  createAxiosHttpClient,
  getDefaultHttpClient,
  setDefaultHttpClient,
  // Price API
  COINGECKO_API_URL,
  DEFAULT_PRICES,
  fetchPrices,
  getPrice,
  calculateUsdValue,
  formatPrice,
  // Registry API
  UNICITY_REGISTRY_URL,
  fetchRegistry,
  getBestIconUrl,
  findTokenByCoinId,
  findTokenBySymbol,
  filterByNetwork,
  filterByAssetKind,
} from './api';

export type {
  HttpClient,
  HttpResponse,
  HttpRequestOptions,
  CryptoPriceData,
  PriceMap,
  TokenDefinition,
  ApiServiceConfig,
  CoinGeckoResponse,
} from './api';

// ============================================================================
// NOSTR MODULE
// ============================================================================

export {
  // Core client
  NostrClientWrapper,
  // Token transfer service
  TokenTransferService,
  createTokenTransferPayload,
  // Nametag service
  NametagMintService,
  DefaultRandomBytesProvider,
  // Types
  DEFAULT_NOSTR_RELAYS,
  InMemoryNostrStorage,
} from './nostr';

export type {
  // Token transfer types
  NametagTokenProvider,
  TokenReceivedCallback,
  TokenMetadata,
  StateTransitionProvider,
  // Nametag types
  MintResult,
  RandomBytesProvider,
  // Config types
  NostrConfig,
  NostrIdentity,
  NostrUserIdentity,
  NostrIdentityProvider,
  TokenTransferPayload,
  TokenTransferOptions,
  ReceivedTokenTransfer,
  PaymentRequest,
  ReceivedPaymentRequest,
  ProcessedPaymentRequest,
  TokenTransferHandler,
  PaymentRequestHandler,
  NametagBinding,
  NostrStorageProvider,
} from './nostr';
export { PaymentRequestStatus } from './nostr';

// ============================================================================
// IPNS MODULE
// ============================================================================

export {
  IPNS_HKDF_INFO,
  deriveEd25519KeyMaterial,
  deriveIpnsNameFromPrivateKey,
  deriveEd25519KeyPair,
  derivePeerIdFromPrivateKey,
} from './ipns';

// ============================================================================
// TYPES MODULE
// ============================================================================

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

export {
  DEFAULT_BASE_PATH,
  DEFAULT_DERIVATION_MODE,
} from './types';

// ============================================================================
// TOKEN TYPES (Business Logic Layer)
// ============================================================================

export {
  // Token status enum
  TokenStatus,
  TransactionType,
  // Utility functions
  isTokenAvailable,
  isTokenPending,
  isTokenInactive,
  getTokenAmountAsBigInt,
  // Token classes
  WalletToken,
  AggregatedAsset,
  TokenCollection,
  TransactionEvent,
} from './types/token';

export type {
  // Token interfaces
  BaseToken,
  TransferableToken,
  AggregatedAssetData,
  // PaymentRequestData is deprecated alias for ProcessedPaymentRequest
  PaymentRequestData,
} from './types/token';

// ============================================================================
// TXF (TOKEN EXCHANGE FORMAT) TYPES
// ============================================================================

export {
  isActiveTokenKey,
  isValidTokenId,
  countProofs,
} from './types/txf';

export type {
  // Base types (generic, platform-independent)
  NametagDataBase,
  TombstoneEntry,
  OutboxStatus,
  OutboxEntryBase,
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
  isTerminalStatus,
  isPendingStatus,
  isRetryableStatus,
  getNextStatus,
  validateOutboxEntryBase,
} from './types/outbox';

export type {
  OutboxEntryStatus,
  OutboxEntryType,
  OutboxSplitGroup,
  RecoveryResult,
  RecoveryDetail,
} from './types/outbox';

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
  // Cryptographic Token from @unicitylabs/state-transition-sdk
  // NOTE: WalletToken is for UI/storage, Token is for crypto operations (mint, transfer, split)
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

// NOTE: FileStorageProvider uses Node.js fs/path modules and is NOT exported here.
// For Node.js/CLI usage, import directly:
// import { FileStorageProvider, createFileStorageProvider } from './sdk/storage/file-storage';
//
// NOTE: BrowserIpfsStatePersistence and BrowserWalletStatePersistence use localStorage
// and are NOT exported here. For browser usage, import from browser module:
// import { BrowserIpfsStatePersistence, BrowserWalletStatePersistence } from './sdk/browser';
