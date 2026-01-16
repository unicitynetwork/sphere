/**
 * LocalStorage Provider (Async)
 *
 * Browser localStorage wrapped in async interface.
 * Primary storage for browser-based wallets.
 */

import {
  PROVIDER_IDS,
  type StorageProvider,
  type StorageProviderConfig,
  type ProviderStatus,
  type ProviderType,
} from '../storage-provider';

// ==========================================
// Configuration
// ==========================================

export interface LocalStorageProviderConfig extends StorageProviderConfig {
  /** Reference to localStorage (for testing/SSR) */
  storage?: Storage;
}

// ==========================================
// Implementation
// ==========================================

/**
 * localStorage-based storage provider
 *
 * Wraps synchronous localStorage in async interface for compatibility
 * with other async providers (database, cloud, etc.)
 */
export class LocalStorageProvider implements StorageProvider {
  // Metadata
  readonly id = PROVIDER_IDS.LOCAL_STORAGE;
  readonly name = 'Browser Storage';
  readonly type: ProviderType = 'local';
  readonly icon = '💾';
  readonly description = 'Store data locally in your browser';

  // Internal state
  private readonly storage: Storage;
  private readonly prefix: string;
  private readonly debug: boolean;
  private status: ProviderStatus = 'disconnected';

  constructor(config: LocalStorageProviderConfig = {}) {
    this.storage = config.storage ?? (typeof localStorage !== 'undefined' ? localStorage : createMemoryStorage());
    this.prefix = config.prefix ?? '';
    this.debug = config.debug ?? false;
  }

  // ==========================================
  // Lifecycle
  // ==========================================

  async connect(): Promise<void> {
    this.status = 'connecting';
    try {
      // Test that storage is available
      const testKey = `${this.prefix}__test__`;
      this.storage.setItem(testKey, 'test');
      this.storage.removeItem(testKey);
      this.status = 'connected';
      this.log('Connected to localStorage');
    } catch (error) {
      this.status = 'error';
      throw new Error(`localStorage not available: ${error}`);
    }
  }

  async disconnect(): Promise<void> {
    this.status = 'disconnected';
    this.log('Disconnected from localStorage');
  }

  isConnected(): boolean {
    return this.status === 'connected';
  }

  getStatus(): ProviderStatus {
    return this.status;
  }

  // ==========================================
  // CRUD Operations
  // ==========================================

  async get(key: string): Promise<string | null> {
    const fullKey = this.getFullKey(key);
    const value = this.storage.getItem(fullKey);
    this.log(`get(${key}) = ${value ? `${value.slice(0, 50)}...` : 'null'}`);
    return value;
  }

  async set(key: string, value: string): Promise<void> {
    const fullKey = this.getFullKey(key);
    this.storage.setItem(fullKey, value);
    this.log(`set(${key}, ${value.slice(0, 50)}...)`);
  }

  async remove(key: string): Promise<void> {
    const fullKey = this.getFullKey(key);
    this.storage.removeItem(fullKey);
    this.log(`remove(${key})`);
  }

  async has(key: string): Promise<boolean> {
    const fullKey = this.getFullKey(key);
    return this.storage.getItem(fullKey) !== null;
  }

  async keys(prefix?: string): Promise<string[]> {
    const result: string[] = [];
    const searchPrefix = this.prefix + (prefix ?? '');

    for (let i = 0; i < this.storage.length; i++) {
      const key = this.storage.key(i);
      if (key && key.startsWith(searchPrefix)) {
        // Return key without the provider's prefix
        result.push(key.slice(this.prefix.length));
      }
    }

    return result;
  }

  async clear(prefix?: string): Promise<void> {
    const keysToRemove = await this.keys(prefix);
    for (const key of keysToRemove) {
      await this.remove(key);
    }
    this.log(`clear(${prefix ?? 'all'}) - removed ${keysToRemove.length} keys`);
  }

  // ==========================================
  // Helpers
  // ==========================================

  private getFullKey(key: string): string {
    return this.prefix + key;
  }

  private log(message: string): void {
    if (this.debug) {
      console.log(`[LocalStorageProvider] ${message}`);
    }
  }
}

// ==========================================
// Helper: Memory Storage for SSR
// ==========================================

/**
 * Create a memory-based Storage object (for SSR/testing)
 */
function createMemoryStorage(): Storage {
  const data = new Map<string, string>();

  return {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key: string) {
      return data.get(key) ?? null;
    },
    key(index: number) {
      const keys = Array.from(data.keys());
      return keys[index] ?? null;
    },
    removeItem(key: string) {
      data.delete(key);
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    },
  };
}

// ==========================================
// Factory
// ==========================================

/**
 * Create a localStorage provider
 */
export function createLocalStorageProvider(
  config?: LocalStorageProviderConfig
): LocalStorageProvider {
  return new LocalStorageProvider(config);
}
