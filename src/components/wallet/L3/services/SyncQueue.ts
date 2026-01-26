/**
 * SyncQueue - Priority-based queue for IPFS sync requests
 *
 * Solves the "Sync already in progress" error by queuing requests instead of rejecting them.
 * Features:
 * - Priority-based ordering (HIGH > MEDIUM > LOW)
 * - FIFO within same priority level
 * - Coalescing for LOW priority requests (auto-sync debouncing)
 * - Per-request timeout handling
 * - Integration with SyncCoordinator for cross-tab locking
 */

import type { StorageResult } from "./IpfsStorageService";

// ==========================================
// Types
// ==========================================

/**
 * Priority levels for sync requests
 */
export const SyncPriority = {
  LOW: 0,      // Auto-sync from wallet-updated event (coalesced)
  MEDIUM: 1,   // Post-transfer sync, outbox recovery
  HIGH: 2,     // Pre-transfer sync, Nostr incoming, nametag mint
  CRITICAL: 3  // Reserved for future use (emergency sync)
} as const;

export type SyncPriority = (typeof SyncPriority)[keyof typeof SyncPriority];

/** Helper to get priority name for logging */
function priorityName(priority: SyncPriority): string {
  switch (priority) {
    case SyncPriority.LOW: return 'LOW';
    case SyncPriority.MEDIUM: return 'MEDIUM';
    case SyncPriority.HIGH: return 'HIGH';
    case SyncPriority.CRITICAL: return 'CRITICAL';
    default: return String(priority);
  }
}

/**
 * Options for syncNow() calls
 */
export interface SyncOptions {
  /** Force IPNS publish even if CID unchanged (for IPNS recovery) */
  forceIpnsPublish?: boolean;
  /** Priority level - higher priority requests are processed first */
  priority?: SyncPriority;
  /** Maximum time to wait in queue before timing out (ms) */
  timeout?: number;
  /** Identifier for debugging/logging */
  callerContext?: string;
  /** For LOW priority: coalesce multiple requests into one (default: true) */
  coalesce?: boolean;
  /** Internal: true when called from IPNS retry loop (prevents recursive retry) */
  isRetryAttempt?: boolean;
  /**
   * Skip extended IPFS/IPNS verification delays for faster sync.
   * Content is still persisted (safety guaranteed), but verification retries are reduced.
   * Use for pre-transfer sync where speed is critical.
   */
  skipExtendedVerification?: boolean;
}

/**
 * Internal queue entry
 */
interface SyncQueueEntry {
  id: string;
  priority: SyncPriority;
  options: { forceIpnsPublish?: boolean; isRetryAttempt?: boolean; skipExtendedVerification?: boolean };
  resolve: (result: StorageResult) => void;
  reject: (error: Error) => void;
  timeoutHandle: ReturnType<typeof setTimeout> | null;
  createdAt: number;
  callerContext?: string;
}

/**
 * Queue status for monitoring/debugging
 */
export interface QueueStatus {
  queueLength: number;
  isProcessing: boolean;
  pendingCoalesce: boolean;
  entriesByPriority: Record<SyncPriority, number>;
}

/**
 * Executor function type - the actual sync implementation
 */
type SyncExecutor = (options?: { forceIpnsPublish?: boolean; isRetryAttempt?: boolean; skipExtendedVerification?: boolean }) => Promise<StorageResult>;

// ==========================================
// SyncQueue
// ==========================================

export class SyncQueue {
  private queue: SyncQueueEntry[] = [];
  private isProcessing = false;

