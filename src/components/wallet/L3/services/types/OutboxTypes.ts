/**
 * Outbox Types
 * Data structures for persisting pending token transfers
 *
 * The Outbox pattern ensures tokens are never lost during the transfer process
 * by saving the transfer state (including non-reproducible commitment data)
 * to localStorage AND IPFS BEFORE submitting to the Unicity aggregator.
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
  | "READY_TO_SEND"      // INSTANT_SEND: Ready for Nostr delivery (skip aggregator wait)
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

/**
 * Type of mint operation
 */
export type MintOutboxEntryType =
  | "MINT_NAMETAG"       // Minting a nametag token (Unicity ID)
  | "MINT_TOKEN";        // Minting a generic token

// ==========================================
// Main Outbox Entry
// ==========================================

/**
 * A single outbox entry representing a pending transfer operation
 *
 * CRITICAL: This structure contains the commitment JSON which includes
 * the random salt. Without this data, recovery is IMPOSSIBLE after
 * aggregator submission.
 */
export interface OutboxEntry {
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

  /** Recipient's human-readable nametag (e.g., "@alice") */
  recipientNametag: string;

  /** Recipient's Nostr public key (hex) */
  recipientPubkey: string;

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
   * NOTE: null for INSTANT_SPLIT V2 entries (recipient creates the commitment)
   */
  commitmentJson: string | null;

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
  // Nostr Delivery Tracking
  // ==========================================

  /** Nostr event ID after successful send */
  nostrEventId?: string;

  /** Timestamp when Nostr delivery was confirmed */
  nostrConfirmedAt?: number;

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
// Mint Outbox Entry
// ==========================================

/**
 * A single outbox entry representing a pending mint operation
 *
 * CRITICAL: This structure contains the salt and MintTransactionData which
 * are required for recovery. Unlike TransferCommitment, MintCommitment
 * does NOT have toJSON()/fromJSON() methods, so we store MintTransactionData
 * and requestId separately for reconstruction.
 *
 * Flow:
 * 1. Generate salt, create MintTransactionData, create MintCommitment
 * 2. SAVE TO OUTBOX IMMEDIATELY (before any network calls)
 * 3. Sync to IPFS and wait for success
 * 4. Submit commitment to aggregator
 * 5. Wait for inclusion proof
 * 6. Create final token with proof
 * 7. Save token to storage, mark complete
 */
export interface MintOutboxEntry {
  /** Unique identifier for this outbox entry */
  id: string;

  /** Timestamp when entry was created */
  createdAt: number;

  /** Timestamp of last status update */
  updatedAt: number;

  /** Current status in the mint lifecycle */
  status: OutboxEntryStatus;

  /** Type of mint operation */
  type: MintOutboxEntryType;

  // ==========================================
  // Mint Metadata
  // ==========================================

  /** Nametag being minted (for MINT_NAMETAG type) */
  nametag?: string;

  /** Token type hex string */
  tokenTypeHex: string;

  /** Serialized owner address (DirectAddress.toJSON() as string) */
  ownerAddressJson: string;

  // ==========================================
  // CRITICAL: Non-Reproducible Data
  // ==========================================

  /**
   * Hex-encoded 32-byte random salt used in commitment creation.
   * THIS IS THE CRITICAL DATA - without it, the commitment cannot
   * be recreated and the token cannot be recovered.
   */
  salt: string;

  /**
   * Request ID from the commitment (commitment.requestId.toString())
   * Used for polling inclusion proof during recovery.
   */
  requestIdHex: string;

  /**
   * Serialized MintTransactionData (mintData.toJSON() as string)
   * Used to reconstruct MintCommitment during recovery.
   */
  mintDataJson: string;

  // ==========================================
  // Post-Submission Data (filled during flow)
  // ==========================================

  /**
   * Serialized inclusion proof (after aggregator response)
   * Set during SUBMITTED → PROOF_RECEIVED transition
   */
  inclusionProofJson?: string;

  /**
   * Serialized mint transaction (commitment.toTransaction(proof))
   * Set during SUBMITTED → PROOF_RECEIVED transition
   */
  mintTransactionJson?: string;

  /**
   * Serialized final token (Token.toJSON() as string)
   * Set when token is fully created with proof
   */
  tokenJson?: string;

  // ==========================================
  // Error Tracking
  // ==========================================

  /** Last error message (for debugging/retry logic) */
  lastError?: string;

  /** Number of retry attempts */
  retryCount: number;
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
    status === "READY_TO_SEND" ||
    status === "SUBMITTED" ||
    status === "PROOF_RECEIVED" ||
    status === "NOSTR_SENT"
  );
}

/**
 * Get the next expected status after current status
 *
 * Standard flow: PENDING_IPFS_SYNC -> READY_TO_SUBMIT -> SUBMITTED -> PROOF_RECEIVED -> NOSTR_SENT -> COMPLETED
 * INSTANT_SEND flow: PENDING_IPFS_SYNC -> READY_TO_SEND -> NOSTR_SENT -> COMPLETED
 */
