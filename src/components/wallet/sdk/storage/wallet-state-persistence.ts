/**
 * Wallet State Persistence Interface (Platform-Independent)
 *
 * Generic interface for persisting wallet application state.
 * This covers identity selection, Nostr sync state, backup timestamps, etc.
 *
 * Implementations can use localStorage (browser), files (CLI), or other storage.
 */

// ==========================================
// Interface
// ==========================================

/**
 * Wallet state persistence for app-level data
 * Abstracts storage for identity, nostr, backup, and cache state
 */
export interface WalletStatePersistence {
  // ==========================================
  // Generic key-value operations
  // ==========================================

  /**
   * Get a string value by key
   */
  getString(key: string): string | null;

  /**
   * Set a string value by key
   */
  setString(key: string, value: string): void;

  /**
   * Remove a value by key
   */
  remove(key: string): void;

  /**
   * Check if key exists
   */
  has(key: string): boolean;

  // ==========================================
  // JSON operations (convenience)
  // ==========================================

  /**
   * Get a JSON value by key
   */
  getJSON<T>(key: string): T | null;

  /**
   * Set a JSON value by key
   */
  setJSON<T>(key: string, value: T): void;
}

// ==========================================
// Storage Keys (constants for CLI compatibility)
// ==========================================

/**
 * Standard storage keys used by wallet services
 * CLI implementations should use these same keys for compatibility
 */
export const WALLET_STATE_KEYS = {
  // Identity
  SELECTED_ADDRESS_PATH: 'l3_selected_address_path',
  ENCRYPTED_SEED: 'encrypted_seed',

  // Nostr
  NOSTR_LAST_SYNC: 'nostr_last_sync',
  NOSTR_PROCESSED_EVENTS: 'nostr_processed_events',

  // Backup
  TOKEN_BACKUP_TIMESTAMP: 'token_backup_timestamp',
  LAST_IPFS_SYNC_SUCCESS: 'last_ipfs_sync_success',
  ENCRYPTED_TOKEN_BACKUP: 'encrypted_token_backup',

  // Registry cache
  REGISTRY_CACHE: 'unicity_ids_cache',
  REGISTRY_TIMESTAMP: 'unicity_ids_timestamp',
} as const;

// ==========================================
// In-Memory Implementation
// ==========================================

/**
 * In-memory wallet state persistence
 * Useful for testing or stateless CLI operations
 */
export class InMemoryWalletStatePersistence implements WalletStatePersistence {
  private data = new Map<string, string>();

  getString(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setString(key: string, value: string): void {
    this.data.set(key, value);
  }

  remove(key: string): void {
    this.data.delete(key);
  }

  has(key: string): boolean {
    return this.data.has(key);
  }

  getJSON<T>(key: string): T | null {
    const raw = this.data.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  setJSON<T>(key: string, value: T): void {
    this.data.set(key, JSON.stringify(value));
  }

  /**
   * Clear all data (for testing)
   */
  clear(): void {
    this.data.clear();
  }
}

// ==========================================
// Factory
// ==========================================

/**
 * Create an in-memory wallet state persistence
 */
export function createInMemoryWalletStatePersistence(): WalletStatePersistence {
  return new InMemoryWalletStatePersistence();
}
