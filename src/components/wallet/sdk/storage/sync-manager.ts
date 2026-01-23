/**
 * Sync Manager
 *
 * Manages multiple sync providers and orchestrates sync operations.
 * Handles push/pull to remote storage (IPFS, cloud, database).
 */

import type {
  SyncProvider,
  SyncManager as ISyncManager,
  SyncManagerConfig,
  SyncStrategy,
  SyncResult,
  SyncEvent,
  SyncEventCallback,
  WalletSnapshot,
} from './storage-provider';

// ==========================================
// Default Configuration
// ==========================================

const DEFAULT_CONFIG: Required<SyncManagerConfig> = {
  strategy: 'manual',
  autoSyncInterval: 60000, // 1 minute
  debounceMs: 1000,
};

// ==========================================
// Implementation
// ==========================================

/**
 * Default SyncManager implementation
 */
export class DefaultSyncManager implements ISyncManager {
  private providers: Map<string, SyncProvider> = new Map();
  private enabledProviders: Set<string> = new Set();
  private subscribers: Set<SyncEventCallback> = new Set();
  private strategy: SyncStrategy;
  private autoSyncInterval: number;
  private debounceMs: number;
  private autoSyncTimer: ReturnType<typeof setInterval> | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: SyncManagerConfig = {}) {
    const mergedConfig = { ...DEFAULT_CONFIG, ...config };
    this.strategy = mergedConfig.strategy;
    this.autoSyncInterval = mergedConfig.autoSyncInterval;
    this.debounceMs = mergedConfig.debounceMs;
  }

  // ==========================================
  // Provider Management
  // ==========================================

  addProvider(provider: SyncProvider): void {
    this.providers.set(provider.id, provider);
    this.emit({
      type: 'provider:added',
      providerId: provider.id,
      timestamp: Date.now(),
    });
  }

  removeProvider(providerId: string): void {
    this.providers.delete(providerId);
    this.enabledProviders.delete(providerId);
    this.emit({
      type: 'provider:removed',
      providerId,
      timestamp: Date.now(),
    });
  }

  getProviders(): SyncProvider[] {
    return Array.from(this.providers.values());
  }

  getEnabledProviders(): SyncProvider[] {
    return Array.from(this.providers.values()).filter(p =>
      this.enabledProviders.has(p.id)
    );
  }

  async enableProvider(providerId: string): Promise<void> {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new Error(`Provider not found: ${providerId}`);
    }

    // Connect if not connected
    if (!provider.isConnected()) {
      await provider.connect();
    }

    this.enabledProviders.add(providerId);
    this.emit({
      type: 'provider:enabled',
      providerId,
      timestamp: Date.now(),
    });
  }

  disableProvider(providerId: string): void {
    this.enabledProviders.delete(providerId);
    this.emit({
      type: 'provider:disabled',
      providerId,
      timestamp: Date.now(),
    });
  }

  isProviderEnabled(providerId: string): boolean {
    return this.enabledProviders.has(providerId);
  }

  // ==========================================
  // Sync Operations
  // ==========================================

  async push(snapshot: WalletSnapshot): Promise<SyncResult[]> {
    const enabledProviders = this.getEnabledProviders();
    const results: SyncResult[] = [];

    this.emit({
      type: 'sync:start',
      timestamp: Date.now(),
    });

    for (const provider of enabledProviders) {
      try {
        const result = await provider.push(snapshot);
        results.push(result);
      } catch (error) {
        const result: SyncResult = {
          providerId: provider.id,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          timestamp: Date.now(),
        };
        results.push(result);
        this.emit({
          type: 'sync:error',
          providerId: provider.id,
          error: error instanceof Error ? error : new Error(String(error)),
          timestamp: Date.now(),
        });
      }
    }

    this.emit({
      type: 'sync:complete',
      timestamp: Date.now(),
    });

    return results;
  }

  async pull(providerId: string, address: string): Promise<WalletSnapshot | null> {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new Error(`Provider not found: ${providerId}`);
    }

    if (!provider.isConnected()) {
      await provider.connect();
    }

    return provider.pull(address);
  }

  async pullAll(address: string): Promise<WalletSnapshot | null> {
    const enabledProviders = this.getEnabledProviders();
    const snapshots: WalletSnapshot[] = [];

    for (const provider of enabledProviders) {
      try {
        const snapshot = await provider.pull(address);
        if (snapshot) {
          snapshots.push(snapshot);
        }
      } catch (error) {
        console.warn(`Failed to pull from ${provider.id}:`, error);
      }
    }

    if (snapshots.length === 0) {
      return null;
    }

    // Return the most recent snapshot
    // TODO: Implement proper merge with conflict resolution
    return snapshots.sort((a, b) => b.timestamp - a.timestamp)[0];
  }

  async sync(address: string, localSnapshot: WalletSnapshot): Promise<SyncResult[]> {
    // 1. Pull from all providers
    const remoteSnapshot = await this.pullAll(address);

    // 2. Merge if needed
    let snapshotToSync = localSnapshot;
    if (remoteSnapshot && remoteSnapshot.timestamp > localSnapshot.timestamp) {
      // Remote is newer - use remote with local changes
      // TODO: Implement proper merge
      snapshotToSync = {
        ...remoteSnapshot,
        tokens: [...remoteSnapshot.tokens, ...localSnapshot.tokens.filter(
          t => !remoteSnapshot.tokens.some((rt: unknown) => (rt as { id?: string }).id === (t as { id?: string }).id)
        )],
        timestamp: Date.now(),
      };
    }

    // 3. Push to all providers
    return this.push(snapshotToSync);
  }

  // ==========================================
  // Strategy
  // ==========================================

  setStrategy(strategy: SyncStrategy): void {
    this.strategy = strategy;
  }

  getStrategy(): SyncStrategy {
    return this.strategy;
  }

  startAutoSync(address: string, getSnapshot: () => WalletSnapshot): void {
    if (this.strategy !== 'auto') {
      console.warn('Auto-sync only works with "auto" strategy');
      return;
    }

    this.stopAutoSync();

    this.autoSyncTimer = setInterval(async () => {
      try {
        const snapshot = getSnapshot();
        await this.sync(address, snapshot);
      } catch (error) {
        console.error('Auto-sync failed:', error);
      }
    }, this.autoSyncInterval);
  }

  stopAutoSync(): void {
    if (this.autoSyncTimer) {
      clearInterval(this.autoSyncTimer);
      this.autoSyncTimer = null;
    }
  }

  /**
   * Trigger sync with debounce (for 'on-change' strategy)
   */
  triggerSync(_address: string, getSnapshot: () => WalletSnapshot): void {
    if (this.strategy !== 'on-change') {
      return;
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(async () => {
      this.debounceTimer = null;
      try {
        const snapshot = getSnapshot();
        await this.push(snapshot);
      } catch (error) {
        console.error('Debounced sync failed:', error);
      }
    }, this.debounceMs);
  }

  // ==========================================
  // Events
  // ==========================================

  subscribe(callback: SyncEventCallback): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  private emit(event: SyncEvent): void {
    for (const callback of this.subscribers) {
      try {
        callback(event);
      } catch (error) {
        console.error('Sync event callback error:', error);
      }
    }
  }
}

// ==========================================
// Factory
// ==========================================

/**
 * Create a sync manager
 */
export function createSyncManager(config?: SyncManagerConfig): DefaultSyncManager {
  return new DefaultSyncManager(config);
}
