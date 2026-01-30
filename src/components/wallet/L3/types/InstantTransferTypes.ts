/**
 * Instant Transfer Types
 *
 * Spec Reference: TOKEN_INVENTORY_SPEC.md v3.5 - Sections 13 & 14
 *
 * Implements types for INSTANT_SEND and INSTANT_RECEIVE modes:
 * - INSTANT_SEND: Reduce send latency from 15-20s to 2-3s
 * - INSTANT_RECEIVE: Make received tokens visible immediately
 */

import type { Token } from '../data/model';

// ============================================
// Payment Session Types
// ============================================

/**
 * Status of a payment session through its lifecycle
 *
 * SEND Flow:
 * INITIATED -> COMMITMENT_CREATED -> NOSTR_DELIVERED -> (background: SUBMITTED -> PROOF_RECEIVED) -> COMPLETED
 *
 * RECEIVE Flow:
 * INITIATED -> TOKEN_RECEIVED -> FINALIZING -> COMPLETED
 */
export type PaymentSessionStatus =
  | 'INITIATED'           // Session created
  | 'COMMITMENT_CREATED'  // Transfer commitment ready (SEND)
  | 'SUBMITTED'           // Submitted to aggregator (SEND, background)
  | 'PROOF_RECEIVED'      // Inclusion proof received (SEND, background)
  | 'TOKEN_RECEIVED'      // Token received from Nostr (RECEIVE)
  | 'FINALIZING'          // Running finalization (RECEIVE)
  | 'NOSTR_DELIVERED'     // Token sent via Nostr (SEND)
  | 'COMPLETED'           // Fully completed
  | 'FAILED'              // Terminal failure
  | 'TIMED_OUT';          // Session exceeded deadline

/**
 * Direction of the payment session
 */
export type PaymentSessionDirection = 'SEND' | 'RECEIVE';

/**
 * Error codes specific to instant transfers
 */
export type PaymentSessionErrorCode =
  | 'NOSTR_DELIVERY_FAILED'      // Failed to send via Nostr
  | 'NOSTR_TIMEOUT'              // Nostr confirmation timed out
  | 'AGGREGATOR_SUBMIT_FAILED'   // Background aggregator submission failed (non-fatal for sender)
  | 'IPFS_SYNC_FAILED'           // Background IPFS sync failed (non-fatal)
  | 'TOKEN_FINALIZATION_FAILED'  // Recipient couldn't finalize token
  | 'PROOF_FETCH_FAILED'         // Recipient couldn't fetch proof
  | 'SESSION_TIMEOUT'            // Session exceeded deadline
  | 'UNKNOWN';

/**
 * Error details for a payment session
 */
export interface PaymentSessionError {
  code: PaymentSessionErrorCode;
  message: string;
  timestamp: number;
  recoverable: boolean;
  details?: Record<string, unknown>;
}

/**
 * Payment session tracking structure
 *
 * Per spec Section 13.4: PaymentSession tracks the instant transfer lifecycle
 */
export interface PaymentSession {
  /** Unique session identifier */
  id: string;

  /** Direction of transfer */
  direction: PaymentSessionDirection;

  /** Current status */
  status: PaymentSessionStatus;

  /** Timestamp when session was created */
  createdAt: number;

  /** Timestamp of last status update */
  updatedAt: number;

  /** Deadline for session completion (default: createdAt + 300_000 = 5 min) */
  deadline?: number;

  /** Error details if failed */
  error: PaymentSessionError | null;

  // ==========================================
  // SEND-specific fields (when direction === 'SEND')
  // ==========================================

  /** Source token ID being sent */
  sourceTokenId?: string;

  /** Recipient's human-readable nametag */
  recipientNametag?: string;

  /** Recipient's Nostr public key */
  recipientPubkey?: string;

  /** Amount being sent (BigInt as string) */
  amount?: string;

  /** Coin ID for the token type */
  coinId?: string;

  /** Hex-encoded salt used in commitment */
  salt?: string;

  /** Serialized transfer commitment */
  commitmentJson?: string;

  /** Nostr event ID after delivery */
  nostrEventId?: string;

  /** Associated outbox entry ID */
  outboxEntryId?: string;

  // ==========================================
  // Background lane status (SEND)
  // ==========================================

  /** Background aggregator submission status */
  aggregatorStatus?: 'PENDING' | 'SUBMITTED' | 'CONFIRMED' | 'FAILED';

  /** Background IPFS sync status */
  ipfsStatus?: 'PENDING' | 'SYNCED' | 'FAILED';

