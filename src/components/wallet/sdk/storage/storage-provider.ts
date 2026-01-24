/**
 * Storage Provider Interface
 *
 * Unified async interface for all storage backends.
 * Used as primary storage for WalletRepository.
 *
 * Implementations:
 * - LocalStorageProvider (browser)
 * - FileStorageProvider (Node.js)
 * - SQLiteProvider (mobile)
 * - PostgresProvider (server)
 * - MongoDBProvider (server)
 */

// ==========================================
// Provider ID Constants
// ==========================================

/**
 * Standard provider IDs
 * Use these instead of magic strings
 *
 * Note: Only providers with implementations are listed here.
 * Add new IDs when implementing new providers.
 */
export const PROVIDER_IDS = {
  // Primary storage providers (LOCAL)
  LOCAL_STORAGE: 'localStorage',
  IN_MEMORY: 'inMemory',
  // FILE_STORAGE: 'fileStorage',    // TODO: implement FileStorageProvider
  // SQLITE: 'sqlite',               // TODO: implement SQLiteProvider

  // Sync providers (REMOTE)
  IPFS: 'ipfs',
  // ICLOUD: 'icloud',               // TODO: implement ICloudSyncProvider
  // GOOGLE_DRIVE: 'gdrive',         // TODO: implement GoogleDriveSyncProvider
  // DROPBOX: 'dropbox',             // TODO: implement DropboxSyncProvider
  // MONGODB: 'mongodb',             // TODO: implement MongoSyncProvider
  // POSTGRES: 'postgres',           // TODO: implement PostgresSyncProvider
} as const;

export type ProviderId = typeof PROVIDER_IDS[keyof typeof PROVIDER_IDS];

// ==========================================
// Storage Provider Interface
// ==========================================

/**
 * Provider status
 */
export type ProviderStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/**
 * Provider type for UI categorization
 */
export type ProviderType = 'local' | 'database' | 'cloud' | 'p2p';

/**
 * Provider metadata for UI display
 */
export interface ProviderMetadata {
  /** Unique identifier */
  readonly id: string;
  /** Display name */
  readonly name: string;
  /** Provider type */
  readonly type: ProviderType;
  /** Icon URL or emoji */
  readonly icon?: string;
  /** Description */
  readonly description?: string;
}

/**
 * Storage Provider Interface
 *
 * All methods are async to support both local and remote storage.
 * Local providers (localStorage) can return immediately via Promise.resolve().
 */
export interface StorageProvider extends ProviderMetadata {
  // ==========================================
  // Lifecycle
  // ==========================================

  /**
   * Connect to storage backend
   * For local storage, this is a no-op.
   * For remote storage, establishes connection.
   */
  connect(): Promise<void>;

  /**
   * Disconnect from storage backend
   */
  disconnect(): Promise<void>;

  /**
   * Check if connected
   */
  isConnected(): boolean;

  /**
   * Get current status
   */
  getStatus(): ProviderStatus;

  // ==========================================
  // CRUD Operations
  // ==========================================

  /**
   * Get value by key
   * @returns Value or null if not found
   */
  get(key: string): Promise<string | null>;

  /**
   * Set value for key
   */
  set(key: string, value: string): Promise<void>;

  /**
   * Remove key
   */
  remove(key: string): Promise<void>;

  /**
   * Check if key exists
   */
  has(key: string): Promise<boolean>;

  /**
   * Get all keys matching optional prefix
   */
  keys(prefix?: string): Promise<string[]>;

  /**
   * Clear all keys matching optional prefix
   */
  clear(prefix?: string): Promise<void>;
}

// ==========================================
// Configuration Types
// ==========================================

/**
 * Base configuration for storage providers
 *
 * StorageProvider is always LOCAL (single-user, single-device):
 * - localStorage (browser)
 * - SQLite (mobile)
 * - File system (CLI/Node.js)
 *
 * For remote storage (IPFS, Cloud), use SyncProvider instead.
 */
export interface StorageProviderConfig {
  /** Key prefix for all operations */
  prefix?: string;
  /** Enable debug logging */
  debug?: boolean;
}

// ==========================================
// Sync Provider Interface
// ==========================================

/**
 * Wallet data snapshot for sync
 */
export interface WalletSnapshot {
  /** Address this snapshot belongs to */
  address: string;
  /** Tokens */
  tokens: unknown[];
  /** Nametag data */
  nametag?: unknown;
  /** Tombstones for conflict resolution */
  tombstones?: unknown[];
  /** Archived tokens */
  archivedTokens?: Record<string, unknown>;
  /** Transaction history */
  transactionHistory?: unknown[];
  /** Timestamp of snapshot */
  timestamp: number;
  /** Version for conflict resolution */
  version?: number;
}

/**
 * Sync result
 */
export interface SyncResult {
  /** Provider that was synced */
  providerId: string;
  /** Whether sync was successful */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Number of items pushed */
  pushed?: number;
  /** Number of items pulled */
  pulled?: number;
  /** Conflicts detected */
  conflicts?: number;
  /** Timestamp of sync */
  timestamp: number;
}