export function getNextStatus(current: OutboxEntryStatus, instantMode: boolean = false): OutboxEntryStatus | null {
  if (instantMode) {
    // INSTANT_SEND flow: skip aggregator wait
    const instantStatusOrder: OutboxEntryStatus[] = [
      "PENDING_IPFS_SYNC",
      "READY_TO_SEND",
      "NOSTR_SENT",
      "COMPLETED",
    ];

    const currentIndex = instantStatusOrder.indexOf(current);
    if (currentIndex === -1 || currentIndex >= instantStatusOrder.length - 1) {
      return null;
    }

    return instantStatusOrder[currentIndex + 1];
  }

  // Standard flow
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
 * Create a minimal outbox entry with required fields
 */
export function createOutboxEntry(
  type: OutboxEntryType,
  sourceTokenId: string,
  recipientNametag: string,
  recipientPubkey: string,
  recipientAddressJson: string,
  amount: string,
  coinId: string,
  salt: string,
  sourceTokenJson: string,
  commitmentJson: string | null, // null for INSTANT_SPLIT V2 (recipient creates commitment)
  splitGroupId?: string,
  splitGroupIndex?: number
): OutboxEntry {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    status: "PENDING_IPFS_SYNC",
    type,
    sourceTokenId,
    recipientNametag,
    recipientPubkey,
    recipientAddressJson,
    amount,
    coinId,
    salt,
    sourceTokenJson,
    commitmentJson,
    retryCount: 0,
    splitGroupId,
    splitGroupIndex,
  };
}

/**
 * Validate that an outbox entry has all required fields for its current status
 */
export function validateOutboxEntry(entry: OutboxEntry): { valid: boolean; error?: string } {
  // Basic required fields
  // NOTE: commitmentJson can be null for INSTANT_SPLIT V2 entries (recipient creates commitment)
  // In that case, sourceTokenJson contains the bundle with all necessary data
  if (!entry.id || !entry.sourceTokenId || !entry.salt) {
    return { valid: false, error: "Missing required fields (id, sourceTokenId, or salt)" };
  }
  // For non-V2 entries, commitmentJson is required; for V2, sourceTokenJson (bundle) is required
  if (!entry.commitmentJson && !entry.sourceTokenJson) {
    return { valid: false, error: "Missing both commitmentJson and sourceTokenJson" };
  }

  // Status-specific validation
  // Note: In INSTANT_SEND mode, we don't require inclusionProofJson because:
  // - NOSTR_SENT: Token sent via Nostr before getting proof
  // - COMPLETED: Nostr delivery succeeded; recipient fetches their own proof
  // Only PROOF_RECEIVED explicitly requires the proof (legacy flow)
  switch (entry.status) {
    case "PROOF_RECEIVED":
      if (!entry.inclusionProofJson) {
        return { valid: false, error: "Missing inclusionProofJson for status " + entry.status };
      }
      break;
  }

  return { valid: true };
}

// ==========================================
// Mint Outbox Utility Functions
// ==========================================

/**
 * Create a mint outbox entry with required fields
 */
export function createMintOutboxEntry(
  type: MintOutboxEntryType,
  tokenTypeHex: string,
  ownerAddressJson: string,
  salt: string,
  requestIdHex: string,
  mintDataJson: string,
  nametag?: string
): MintOutboxEntry {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    status: "PENDING_IPFS_SYNC",
    type,
    tokenTypeHex,
    ownerAddressJson,
    salt,
    requestIdHex,
    mintDataJson,
    nametag,
    retryCount: 0,
  };
}

/**
 * Validate that a mint outbox entry has all required fields for its current status
 */
export function validateMintOutboxEntry(entry: MintOutboxEntry): { valid: boolean; error?: string } {
  // Basic required fields
  if (!entry.id || !entry.salt || !entry.requestIdHex || !entry.mintDataJson) {
    return { valid: false, error: "Missing required fields (id, salt, requestIdHex, or mintDataJson)" };
  }

  // Type-specific validation
  if (entry.type === "MINT_NAMETAG" && !entry.nametag) {
    return { valid: false, error: "Missing nametag for MINT_NAMETAG type" };
  }

  // Status-specific validation
  switch (entry.status) {
    case "PROOF_RECEIVED":
    case "COMPLETED":
      if (!entry.inclusionProofJson) {
        return { valid: false, error: "Missing inclusionProofJson for status " + entry.status };
      }
      break;
  }

  return { valid: true };
}

/**
 * Check if a mint outbox entry is in a state that can be recovered
 */
export function isMintRecoverable(entry: MintOutboxEntry): boolean {
  return (
    entry.status === "PENDING_IPFS_SYNC" ||
    entry.status === "READY_TO_SUBMIT" ||
    entry.status === "SUBMITTED" ||
    entry.status === "PROOF_RECEIVED"
  );
}
