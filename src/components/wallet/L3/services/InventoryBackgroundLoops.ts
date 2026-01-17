/**
 * Background Loops for Token Inventory
 * Per TOKEN_INVENTORY_SPEC.md Section 7
 *
 * Three independent loops:
 * 1. ReceiveTokensToInventoryLoop - Batches incoming Nostr tokens (Section 7.1)
 * 2. NostrDeliveryQueue - Sends tokens via Nostr with parallelism (Section 7.3)
 * 3. InventoryBackgroundLoopsManager - Lifecycle management
 */

import type { Token } from '../data/model';
import type { IdentityManager } from './IdentityManager';
import type { NostrService } from './NostrService';
import type {
  ReceiveTokenBatchItem,
  ReceiveTokenBatch,
  NostrDeliveryQueueEntry,
  DeliveryQueueStatus,
  LoopConfig,
  CompletedTransfer,
} from './types/QueueTypes';
import { DEFAULT_LOOP_CONFIG } from './types/QueueTypes';
import { inventorySync, type SyncParams } from './InventorySyncService';

/**
 * Batches incoming Nostr tokens with 3-second idle detection
 * Per TOKEN_INVENTORY_SPEC.md Section 7.1
 *
 * Flow:
 * 1. Tokens arrive via queueIncomingToken()
 * 2. Wait until 3 seconds of no new tokens
 * 3. Call inventorySync(incomingTokens) in FAST mode
 * 4. Wait 3 seconds, call inventorySync() in NORMAL mode
 *
 * AMENDMENT 1: Tokens are saved to localStorage IMMEDIATELY before batching
 */
export class ReceiveTokensToInventoryLoop {
  private batchBuffer: ReceiveTokenBatchItem[] = [];
  private batchId: string | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private isProcessing = false;
  private completedBatches: ReceiveTokenBatch[] = [];
  private identityManager: IdentityManager;
  private config: LoopConfig;
  private eventToTokenMap: Map<string, string> = new Map(); // eventId -> tokenId
  private onEventProcessed: ((eventId: string) => void) | null = null;

  constructor(identityManager: IdentityManager, config: LoopConfig = DEFAULT_LOOP_CONFIG) {
    this.identityManager = identityManager;
    this.config = config;
  }

  /**
   * Set callback for marking Nostr events as processed
   * Called after IPFS sync succeeds
   */
  setEventProcessedCallback(callback: (eventId: string) => void): void {
    this.onEventProcessed = callback;
  }

  /**
   * Queue a token received from Nostr for batch processing
   * NOTE: Token should already be saved to localStorage BEFORE calling this
   *
   * @param token - UI token from WalletRepository (already saved)
   * @param eventId - Nostr event ID
   * @param senderPubkey - Sender's public key
   */
  async queueIncomingToken(token: Token, eventId: string, senderPubkey: string): Promise<void> {
    // If already processing, add to buffer for next batch
    const item: ReceiveTokenBatchItem = {
      token,
      eventId,
      timestamp: Date.now(),
      senderPubkey,
    };

    this.batchBuffer.push(item);
    this.eventToTokenMap.set(eventId, token.id);

    // Create batch ID if not exists
    if (!this.batchId) {
      this.batchId = crypto.randomUUID();
    }

    console.log(`📥 [ReceiveLoop] Queued token ${token.id.slice(0, 8)} (batch ${this.batchId.slice(0, 8)}, ${this.batchBuffer.length} items)`);

    // Reset idle timer
    this.resetIdleTimer();

    // Force process if at max size
    if (this.batchBuffer.length >= this.config.receiveTokenMaxBatchSize) {
      console.log(`📥 [ReceiveLoop] Max batch size reached, processing immediately`);
      this.clearIdleTimer();
      await this.processBatch();
    }
  }