  // Coalescing state for LOW priority requests
  private pendingCoalesce: {
    entry: SyncQueueEntry;
    additionalResolvers: Array<{
      resolve: (result: StorageResult) => void;
      reject: (error: Error) => void;
    }>;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;

  // Configuration
  readonly COALESCE_WINDOW_MS = 5000;  // 5 second window for coalescing LOW priority
  readonly DEFAULT_TIMEOUT_MS = 60000; // 60 second default timeout
  readonly MAX_QUEUE_SIZE = 50;        // Prevent unbounded growth

  private executor: SyncExecutor;
  private idCounter = 0;

  constructor(executor: SyncExecutor) {
    this.executor = executor;
  }

  /**
   * Enqueue a sync request and return a promise that resolves when sync completes
   */
  async enqueue(options: SyncOptions = {}): Promise<StorageResult> {
    const {
      forceIpnsPublish = false,
      priority = SyncPriority.MEDIUM,
      timeout = this.DEFAULT_TIMEOUT_MS,
      callerContext,
      coalesce = true,
      isRetryAttempt = false,
      skipExtendedVerification = false,
    } = options;

    // Check queue size limit
    if (this.queue.length >= this.MAX_QUEUE_SIZE) {
      console.warn(`📦 [SyncQueue] Queue full (${this.MAX_QUEUE_SIZE}), rejecting request from ${callerContext || 'unknown'}`);
      return {
        success: false,
        timestamp: Date.now(),
        error: "Sync queue is full - too many pending requests",
      };
    }

    return new Promise<StorageResult>((resolve, reject) => {
      const entry: SyncQueueEntry = {
        id: `sync-${++this.idCounter}`,
        priority,
        options: { forceIpnsPublish, isRetryAttempt, skipExtendedVerification },
        resolve,
        reject,
        timeoutHandle: null,
        createdAt: Date.now(),
        callerContext,
      };

      // Set up timeout
      if (timeout > 0) {
        entry.timeoutHandle = setTimeout(() => {
          this.handleTimeout(entry);
        }, timeout);
      }

      // Handle LOW priority coalescing
      if (priority === SyncPriority.LOW && coalesce) {
        this.handleCoalesce(entry);
        return;
      }

      // Insert into queue by priority (higher priority first, FIFO within same priority)
      this.insertByPriority(entry);
      console.log(`📦 [SyncQueue] Queued ${entry.id} (priority=${priorityName(priority)}, context=${callerContext || 'none'}, queue=${this.queue.length})`);

      // Start processing if not already
      this.processNextIfIdle();
    });
  }

  /**
   * Handle LOW priority coalescing - batch multiple auto-syncs into one
   */
  private handleCoalesce(entry: SyncQueueEntry): void {
    if (this.pendingCoalesce) {
      // Add to existing coalesce batch
      console.log(`📦 [SyncQueue] Coalescing ${entry.id} into pending batch`);
      this.pendingCoalesce.additionalResolvers.push({
        resolve: entry.resolve,
        reject: entry.reject,
      });
      // Clear timeout since this entry is being coalesced
      if (entry.timeoutHandle) {
        clearTimeout(entry.timeoutHandle);
      }
      // Merge forceIpnsPublish (if any request needs it, do it)
      if (entry.options.forceIpnsPublish) {
        this.pendingCoalesce.entry.options.forceIpnsPublish = true;
      }
      // Merge isRetryAttempt (if any request is a retry, treat batch as retry)
      if (entry.options.isRetryAttempt) {
        this.pendingCoalesce.entry.options.isRetryAttempt = true;
      }
      return;
    }

    // Start new coalesce window
    console.log(`📦 [SyncQueue] Starting coalesce window for ${entry.id}`);
    this.pendingCoalesce = {
      entry,
      additionalResolvers: [],
      timer: setTimeout(() => {
        this.flushCoalesce();
      }, this.COALESCE_WINDOW_MS),
    };
  }

  /**
   * Flush coalesced requests into the queue
   */
  private flushCoalesce(): void {
    if (!this.pendingCoalesce) return;

    const { entry, additionalResolvers } = this.pendingCoalesce;
    this.pendingCoalesce = null;

    // Wrap the original resolver to also resolve all coalesced requests
    const originalResolve = entry.resolve;
    const originalReject = entry.reject;

    entry.resolve = (result: StorageResult) => {
      originalResolve(result);
      for (const resolver of additionalResolvers) {
        resolver.resolve(result);
      }
    };

    entry.reject = (error: Error) => {
      originalReject(error);
      for (const resolver of additionalResolvers) {
        resolver.reject(error);
      }
    };

    const totalCoalesced = additionalResolvers.length + 1;
    console.log(`📦 [SyncQueue] Flushing coalesced batch: ${totalCoalesced} request(s)`);

    this.insertByPriority(entry);
    this.processNextIfIdle();
  }

  /**
   * Insert entry into queue maintaining priority order
   */
  private insertByPriority(entry: SyncQueueEntry): void {
    // Find insertion point: after all entries with >= priority
    let insertIndex = this.queue.length;
    for (let i = 0; i < this.queue.length; i++) {
      if (this.queue[i].priority < entry.priority) {
        insertIndex = i;
        break;
      }
    }
    this.queue.splice(insertIndex, 0, entry);
  }

  /**
   * Handle entry timeout
   */
  private handleTimeout(entry: SyncQueueEntry): void {
    // Remove from queue if still there
    const index = this.queue.indexOf(entry);
    if (index !== -1) {
      this.queue.splice(index, 1);
      console.warn(`📦 [SyncQueue] Timeout for ${entry.id} (context=${entry.callerContext || 'none'})`);
      entry.resolve({
        success: false,
        timestamp: Date.now(),
        error: `Sync request timed out after waiting in queue (context: ${entry.callerContext || 'unknown'})`,
      });
    }

    // Also check if it's in pending coalesce
    if (this.pendingCoalesce?.entry === entry) {
      clearTimeout(this.pendingCoalesce.timer);
      // Resolve all coalesced requests with timeout error
      const result: StorageResult = {
        success: false,
        timestamp: Date.now(),
        error: "Sync request timed out after waiting in queue",
      };
      entry.resolve(result);
      for (const resolver of this.pendingCoalesce.additionalResolvers) {
        resolver.resolve(result);
      }
      this.pendingCoalesce = null;
    }
  }

  /**
   * Start processing if not already processing
   */
  private processNextIfIdle(): void {
    if (!this.isProcessing && this.queue.length > 0) {
      this.processNext();
    }
  }

  /**
   * Process the next entry in the queue
   */
  private async processNext(): Promise<void> {
    if (this.queue.length === 0) {
      this.isProcessing = false;
      return;
    }

    this.isProcessing = true;
    const entry = this.queue.shift()!;

    // Clear timeout since we're processing
    if (entry.timeoutHandle) {
      clearTimeout(entry.timeoutHandle);
      entry.timeoutHandle = null;
    }

    const waitTime = Date.now() - entry.createdAt;
    console.log(`📦 [SyncQueue] Processing ${entry.id} (priority=${priorityName(entry.priority)}, context=${entry.callerContext || 'none'}, waited=${waitTime}ms, remaining=${this.queue.length})`);

    try {
      const result = await this.executor(entry.options);
      entry.resolve(result);
    } catch (error) {
      console.error(`📦 [SyncQueue] Error in ${entry.id}:`, error);
      entry.resolve({
        success: false,
        timestamp: Date.now(),
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Process next entry
    // Use setImmediate-like behavior to prevent stack overflow on long queues
    setTimeout(() => this.processNext(), 0);
  }

  /**
   * Get current queue status for monitoring
   */
  getQueueStatus(): QueueStatus {
    const entriesByPriority: Record<SyncPriority, number> = {
      [SyncPriority.LOW]: 0,
      [SyncPriority.MEDIUM]: 0,
      [SyncPriority.HIGH]: 0,
      [SyncPriority.CRITICAL]: 0,
    };

    for (const entry of this.queue) {
      entriesByPriority[entry.priority]++;
    }

    return {
      queueLength: this.queue.length,
      isProcessing: this.isProcessing,
      pendingCoalesce: this.pendingCoalesce !== null,
      entriesByPriority,
    };
  }

  /**
   * Shutdown the queue - reject all pending requests
   */
  shutdown(): void {
    console.log(`📦 [SyncQueue] Shutting down, clearing ${this.queue.length} pending requests`);

    // Clear coalesce timer and reject
    if (this.pendingCoalesce) {
      clearTimeout(this.pendingCoalesce.timer);
      const error = new Error("SyncQueue shutdown");
      this.pendingCoalesce.entry.reject(error);
      for (const resolver of this.pendingCoalesce.additionalResolvers) {
        resolver.reject(error);
      }
      this.pendingCoalesce = null;
    }

    // Reject all queued entries
    for (const entry of this.queue) {
      if (entry.timeoutHandle) {
        clearTimeout(entry.timeoutHandle);
      }
      entry.resolve({
        success: false,
        timestamp: Date.now(),
        error: "SyncQueue shutdown",
      });
    }
    this.queue = [];
    this.isProcessing = false;
  }
}