  // ==========================================
  // RECEIVE-specific fields (when direction === 'RECEIVE')
  // ==========================================

  /** Source Nostr event ID */
  sourceEventId?: string;

  /** Sender's Nostr public key */
  senderPubkey?: string;

  /** Serialized received token JSON (before finalization) */
  receivedTokenJson?: string;

  /** Finalized UI token */
  finalizedToken?: Token;
}

// ============================================
// Transfer Progress Events
// ============================================

/**
 * Stages of transfer progress for UI updates
 */
export type TransferProgressStage =
  | 'SESSION_CREATED'
  | 'COMMITMENT_READY'
  | 'DELIVERING'
  | 'DELIVERED'
  | 'BACKGROUND_AGGREGATOR'
  | 'BACKGROUND_IPFS'
  | 'DONE'
  | 'ERROR';

/**
 * Progress event emitted during instant transfer
 */
export interface TransferProgressEvent {
  paymentSessionId: string;
  stage: TransferProgressStage;
  timestamp: number;
  message: string;
  payload?: Record<string, unknown>;
}

/**
 * Emit a transfer progress event for UI updates
 * @param event - Progress event to emit
 */
export function emitTransferProgress(event: TransferProgressEvent): void {
  window.dispatchEvent(new CustomEvent('transfer-progress', { detail: event }));
}

/**
 * Subscribe to transfer progress events
 * @param callback - Callback to invoke on progress
 * @returns Cleanup function to unsubscribe
 */
export function subscribeToTransferProgress(
  callback: (event: TransferProgressEvent) => void
): () => void {
  const handler = (e: Event) => {
    const customEvent = e as CustomEvent<TransferProgressEvent>;
    callback(customEvent.detail);
  };

  window.addEventListener('transfer-progress', handler);
  return () => window.removeEventListener('transfer-progress', handler);
}

// ============================================
// Instant Send Types
// ============================================

/**
 * Result of an instant send operation
 */
export interface InstantSendResult {
  /** Payment session ID for tracking */
  sessionId: string;

  /** Whether Nostr delivery succeeded (critical path) */
  nostrDelivered: boolean;

  /** Nostr event ID (if delivered) */
  nostrEventId?: string;

  /** Time taken for critical path (Nostr delivery) in ms */
  criticalPathDurationMs: number;

  /** Whether background aggregator submission started */
  aggregatorSubmissionStarted: boolean;

  /** Whether background IPFS sync started */
  ipfsSyncStarted: boolean;
}

/**
 * Options for instant send operation
 */
export interface InstantSendOptions {
  /** Enable instant mode (default: true) */
  instant?: boolean;

  /** Timeout for Nostr delivery confirmation in ms (default: 30000) */
  nostrTimeoutMs?: number;

  /** Skip background aggregator submission (for testing) */
  skipBackgroundAggregator?: boolean;

  /** Skip background IPFS sync (for testing) */
  skipBackgroundIpfs?: boolean;
}

// ============================================
// Instant Receive Types
// ============================================

/**
 * Pending IPFS sync entry for 3-phase receive model
 *
 * Per spec Section 13.20: Phase 2 tracks tokens pending IPFS confirmation
 */
export interface PendingIpfsSyncEntry {
  /** Token ID saved to localStorage */
  tokenId: string;

  /** Nostr event ID (to mark as processed after IPFS confirms) */
  nostrEventId: string;

  /** Timestamp when saved to localStorage */
  savedAt: number;

  /** Number of IPFS sync attempts */
  syncAttempts: number;

  /** Last sync error (if any) */
  lastSyncError?: string;
}

// ============================================
// INSTANT_SPLIT Types (Section 15)
// ============================================

/**
 * Split payment session for tracking token split transfers
 * Similar to PaymentSession but tracks the multi-phase split operation
 */
export interface SplitPaymentSession {
  /** Unique session identifier */
  id: string;

  /** Direction (always 'SEND' for split operations) */
  direction: 'SEND';

  /** Source token ID being split */
  sourceTokenId: string;

  /** Payment amount (sent to recipient) */
  paymentAmount: string;

  /** Change amount (kept by sender) */
  changeAmount: string;

  /** Recipient's human-readable nametag */
  recipientNametag?: string;

  /** Recipient's Nostr public key */
  recipientPubkey?: string;

  /** Phase tracking for split operation */
  phases: {
    /** Burn phase status */
    burn: 'PENDING' | 'SUBMITTED' | 'CONFIRMED' | 'FAILED';
    /** Mints phase status (parallel submission) */
    mints: 'PENDING' | 'SUBMITTED' | 'CONFIRMED' | 'PARTIAL' | 'FAILED';
    /** Transfer phase status (INSTANT_SEND) */
    transfer: 'PENDING' | 'NOSTR_DELIVERED' | 'CONFIRMED' | 'FAILED';
  };

