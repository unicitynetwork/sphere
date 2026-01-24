/**
 * Token Storage Provider Types (Platform-Independent)
 *
 * Defines interfaces for token storage abstraction.
 * Allows different implementations: IPFS, file system, database, etc.
 */

import type { TxfStorageDataBase } from '../types/txf';

// ==========================================
// Storage Event Types
// ==========================================

/**
 * Types of storage events that can be emitted
 */
export type StorageEventType =
  | "storage:saving"
  | "storage:saved"
  | "storage:loading"
  | "storage:loaded"
  | "storage:error"
  | "sync:started"
  | "sync:completed"
  | "sync:conflict"
  | "sync:error";

/**
 * Storage event payload
 */
export interface StorageEvent {
  type: StorageEventType;
  timestamp: number;
  data?: {
    identifier?: string;      // Storage identifier (CID, file path, etc.)
    tokenCount?: number;
    version?: number;
    error?: string;
    conflictsResolved?: number;
  };
}

/**
 * Storage event callback function
 */
export type StorageEventCallback = (event: StorageEvent) => void | Promise<void>;

// ==========================================
// Storage Result Types
// ==========================================

/**
 * Result of a save operation
 */
export interface SaveResult {
  success: boolean;
  /** Storage identifier (CID for IPFS, path for file, etc.) */
  identifier?: string;
  /** Data version after save */
  version?: number;
  /** Number of tokens saved */
  tokenCount?: number;
  /** Timestamp of save */
  timestamp: number;
  /** Error message if failed */
  error?: string;
}

/**
 * Result of a load operation
 */
export interface LoadResult<TStorageData = TxfStorageDataBase> {
  success: boolean;
  /** Loaded storage data */
  data?: TStorageData;
  /** Data version */
  version?: number;
  /** Number of tokens loaded */
  tokenCount?: number;
  /** Timestamp of load */
  timestamp: number;
  /** Error message if failed */
  error?: string;
}

/**
 * Result of a sync operation
 */
export interface SyncResult<TStorageData = TxfStorageDataBase> {
  success: boolean;
  /** Merged/synced data */
  data?: TStorageData;
  /** Final version after sync */
  version?: number;
  /** Number of tokens after sync */
  tokenCount?: number;
  /** Number of conflicts resolved during merge */
  conflictsResolved?: number;
  /** New tokens discovered from remote */
  newTokens?: string[];
  /** Tokens removed (tombstoned) */
  removedTokens?: string[];
  /** Timestamp of sync */
  timestamp: number;
  /** Error message if failed */
  error?: string;
}

/**
 * Storage provider status
 */
export interface StorageStatus {
  /** Whether provider is initialized and ready */
  initialized: boolean;
  /** Whether a sync operation is in progress */
  isSyncing: boolean;
  /** Current data version */
  currentVersion: number;
  /** Last successful sync result */
  lastSync: SyncResult | null;
  /** Provider-specific identifier (IPNS name, file path, etc.) */
  identifier: string | null;
  /** Additional provider-specific status info */
  providerInfo?: Record<string, unknown>;
}

// ==========================================
// Storage Provider Interface
// ==========================================

/**
 * Token Storage Provider Interface
 *
 * Implementations can use different backends:
 * - IPFS/IPNS (decentralized, browser)
 * - File system (CLI, Node.js)
 * - SQLite (mobile, Electron)
 * - PostgreSQL (server)
 * - In-memory (testing)
 */
export interface TokenStorageProvider<
  TStorageData extends TxfStorageDataBase = TxfStorageDataBase
> {
  // ==========================================
  // Lifecycle
  // ==========================================

  /**
   * Initialize the storage provider
   * May establish connections, create tables, etc.
   */
  initialize(): Promise<boolean>;

  /**
   * Shutdown the storage provider
   * Clean up resources, close connections
   */
  shutdown(): Promise<void>;

  /**
   * Get current status of the storage provider
   */
  getStatus(): StorageStatus;

  // ==========================================
  // Core Operations
  // ==========================================

  /**
   * Save storage data
   *
   * @param data - Storage data to save
   * @returns Save result with identifier
   */
  save(data: TStorageData): Promise<SaveResult>;

  /**
   * Load storage data
   *
   * @param identifier - Optional identifier (uses default if not provided)
   * @returns Load result with data
   */
  load(identifier?: string): Promise<LoadResult<TStorageData>>;

  /**
   * Sync local data with remote/external source
   * Handles conflict resolution automatically
   *
   * @param localData - Current local data to sync
   * @returns Sync result with merged data
   */
  sync(localData: TStorageData): Promise<SyncResult<TStorageData>>;

  // ==========================================
  // Optional Operations
  // ==========================================

  /**
   * Delete/clear all stored data
   * Not all providers may support this
   */
  clear?(): Promise<boolean>;

  /**
   * Check if data exists at identifier
   */
  exists?(identifier?: string): Promise<boolean>;

  /**
   * Get list of all stored identifiers
   * Useful for backup/migration
   */
  list?(): Promise<string[]>;

  // ==========================================
  // Events
  // ==========================================

  /**
   * Subscribe to storage events
   * Returns unsubscribe function
   */
  onEvent?(callback: StorageEventCallback): () => void;
}

// ==========================================
// Storage Provider Options
// ==========================================

/**
 * Base options for storage providers
 */
export interface StorageProviderOptions {
  /** Enable debug logging */
  debug?: boolean;
  /** Auto-sync interval in ms (0 = disabled) */
  autoSyncInterval?: number;
}

/**
 * Options for file-based storage
 */
export interface FileStorageOptions extends StorageProviderOptions {
  /** Path to storage file */
  filePath: string;
  /** Create file if it doesn't exist */
  createIfNotExists?: boolean;
  /** Pretty-print JSON output */
  prettyPrint?: boolean;
}

/**
 * Options for IPFS storage
 */
export interface IpfsStorageOptions extends StorageProviderOptions {
  /** Private key for IPNS (hex) */
  privateKey: string;
  /** Bootstrap peers */
  bootstrapPeers?: string[];
  /** Gateway URLs for IPNS resolution */
  gatewayUrls?: string[];
}

/**
 * Options for in-memory storage (testing)
 */
export interface InMemoryStorageOptions extends StorageProviderOptions {
  /** Initial data to load */
  initialData?: TxfStorageDataBase;
  /** Simulate network latency in ms */
  simulatedLatency?: number;
}

// ==========================================
// Factory Function Type
// ==========================================

/**
 * Factory function for creating storage providers
 */
export type StorageProviderFactory<
  TOptions extends StorageProviderOptions = StorageProviderOptions,
  TStorageData extends TxfStorageDataBase = TxfStorageDataBase
> = (options: TOptions) => TokenStorageProvider<TStorageData>;
