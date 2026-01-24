/**
 * InMemory Storage Provider (Async)
 *
 * Memory-based storage for testing and development.
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

export interface InMemoryProviderConfig extends StorageProviderConfig {
  /** Initial data to populate */
  initialData?: Record<string, string>;
}

// ==========================================
// Implementation
// ==========================================

/**
 * In-memory storage provider
 *
 * Useful for testing and development.
 * Data is lost when the provider is garbage collected.
 */
export class InMemoryProvider implements StorageProvider {
  // Metadata
  readonly id = PROVIDER_IDS.IN_MEMORY;
  readonly name = 'Memory Storage';
  readonly type: ProviderType = 'local';
  readonly icon = '🧠';
  readonly description = 'Temporary in-memory storage (data lost on refresh)';

  // Internal state
  private data: Map<string, string>;
  private readonly prefix: string;
  private readonly debug: boolean;
  private status: ProviderStatus = 'disconnected';

  constructor(config: InMemoryProviderConfig = {}) {
    this.data = new Map();
    this.prefix = config.prefix ?? '';
    this.debug = config.debug ?? false;

    // Populate initial data
    if (config.initialData) {
      for (const [key, value] of Object.entries(config.initialData)) {
        this.data.set(key, value);
      }
    }
  }

  // ==========================================
  // Lifecycle
  // ==========================================

  async connect(): Promise<void> {
    this.status = 'connected';
    this.log('Connected to in-memory storage');
  }

  async disconnect(): Promise<void> {
    this.status = 'disconnected';
    this.log('Disconnected from in-memory storage');
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
    const value = this.data.get(fullKey) ?? null;
    this.log(`get(${key}) = ${value ? `${value.slice(0, 50)}...` : 'null'}`);
    return value;
  }

  async set(key: string, value: string): Promise<void> {
    const fullKey = this.getFullKey(key);
    this.data.set(fullKey, value);
    this.log(`set(${key}, ${value.slice(0, 50)}...)`);
  }

  async remove(key: string): Promise<void> {
    const fullKey = this.getFullKey(key);
    this.data.delete(fullKey);
    this.log(`remove(${key})`);
  }

  async has(key: string): Promise<boolean> {
    const fullKey = this.getFullKey(key);
    return this.data.has(fullKey);
  }

  async keys(prefix?: string): Promise<string[]> {
    const result: string[] = [];
    const searchPrefix = this.prefix + (prefix ?? '');

    for (const key of this.data.keys()) {
      if (key.startsWith(searchPrefix)) {
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
  // Testing Helpers
  // ==========================================

  /**
   * Get all data (for testing/debugging)
   */
  getAllData(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of this.data) {
      result[key] = value;
    }
    return result;
  }

  /**
   * Get size of storage
   */
  size(): number {
    return this.data.size;
  }

  /**
   * Reset storage (clear all data)
   */
  reset(): void {
    this.data.clear();
    this.log('Storage reset');
  }

  // ==========================================
  // Helpers
  // ==========================================

  private getFullKey(key: string): string {
    return this.prefix + key;
  }

  private log(message: string): void {
    if (this.debug) {
      console.log(`[InMemoryProvider] ${message}`);
    }
  }
}

// ==========================================
// Factory
// ==========================================

/**
 * Create an in-memory provider
 */
export function createInMemoryProvider(
  config?: InMemoryProviderConfig
): InMemoryProvider {
  return new InMemoryProvider(config);
}
