/**
 * Outbox Types (Platform-Independent)
 * Data structures for persisting pending token transfers
 *
 * The Outbox pattern ensures tokens are never lost during the transfer process
 * by saving the transfer state (including non-reproducible commitment data)
 * before submitting to the Unicity aggregator.
 */

// ==========================================
// Status Types
// ==========================================

/**
 * Status of an outbox entry through the transfer lifecycle
 */
export type OutboxEntryStatus =
  | "PENDING_IPFS_SYNC"  // Saved to localStorage, awaiting IPFS confirmation
  | "READY_TO_SUBMIT"    // IPFS confirmed, safe to submit to aggregator
  | "SUBMITTED"          // Submitted to aggregator, awaiting inclusion proof
  | "PROOF_RECEIVED"     // Have inclusion proof, ready for Nostr delivery
  | "NOSTR_SENT"         // Sent via Nostr, awaiting confirmation
  | "COMPLETED"          // Fully completed, pending cleanup
  | "FAILED";            // Terminal failure (manual intervention needed)

/**
 * Type of transfer operation
 */
export type OutboxEntryType =
  | "DIRECT_TRANSFER"    // Whole token transfer to recipient
  | "SPLIT_BURN"         // Burn phase of token split
  | "SPLIT_MINT"         // Mint phase of token split (sender or recipient portion)
  | "SPLIT_TRANSFER";    // Transfer phase of split (recipient token to recipient)

// ==========================================
// Base Outbox Entry (Platform-Independent)
// ==========================================

/**
 * Base outbox entry with required fields for transfer recovery.
 * App can extend this with additional fields.
 *
 * CRITICAL: This structure contains the commitment JSON which includes
 * the random salt. Without this data, recovery is IMPOSSIBLE after
 * aggregator submission.
 */
export interface OutboxEntryBase {
  /** Unique identifier for this outbox entry */
  id: string;

  /** Timestamp when entry was created */
  createdAt: number;

  /** Timestamp of last status update */
  updatedAt: number;

  /** Current status in the transfer lifecycle */
  status: OutboxEntryStatus;

  /** Type of transfer operation */
  type: OutboxEntryType;

  // ==========================================
  // Transfer Metadata
  // ==========================================

  /** UI Token ID being spent (from wallet repository) */
  sourceTokenId: string;

  /** Recipient's Unicity address (serialized ProxyAddress JSON) */
  recipientAddressJson: string;

  /** Amount being transferred (BigInt as string) */
  amount: string;

  /** Coin ID for the token type */
  coinId: string;

  // ==========================================
  // CRITICAL: Non-Reproducible Data
  // ==========================================

  /**
   * Hex-encoded 32-byte random salt used in commitment creation.
   * THIS IS THE CRITICAL DATA - without it, the commitment cannot
   * be recreated and the requestId cannot be derived.
   */
  salt: string;

  /**
   * Serialized source token (SdkToken.toJSON() as string)
   * Needed for Nostr delivery payload
   */
  sourceTokenJson: string;

  /**
   * Serialized transfer commitment (TransferCommitment.toJSON() as string)
   * Contains: requestId, transactionData (including salt), authenticator
   */
  commitmentJson: string;

  // ==========================================
  // Post-Submission Data (filled during flow)
  // ==========================================

  /**
   * Serialized inclusion proof (after aggregator response)
   * Set during SUBMITTED → PROOF_RECEIVED transition
   */
  inclusionProofJson?: string;

  /**
   * Serialized transfer transaction (commitment.toTransaction(proof))
   * Set during SUBMITTED → PROOF_RECEIVED transition
   */
  transferTxJson?: string;

  // ==========================================
  // Error Tracking
  // ==========================================

  /** Last error message (for debugging/retry logic) */
  lastError?: string;

  /** Number of retry attempts */
  retryCount: number;

  // ==========================================
  // Split Group Tracking (for split operations)
  // ==========================================

