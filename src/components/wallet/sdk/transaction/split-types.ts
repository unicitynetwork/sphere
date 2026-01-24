/**
 * Split Transfer Types (Platform-Independent)
 *
 * Types for token split operations that require burning
 * an original token and minting two new tokens:
 * - One for the recipient (transferred)
 * - One for the sender (change)
 */

import type { TokenId } from '@unicitylabs/state-transition-sdk/lib/token/TokenId';
import type { Token as SdkToken } from '@unicitylabs/state-transition-sdk/lib/token/Token';
import type { TransferTransaction } from '@unicitylabs/state-transition-sdk/lib/transaction/TransferTransaction';
import type { MintCommitment } from '@unicitylabs/state-transition-sdk/lib/transaction/MintCommitment';

// ==========================================
// Core Types
// ==========================================

/**
 * Information about a minted token from split operation
 */
export interface MintedTokenInfo {
  /** The mint commitment used */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  commitment: MintCommitment<any>;
  /** Inclusion proof from blockchain */
  inclusionProof: unknown;
  /** Whether this token is intended for the recipient */
  isForRecipient: boolean;
  /** The token ID */
  tokenId: TokenId;
  /** Salt used for minting */
  salt: Uint8Array;
}

/**
 * Result of a single token split operation
 */
export interface SplitTokenResult {
  /** Token created for recipient (before transfer to them) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tokenForRecipient: SdkToken<any>;
  /** Token created for sender (change) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tokenForSender: SdkToken<any>;
  /** Transfer transaction for recipient token */
  recipientTransferTx: TransferTransaction;
  /** Outbox entry ID for tracking (if outbox enabled) */
  outboxEntryId?: string;
  /** Split group ID for recovery (if outbox enabled) */
  splitGroupId?: string;
}

/**
 * Result of executing a complete split plan
 */
export interface SplitPlanResult {
  /** All tokens transferred to recipient */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tokensForRecipient: SdkToken<any>[];
  /** All tokens kept by sender (change) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tokensKeptBySender: SdkToken<any>[];
  /** UI token IDs that were burned */
  burnedTokens: Array<{ id: string }>;
  /** Transfer transactions for recipient tokens */
  recipientTransferTxs: TransferTransaction[];
  /** Outbox entry IDs for tracking */
  outboxEntryIds: string[];
  /** Split group ID */
  splitGroupId?: string;
}

// ==========================================
// Outbox Provider Interface
// ==========================================

/**
 * Status of an outbox entry
 */
export type SplitOutboxStatus =
  | 'PENDING'
  | 'READY_TO_SUBMIT'
  | 'SUBMITTED'
  | 'PROOF_RECEIVED'
  | 'COMPLETED'
  | 'FAILED';

/**
 * Outbox entry for a split transfer
 */
export interface SplitTransferEntry {
  /** Unique entry ID */
  id: string;
  /** Entry type */
  type: 'SPLIT_TRANSFER';
  /** Current status */
  status: SplitOutboxStatus;
  /** Source token ID (from UI) */
  sourceTokenId: string;
  /** Recipient nametag */
  recipientNametag: string;
  /** Recipient public key (hex) */
  recipientPubkey: string;
  /** Recipient address JSON */
  recipientAddressJson: string;
  /** Amount being transferred */
  amount: string;
  /** Coin ID (hex) */
  coinId: string;
  /** Salt used for transfer (hex) */
  salt: string;
  /** Token JSON before transfer */
  tokenJson: string;
  /** Commitment JSON */
  commitmentJson: string;
  /** Split group ID */
  splitGroupId: string;
  /** Phase index (0=burn, 1=mint-sender, 2=mint-recipient, 3=transfer) */
  phaseIndex: number;
  /** Error message if failed */
  error?: string;
  /** Inclusion proof JSON (when available) */
  inclusionProofJson?: string;
  /** Transfer transaction JSON (when available) */
  transferTxJson?: string;
  /** Timestamp created */
  createdAt: number;
  /** Timestamp last updated */
  updatedAt: number;
}

/**
 * Split group for tracking related operations
 */
export interface SplitGroup {
  /** Unique group ID */
  groupId: string;
  /** Timestamp created */
  createdAt: number;
  /** Original token ID being split */
  originalTokenId: string;
  /** Seed string for deterministic ID generation */
  seedString: string;
  /** IDs of entries in this group */
  entryIds: string[];
}

/**
 * Provider for outbox operations during split
 *
 * This is optional - split operations work without outbox,
 * but outbox enables recovery of incomplete transfers.
 */
export interface SplitOutboxProvider {
  /**
   * Create a new split group
   */
  createSplitGroup(group: SplitGroup): void;

  /**
   * Add entry ID to a split group
   */
  addEntryToSplitGroup(groupId: string, entryId: string): void;

  /**
   * Create a new transfer entry
   */
  createTransferEntry(entry: SplitTransferEntry): void;

  /**
   * Update entry status
   */
  updateEntryStatus(entryId: string, status: SplitOutboxStatus, error?: string): void;

  /**
   * Update entry with proof and transfer transaction
   */
  updateEntryProof(
    entryId: string,
    inclusionProofJson: string,
    transferTxJson: string
  ): void;
}

// ==========================================
// Context Types
// ==========================================

/**
 * Context for outbox tracking during split
 */
export interface SplitOutboxContext {
  /** Current wallet address */
  walletAddress: string;
  /** Recipient nametag */
  recipientNametag: string;
  /** Recipient public key (hex) */
  recipientPubkey: string;
}

/**
 * Callback for token burn notification
 */
export type OnTokenBurnedCallback = (uiTokenId: string) => void;
