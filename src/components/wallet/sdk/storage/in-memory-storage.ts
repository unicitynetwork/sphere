/**
 * In-Memory Token Storage Provider
 *
 * Simple storage implementation that keeps data in memory.
 * Useful for:
 * - Testing
 * - CLI tools (single session)
 * - Temporary storage before persisting elsewhere
 */

import type { TxfStorageDataBase, TxfMeta } from '../types/txf';
import type {
  TokenStorageProvider,
  StorageStatus,
  SaveResult,
  LoadResult,
  SyncResult,
  StorageEventCallback,
  StorageEvent,
  InMemoryStorageOptions,
} from './types';
import { ConflictResolutionService } from './conflict-resolution';

// ==========================================
// InMemoryStorageProvider
// ==========================================

export class InMemoryStorageProvider<
  TStorageData extends TxfStorageDataBase = TxfStorageDataBase
> implements TokenStorageProvider<TStorageData> {
  private data: TStorageData | null = null;
  private initialized = false;
  private isSyncing = false;
  private lastSync: SyncResult<TStorageData> | null = null;
  private eventCallbacks: StorageEventCallback[] = [];
  private conflictResolver: ConflictResolutionService<TStorageData>;

  private readonly options: InMemoryStorageOptions;

  constructor(options: InMemoryStorageOptions = {}) {
    this.options = {
      debug: false,
      autoSyncInterval: 0,
      simulatedLatency: 0,
      ...options,
    };
    this.conflictResolver = new ConflictResolutionService<TStorageData>();
  }

  // ==========================================
  // Lifecycle
  // ==========================================

  async initialize(): Promise<boolean> {
    if (this.initialized) return true;

    await this.simulateLatency();

    if (this.options.initialData) {
      this.data = this.options.initialData as TStorageData;
      this.log('Initialized with initial data');
    } else {
      this.log('Initialized (empty)');
    }

    this.initialized = true;
    return true;
  }

  async shutdown(): Promise<void> {
    this.data = null;
    this.initialized = false;
    this.eventCallbacks = [];
    this.log('Shutdown');
  }

  getStatus(): StorageStatus {
    return {
      initialized: this.initialized,
      isSyncing: this.isSyncing,
      currentVersion: this.data?._meta?.version ?? 0,
      lastSync: this.lastSync as SyncResult | null,
      identifier: 'memory',
      providerInfo: {
        type: 'in-memory',
        hasData: this.data !== null,
      },
    };
  }

  // ==========================================
  // Core Operations
  // ==========================================

  async save(data: TStorageData): Promise<SaveResult> {
    await this.simulateLatency();

    const timestamp = Date.now();

    try {
      await this.emitEvent({
        type: 'storage:saving',
        timestamp,
      });

      // Increment version
      const newVersion = (this.data?._meta?.version ?? 0) + 1;
      const newMeta: TxfMeta = {
        ...data._meta,
        version: newVersion,
        lastModified: timestamp,
      };

      this.data = {
        ...data,
        _meta: newMeta,
      } as TStorageData;

      const tokenCount = this.countTokens(this.data);

      await this.emitEvent({
        type: 'storage:saved',
        timestamp,
        data: {
          identifier: 'memory',
          version: newVersion,
          tokenCount,
        },
      });

      this.log(`Saved ${tokenCount} tokens, version ${newVersion}`);

      return {
        success: true,
        identifier: 'memory',
        version: newVersion,
        tokenCount,
        timestamp,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      await this.emitEvent({
        type: 'storage:error',
        timestamp,
        data: { error: errorMsg },
      });

      return {
        success: false,
        timestamp,
        error: errorMsg,
      };
    }
  }

  async load(identifier?: string): Promise<LoadResult<TStorageData>> {
    await this.simulateLatency();

    const timestamp = Date.now();

    try {
      await this.emitEvent({
        type: 'storage:loading',
        timestamp,
      });

      if (!this.data) {
        return {
          success: false,
          timestamp,
          error: 'No data stored',
        };
      }

      const tokenCount = this.countTokens(this.data);

      await this.emitEvent({
        type: 'storage:loaded',
        timestamp,
        data: {
          identifier: identifier ?? 'memory',
          version: this.data._meta.version,
          tokenCount,
        },
      });

      this.log(`Loaded ${tokenCount} tokens, version ${this.data._meta.version}`);

      return {
        success: true,
        data: { ...this.data } as TStorageData,
        version: this.data._meta.version,
        tokenCount,
        timestamp,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      await this.emitEvent({
        type: 'storage:error',
        timestamp,
        data: { error: errorMsg },
      });

      return {
        success: false,
        timestamp,
        error: errorMsg,
      };
    }
  }

  async sync(localData: TStorageData): Promise<SyncResult<TStorageData>> {
    await this.simulateLatency();

    const timestamp = Date.now();
    this.isSyncing = true;

    try {
      await this.emitEvent({
        type: 'sync:started',
        timestamp,
      });

      // If no stored data, just save the local data
      if (!this.data) {
        const saveResult = await this.save(localData);
        const result: SyncResult<TStorageData> = {
          success: saveResult.success,
          data: this.data ?? undefined,
          version: saveResult.version,
          tokenCount: saveResult.tokenCount,
          conflictsResolved: 0,
          newTokens: [],
          removedTokens: [],
          timestamp,
          error: saveResult.error,
        };
        this.lastSync = result;
        this.isSyncing = false;

        await this.emitEvent({
          type: 'sync:completed',
          timestamp,
          data: {
            version: result.version,
            tokenCount: result.tokenCount,
            conflictsResolved: 0,
          },
        });

        return result;
      }

      // Resolve conflicts between local and stored data
      const mergeResult = this.conflictResolver.resolveConflict(localData, this.data);

      // Save merged data
      this.data = mergeResult.merged as TStorageData;

      const tokenCount = this.countTokens(this.data);

      if (mergeResult.conflicts.length > 0) {
        await this.emitEvent({
          type: 'sync:conflict',
          timestamp,
          data: {
            conflictsResolved: mergeResult.conflicts.length,
          },
        });
      }

      await this.emitEvent({
        type: 'sync:completed',
        timestamp,
        data: {
          version: this.data._meta.version,
          tokenCount,
          conflictsResolved: mergeResult.conflicts.length,
        },
      });

      this.log(`Sync complete: ${tokenCount} tokens, ${mergeResult.conflicts.length} conflicts resolved`);

      const result: SyncResult<TStorageData> = {
        success: true,
        data: { ...this.data } as TStorageData,
        version: this.data._meta.version,
        tokenCount,
        conflictsResolved: mergeResult.conflicts.length,
        newTokens: mergeResult.newTokens,
        removedTokens: mergeResult.removedTokens,
        timestamp,
      };

      this.lastSync = result;
      this.isSyncing = false;

      return result;
    } catch (error) {
      this.isSyncing = false;
      const errorMsg = error instanceof Error ? error.message : String(error);

      await this.emitEvent({
        type: 'sync:error',
        timestamp,
        data: { error: errorMsg },
      });

      return {
        success: false,
        timestamp,
        error: errorMsg,
      };
    }
  }

  // ==========================================
  // Optional Operations
  // ==========================================

  async clear(): Promise<boolean> {
    await this.simulateLatency();
    this.data = null;
    this.lastSync = null;
    this.log('Cleared');
    return true;
  }

  async exists(_identifier?: string): Promise<boolean> { // eslint-disable-line @typescript-eslint/no-unused-vars
    return this.data !== null;
  }

  async list(): Promise<string[]> {
    return this.data ? ['memory'] : [];
  }

  // ==========================================
  // Events
  // ==========================================

  onEvent(callback: StorageEventCallback): () => void {
    this.eventCallbacks.push(callback);
    return () => {
      this.eventCallbacks = this.eventCallbacks.filter(cb => cb !== callback);
    };
  }

  // ==========================================
  // Direct Data Access (for testing)
  // ==========================================

  /**
   * Get raw stored data (for testing)
   */
  getRawData(): TStorageData | null {
    return this.data ? { ...this.data } as TStorageData : null;
  }

  /**
   * Set raw data directly (for testing)
   */
  setRawData(data: TStorageData | null): void {
    this.data = data;
  }

  // ==========================================
  // Private Helpers
  // ==========================================

  private async emitEvent(event: StorageEvent): Promise<void> {
    for (const callback of this.eventCallbacks) {
      try {
        await callback(event);
      } catch (error) {
        this.log(`Event callback error: ${error}`);
      }
    }
  }

  private countTokens(data: TxfStorageDataBase): number {
    let count = 0;
    for (const key of Object.keys(data)) {
      if (key.startsWith('token_') && !key.startsWith('token_archived_') && !key.startsWith('token_forked_')) {
        count++;
      }
    }
    return count;
  }

  private async simulateLatency(): Promise<void> {
    if (this.options.simulatedLatency && this.options.simulatedLatency > 0) {
      await new Promise(resolve => setTimeout(resolve, this.options.simulatedLatency));
    }
  }

  private log(message: string): void {
    if (this.options.debug) {
      console.log(`[InMemoryStorage] ${message}`);
    }
  }
}

// ==========================================
// Factory Function
// ==========================================

/**
 * Create an in-memory storage provider
 */
export function createInMemoryStorageProvider<
  TStorageData extends TxfStorageDataBase = TxfStorageDataBase
>(options: InMemoryStorageOptions = {}): InMemoryStorageProvider<TStorageData> {
  return new InMemoryStorageProvider<TStorageData>(options);
}