  /**
   * Reset the 3-second idle timer
   */
  private resetIdleTimer(): void {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      this.processBatch().catch(err => {
        console.error('📥 [ReceiveLoop] Batch processing failed:', err);
      });
    }, this.config.receiveTokenBatchWindowMs);
  }

  /**
   * Clear the idle timer
   */
  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  /**
   * Process the current batch of tokens
   * Implements TOKEN_INVENTORY_SPEC.md Section 7.1
   */
  private async processBatch(): Promise<void> {
    // Prevent concurrent processing
    if (this.isProcessing || this.batchBuffer.length === 0) {
      return;
    }

    this.isProcessing = true;
    const batchId = this.batchId || crypto.randomUUID();
    const items = [...this.batchBuffer];
    const eventIds = items.map(i => i.eventId);

    // Clear buffer for next batch
    this.batchBuffer = [];
    this.batchId = null;

    console.log(`📥 [ReceiveLoop] Processing batch ${batchId.slice(0, 8)} with ${items.length} tokens`);

    const batch: ReceiveTokenBatch = {
      items,
      batchId,
      createdAt: items[0]?.timestamp || Date.now(),
      finalizedAt: Date.now(),
    };

    try {
      // Phase 2: FAST sync to persist incoming tokens
      batch.syncStartedAt = Date.now();
      const identity = await this.identityManager.getCurrentIdentity();
      if (!identity) {
        throw new Error('No identity available');
      }

      const tokens = items.map(i => i.token);
      console.log(`📥 [ReceiveLoop] Calling inventorySync(FAST) with ${tokens.length} incoming tokens`);

      const syncParams: SyncParams = {
        incomingTokens: tokens,
        address: identity.address,
        publicKey: identity.publicKey,
        ipnsName: identity.ipnsName || '',
      };

      const result = await inventorySync(syncParams);
      batch.syncCompletedAt = Date.now();
      batch.syncResult = result;

      if (result.status === 'SUCCESS' || result.status === 'PARTIAL_SUCCESS') {
        console.log(`✅ [ReceiveLoop] FAST sync completed: ${result.stats?.tokensImported || 0} tokens imported`);

        // Mark Nostr events as processed
        if (this.onEventProcessed) {
          for (const eventId of eventIds) {
            this.onEventProcessed(eventId);
          }
          console.log(`✅ [ReceiveLoop] Marked ${eventIds.length} Nostr events as processed`);
        }
      } else {
        console.warn(`⚠️ [ReceiveLoop] FAST sync failed: ${result.errorMessage}`);
        // Don't mark events as processed - they will be retried on next connect
      }

      // Phase 3: Wait 3 seconds then run NORMAL sync for spent detection
      console.log(`📥 [ReceiveLoop] Waiting ${this.config.receiveTokenBatchWindowMs}ms before NORMAL sync`);
      await this.sleep(this.config.receiveTokenBatchWindowMs);

      console.log(`📥 [ReceiveLoop] Calling inventorySync(NORMAL) for spent detection`);
      const normalParams: SyncParams = {
        address: identity.address,
        publicKey: identity.publicKey,
        ipnsName: identity.ipnsName || '',
      };

      const normalResult = await inventorySync(normalParams);
      if (normalResult.status === 'SUCCESS' || normalResult.status === 'PARTIAL_SUCCESS') {
        console.log(`✅ [ReceiveLoop] NORMAL sync completed`);
      } else {
        console.warn(`⚠️ [ReceiveLoop] NORMAL sync had issues: ${normalResult.errorMessage}`);
      }

    } catch (error) {
      console.error(`❌ [ReceiveLoop] Batch processing error:`, error);
      batch.syncCompletedAt = Date.now();
    } finally {
      // Store completed batch (keep last 10)
      this.completedBatches.push(batch);
      if (this.completedBatches.length > 10) {
        this.completedBatches.shift();
      }

      this.isProcessing = false;

      // Clear event mappings for processed events
      for (const eventId of eventIds) {
        this.eventToTokenMap.delete(eventId);
      }
    }
  }

  /**
   * Sleep helper for async delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get current batch status for debugging
   */
  getBatchStatus(): { pending: number; batchId: string | null; isProcessing: boolean } {
    return {
      pending: this.batchBuffer.length,
      batchId: this.batchId,
      isProcessing: this.isProcessing,
    };
  }

  /**
   * Get completed batches (last 10) for debugging
   */
  getCompletedBatches(): ReceiveTokenBatch[] {
    return [...this.completedBatches];
  }

  /**
   * Cleanup on app shutdown
   */
  destroy(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    this.batchBuffer = [];
    console.log('🛑 [ReceiveLoop] Destroyed');
  }
}

