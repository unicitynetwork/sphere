/**
 * Types for Token Inventory Sync Operations
 *
 * Spec Reference: /docs/TOKEN_INVENTORY_SPEC.md v3.1
 */

import type { NametagData } from '../services/types/TxfTypes';

/**
 * FOLDER CATEGORIZATION (Section 3.1)
 *
 * Tokens are organized into logical folders based on their lifecycle state:
 *
 * - **Nametags**: `_nametag` field + tokens with nametag type pointing to user's address
 * - **Active**: Tokens stored with `_<tokenId>` keys (unspent, ready for transactions)
 * - **Sent**: Tokens in `_sent` array (latest state SPENT with inclusion proof)
 * - **Outbox**: Entries in `_outbox` array (pending send operations)
 * - **Invalid**: Entries in `_invalid` array (failed validation, kept for investigation)
 *
 * Note: Archived tokens (`_archived_<tokenId>`) and forked tokens (`_forked_<tokenId>_<stateHash>`)
 * are internal categories, not exposed as folders to users.
 */

/**
 * Sync mode determines which steps are executed in inventorySync()
 * Modes are mutually exclusive and listed in order of precedence (Section 6.1)
 *
 * - LOCAL: Skip IPFS entirely, localStorage only (Section 6.2)
 * - NAMETAG: Fetch only nametag tokens, read-only (Section 6.3)
 * - FAST: Skip Step 7 spent detection, for speed (Section 6.1)
 * - NORMAL: Full sync with all validation (Section 6.1)
 */
export type SyncMode = 'LOCAL' | 'NAMETAG' | 'FAST' | 'NORMAL';

/**
 * Sync operation result status
 *
 * Note: This is a simplified status model vs spec's original 5-status design.
 * PARTIAL_SUCCESS covers spec's PARTIAL_SYNC_FAILED; RETRY handled via error codes.
 * NAMETAG_ONLY added for NAMETAG mode completion (spec extension).
 *
 * - SUCCESS: All operations completed successfully
 * - PARTIAL_SUCCESS: localStorage saved but IPFS publish failed (ipnsPublishPending=true)
 * - LOCAL_ONLY: Operated in LOCAL mode (no IPFS)
 * - NAMETAG_ONLY: NAMETAG mode completed (lightweight return)
 * - ERROR: Critical failure, operation aborted
 */
export type SyncStatus =
  | 'SUCCESS'
  | 'PARTIAL_SUCCESS'
  | 'LOCAL_ONLY'
  | 'NAMETAG_ONLY'
  | 'ERROR';

/**
 * Standardized error codes aligned with Unicity architecture layers
 *
 * - IPFS layer: IPFS_UNAVAILABLE, IPNS_PUBLISH_FAILED, IPNS_RESOLUTION_FAILED
 * - Aggregator layer: AGGREGATOR_UNREACHABLE, PROOF_FETCH_FAILED
 * - Validation layer: VALIDATION_FAILED, INTEGRITY_FAILURE
 * - Application layer: CONFLICT_LOOP, PARTIAL_OPERATION, STORAGE_ERROR
 */
export type SyncErrorCode =
  | 'IPFS_UNAVAILABLE'           // Step 2: IPFS fetch failed (10 consecutive)
  | 'IPNS_PUBLISH_FAILED'        // Step 10: IPNS publish failed
  | 'IPNS_RESOLUTION_FAILED'     // Step 2: IPNS resolution failed
  | 'AGGREGATOR_UNREACHABLE'     // Aggregator timeout/connection failure
  | 'PROOF_FETCH_FAILED'         // Step 3.2: Inclusion proof fetch failed
  | 'VALIDATION_FAILED'          // Step 4/5: Token validation failed
  | 'INTEGRITY_FAILURE'          // Critical: State hash collision detected
  | 'CONFLICT_LOOP'              // Circuit breaker: max 5 consecutive merge conflicts
  | 'PARTIAL_OPERATION'          // localStorage saved, IPFS failed
  | 'STORAGE_ERROR'              // localStorage write failure
  | 'UNKNOWN';

/**
 * Reason codes for invalid tokens (Section 3.3)
 */
export type InvalidReasonCode =
  | 'SDK_VALIDATION'       // Token failed Unicity SDK validation
  | 'INTEGRITY_FAILURE'    // State hash collision detected
  | 'NAMETAG_MISMATCH'     // Nametag token's Nostr pubkey mismatch
  | 'MISSING_FIELDS'       // Missing required fields (genesis, state, etc.)
  | 'OWNERSHIP_MISMATCH'   // Token destination doesn't match user's address
  | 'PROOF_MISMATCH';      // Inclusion proof doesn't match commitment

/**
 * Circuit breaker state for LOCAL mode auto-recovery (Section 10.7)
 * Tracks both IPFS failures and conflict loops
 *
 * Reset Conditions:
 * - consecutiveConflicts: Reset to 0 on successful merge OR when LOCAL mode activated
 * - consecutiveIpfsFailures: Reset to 0 on successful IPFS operation
 * - localModeActive: Cleared on successful full sync in NORMAL mode
 */
