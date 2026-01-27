/**
 * Token Storage - platform-independent
 *
 * NOTE: FileStorageProvider is NOT exported from here because it uses
 * Node.js-only modules (fs, path) that break browser bundlers like Vite.
 * For Node.js/CLI usage, import directly from './file-storage'.
 */

// Types
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
} from './types';

// Conflict Resolution
export {
  ConflictResolutionService,
  createConflictResolutionService,
} from './conflict-resolution';

// Token Comparison
export {
  compareTokenVersions,
  compareTokenVersionsSimple,
  isLocalBetter,
  isRemoteBetter,
  areTokensEqual,
  countCommittedTransactions,
  countPendingTransactions,
  hasPendingTransactions,
  getTokenTransactionStats,
} from './token-comparison';

export type {
  TokenComparisonResult,
  TokenTransactionStats,
} from './token-comparison';

// Tombstone Utilities
export {
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
} from './tombstone-utils';

export type {
  TombstoneValidationResult,
  TombstoneCheckResult,
} from './tombstone-utils';

// Sync Orchestrator
export {
  SyncOrchestrator,
  createSyncOrchestrator,
} from './sync-orchestrator';

export type {
  SyncAction,
  SyncDecision,
  DiffResult,
  SyncOrchestratorOptions,
} from './sync-orchestrator';

// In-Memory Storage (browser & Node.js)
export {
  InMemoryStorageProvider,
  createInMemoryStorageProvider,
} from './in-memory-storage';

// IPFS State Persistence Interface
export type {
  IpfsPersistedState,
  IpfsStatePersistence,
} from './ipfs-state-persistence';

export {
  InMemoryIpfsStatePersistence,
  createInMemoryIpfsStatePersistence,
} from './ipfs-state-persistence';

// Wallet State Persistence Interface
export type {
  WalletStatePersistence,
} from './wallet-state-persistence';

export {
  WALLET_STATE_KEYS,
  InMemoryWalletStatePersistence,
  createInMemoryWalletStatePersistence,
} from './wallet-state-persistence';

// Token Repository (base interface and pure functions) - re-export from core
export {
  // Pure functions
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
  // Pruning functions
  pruneTombstonesByAge,
  pruneMapByCount,
  // Best version selection
  findBestTokenVersion,
} from '../core/token-repository';

export type {
  // Types
  StoredToken,
  StoredWalletData,
  NametagDataBase,
  TransactionHistoryEntry,
} from '../core/token-repository';

// NOTE: FileStorageProvider is available for Node.js only:
// import { FileStorageProvider, createFileStorageProvider } from './sdk/storage/file-storage';

// ==========================================
// Storage Provider System
// ==========================================
// StorageProvider = primary storage (localStorage, SQLite, file system)
// SyncProvider = backup/sync (IPFS, iCloud, Google Drive)

// Storage Provider Interface & Types
export {
  PROVIDER_IDS,
} from './storage-provider';

export type {
  ProviderId,
  StorageProvider,
  StorageProviderConfig,
  ProviderStatus,
  ProviderType,
  ProviderMetadata,
  // Sync types
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
} from './storage-provider';

// Storage Providers
export {
  LocalStorageProvider,
  createLocalStorageProvider,
  type LocalStorageProviderConfig,
  InMemoryProvider,
  createInMemoryProvider,
  type InMemoryProviderConfig,
  // IPFS Sync
  IpfsSyncProvider,
  createIpfsSyncProvider,
  type IpfsSyncProviderConfig,
  type IpnsKeyPair,
} from './providers';

// Sync Manager
export {
  DefaultSyncManager,
  createSyncManager,
} from './sync-manager';

// Wallet Repository (platform-independent implementation) - re-export from core
export {
  WalletRepository,
  WALLET_REPOSITORY_KEYS,
} from '../core/wallet-repository';

// Factory function
export { createWalletRepository } from '../core/wallet-repository';

export type {
  WalletRepositoryConfig,
} from '../core/wallet-repository';

// TokenRepository interface
export type { TokenRepository } from '../core/token-repository';
