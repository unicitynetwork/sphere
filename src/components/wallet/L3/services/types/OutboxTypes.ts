/**
 * Outbox Types
 * Data structures for persisting pending token transfers
 *
 * This module re-exports SDK outbox types and adds app-specific extensions.
 */

// Re-export all SDK outbox types for backwards compatibility
export {
  // Utility functions
  isTerminalStatus,
  isPendingStatus,
  isRetryableStatus,
  getNextStatus,
  validateOutboxEntryBase,
} from '../../../sdk';

export type {
  OutboxEntryStatus,
  OutboxEntryType,
  OutboxEntryBase,
  OutboxSplitGroup,
  RecoveryResult,
  RecoveryDetail,
} from '../../../sdk';

// Import base type for extension
import type { OutboxEntryBase, OutboxEntryType } from '../../../sdk';

// ==========================================
// App-Specific Outbox Entry
// ==========================================

/**
 * Full outbox entry with app-specific fields for Nostr delivery tracking.
 * Extends the SDK's OutboxEntryBase with additional fields.
 */
export interface OutboxEntry extends OutboxEntryBase {
  /** Type of transfer operation (from SDK) */
  type: OutboxEntryType;

  /** Recipient's human-readable nametag (e.g., "@alice") */
  recipientNametag: string;

  /** Recipient's Nostr public key (hex) */
  recipientPubkey: string;

  // ==========================================
  // Nostr Delivery Tracking (app-specific)
  // ==========================================

  /** Nostr event ID after successful send */
  nostrEventId?: string;

  /** Timestamp when Nostr delivery was confirmed */
  nostrConfirmedAt?: number;
}

// ==========================================
// App-Specific Utility Functions
// ==========================================

/**
 * Create a minimal outbox entry with required fields
 * Uses crypto.randomUUID() which is available in browser/Node.js
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
  commitmentJson: string,
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
 * App-specific version that also validates Nostr-related fields
 */
export function validateOutboxEntry(entry: OutboxEntry): { valid: boolean; error?: string } {
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