/**
 * Sends tokens via Nostr with 12-way parallelism and exponential backoff
 * Per TOKEN_INVENTORY_SPEC.md Section 7.3
 *
 * Flow:
 * 1. Entries queued via queueForDelivery()
 * 2. Up to 12 sent in parallel
 * 3. Exponential backoff on errors: 1s, 3s, 10s, 30s, 60s
 * 4. After 3s empty queue, call inventorySync(completedList)
 *
 * AMENDMENT 2: CompletedList includes stateHash for multi-version architecture
 * AMENDMENT 3: Extended backoff schedule per spec max 1 minute
 */
export class NostrDeliveryQueue {
  private queue: Map<string, NostrDeliveryQueueEntry> = new Map();
  private activeDeliveries: Map<string, Promise<void>> = new Map();
  private processTimer: ReturnType<typeof setInterval> | null = null;
  private emptyQueueTimer: ReturnType<typeof setTimeout> | null = null;
  private completedEntries: NostrDeliveryQueueEntry[] = [];
  private nostrService: NostrService | null = null;
  private identityManager: IdentityManager;
  private config: LoopConfig;
  private isProcessing = false;
  private completedSinceLastSync: NostrDeliveryQueueEntry[] = [];

  constructor(identityManager: IdentityManager, config: LoopConfig = DEFAULT_LOOP_CONFIG) {
    this.identityManager = identityManager;
    this.config = config;
  }

  /**
   * Set NostrService reference (lazy initialization to avoid circular deps)
   */
  setNostrService(nostrService: NostrService): void {
    this.nostrService = nostrService;
  }

  /**
   * Add entry to delivery queue
   * Called by sendTokensFromInventory() when setting up transfer
   */
  async queueForDelivery(entry: NostrDeliveryQueueEntry): Promise<void> {
    // Add to queue
    this.queue.set(entry.id, entry);
    console.log(`📤 [DeliveryQueue] Queued ${entry.id.slice(0, 8)} for ${entry.recipientNametag} (${this.queue.size} pending)`);

    // Start processing if not already running
    this.startProcessing();
  }

  /**
   * Start the processing loop
   */
  private startProcessing(): void {
    if (this.processTimer) return; // Already running

    this.processTimer = setInterval(() => {
      this.processQueue().catch(err => {
        console.error('📤 [DeliveryQueue] Process error:', err);
      });
    }, this.config.deliveryCheckIntervalMs);

    console.log('📤 [DeliveryQueue] Started processing');
  }

  /**
   * Stop the processing loop
   */
  private stopProcessing(): void {
    if (this.processTimer) {
      clearInterval(this.processTimer);
      this.processTimer = null;
      console.log('📤 [DeliveryQueue] Stopped processing');
    }
  }