/**
 * Base configuration for sync providers
 *
 * SyncProvider handles REMOTE storage for backup/sync:
 * - IPFS (decentralized, IPNS name derived from private key)
 * - iCloud / Google Drive (cloud)
 *
 * User isolation is automatic via wallet's private key:
 * - IPFS: Each wallet has unique IPNS name derived from private key
 * - Cloud: Data stored under wallet-specific path
 */
export interface SyncProviderConfig {
  /** Enable debug logging */
  debug?: boolean;
  /** Connection timeout in ms */
  timeout?: number;
}

/**
 * Sync Provider Interface
 *
 * Used for backup/sync to remote storage.
 * Different from StorageProvider - operates on full snapshots, not individual keys.
 *
 * User isolation is automatic via wallet's private key:
 * - IPFS: Each wallet has unique IPNS name derived from private key
 * - Cloud: Data stored under wallet-specific path
 */
export interface SyncProvider extends ProviderMetadata {
  // ==========================================
  // Lifecycle
  // ==========================================

  /**
   * Connect to sync backend
   */
  connect(config?: unknown): Promise<void>;

  /**
   * Disconnect from sync backend
   */
  disconnect(): Promise<void>;

  /**
   * Check if connected
   */
  isConnected(): boolean;

  /**
   * Get current status
   */
  getStatus(): ProviderStatus;

  // ==========================================
  // Sync Operations
  // ==========================================

  /**
   * Push local snapshot to remote
   */
  push(snapshot: WalletSnapshot): Promise<SyncResult>;

  /**
   * Pull remote snapshot
   * @returns Remote snapshot or null if not found
   */
  pull(address: string): Promise<WalletSnapshot | null>;

  /**
   * Get last sync timestamp for address
   */
  getLastSyncTime(address: string): Promise<number | null>;
}

// ==========================================
// Sync Manager
// ==========================================

/**
 * Sync strategy
 */
export type SyncStrategy = 'manual' | 'auto' | 'on-change';

/**
 * Sync manager configuration
 */
export interface SyncManagerConfig {
  /** Sync strategy */
  strategy?: SyncStrategy;
  /** Auto-sync interval in ms (for 'auto' strategy) */
  autoSyncInterval?: number;
  /** Debounce time for 'on-change' strategy */
  debounceMs?: number;
}

/**
 * Sync event types
 */
export type SyncEventType = 'sync:start' | 'sync:complete' | 'sync:error' | 'provider:added' | 'provider:removed' | 'provider:enabled' | 'provider:disabled';

/**
 * Sync event
 */
export interface SyncEvent {
  type: SyncEventType;
  providerId?: string;
  result?: SyncResult;
  error?: Error;
  timestamp: number;
}

/**
 * Sync event callback
 */
export type SyncEventCallback = (event: SyncEvent) => void;

/**
 * Sync Manager Interface
 *
 * Manages multiple sync providers and orchestrates sync operations.
 */
export interface SyncManager {
  // ==========================================
  // Provider Management
  // ==========================================

  /**
   * Add a sync provider
   */
  addProvider(provider: SyncProvider): void;

  /**
   * Remove a sync provider
   */
  removeProvider(providerId: string): void;

  /**
   * Get all registered providers
   */
  getProviders(): SyncProvider[];

  /**
   * Get enabled providers
   */
  getEnabledProviders(): SyncProvider[];

  /**
   * Enable a provider
   */
  enableProvider(providerId: string): Promise<void>;

  /**
   * Disable a provider
   */
  disableProvider(providerId: string): void;

  /**
   * Check if provider is enabled
   */
  isProviderEnabled(providerId: string): boolean;

  // ==========================================
  // Sync Operations
  // ==========================================

  /**
   * Push to all enabled providers
   */
  push(snapshot: WalletSnapshot): Promise<SyncResult[]>;

  /**
   * Pull from a specific provider
   */
  pull(providerId: string, address: string): Promise<WalletSnapshot | null>;

  /**
   * Pull from all enabled providers and merge
   */
  pullAll(address: string): Promise<WalletSnapshot | null>;

  /**
   * Full sync (pull + merge + push)
   */
  sync(address: string, localSnapshot: WalletSnapshot): Promise<SyncResult[]>;

  // ==========================================
  // Strategy
  // ==========================================

  /**
   * Set sync strategy
   */
  setStrategy(strategy: SyncStrategy): void;

  /**
   * Get current strategy
   */
  getStrategy(): SyncStrategy;

  /**
   * Start auto-sync (for 'auto' strategy)
   */
  startAutoSync(address: string, getSnapshot: () => WalletSnapshot): void;

  /**
   * Stop auto-sync
   */
  stopAutoSync(): void;

  // ==========================================
  // Events
  // ==========================================

  /**
   * Subscribe to sync events
   */
  subscribe(callback: SyncEventCallback): () => void;
}
