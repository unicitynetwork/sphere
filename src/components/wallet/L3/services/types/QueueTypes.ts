/**
 * Queue Types for Background Loops
 * Per TOKEN_INVENTORY_SPEC.md Section 7
 */

import type { Token } from '../../data/model';
import type { SyncResult } from '../../types/SyncTypes';

/**
 * Single token received from Nostr (waiting for batching)
 */
export interface ReceiveTokenBatchItem {
  /** UI token from WalletRepository */
  token: Token;
  /** Nostr event ID (for deduplication) */
  eventId: string;
  /** When received (epoch ms) */
  timestamp: number;
  /** Sender's Nostr pubkey */
  senderPubkey: string;
}

/**
 * Batch of tokens ready for inventory sync
 */
export interface ReceiveTokenBatch {
  /** Tokens in this batch */
  items: ReceiveTokenBatchItem[];
  /** UUID for logging/tracking */
  batchId: string;
  /** When batch was created (epoch ms) */
  createdAt: number;
  /** When 3-second timer fired (epoch ms) */
  finalizedAt?: number;
  /** When inventorySync() was called */
  syncStartedAt?: number;
  /** When sync completed */
  syncCompletedAt?: number;
  /** Result from inventorySync(FAST) */
  syncResult?: SyncResult;
}

/**
 * Entry in Nostr delivery queue
 */
export interface NostrDeliveryQueueEntry {
  /** UUID */
  id: string;
  /** Links to OutboxEntry for recovery */
  outboxEntryId: string;
  /** Recipient's Nostr pubkey (hex) */
  recipientPubkey: string;
  /** Recipient's nametag (e.g., "@alice") */
  recipientNametag: string;
  /** Serialized token + proof payload */
  payloadJson: string;
  /** Amount being sent (for display) */
  amount?: string;
  /** Token symbol (for display) */
  symbol?: string;
  /** When entry was queued (epoch ms) */
  createdAt: number;
  /** First send attempt (epoch ms) */
  attemptedAt?: number;
  /** Successful send (epoch ms) */
  completedAt?: number;
  /** Nostr event ID from successful send */
  nostrEventId?: string;
  /** Exponential backoff tracking */
  retryCount: number;
  /** Last error message */
  lastError?: string;
  /** Don't retry before this time (epoch ms) */
  backoffUntil?: number;

  // ==========================================
  // INSTANT_SEND mode fields (v3.5)
  // ==========================================

  /**
   * Associated PaymentSession ID (for instant mode tracking)
   * When set, Nostr delivery triggers background aggregator submission
   */
  paymentSessionId?: string;

  /**
   * Serialized TransferCommitment (for background aggregator submission)
   * Only set in INSTANT_SEND mode
   */
  commitmentJson?: string;
}

/**
 * Status snapshot of delivery queue
 */
export interface DeliveryQueueStatus {
  totalPending: number;
  totalCompleted: number;
  totalFailed: number;
  byRetryCount: Record<number, number>;
  oldestEntryAge: number;
  activeDeliveries: number;
}

/**
 * Configuration for loop behavior
 * Per TOKEN_INVENTORY_SPEC.md Section 7
 */
export interface LoopConfig {
  // ReceiveTokensToInventoryLoop (Section 7.1)
  /** 3000ms - Wait for idle before processing batch */
  receiveTokenBatchWindowMs: number;
  /** 100 - Max tokens before forcing sync */
  receiveTokenMaxBatchSize: number;
  /** 120000ms - Timeout for batch processing */
  receiveTokenProcessTimeoutMs: number;

  // NostrDeliveryQueue (Section 7.3)
  /** 12 - Concurrent Nostr sends */
  deliveryMaxParallel: number;
  /** 10 - Per spec Section 9.2 */
  deliveryMaxRetries: number;
  /** [1000, 3000, 10000, 30000, 60000] - Per spec max 1 minute */
  deliveryBackoffMs: number[];
  /** 3000ms - Wait for empty before NORMAL sync */
  deliveryEmptyQueueWaitMs: number;
  /** 2000ms - How often to check queue (reduced from 500ms to lower CPU overhead) */
  deliveryCheckIntervalMs: number;

  // LazyRecoveryLoop (Section 7.4)
  /** 10000ms - Delay before running lazy recovery (default: 10 seconds) */
  lazyRecoveryDelayMs: number;
  /** 20 - Max versions to traverse during lazy recovery */
  lazyRecoveryDepth: number;
  /** 120000ms - Timeout for lazy recovery operation (default: 2 minutes) */
  lazyRecoveryTimeoutMs: number;
  /** 0.5 - Jitter ratio for recovery delay (±50%) */
  lazyRecoveryJitter: number;
}

/**
 * Default configuration matching spec
 */
export const DEFAULT_LOOP_CONFIG: LoopConfig = {
  receiveTokenBatchWindowMs: 3000,
  receiveTokenMaxBatchSize: 100,
  receiveTokenProcessTimeoutMs: 120000,
  deliveryMaxParallel: 12,
  deliveryMaxRetries: 10,
  deliveryBackoffMs: [1000, 3000, 10000, 30000, 60000],
  deliveryEmptyQueueWaitMs: 3000,
  deliveryCheckIntervalMs: 2000,  // 2000ms (was 500ms) - reduce CPU overhead
  lazyRecoveryDelayMs: 10000,      // 10 seconds after startup
  lazyRecoveryDepth: 20,           // Traverse up to 20 versions
  lazyRecoveryTimeoutMs: 120000,   // 2 minutes timeout
  lazyRecoveryJitter: 0.5,         // ±50% jitter for DHT load distribution
};

/**
 * Completed transfer info for inventorySync(completedList)
 * AMENDMENT 2: Must include stateHash for multi-version architecture
 */
export interface CompletedTransfer {
  tokenId: string;
  /** CRITICAL: Required for multi-version architecture (Spec Section 3.7.4) */
  stateHash: string;
  /** Inclusion proof object (matches InventorySyncService.CompletedTransfer) */
  inclusionProof: object;
}