  /**
   * Process queue: send ready entries in parallel
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const now = Date.now();
      const availableSlots = this.config.deliveryMaxParallel - this.activeDeliveries.size;

      if (availableSlots <= 0) return;

      // Get entries ready for delivery (not in backoff)
      const readyEntries = [...this.queue.values()]
        .filter(e => !e.backoffUntil || e.backoffUntil <= now)
        .filter(e => !this.activeDeliveries.has(e.id))
        .slice(0, availableSlots);

      if (readyEntries.length === 0) {
        // Check if queue is empty (including active deliveries)
        if (this.queue.size === 0 && this.activeDeliveries.size === 0) {
          this.checkEmptyQueueWindow();
        }
        return;
      }

      // Clear empty queue timer since we have work
      this.clearEmptyQueueTimer();

      // Send entries in parallel
      for (const entry of readyEntries) {
        const promise = this.sendEntry(entry);
        this.activeDeliveries.set(entry.id, promise);
        promise.finally(() => {
          this.activeDeliveries.delete(entry.id);
        });
      }

      console.log(`📤 [DeliveryQueue] Sending ${readyEntries.length} entries (${this.activeDeliveries.size}/${this.config.deliveryMaxParallel} active)`);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Send a single entry via Nostr
   */
  private async sendEntry(entry: NostrDeliveryQueueEntry): Promise<void> {
    if (!this.nostrService) {
      console.error('📤 [DeliveryQueue] NostrService not set');
      return;
    }

    entry.attemptedAt = entry.attemptedAt || Date.now();

    try {
      console.log(`📤 [DeliveryQueue] Sending ${entry.id.slice(0, 8)} to ${entry.recipientNametag} (attempt ${entry.retryCount + 1})`);

      // Send via NostrService
      const eventId = await this.nostrService.sendTokenToRecipient(
        entry.recipientPubkey,
        entry.payloadJson
      );

      // Validate return value - eventId should be non-empty string
      if (!eventId || typeof eventId !== 'string' || eventId.length === 0) {
        throw new Error(`Invalid eventId returned from sendTokenToRecipient: ${eventId}`);
      }

      // Success!
      entry.completedAt = Date.now();
      entry.nostrEventId = eventId;

      console.log(`✅ [DeliveryQueue] Sent ${entry.id.slice(0, 8)} - event ${eventId.slice(0, 8)}`);

      // Move to completed
      this.queue.delete(entry.id);
      this.completedEntries.push(entry);
      this.completedSinceLastSync.push(entry);

      // Trim completed list
      if (this.completedEntries.length > 100) {
        this.completedEntries.shift();
      }

    } catch (error) {
      entry.retryCount++;
      entry.lastError = error instanceof Error ? error.message : String(error);

      if (entry.retryCount >= this.config.deliveryMaxRetries) {
        console.error(`❌ [DeliveryQueue] Max retries reached for ${entry.id.slice(0, 8)}`);
        // Keep in queue but mark as permanently failed
        // UI can display these for manual intervention
      } else {
        // Calculate backoff
        const backoffIndex = Math.min(entry.retryCount - 1, this.config.deliveryBackoffMs.length - 1);
        const backoffMs = this.config.deliveryBackoffMs[backoffIndex];
        entry.backoffUntil = Date.now() + backoffMs;

        console.warn(`⚠️ [DeliveryQueue] Retry ${entry.retryCount}/${this.config.deliveryMaxRetries} for ${entry.id.slice(0, 8)} in ${backoffMs}ms`);
      }
    }
  }

  /**
   * Clear the empty queue timer
   */
  private clearEmptyQueueTimer(): void {
    if (this.emptyQueueTimer) {
      clearTimeout(this.emptyQueueTimer);
      this.emptyQueueTimer = null;
    }
  }

  /**
   * Start 3-second empty queue timer
   */
  private checkEmptyQueueWindow(): void {
    // Don't start timer if already running
    if (this.emptyQueueTimer) return;

    console.log(`📤 [DeliveryQueue] Queue empty, waiting ${this.config.deliveryEmptyQueueWaitMs}ms before finalizing`);

    this.emptyQueueTimer = setTimeout(async () => {
      this.emptyQueueTimer = null;

      // Double-check queue is still empty
      if (this.queue.size > 0 || this.activeDeliveries.size > 0) {
        return;
      }

      // Stop processing loop
      this.stopProcessing();

      // Finalize completed transfers
      await this.finalizeCompletedTransfers();
    }, this.config.deliveryEmptyQueueWaitMs);
  }