export interface CircuitBreakerState {
  /** Currently operating in LOCAL mode due to failures */
  localModeActive: boolean;

  /** Epoch ms when LOCAL mode was activated */
  localModeActivatedAt?: number;

  /** Epoch ms for next auto-recovery attempt (1 hour intervals per Section 10.7) */
  nextRecoveryAttempt?: number;

  /** Consecutive conflicts before switching to LOCAL (max 5) */
  consecutiveConflicts: number;

  /** Timestamp of last conflict */
  lastConflictTimestamp?: number;

  /** Consecutive IPFS failures (max 10 before LOCAL mode per Section 10.2) */
  consecutiveIpfsFailures: number;
}

/**
 * Sync operation statistics - what changed during this sync
 */
export interface SyncOperationStats {
  /** New tokens added from IPFS */
  tokensImported: number;

  /** Tokens tombstoned/invalidated */
  tokensRemoved: number;

  /** Existing tokens updated to newer state */
  tokensUpdated: number;

  /** Merge conflicts resolved */
  conflictsResolved: number;

  /** Tokens checked against aggregator (Step 7) */
  tokensValidated: number;

  /** New tombstones created */
  tombstonesAdded: number;

  /** Nametag bindings published to Nostr (Step 8.5) */
  nametagsPublished: number;

  /** Tokens recovered from false tombstones (Step 7.5) */
  tokensRecovered?: number;
}

/**
 * Token inventory statistics - snapshot after sync
 *
 * Note: Extends spec's tokenStats (Section 6.1) with additional fields:
 * - nametagTokens: Count of Unicity ID tokens (Section 3.1 Nametags folder)
 * - tombstoneCount: Total tombstone markers (Section 3.6 conflict resolution)
 */
export interface TokenInventoryStats {
  /** ACTIVE status tokens (unspent, ready for transactions) */
  activeTokens: number;

  /** SENT status tokens (spent, audit trail) */
  sentTokens: number;

  /** Tokens in OUTBOX (pending send operations) */
  outboxTokens: number;

  /** INVALID status tokens (failed validation) */
  invalidTokens: number;

  /** Nametag tokens (Unicity IDs) */
  nametagTokens: number;

  /** Total tombstone markers */
  tombstoneCount: number;
}

/**
 * Result returned by inventorySync() (Section 6.1)
 *
 * Supports all sync modes: LOCAL, NAMETAG, FAST, NORMAL
 * Tracks multi-stage finality: localStorage -> IPFS -> IPNS
 */
export interface SyncResult {
  /** Final status of sync operation */
  status: SyncStatus;

  /** Which sync mode was executed */
  syncMode: SyncMode;

  /** Structured error code (undefined on SUCCESS) */
  errorCode?: SyncErrorCode;

  /** Human-readable error message */
  errorMessage?: string;

  /** What changed during this sync */
  operationStats: SyncOperationStats;

  /** Total inventory state after sync (omit in NAMETAG mode) */
  inventoryStats?: TokenInventoryStats;

  /** IPFS content CID (latest version) */
  lastCid?: string;

  /** IPNS name for this identity */
  ipnsName?: string;

  /** True if IPNS publish succeeded */
  ipnsPublished?: boolean;

  /** True if localStorage saved but IPNS publish failed */
  ipnsPublishPending?: boolean;

  /** Epoch ms when IPNS retry is scheduled */
  ipnsRetryScheduled?: number;

  /** Sync operation duration in milliseconds */
  syncDurationMs: number;

  /** Epoch ms when sync completed */
  timestamp: number;

  /** Storage version after sync */
  version?: number;

  /** Circuit breaker state (for LOCAL mode auto-recovery) */
  circuitBreaker?: CircuitBreakerState;

  /** Nametags (only populated in NAMETAG mode) */
  nametags?: NametagData[];

  /** Validation warnings that didn't prevent sync */
  validationIssues?: string[];
}

/**
 * Helper type for creating default CircuitBreakerState
 */
export function createDefaultCircuitBreakerState(): CircuitBreakerState {
  return {
    localModeActive: false,
    consecutiveConflicts: 0,
    consecutiveIpfsFailures: 0,
  };
}

/**
 * Helper type for creating default SyncOperationStats
 */
export function createDefaultSyncOperationStats(): SyncOperationStats {
  return {
    tokensImported: 0,
    tokensRemoved: 0,
    tokensUpdated: 0,
    conflictsResolved: 0,
    tokensValidated: 0,
    tombstonesAdded: 0,
    nametagsPublished: 0,
  };
}

/**
 * Helper type for creating default TokenInventoryStats
 */
export function createDefaultTokenInventoryStats(): TokenInventoryStats {
  return {
    activeTokens: 0,
    sentTokens: 0,
    outboxTokens: 0,
    invalidTokens: 0,
    nametagTokens: 0,
    tombstoneCount: 0,
  };
}
