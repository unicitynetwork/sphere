/**
 * File-Based Token Storage Provider
 *
 * Storage implementation that persists data to a JSON file.
 * Useful for:
 * - CLI tools
 * - Node.js applications
 * - Desktop apps (Electron)
 *
 * NOTE: This implementation uses dynamic imports for 'fs' and 'path'
 * to avoid bundling issues in browser environments.
 * It will only work in Node.js environments.
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
  FileStorageOptions,
} from './types';
import { ConflictResolutionService } from './conflict-resolution';

// ==========================================
// FileStorageProvider
// ==========================================

export class FileStorageProvider<
  TStorageData extends TxfStorageDataBase = TxfStorageDataBase
> implements TokenStorageProvider<TStorageData> {
  private data: TStorageData | null = null;
  private initialized = false;
  private isSyncing = false;
  private lastSync: SyncResult<TStorageData> | null = null;
  private eventCallbacks: StorageEventCallback[] = [];
  private conflictResolver: ConflictResolutionService<TStorageData>;

  private readonly options: Required<FileStorageOptions>;

  // Node.js modules (lazy loaded)
  private fs: typeof import('fs/promises') | null = null;
  private path: typeof import('path') | null = null;

  constructor(options: FileStorageOptions) {
    this.options = {
      debug: false,
      autoSyncInterval: 0,
      createIfNotExists: true,
      prettyPrint: true,
      ...options,
    };
    this.conflictResolver = new ConflictResolutionService<TStorageData>();
  }

  // ==========================================
  // Lifecycle
  // ==========================================

  async initialize(): Promise<boolean> {
    if (this.initialized) return true;

    try {
      // Dynamically import Node.js modules
      this.fs = await import('fs/promises');
      this.path = await import('path');

      // Check if file exists
      const fileExists = await this.fileExists(this.options.filePath);

      if (fileExists) {
        // Load existing data
        const loadResult = await this.load();
        if (loadResult.success && loadResult.data) {
          this.data = loadResult.data;
          this.log(`Initialized with existing data (${loadResult.tokenCount} tokens)`);
        }
      } else if (this.options.createIfNotExists) {
        // Create empty file
        await this.createEmptyFile();
        this.log('Initialized with new empty file');
      } else {
        throw new Error(`File not found: ${this.options.filePath}`);
      }

      this.initialized = true;
      return true;
    } catch (error) {
      this.log(`Initialization failed: ${error}`);
      return false;
    }
  }

  async shutdown(): Promise<void> {
    // Save any pending data before shutdown
    if (this.data) {
      await this.save(this.data);
    }

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
      identifier: this.options.filePath,
      providerInfo: {
        type: 'file',
        filePath: this.options.filePath,
        hasData: this.data !== null,
      },
    };
  }

  // ==========================================
  // Core Operations
  // ==========================================

  async save(data: TStorageData): Promise<SaveResult> {
    const timestamp = Date.now();

    try {
      if (!this.fs) {
        throw new Error('File system not initialized');
      }

      await this.emitEvent({
        type: 'storage:saving',
        timestamp,
      });

      // Increment version
      const newVersion = (data._meta?.version ?? 0) + 1;
      const newMeta: TxfMeta = {
        ...data._meta,
        version: newVersion,
        lastModified: timestamp,
      };

      const dataToSave = {
        ...data,
        _meta: newMeta,
      } as TStorageData;

      // Write to file
      const jsonContent = this.options.prettyPrint
        ? JSON.stringify(dataToSave, null, 2)
        : JSON.stringify(dataToSave);

      await this.fs.writeFile(this.options.filePath, jsonContent, 'utf-8');

      this.data = dataToSave;
      const tokenCount = this.countTokens(this.data);

      await this.emitEvent({
        type: 'storage:saved',
        timestamp,
        data: {
          identifier: this.options.filePath,
          version: newVersion,
          tokenCount,
        },
      });

      this.log(`Saved ${tokenCount} tokens to ${this.options.filePath}`);

      return {
        success: true,
        identifier: this.options.filePath,
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
    const timestamp = Date.now();
    const filePath = identifier ?? this.options.filePath;

    try {
      if (!this.fs) {
        throw new Error('File system not initialized');
      }

      await this.emitEvent({
        type: 'storage:loading',
        timestamp,
      });

      const content = await this.fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(content) as TStorageData;

      const tokenCount = this.countTokens(data);

      await this.emitEvent({
        type: 'storage:loaded',
        timestamp,
        data: {
          identifier: filePath,
          version: data._meta?.version,
          tokenCount,
        },
      });

      this.log(`Loaded ${tokenCount} tokens from ${filePath}`);

      return {
        success: true,
        data,
        version: data._meta?.version,
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
    const timestamp = Date.now();
    this.isSyncing = true;

    try {
      await this.emitEvent({
        type: 'sync:started',
        timestamp,
      });

      // Load current file data
      const fileResult = await this.load();

      // If no file data, just save local data
      if (!fileResult.success || !fileResult.data) {
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
        return result;
      }

      // Resolve conflicts
      const mergeResult = this.conflictResolver.resolveConflict(localData, fileResult.data);

      // Save merged data
      const saveResult = await this.save(mergeResult.merged as TStorageData);

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
          version: saveResult.version,
          tokenCount: saveResult.tokenCount,
          conflictsResolved: mergeResult.conflicts.length,
        },
      });

      this.log(`Sync complete: ${saveResult.tokenCount} tokens, ${mergeResult.conflicts.length} conflicts`);

      const result: SyncResult<TStorageData> = {
        success: true,
        data: this.data ?? undefined,
        version: saveResult.version,
        tokenCount: saveResult.tokenCount,
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
    try {
      if (!this.fs) return false;

      await this.fs.unlink(this.options.filePath);
      this.data = null;
      this.lastSync = null;
      this.log('File deleted');
      return true;
    } catch {
      return false;
    }
  }

  async exists(identifier?: string): Promise<boolean> {
    return this.fileExists(identifier ?? this.options.filePath);
  }

  async list(): Promise<string[]> {
    const exists = await this.fileExists(this.options.filePath);
    return exists ? [this.options.filePath] : [];
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

  private async fileExists(filePath: string): Promise<boolean> {
    if (!this.fs) return false;

    try {
      await this.fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private async createEmptyFile(): Promise<void> {
    if (!this.fs || !this.path) return;

    const emptyData: TxfStorageDataBase = {
      _meta: {
        version: 1,
        lastModified: Date.now(),
        format: 'txf',
        formatVersion: '2.0',
      },
    };

    // Ensure directory exists
    const dir = this.path.dirname(this.options.filePath);
    await this.fs.mkdir(dir, { recursive: true });

    // Write empty file
    const content = this.options.prettyPrint
      ? JSON.stringify(emptyData, null, 2)
      : JSON.stringify(emptyData);

    await this.fs.writeFile(this.options.filePath, content, 'utf-8');
  }

  private log(message: string): void {
    if (this.options.debug) {
      console.log(`[FileStorage] ${message}`);
    }
  }
}

// ==========================================
// Factory Function
// ==========================================

/**
 * Create a file-based storage provider
 * Only works in Node.js environments
 */
export function createFileStorageProvider<
  TStorageData extends TxfStorageDataBase = TxfStorageDataBase
>(options: FileStorageOptions): FileStorageProvider<TStorageData> {
  return new FileStorageProvider<TStorageData>(options);
}