  /**
   * Finalize completed transfers by calling inventorySync(completedList)
   */
  private async finalizeCompletedTransfers(): Promise<void> {
    if (this.completedSinceLastSync.length === 0) {
      console.log(`📤 [DeliveryQueue] No completed transfers to finalize`);
      return;
    }

    console.log(`📤 [DeliveryQueue] Finalizing ${this.completedSinceLastSync.length} completed transfers`);

    const identity = await this.identityManager.getCurrentIdentity();
    if (!identity) {
      console.error('📤 [DeliveryQueue] No identity available for finalize');
      return;
    }

    // Build completedList with stateHash (Amendment 2)
    const completedList: CompletedTransfer[] = [];
    for (const entry of this.completedSinceLastSync) {
      // Parse payload to extract token info
      try {
        const payload = JSON.parse(entry.payloadJson);
        const tokenId = payload.tokenId || payload.sourceToken?.id;
        const stateHash = payload.stateHash || '';
        const inclusionProof = payload.inclusionProof || {};

        if (!tokenId) {
          console.warn(`📤 [DeliveryQueue] Missing tokenId in payload for entry ${entry.id.slice(0, 8)}`);
          continue;
        }

        if (!stateHash) {
          // CRITICAL: stateHash required for multi-version architecture (Amendment 2)
          console.warn(`📤 [DeliveryQueue] Missing stateHash for token ${tokenId.slice(0, 8)} - cannot finalize`);
          continue;
        }

        completedList.push({
          tokenId,
          stateHash,
          inclusionProof,
        });
      } catch (err) {
        console.warn(`📤 [DeliveryQueue] Failed to parse payload for ${entry.id}:`, err);
      }
    }

    if (completedList.length > 0) {
      try {
        const result = await inventorySync({
          completedList,
          address: identity.address,
          publicKey: identity.publicKey,
          ipnsName: identity.ipnsName || '',
        });

        if (result.status === 'SUCCESS' || result.status === 'PARTIAL_SUCCESS') {
          console.log(`✅ [DeliveryQueue] Finalized ${completedList.length} transfers`);
          this.completedSinceLastSync = []; // Clear after successful sync
        } else {
          console.warn(`⚠️ [DeliveryQueue] Finalize sync had issues: ${result.errorMessage}`);
        }
      } catch (error) {
        console.error('📤 [DeliveryQueue] Finalize error:', error);
      }
    }
  }

  /**
   * Get queue status for UI/debugging
   */
  getQueueStatus(): DeliveryQueueStatus {
    const byRetryCount: Record<number, number> = {};
    let oldestAge = 0;
    const now = Date.now();

    for (const entry of this.queue.values()) {
      byRetryCount[entry.retryCount] = (byRetryCount[entry.retryCount] || 0) + 1;
      const age = now - entry.createdAt;
      if (age > oldestAge) oldestAge = age;
    }

    return {
      totalPending: this.queue.size,
      totalCompleted: this.completedEntries.length,
      totalFailed: [...this.queue.values()].filter(e => e.retryCount >= this.config.deliveryMaxRetries).length,
      byRetryCount,
      oldestEntryAge: oldestAge,
      activeDeliveries: this.activeDeliveries.size,
    };
  }

  /**
   * Get completed entries (last 100) for debugging
   */
  getCompletedEntries(): NostrDeliveryQueueEntry[] {
    return [...this.completedEntries];
  }

  /**
   * Cleanup on app shutdown
   */
  destroy(): void {
    if (this.processTimer) {
      clearInterval(this.processTimer);  // CRITICAL: processTimer uses setInterval, not setTimeout
      this.processTimer = null;
    }
    if (this.emptyQueueTimer) {
      clearTimeout(this.emptyQueueTimer);  // emptyQueueTimer uses setTimeout
      this.emptyQueueTimer = null;
    }
    this.queue.clear();
    console.log('🛑 [DeliveryQueue] Destroyed');
  }
}

/**
 * Singleton manager for background loop lifecycle
 */
export class InventoryBackgroundLoopsManager {
  private static instance: InventoryBackgroundLoopsManager | null = null;
  private receiveLoop: ReceiveTokensToInventoryLoop | null = null;
  private deliveryQueue: NostrDeliveryQueue | null = null;
  private identityManager: IdentityManager;
  private config: LoopConfig;
  private isInitialized = false;
  private initializationPromise: Promise<void> | null = null; // Guard against concurrent init