  /**
   * Group ID linking related split entries (burn + mints + transfers)
   * Only set for SPLIT_* types
   */
  splitGroupId?: string;

  /**
   * Index within split group (e.g., 0=burn, 1=mint-sender, 2=mint-recipient, 3=transfer)
   * Only set for SPLIT_* types
   */
  splitGroupIndex?: number;
}

// ==========================================
// Split Group (for tracking multi-step splits)
// ==========================================

/**
 * Groups related split operation entries
 * A single token split creates multiple outbox entries (burn + mints + transfer)
 * that need to be tracked together for proper recovery.
 */
export interface OutboxSplitGroup {
  /** Unique identifier for this split group */
  groupId: string;

  /** Timestamp when split was initiated */
  createdAt: number;

  /** Original token ID being split */
  originalTokenId: string;

  /** Serialized split plan (for recovery) */
  splitPlanJson?: string;

  /** Seed string used for deterministic salt derivation */
  seedString: string;

  /** Entry IDs in this group (in order: burn, mints..., transfer) */
  entryIds: string[];
}

// ==========================================
// Recovery Types
// ==========================================

/**
 * Result of recovering pending transfers on startup
 */
export interface RecoveryResult {
  /** Number of successfully recovered transfers */
  recovered: number;

  /** Number of failed recovery attempts */
  failed: number;

  /** Number of skipped entries (already completed) */
  skipped: number;

  /** Details of each recovery attempt */
  details: RecoveryDetail[];
}

/**
 * Detail of a single recovery attempt
 */
export interface RecoveryDetail {
  entryId: string;
  status: "recovered" | "failed" | "skipped";
  previousStatus: OutboxEntryStatus;
  newStatus?: OutboxEntryStatus;
  error?: string;
}

// ==========================================
// Utility Functions
// ==========================================

/**
 * Check if an outbox entry is in a terminal state (completed or failed)
 */
export function isTerminalStatus(status: OutboxEntryStatus): boolean {
  return status === "COMPLETED" || status === "FAILED";
}

/**
 * Check if an outbox entry is pending (needs processing)
 */
export function isPendingStatus(status: OutboxEntryStatus): boolean {
  return !isTerminalStatus(status);
}

/**
 * Check if an outbox entry can be safely retried
 */
export function isRetryableStatus(status: OutboxEntryStatus): boolean {
  return (
    status === "PENDING_IPFS_SYNC" ||
    status === "READY_TO_SUBMIT" ||
    status === "SUBMITTED" ||
    status === "PROOF_RECEIVED" ||
    status === "NOSTR_SENT"
  );
}

/**
 * Get the next expected status after current status
 */
export function getNextStatus(current: OutboxEntryStatus): OutboxEntryStatus | null {
  const statusOrder: OutboxEntryStatus[] = [
    "PENDING_IPFS_SYNC",
    "READY_TO_SUBMIT",
    "SUBMITTED",
    "PROOF_RECEIVED",
    "NOSTR_SENT",
    "COMPLETED",
  ];

  const currentIndex = statusOrder.indexOf(current);
  if (currentIndex === -1 || currentIndex >= statusOrder.length - 1) {
    return null;
  }

  return statusOrder[currentIndex + 1];
}

/**
 * Validate that an outbox entry has all required fields for its current status
 */
export function validateOutboxEntryBase(entry: OutboxEntryBase): { valid: boolean; error?: string } {
  // Basic required fields
  if (!entry.id || !entry.sourceTokenId || !entry.salt || !entry.commitmentJson) {
    return { valid: false, error: "Missing required fields (id, sourceTokenId, salt, or commitmentJson)" };
  }

  // Status-specific validation
  switch (entry.status) {
    case "PROOF_RECEIVED":
    case "NOSTR_SENT":
    case "COMPLETED":
      if (!entry.inclusionProofJson) {
        return { valid: false, error: "Missing inclusionProofJson for status " + entry.status };
      }
      break;
  }

  return { valid: true };
}
