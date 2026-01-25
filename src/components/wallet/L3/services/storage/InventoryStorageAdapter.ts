/**
 * Inventory Storage Adapter
 *
 * Drop-in replacement for localStorage with quota handling.
 * Falls back to in-memory storage when quota exceeded.
 *
 * When localStorage quota is exceeded (typically 5-10MB per domain),
 * the adapter automatically migrates inventory data to an in-memory Map.
 * IPFS sync serves as the primary persistence mechanism in this mode.
 */

// Marker key indicating inventory is in memory-only mode
const MEMORY_MODE_MARKER = 'sphere_inventory_memory_mode';

type StorageMode = 'localStorage' | 'recovering' | 'memory';

interface MemoryModeMarkerData {
  timestamp: number;
  reason: string;
}

class InventoryStorageAdapter {
  private mode: StorageMode = 'localStorage';
  private memoryStore: Map<string, string> = new Map();

  // Pattern matching inventory and outbox keys that should be migrated
  private inventoryKeyPattern = /^sphere_wallet_|^sphere_outbox/;

  constructor() {
    // Check if we were previously in memory mode
    if (this.isMemoryModeMarkerSet()) {
      this.mode = 'memory';
      console.log('[InventoryStorage] Starting in memory-only mode (marker detected)');
    }
  }

  /**
   * Synchronous API matching localStorage.getItem
   */
  getItem(key: string): string | null {
    if (this.mode === 'memory') {
      return this.memoryStore.get(key) ?? null;
    }
    return localStorage.getItem(key);
  }

  /**
   * Synchronous API matching localStorage.setItem
   * Falls back to memory storage on QuotaExceededError
   */
  setItem(key: string, value: string): void {
    if (this.mode === 'memory') {
      this.memoryStore.set(key, value);
      return;
    }

    try {
      localStorage.setItem(key, value);
    } catch (error) {
      if (this.isQuotaError(error)) {
        console.warn('[InventoryStorage] Quota exceeded - migrating to memory');
        this.migrateToMemory();
        this.memoryStore.set(key, value);  // Store current write
      } else {
        throw error;
      }
    }
  }

  /**
   * Synchronous API matching localStorage.removeItem
   */
  removeItem(key: string): void {
    if (this.mode === 'memory') {
      this.memoryStore.delete(key);
      return;
    }
    localStorage.removeItem(key);
  }

  /**
   * Migrate inventory data from localStorage to in-memory storage
   * Called when quota is exceeded
   */
  private migrateToMemory(): void {
    this.mode = 'recovering';

    // 1. Copy inventory keys from localStorage to memory
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && this.inventoryKeyPattern.test(key)) {
        const value = localStorage.getItem(key);
        if (value) {
          this.memoryStore.set(key, value);
        }
      }
    }

    // 2. Set marker BEFORE clearing (small write likely to succeed even at quota)
    try {
      const markerData: MemoryModeMarkerData = {
        timestamp: Date.now(),
        reason: 'quota_exceeded'
      };
      localStorage.setItem(MEMORY_MODE_MARKER, JSON.stringify(markerData));
    } catch {
      // Marker write failed - continue anyway, this is informational
      console.warn('[InventoryStorage] Failed to write memory mode marker');
    }

    // 3. Clear large inventory data from localStorage to free space
    // This allows other smaller writes to succeed
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && this.inventoryKeyPattern.test(key)) {
        try {
          localStorage.removeItem(key);
        } catch {
          // Ignore removal errors
        }
      }
    }

    this.mode = 'memory';
    console.log(`[InventoryStorage] Migration complete: ${this.memoryStore.size} keys in memory`);
  }

  /**
   * Check if an error is a quota exceeded error
   */
  private isQuotaError(error: unknown): boolean {
    return error instanceof DOMException && (
      error.name === 'QuotaExceededError' ||
      error.code === 22  // Legacy code for QuotaExceededError
    );
  }

  /**
   * Check if memory mode marker is set in localStorage
   */
  private isMemoryModeMarkerSet(): boolean {
    try {
      return localStorage.getItem(MEMORY_MODE_MARKER) !== null;
    } catch {
      // localStorage inaccessible - use memory
      return true;
    }
  }

  // ==========================================
  // Status methods for diagnostics
  // ==========================================

  /**
   * Check if adapter is using in-memory storage
   */
  isUsingMemory(): boolean {
    return this.mode === 'memory';
  }

  /**
   * Get current storage mode
   */
  getMode(): StorageMode {
    return this.mode;
  }

  /**
   * Get count of keys in memory store (for diagnostics)
   */
  getMemoryKeyCount(): number {
    return this.memoryStore.size;
  }

  /**
   * Clear memory mode marker to re-enable localStorage on next session
   * Use this when localStorage space has been freed (e.g., after cleanup)
   */
  clearMemoryModeMarker(): void {
    try {
      localStorage.removeItem(MEMORY_MODE_MARKER);
      console.log('[InventoryStorage] Memory mode marker cleared');
    } catch {
      // Ignore errors
    }
  }
}

// ==========================================
// Singleton instance
// ==========================================

let instance: InventoryStorageAdapter | null = null;

/**
 * Get the singleton InventoryStorageAdapter instance
 */
export function getInventoryStorage(): InventoryStorageAdapter {
  if (!instance) {
    instance = new InventoryStorageAdapter();
  }
  return instance;
}

/**
 * Reset the singleton instance (for testing)
 */
export function resetInventoryStorage(): void {
  instance = null;
}

export type { StorageMode };