  private constructor(identityManager: IdentityManager, config: LoopConfig = DEFAULT_LOOP_CONFIG) {
    this.identityManager = identityManager;
    this.config = config;
  }

  /**
   * Get singleton instance
   * @param identityManager - Required on first call
   */
  static getInstance(identityManager?: IdentityManager): InventoryBackgroundLoopsManager {
    if (!InventoryBackgroundLoopsManager.instance) {
      if (!identityManager) {
        throw new Error('IdentityManager required for first getInstance() call');
      }
      InventoryBackgroundLoopsManager.instance = new InventoryBackgroundLoopsManager(identityManager);
    }
    return InventoryBackgroundLoopsManager.instance;
  }

  /**
   * Reset singleton (for testing)
   */
  static resetInstance(): void {
    if (InventoryBackgroundLoopsManager.instance) {
      InventoryBackgroundLoopsManager.instance.shutdown();
    }
    InventoryBackgroundLoopsManager.instance = null;
  }

  /**
   * Initialize loops
   * Called from DashboardLayout on mount
   *
   * Race-condition safe: Returns existing promise if initialization in progress
   */
  async initialize(): Promise<void> {
    // Already initialized - return immediately
    if (this.isInitialized) {
      console.log('⚡ [LoopsManager] Already initialized');
      return;
    }

    // Initialization in progress - return existing promise to avoid duplicate init
    if (this.initializationPromise) {
      console.log('⚡ [LoopsManager] Initialization already in progress, waiting...');
      return this.initializationPromise;
    }

    // Start initialization and store promise
    this.initializationPromise = this.doInitialize();
    return this.initializationPromise;
  }

  /**
   * Internal initialization logic
   */
  private async doInitialize(): Promise<void> {
    try {
      this.receiveLoop = new ReceiveTokensToInventoryLoop(this.identityManager, this.config);
      this.deliveryQueue = new NostrDeliveryQueue(this.identityManager, this.config);
      this.isInitialized = true;
      console.log('✅ [LoopsManager] Background loops initialized');
    } finally {
      // Clear promise after completion (success or failure)
      this.initializationPromise = null;
    }
  }

  /**
   * Gracefully shutdown all loops
   * Called from DashboardLayout on unmount
   */
  shutdown(): void {
    if (this.receiveLoop) {
      this.receiveLoop.destroy();
      this.receiveLoop = null;
    }
    if (this.deliveryQueue) {
      this.deliveryQueue.destroy();
      this.deliveryQueue = null;
    }
    this.isInitialized = false;
    console.log('🛑 [LoopsManager] Background loops shutdown');
  }

  /**
   * Get receive loop (throws if not initialized)
   */
  getReceiveLoop(): ReceiveTokensToInventoryLoop {
    if (!this.receiveLoop) {
      throw new Error('ReceiveLoop not initialized - call initialize() first');
    }
    return this.receiveLoop;
  }

  /**
   * Get delivery queue (throws if not initialized)
   */
  getDeliveryQueue(): NostrDeliveryQueue {
    if (!this.deliveryQueue) {
      throw new Error('DeliveryQueue not initialized - call initialize() first');
    }
    return this.deliveryQueue;
  }

  /**
   * Get combined status of all loops
   */
  getStatus(): {
    receive: { pending: number; batchId: string | null; isProcessing: boolean };
    delivery: DeliveryQueueStatus;
    isInitialized: boolean;
  } {
    return {
      receive: this.receiveLoop?.getBatchStatus() || { pending: 0, batchId: null, isProcessing: false },
      delivery: this.deliveryQueue?.getQueueStatus() || {
        totalPending: 0,
        totalCompleted: 0,
        totalFailed: 0,
        byRetryCount: {},
        oldestEntryAge: 0,
        activeDeliveries: 0,
      },
      isInitialized: this.isInitialized,
    };
  }

  /**
   * Check if loops are initialized
   */
  isReady(): boolean {
    return this.isInitialized;
  }
}