  /** Timing information for performance tracking */
  timing: {
    burnStartedAt?: number;
    burnConfirmedAt?: number;
    mintsStartedAt?: number;
    mintsConfirmedAt?: number;
    nostrDeliveredAt?: number;
  };

  /** Payment token ID (after mint) */
  paymentTokenId?: string;

  /** Change token ID (after mint) */
  changeTokenId?: string;

  /** Split group ID (links all outbox entries) */
  splitGroupId?: string;

  /** Creation timestamp */
  createdAt: number;

  /** Last update timestamp */
  updatedAt: number;
}

// ============================================
// Sender Recovery Types (Section 14)
// ============================================

/**
 * Result of sender recovery operation
 */
export interface SenderRecoveryResult {
  /** Number of tokens successfully recovered */
  tokensRecovered: number;

  /** Number of tokens skipped (already in Sent folder) */
  tokensSkipped: number;

  /** Errors encountered during recovery */
  errors: SenderRecoveryError[];

  /** Total Nostr events scanned */
  eventsScanned: number;

  /** Duration of recovery operation in ms */
  durationMs: number;
}

/**
 * Error during sender recovery
 */
export interface SenderRecoveryError {
  nostrEventId: string;
  error: string;
  timestamp: number;
}

/**
 * Options for sender recovery
 */
export interface SenderRecoveryOptions {
  /** Unix timestamp to start scanning from (default: 30 days ago) */
  since?: number;

  /** Maximum number of events to scan (default: 100) */
  limit?: number;

  /** Relays to query (default: configured Nostr relays) */
  relays?: string[];
}

// ============================================
// Nostr Delivery Queue Extensions
// ============================================

/**
 * Extended entry for instant send delivery queue
 */
export interface InstantSendQueueEntry {
  /** Entry ID */
  id: string;

  /** Outbox entry ID (for tracking) */
  outboxEntryId: string;

  /** Recipient Nostr public key */
  recipientPubkey: string;

  /** Recipient nametag */
  recipientNametag?: string;

  /** Payload JSON to send */
  payloadJson: string;

  /** Associated payment session ID */
  paymentSessionId: string;

  /** Serialized commitment (for background aggregator) */
  commitmentJson?: string;

  /** Retry count */
  retryCount: number;

  /** Creation timestamp */
  createdAt: number;

  /** Nostr event ID (after delivery) */
  nostrEventId?: string;

  /** Completion timestamp */
  completedAt?: number;

  /** Backoff until timestamp */
  backoffUntil?: number;

  /** Last error message */
  lastError?: string;
}

// ============================================
// Helper Functions
// ============================================

/**
 * Create a new payment session
 */
export function createPaymentSession(params: {
  direction: PaymentSessionDirection;
  sourceTokenId?: string;
  recipientNametag?: string;
  recipientPubkey?: string;
  amount?: string;
  coinId?: string;
  salt?: string;
  deadlineMs?: number;
}): PaymentSession {
  const now = Date.now();
  const deadlineMs = params.deadlineMs ?? 300_000; // 5 minutes default

  return {
    id: crypto.randomUUID(),
    direction: params.direction,
    status: 'INITIATED',
    createdAt: now,
    updatedAt: now,
    deadline: now + deadlineMs,
    error: null,
    sourceTokenId: params.sourceTokenId,
    recipientNametag: params.recipientNametag,
    recipientPubkey: params.recipientPubkey,
    amount: params.amount,
    coinId: params.coinId,
    salt: params.salt,
  };
}

/**
 * Check if a payment session has timed out
 */
export function isPaymentSessionTimedOut(session: PaymentSession): boolean {
  if (!session.deadline) return false;
  return Date.now() > session.deadline;
}

/**
 * Check if a payment session is in a terminal state
 */
export function isPaymentSessionTerminal(session: PaymentSession): boolean {
  return session.status === 'COMPLETED' ||
         session.status === 'FAILED' ||
         session.status === 'TIMED_OUT';
}

/**
 * Create a payment session error
 */
export function createPaymentSessionError(
  code: PaymentSessionErrorCode,
  message: string,
  recoverable: boolean = false,
  details?: Record<string, unknown>
): PaymentSessionError {
  return {
    code,
    message,
    timestamp: Date.now(),
    recoverable,
    details,
  };
}
