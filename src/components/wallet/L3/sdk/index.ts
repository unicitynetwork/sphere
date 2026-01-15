/**
 * L3 Wallet SDK - Application adapter layer
 *
 * This module provides backwards-compatible exports from the portable SDK.
 * All implementation is in ../../sdk/
 */

// ============================================================================
// L3 WALLET
// ============================================================================

export { L3Wallet } from '../../sdk/wallets/L3Wallet';
export type { L3WalletConfig, L3Identity } from '../../sdk/wallets/L3Wallet';

// ============================================================================
// UNIFIED WALLET (L1 + L3)
// ============================================================================

export { UnityWallet } from '../../sdk/wallets/UnityWallet';
export type { UnityWalletConfig } from '../../sdk/wallets/UnityWallet';

// ============================================================================
// ADDRESS DERIVATION
// ============================================================================

export {
  deriveL3Address,
  deriveUnifiedAddress,
  deriveDefaultUnifiedAddress,
  deriveNextUnifiedAddress,
  parsePathComponents,
  getAddressPath,
} from '../../sdk/address/unified';

export type {
  L3Address,
  UnifiedAddress,
} from '../../sdk/types';

// ============================================================================
// NOSTR SERVICES
// ============================================================================

export {
  // Core client
  NostrClientWrapper,
  // Token transfer
  TokenTransferService,
  createTokenTransferPayload,
  // Nametag minting
  NametagMintService,
  DefaultRandomBytesProvider,
  // Constants
  DEFAULT_NOSTR_RELAYS,
  InMemoryNostrStorage,
} from '../../sdk/nostr';

export type {
  // Token transfer types
  NametagTokenProvider,
  TokenReceivedCallback,
  TokenMetadata,
  StateTransitionProvider,
  MintResult,
  RandomBytesProvider,
  // Nostr types
  NostrConfig,
  NostrIdentity,
  NostrIdentityProvider,
  TokenTransferPayload,
  TokenTransferOptions,
  ReceivedTokenTransfer,
  PaymentRequest,
  ReceivedPaymentRequest,
  TokenTransferHandler,
  PaymentRequestHandler,
  NametagBinding,
  NostrStorageProvider,
} from '../../sdk/nostr';

// ============================================================================
// CORE FUNCTIONS (shared with L1)
// ============================================================================

export {
  // Wallet creation
  validateMnemonic,
  // Key derivation
  deriveKeyAtPath,
  // Crypto
  encrypt,
  decrypt,
} from '../../sdk';

// ============================================================================
// TYPES
// ============================================================================

export {
  UNICITY_TOKEN_TYPE_HEX,
  DEFAULT_BASE_PATH,
  DEFAULT_DERIVATION_MODE,
} from '../../sdk/types';

export type {
  DerivationMode,
  WalletSource,
  WalletKeys,
} from '../../sdk/types';

// ============================================================================
// UNICITY SDK RE-EXPORTS
// ============================================================================

// Re-export commonly used types/classes from @unicitylabs/state-transition-sdk
// L3 services should import from here, not directly from @unicitylabs/*
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
} from '../../sdk';

export type {
  DirectAddress,
  IAddress,
} from '../../sdk';

// Nostr SDK re-exports (@unicitylabs/nostr-js-sdk)
export {
  NostrClient,
  NostrKeyManager,
  EventKinds,
  TokenTransferProtocol,
  PaymentRequestProtocol,
  NostrFilter,
} from '../../sdk';

export type {
  NostrEvent,
} from '../../sdk';

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
  // Validation functions
  parseTxfToken,
  safeParseTxfToken,
  parseTxfStorageData,
  safeParseTxfStorageData,
  parseTxfMeta,
  safeParseTxfMeta,
  validateTokenEntry,
  // Serializer utilities
  isValidTxfToken,
  getTotalAmount,
  getPrimaryCoinId,
  normalizeTxfToken,
  // Outbox utilities
  isTerminalStatus,
  isPendingStatus,
  isRetryableStatus,
  getNextStatus,
  validateOutboxEntryBase,
  // Conflict resolution
  ConflictResolutionService,
  createConflictResolutionService,
} from '../../sdk';

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
  // Outbox types
  OutboxEntryStatus,
  OutboxEntryType,
  OutboxSplitGroup,
  RecoveryResult,
  RecoveryDetail,
  // Validation types
  ValidatedTxfToken,
  ValidatedTxfMeta,
  ValidatedTxfStorageData,
  // Serializer types
  ParseTxfStorageResult,
  BuildTxfStorageOptions,
} from '../../sdk';
