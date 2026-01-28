/**
 * Inventory Sync Service
 *
 * Implements the 10-step sync flow per TOKEN_INVENTORY_SPEC.md Section 6.1
 * This is the central orchestrator for all token inventory operations.
 */

import { Token, TokenStatus } from '../data/model';
import type {
  SyncMode, SyncResult,
  SyncOperationStats, TokenInventoryStats, CircuitBreakerState,
} from '../types/SyncTypes';
import type { TxfToken, TxfStorageData, TxfMeta, SentTokenEntry, InvalidTokenEntry, TombstoneEntry, InvalidatedNametagEntry } from './types/TxfTypes';
import type { OutboxEntry } from './types/OutboxTypes';
import type { NametagData } from './types/TxfTypes';
import {
  detectSyncMode,
  shouldSkipIpfs,
  shouldSkipSpentDetection,
  shouldAcquireSyncLock,
} from './utils/SyncModeDetector';
import type { PaymentSession } from '../types/InstantTransferTypes';
import { getCircuitBreakerService } from './CircuitBreakerService';
import { getSyncCoordinator } from './SyncCoordinator';
import {
  createDefaultSyncOperationStats,
  createDefaultCircuitBreakerState
} from '../types/SyncTypes';
import {
  isTokenKey, keyFromTokenId, tokenIdFromKey,
  isArchivedKey, isForkedKey,
  archivedKeyFromTokenId, tokenIdFromArchivedKey,
  forkedKeyFromTokenIdAndState, parseForkedKey
} from './types/TxfTypes';
import type { TxfInclusionProof } from './types/TxfTypes';
import { tokenToTxf, txfToToken, getCurrentStateHash, extractLastInclusionProof } from './TxfSerializer';
import { STORAGE_KEY_GENERATORS } from '../../../../config/storageKeys';
import { getIpfsHttpResolver } from './IpfsHttpResolver';
import { getIpfsTransport } from './IpfsStorageService';
import type { IpfsTransport } from './types/IpfsTransport';
import { getTokenValidationService } from './TokenValidationService';
import type { InvalidReasonCode } from '../types/SyncTypes';
import { NostrService } from './NostrService';
import { IdentityManager } from './IdentityManager';
import { invalidateWalletQueries } from '../../../../lib/queryClient';
import { getInventoryStorage } from './storage/InventoryStorageAdapter';
import {
  reconstructMintCommitment,
  fetchProofByRequestId,
  isInclusionProofNotExclusion,
  submitMintCommitmentToAggregator,
  waitForMintProofWithSDK,
  tryRecoverFromOutbox
} from '../../../../utils/devTools';

// Nametag token type identifier (sha256 of "nametag-type")
const UNICITY_TOKEN_TYPE_HEX = "f8aa13834268d29355ff12183066f0cb902003629bbc5eb9ef0efbe397867509";

// ============================================
// Sync Lock State (moved from WalletRepository)
// ============================================
// Per TOKEN_INVENTORY_SPEC.md Section 6.1: "Only inventorySync should be allowed to access the inventory in localStorage!"
// This module-level state manages the sync lock to prevent concurrent writes.

/** Flag indicating sync is in progress */
let _syncInProgress = false;

/** Tokens queued during sync for next sync cycle */
let _pendingTokens: Token[] = [];

/**
 * Coalescing mutex for inventorySync
 * - If no sync in progress: start new sync
 * - If sync in progress AND caller has no new data: return current sync's result (coalesce)
 * - If sync in progress AND caller HAS new data: queue data, wait, return sync result
 *
 * This prevents the "infinite sync loop" where multiple components trigger syncs
 * on startup and each waiter runs their own redundant sync after waiting.
 */
let _currentSyncPromise: Promise<SyncResult> | null = null;

/**
 * Set the sync-in-progress flag.
 * Called at the start of inventorySync().
 * While set, external token additions will be queued for next sync.
 */
export function setSyncInProgress(value: boolean): void {
  console.log(`🔒 [SYNC LOCK] setSyncInProgress(${value})`);
  _syncInProgress = value;
}

/**
 * Check if sync is currently in progress.
 */
export function isSyncInProgress(): boolean {
  return _syncInProgress;
}

/**
 * Get tokens that were queued during sync.
 * Called at the start of inventorySync to include pending tokens.
 */
export function getPendingTokens(): Token[] {
  const tokens = [..._pendingTokens];
  _pendingTokens = [];  // Clear after retrieval
  return tokens;
}

/**
 * Queue a token for the next sync cycle.
 * Called when addToken is blocked by sync lock.
 */
export function queuePendingToken(token: Token): void {
  console.log(`📥 [SYNC LOCK] Queuing token ${token.id.slice(0, 8)}... for next sync`);
  _pendingTokens.push(token);
}

// ============================================
// Types
// ============================================

/**
 * Parameters for inventorySync() call
 */
export interface SyncParams {
  /** Force LOCAL mode */
  local?: boolean;

  /** Force NAMETAG mode */
  nametag?: boolean;

  /**
   * Recovery depth for RECOVERY mode.
   * Set to enable RECOVERY mode which traverses the IPFS version chain via _meta.lastCid.
   * - 0 = unlimited (traverse entire history)
   * - >0 = maximum number of versions to traverse
   * - undefined = no recovery (normal sync)
   */
  recoveryDepth?: number;

  /** Incoming tokens from Nostr/peer transfer */
  incomingTokens?: Token[] | null;

  /** Outbox tokens pending send */
  outboxTokens?: OutboxEntry[] | null;

  /** Completed transfers to mark as SPENT */
  completedList?: CompletedTransfer[] | null;

  /** Wallet address (required) */
  address: string;

  /** Public key (required) */
  publicKey: string;

  /** IPNS name (required) */
  ipnsName: string;

  /**
   * Skip extended IPFS/IPNS verification delays for faster sync.
   * Content is still persisted (safety guaranteed), but verification retries are reduced.
   * Use for pre-transfer sync where speed is critical.
   */
  skipExtendedVerification?: boolean;

  /**
   * Enable INSTANT_SEND mode (v3.5).
   * Skip IPFS reads, use Nostr-first delivery.
   * Background lanes handle aggregator and IPFS.
   */
  instantSend?: boolean;

  /**
   * Enable INSTANT_RECEIVE mode (v3.5).
   * Save tokens to localStorage immediately.
   * IPFS sync deferred to background.
   */
  instantReceive?: boolean;

  /**
   * Associated payment session for instant modes.
   * Required when instantSend or instantReceive is true.
   */
  paymentSession?: PaymentSession;
}

/**
 * Completed transfer to mark as SPENT
 */
export interface CompletedTransfer {
  tokenId: string;
  stateHash: string;
  inclusionProof: object;
}

/**
 * Internal sync context - accumulated state passed through pipeline
 */
interface SyncContext {
  // Configuration
  mode: SyncMode;
  address: string;
  publicKey: string;
  ipnsName: string;
  startTime: number;

  // Token collections (keyed by tokenId)
  tokens: Map<string, TxfToken>;

  // Archived tokens: tokens that were spent/transferred (keyed by tokenId)
  // Used for recovery if a tombstone is found to be incorrect (BFT rollback)
  archivedTokens: Map<string, TxfToken>;

  // Forked tokens: tokens saved at specific states for conflict resolution
  // Keyed by `${tokenId}_${stateHash}` for exact state matching
  forkedTokens: Map<string, TxfToken>;

  // Folder collections
  sent: SentTokenEntry[];
  invalid: InvalidTokenEntry[];
  outbox: OutboxEntry[];
  tombstones: TombstoneEntry[];
  nametags: NametagData[];

  // Completed transfers to mark as SPENT (from Step 0)
  completedList: CompletedTransfer[];

  // Sync state
  localVersion: number;
  remoteCid: string | null;
  remoteVersion: number;
  uploadNeeded: boolean;
  ipnsPublished: boolean;
  hasLocalOnlyContent: boolean; // Content in local that's not in remote (needs upload)
  preparedStorageData: TxfStorageData | null; // Storage data prepared in step 9 for step 10

  // Statistics
  stats: SyncOperationStats;

  // Circuit breaker
  circuitBreaker: CircuitBreakerState;

  // Errors
  errors: string[];

  // RECOVERY mode state
  recoveryDepth: number;              // 0 = unlimited, >0 = max versions to traverse
  processedCids: Set<string>;         // CIDs already processed (cycle detection)
  networkErrorOccurred: boolean;      // Flag to prevent upload on network errors
  recoveryStats: {                    // Statistics from recovery traversal
    versionsTraversed: number;
    tokensRecoveredFromHistory: number;
    oldestCidReached?: string;
  };

  // Remote data state (for auto-recovery detection)
  remoteLastCid: string | null;       // _meta.lastCid from remote (for version chain traversal)
  autoRecoveryTriggered: boolean;     // True if auto-recovery was triggered

  // Version tracking
  versionHwm: number;                 // Highest version ever seen from IPFS (prevents accepting downgraded data)
  remoteVersionRegressed: boolean;    // True if remote version < HWM (indicates corruption/stale cache)

  // Performance optimization options
  skipExtendedVerification: boolean;  // Skip extended IPFS/IPNS verification delays
}

// ============================================
// Main Entry Point
// ============================================

/**
 * Performs inventory sync operation
 *
 * This is the central function that orchestrates the 10-step sync flow.
 * Only one instance may run at a time (except NAMETAG mode).
 *
 * @param params - Sync parameters
 * @returns SyncResult with status and statistics
 */
export async function inventorySync(params: SyncParams): Promise<SyncResult> {
  // COALESCING MUTEX: Check if caller has new data to contribute
  const hasNewData = (params.incomingTokens && params.incomingTokens.length > 0) ||
                     (params.completedList && params.completedList.length > 0) ||
                     (params.outboxTokens && params.outboxTokens.length > 0);

  // If a sync is already in progress...
  if (_currentSyncPromise) {
    // If caller has new data, save it immediately - no need for follow-up sync
    // since saveTokenImmediately writes directly to localStorage
    if (hasNewData) {
      if (params.incomingTokens) {
        for (const token of params.incomingTokens) {
          // IMMEDIATE: Save token to localStorage right away so UI shows it
          saveTokenImmediately(params.address, token);
        }
        console.log(`📥 [InventorySync] Saved ${params.incomingTokens.length} token(s) immediately during coalescing`);
        // Update UI immediately - don't wait for sync
        dispatchWalletUpdated();
      }
      // Note: completedList and outboxTokens are less common; for now they'll wait
    }

    // Wait for the current sync to complete and return its result
    // This COALESCES multiple callers into one sync instead of running them sequentially
    console.log(`⏳ [InventorySync] Coalescing: waiting for ongoing sync (hasNewData=${hasNewData})...`);
    try {
      const result = await _currentSyncPromise;
      // NOTE: No follow-up sync needed - tokens were already saved via saveTokenImmediately
      // Follow-up syncs were causing infinite loops when multiple useWallet instances
      // each triggered refetches on sync completion
      return result;
    } catch {
      // If previous sync failed, fall through to start a new sync
      console.log(`⏳ [InventorySync] Previous sync failed, starting new sync...`);
    }
  }

  // No sync in progress - start a new one
  // Create a deferred promise for this sync
  let resolveCurrentSync: (result: SyncResult) => void;
  _currentSyncPromise = new Promise<SyncResult>((resolve) => {
    resolveCurrentSync = resolve;
  });

  const startTime = Date.now();

  // Check circuit breaker - force LOCAL mode if active
  const circuitBreaker = getCircuitBreakerService();
  const circuitBreakerActive = circuitBreaker.isLocalModeActive();

  // Detect sync mode based on inputs (circuit breaker can override to LOCAL)
  const mode = detectSyncMode({
    local: params.local || circuitBreakerActive,
    nametag: params.nametag,
    recoveryDepth: params.recoveryDepth,
    incomingTokens: params.incomingTokens as Token[] | undefined,
    outboxTokens: params.outboxTokens,
    completedList: params.completedList
  });

  if (circuitBreakerActive) {
    console.log(`🔧 [InventorySync] Circuit breaker active - forcing LOCAL mode`);
  }

  console.log(`🔄 [InventorySync] Starting sync in ${mode} mode`);

  // Dispatch sync start event to lock wallet refetches
  window.dispatchEvent(new Event('inventory-sync-start'));

  // Dispatch sync state event for useInventorySync hook (real-time UI updates)
  window.dispatchEvent(new CustomEvent('inventory-sync-state', {
    detail: { isSyncing: true, currentStep: 1, mode }
  }));

  // SYNC LOCK: Prevent concurrent writes during sync
  // Per TOKEN_INVENTORY_SPEC.md Section 6.1: "Only inventorySync should be allowed to access the inventory in localStorage!"
  setSyncInProgress(true);

  // Initialize context
  const ctx = initializeContext(params, mode, startTime);

  try {
    // Collect any tokens that were queued during previous sync
    const pendingTokens = getPendingTokens();
    if (pendingTokens.length > 0) {
      console.log(`📥 [InventorySync] Processing ${pendingTokens.length} pending token(s) from queue`);
      // Add pending tokens to incoming tokens
      const existingIncoming = params.incomingTokens || [];
      params.incomingTokens = [...existingIncoming, ...pendingTokens];
    }

    // NAMETAG mode: simplified flow (Steps 1, 2, 8.4 only)
    if (mode === 'NAMETAG') {
      const result = await executeNametagSync(ctx, params);
      resolveCurrentSync!(result);
      return result;
    }

    // All other modes: acquire cross-tab sync lock via SyncCoordinator
    // Per TOKEN_INVENTORY_SPEC.md Section 8.1: coordinate sync across browser tabs
    let syncLockAcquired = false;
    if (shouldAcquireSyncLock(mode)) {
      const coordinator = getSyncCoordinator();
      // Try to acquire lock with 30-second timeout per spec
      syncLockAcquired = await coordinator.acquireLock(30000);
      if (syncLockAcquired) {
        console.log(`📋 [InventorySync] Cross-tab sync lock acquired`);
      } else {
        // Timeout - proceed anyway per spec Section 8.1
        console.log(`📋 [InventorySync] Cross-tab lock timeout - proceeding anyway`);
      }
    }

    // Execute full sync pipeline
    const result = await executeFullSync(ctx, params);
    resolveCurrentSync!(result);

    // Notify UI of wallet changes after successful sync
    if (result.status === 'SUCCESS' || result.status === 'PARTIAL_SUCCESS') {
      dispatchWalletUpdated();
    }

    return result;

  } catch (error) {
    console.error(`❌ [InventorySync] Error:`, error);
    const errorResult = buildErrorResult(ctx, error);
    resolveCurrentSync!(errorResult);
    return errorResult;
  } finally {
    // Release cross-tab lock if acquired (check via coordinator)
    try {
      const coordinator = getSyncCoordinator();
      if (coordinator.hasLock()) {
        coordinator.releaseLock();
        console.log(`📋 [InventorySync] Cross-tab sync lock released`);
      }
    } catch {
      // Ignore errors during lock release
    }

    // CRITICAL: Clear the mutex promise so next sync can proceed
    _currentSyncPromise = null;
    // CRITICAL: Always release sync lock, even on error (prevent deadlock)
    setSyncInProgress(false);
    // CRITICAL: Always dispatch sync-end, even on error (prevent deadlock)
    window.dispatchEvent(new Event('inventory-sync-end'));
    // Dispatch sync state event for useInventorySync hook (real-time UI updates)
    window.dispatchEvent(new CustomEvent('inventory-sync-state', {
      detail: { isSyncing: false, currentStep: 0, mode }
    }));
  }
}

// ============================================
// Sync Execution Flows
// ============================================

/**
 * Execute NAMETAG mode sync (simplified flow)
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function executeNametagSync(ctx: SyncContext, _params: SyncParams): Promise<SyncResult> {
  // Initialize timing object to track step durations
  const stepTimings: Record<string, number> = {};

  // Step 1: Load nametags from localStorage only
  let stepStart = performance.now();
  await step1_loadLocalStorage(ctx);
  stepTimings['Step 1'] = performance.now() - stepStart;
  console.log(`⏱️ [Step 1] Load from localStorage completed in ${stepTimings['Step 1'].toFixed(1)}ms`);

  // Step 2: Load nametags from IPFS
  stepStart = performance.now();
  await step2_loadIpfs(ctx);
  stepTimings['Step 2'] = performance.now() - stepStart;
  console.log(`⏱️ [Step 2] Load from IPFS completed in ${stepTimings['Step 2'].toFixed(1)}ms`);

  // Step 8.4: Extract nametags for current user (filters for ownership)
  stepStart = performance.now();
  const nametags = await step8_4_extractNametags(ctx);
  stepTimings['Step 8.4'] = performance.now() - stepStart;
  console.log(`⏱️ [Step 8.4] Extract Nametags completed in ${stepTimings['Step 8.4'].toFixed(1)}ms`);

  // Log timing summary for NAMETAG mode
  const totalTime = Date.now() - (ctx.startTime || 0);
  console.log(`📊 [Sync Timing Summary - NAMETAG Mode]`);
  console.log(`  Total: ${totalTime.toFixed(1)}ms`);
  Object.entries(stepTimings).sort().forEach(([step, duration]) => {
    console.log(`  ${step}: ${duration.toFixed(1)}ms`);
  });

  return buildNametagResult(ctx, nametags);
}

/**
 * Execute full sync (NORMAL/FAST/LOCAL modes)
 */
async function executeFullSync(ctx: SyncContext, params: SyncParams): Promise<SyncResult> {
  // Initialize timing object to track step durations
  const stepTimings: Record<string, number> = {};

  // Step 0: Input Processing
  let stepStart = performance.now();
  step0_inputProcessing(ctx, params);
  stepTimings['Step 0'] = performance.now() - stepStart;
  console.log(`⏱️ [Step 0] Input Processing completed in ${stepTimings['Step 0'].toFixed(1)}ms`);

  // Step 1: Load from localStorage
  stepStart = performance.now();
  await step1_loadLocalStorage(ctx);
  stepTimings['Step 1'] = performance.now() - stepStart;
  console.log(`⏱️ [Step 1] Load from localStorage completed in ${stepTimings['Step 1'].toFixed(1)}ms`);

  // Step 2: Load from IPFS (skip in LOCAL mode)
  if (!shouldSkipIpfs(ctx.mode)) {
    stepStart = performance.now();
    await step2_loadIpfs(ctx);
    stepTimings['Step 2'] = performance.now() - stepStart;
    console.log(`⏱️ [Step 2] Load from IPFS completed in ${stepTimings['Step 2'].toFixed(1)}ms`);

    // Step 2.5: Version chain traversal (RECOVERY mode only)
    // Traverses _meta.lastCid chain to recover tokens from previous versions
    if (ctx.mode === 'RECOVERY' && ctx.remoteCid) {
      stepStart = performance.now();
      await step2_5_traverseVersionChain(ctx);
      stepTimings['Step 2.5'] = performance.now() - stepStart;
      console.log(`⏱️ [Step 2.5] Version chain traversal completed in ${stepTimings['Step 2.5'].toFixed(1)}ms`);
    }

    // AUTO-RECOVERY DETECTION: If we have 0 tokens but history exists, auto-trigger recovery
    // This handles cases where IPFS current version was corrupted/regressed but history has good data
    if (ctx.mode !== 'RECOVERY' && ctx.mode !== 'LOCAL' && ctx.mode !== 'NAMETAG') {
      const shouldAutoRecover =
        ctx.tokens.size === 0 &&          // No tokens found from localStorage + IPFS
        ctx.remoteCid !== null &&         // We successfully loaded from IPFS
        ctx.remoteLastCid !== null;       // There's history to traverse

      if (shouldAutoRecover) {
        console.log(`🔄 [Auto-Recovery] Detected 0 tokens with IPFS history available`);
        console.log(`   Remote CID: ${ctx.remoteCid!.slice(0, 16)}...`);
        console.log(`   History CID: ${ctx.remoteLastCid!.slice(0, 16)}...`);
        console.log(`   Auto-triggering RECOVERY mode (depth=10)...`);

        ctx.autoRecoveryTriggered = true;
        ctx.recoveryDepth = 10;  // Reasonable default for auto-recovery
        stepStart = performance.now();
        await step2_5_traverseVersionChain(ctx);
        stepTimings['Step 2.5 (Auto)'] = performance.now() - stepStart;
        console.log(`⏱️ [Step 2.5 Auto-Recovery] Version chain traversal completed in ${stepTimings['Step 2.5 (Auto)'].toFixed(1)}ms`);
      }
    }
  }

  // Step 3: Proof Normalization
  stepStart = performance.now();
  step3_normalizeProofs(ctx);
  stepTimings['Step 3'] = performance.now() - stepStart;
  console.log(`⏱️ [Step 3] Normalize Proofs completed in ${stepTimings['Step 3'].toFixed(1)}ms`);

  // Step 4: Commitment Validation
  stepStart = performance.now();
  await step4_validateCommitments(ctx);
  stepTimings['Step 4'] = performance.now() - stepStart;
  console.log(`⏱️ [Step 4] Validate Commitments completed in ${stepTimings['Step 4'].toFixed(1)}ms`);

  // Step 5: Token Validation
  stepStart = performance.now();
  await step5_validateTokens(ctx);
  stepTimings['Step 5'] = performance.now() - stepStart;
  console.log(`⏱️ [Step 5] Validate Tokens completed in ${stepTimings['Step 5'].toFixed(1)}ms`);

  // Step 6: Token Deduplication
  stepStart = performance.now();
  step6_deduplicateTokens(ctx);
  stepTimings['Step 6'] = performance.now() - stepStart;
  console.log(`⏱️ [Step 6] Deduplicate Tokens completed in ${stepTimings['Step 6'].toFixed(1)}ms`);

  // Step 7: Spent Token Detection (skip in FAST/LOCAL mode)
  if (!shouldSkipSpentDetection(ctx.mode)) {
    stepStart = performance.now();
    await step7_detectSpentTokens(ctx);
    stepTimings['Step 7'] = performance.now() - stepStart;
    console.log(`⏱️ [Step 7] Detect Spent Tokens completed in ${stepTimings['Step 7'].toFixed(1)}ms`);
  }

  // Step 7.5: Verify Tombstones (skip in FAST/LOCAL mode)
  if (!shouldSkipSpentDetection(ctx.mode)) {
    stepStart = performance.now();
    await step7_5_verifyTombstones(ctx);
    stepTimings['Step 7.5'] = performance.now() - stepStart;
    console.log(`⏱️ [Step 7.5] Verify Tombstones completed in ${stepTimings['Step 7.5'].toFixed(1)}ms`);
  }

  // Step 8: Folder Assignment / Merge Inventory
  stepStart = performance.now();
  step8_mergeInventory(ctx);
  stepTimings['Step 8'] = performance.now() - stepStart;
  console.log(`⏱️ [Step 8] Merge Inventory completed in ${stepTimings['Step 8'].toFixed(1)}ms`);

  // Step 8.4: Filter nametags for current user ownership
  stepStart = performance.now();
  ctx.nametags = await step8_4_extractNametags(ctx);
  stepTimings['Step 8.4'] = performance.now() - stepStart;
  console.log(`⏱️ [Step 8.4] Extract Nametags completed in ${stepTimings['Step 8.4'].toFixed(1)}ms`);

  // Step 8.5: Ensure nametag bindings are registered with Nostr
  // Best-effort, non-blocking - failures don't stop sync
  stepStart = performance.now();
  await step8_5_ensureNametagNostrBinding(ctx);
  stepTimings['Step 8.5'] = performance.now() - stepStart;
  console.log(`⏱️ [Step 8.5] Ensure Nametag-Nostr Consistency completed in ${stepTimings['Step 8.5'].toFixed(1)}ms`);

  // Step 8.5a: Ensure nametag genesis commitments are on aggregator
  // Per TOKEN_INVENTORY_SPEC.md Section 8.5a: If exclusion proof, trigger recovery
  // Best-effort, non-blocking - failures don't stop sync
  stepStart = performance.now();
  await step8_5a_ensureNametagAggregatorRegistration(ctx);
  stepTimings['Step 8.5a'] = performance.now() - stepStart;
  console.log(`⏱️ [Step 8.5a] Ensure Nametag-Aggregator Registration completed in ${stepTimings['Step 8.5a'].toFixed(1)}ms`);

  // Step 8.6: Attempt recovery of nametag-invalidated tokens
  // Per TOKEN_INVENTORY_SPEC.md Section 13.26: After nametag proof is valid,
  // attempt to recover tokens that were invalidated due to stale embedded nametag proofs
  stepStart = performance.now();
  await step8_6_recoverNametagInvalidatedTokens(ctx);
  stepTimings['Step 8.6'] = performance.now() - stepStart;
  console.log(`⏱️ [Step 8.6] Recover Nametag-Invalidated Tokens completed in ${stepTimings['Step 8.6'].toFixed(1)}ms`);

  // Step 9: Prepare for Storage
  stepStart = performance.now();
  step9_prepareStorage(ctx);
  stepTimings['Step 9'] = performance.now() - stepStart;
  console.log(`⏱️ [Step 9] Prepare for Storage completed in ${stepTimings['Step 9'].toFixed(1)}ms`);

  // Step 10: Upload to IPFS (skip in LOCAL mode)
  if (ctx.uploadNeeded && !shouldSkipIpfs(ctx.mode)) {
    stepStart = performance.now();
    await step10_uploadIpfs(ctx);
    stepTimings['Step 10'] = performance.now() - stepStart;
    console.log(`⏱️ [Step 10] Upload to IPFS completed in ${stepTimings['Step 10'].toFixed(1)}ms`);
  }

  // Log timing summary
  const totalTime = Date.now() - (ctx.startTime || 0);
  console.log(`📊 [Sync Timing Summary]`);
  console.log(`  Total: ${totalTime.toFixed(1)}ms`);
  Object.entries(stepTimings).sort().forEach(([step, duration]) => {
    console.log(`  ${step}: ${duration.toFixed(1)}ms`);
  });

  return buildSuccessResult(ctx);
}

// ============================================
// Step Implementations (Stubs - to be filled in)
// ============================================

function initializeContext(params: SyncParams, mode: SyncMode, startTime: number): SyncContext {
  return {
    mode,
    address: params.address,
    publicKey: params.publicKey,
    ipnsName: params.ipnsName,
    startTime,
    tokens: new Map(),
    archivedTokens: new Map(),  // Archived tokens for recovery
    forkedTokens: new Map(),    // Forked tokens at specific states
    sent: [],
    invalid: [],
    outbox: [],
    tombstones: [],
    nametags: [],
    completedList: [],
    localVersion: 0,
    remoteCid: null,
    remoteVersion: 0,
    uploadNeeded: false,
    ipnsPublished: false,
    hasLocalOnlyContent: false,
    preparedStorageData: null,
    stats: createDefaultSyncOperationStats(),
    circuitBreaker: createDefaultCircuitBreakerState(),
    errors: [],
    // RECOVERY mode state
    recoveryDepth: params.recoveryDepth ?? -1,  // -1 = not in recovery mode
    processedCids: new Set(),
    networkErrorOccurred: false,
    recoveryStats: {
      versionsTraversed: 0,
      tokensRecoveredFromHistory: 0,
    },
    // Remote data state
    remoteLastCid: null,
    autoRecoveryTriggered: false,
    // Version tracking
    versionHwm: 0,
    remoteVersionRegressed: false,
    // Performance optimization
    skipExtendedVerification: params.skipExtendedVerification ?? false,
  };
}

function step0_inputProcessing(ctx: SyncContext, params: SyncParams): void {
  console.log(`📥 [Step 0] Input Processing`);

  // Process incoming tokens from Nostr/peer transfers
  if (params.incomingTokens && params.incomingTokens.length > 0) {
    console.log(`  Processing ${params.incomingTokens.length} incoming tokens`);
    for (const token of params.incomingTokens) {
      const txf = tokenToTxf(token);
      if (txf) {
        const tokenId = txf.genesis.data.tokenId;
        ctx.tokens.set(tokenId, txf);
        ctx.stats.tokensImported++;
      } else {
        console.warn(`  Failed to convert incoming token ${token.id} to TXF format`);
      }
    }
  }

  // Process outbox tokens (pending transfers)
  if (params.outboxTokens && params.outboxTokens.length > 0) {
    console.log(`  Processing ${params.outboxTokens.length} outbox entries`);
    ctx.outbox.push(...params.outboxTokens);
  }

  // Process completed transfers (to mark as SPENT)
  if (params.completedList && params.completedList.length > 0) {
    console.log(`  Processing ${params.completedList.length} completed transfers`);
    ctx.completedList.push(...params.completedList);
  }

  console.log(`  Input processing complete: ${ctx.tokens.size} tokens, ${ctx.outbox.length} outbox, ${ctx.completedList.length} completed`);
}

async function step1_loadLocalStorage(ctx: SyncContext): Promise<void> {
  console.log(`💾 [Step 1] Load from localStorage`);

  // Per TOKEN_INVENTORY_SPEC.md Section 6.1:
  // "Only inventorySync should be allowed to access the inventory in localStorage!"
  //
  // We load directly from localStorage in TxfStorageData format (the canonical format).
  // However, we also detect StoredWallet format (from legacy WalletRepository) and convert it.
  // This ensures backward compatibility while maintaining spec compliance.

  const storageKey = STORAGE_KEY_GENERATORS.walletByAddress(ctx.address);
  const storage = getInventoryStorage();

  // Load Version High Water Mark - tracks highest version ever seen from IPFS
  // This prevents accepting downgraded/corrupted data across sessions
  const hwmKey = STORAGE_KEY_GENERATORS.versionHighWaterMark(ctx.address);
  const hwmStr = storage.getItem(hwmKey);
  if (hwmStr) {
    ctx.versionHwm = parseInt(hwmStr, 10) || 0;
    if (ctx.versionHwm > 0) {
      console.log(`  Version HWM: ${ctx.versionHwm} (highest known version for this wallet)`);
    }
  }

  const json = storage.getItem(storageKey);

  if (!json) {
    console.log(`  No wallet data found for address ${ctx.address.slice(0, 20)}...`);
    return;
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(json);
  } catch {
    console.warn(`  Failed to parse localStorage data`);
    return;
  }

  // Detect format: TxfStorageData has _meta and _<tokenId> keys
  //                StoredWallet has tokens: Token[] array
  const isTxfFormat = data._meta !== undefined || Object.keys(data).some(k => isTokenKey(k));
  const isStoredWalletFormat = Array.isArray(data.tokens);

  if (isStoredWalletFormat && !isTxfFormat) {
    console.log(`  Detected StoredWallet format, converting...`);
    // Convert StoredWallet format to TxfStorageData format
    await loadFromStoredWalletFormat(ctx, data);
  } else {
    // Load from TxfStorageData format (the canonical format)
    await loadFromTxfStorageDataFormat(ctx, data);
  }
}

// Load from TxfStorageData format (canonical format per spec)
async function loadFromTxfStorageDataFormat(ctx: SyncContext, data: Record<string, unknown>): Promise<void> {
  // Load metadata
  const meta = data._meta as TxfMeta | undefined;
  if (meta?.version) {
    ctx.localVersion = meta.version;
    console.log(`  Loaded metadata: version=${ctx.localVersion}`);
  }

  // Load nametag
  if (data._nametag) {
    const nametag = data._nametag as NametagData;
    ctx.nametags.push(nametag);
    console.log(`  Loaded nametag: ${nametag.name}`);

    // NAMETAG mode: only load nametag, skip rest
    if (ctx.mode === 'NAMETAG') {
      return;
    }
  } else if (ctx.mode === 'NAMETAG') {
    return; // NAMETAG mode but no nametag found
  }

  // Load tombstones
  if (data._tombstones && Array.isArray(data._tombstones)) {
    ctx.tombstones.push(...(data._tombstones as TombstoneEntry[]));
    console.log(`  Loaded ${ctx.tombstones.length} tombstones`);
  }

  // Load active tokens from _<tokenId> keys
  let tokenCount = 0;
  for (const key of Object.keys(data)) {
    if (isTokenKey(key)) {
      const txf = data[key] as TxfToken;
      const tokenId = tokenIdFromKey(key);
      // Don't overwrite incoming tokens from Step 0
      if (!ctx.tokens.has(tokenId)) {
        ctx.tokens.set(tokenId, txf);
        tokenCount++;
      }
    }
  }
  console.log(`  Loaded ${tokenCount} active tokens from localStorage`);

  // Load sent, invalid, outbox (for IPFS round-trip)
  if (data._sent && Array.isArray(data._sent)) {
    ctx.sent.push(...(data._sent as SentTokenEntry[]));
    console.log(`  Loaded ${ctx.sent.length} sent tokens`);
  }
  if (data._invalid && Array.isArray(data._invalid)) {
    ctx.invalid.push(...(data._invalid as InvalidTokenEntry[]));
    console.log(`  Loaded ${ctx.invalid.length} invalid tokens`);
  }
  if (data._outbox && Array.isArray(data._outbox)) {
    ctx.outbox.push(...(data._outbox as OutboxEntry[]));
    console.log(`  Loaded ${ctx.outbox.length} outbox entries`);
  }

  // Load archived tokens from _archived_<tokenId> keys
  // These are tokens that were spent/transferred but kept for recovery
  let archivedCount = 0;
  for (const key of Object.keys(data)) {
    if (isArchivedKey(key)) {
      const txf = data[key] as TxfToken;
      const tokenId = tokenIdFromArchivedKey(key);
      ctx.archivedTokens.set(tokenId, txf);
      archivedCount++;
    }
  }
  if (archivedCount > 0) {
    console.log(`  Loaded ${archivedCount} archived tokens from localStorage`);
  }

  // Load forked tokens from _forked_<tokenId>_<stateHash> keys
  // These are tokens saved at specific states for conflict resolution
  let forkedCount = 0;
  for (const key of Object.keys(data)) {
    if (isForkedKey(key)) {
      const txf = data[key] as TxfToken;
      // Store with the full key (includes tokenId and stateHash)
      const parsed = parseForkedKey(key);
      if (parsed) {
        const forkedKey = `${parsed.tokenId}_${parsed.stateHash}`;
        ctx.forkedTokens.set(forkedKey, txf);
        forkedCount++;
      }
    }
  }
  if (forkedCount > 0) {
    console.log(`  Loaded ${forkedCount} forked tokens from localStorage`);
  }
}

// Load from StoredWallet format (legacy WalletRepository format) and convert to TxfStorageData
async function loadFromStoredWalletFormat(ctx: SyncContext, data: Record<string, unknown>): Promise<void> {
  // Load nametag
  if (data.nametag) {
    const nametag = data.nametag as NametagData;
    ctx.nametags.push(nametag);
    console.log(`  Loaded nametag: ${nametag.name}`);

    // NAMETAG mode: only load nametag, skip rest
    if (ctx.mode === 'NAMETAG') {
      return;
    }
  } else if (ctx.mode === 'NAMETAG') {
    return;
  }

  // Load tombstones
  if (data.tombstones && Array.isArray(data.tombstones)) {
    ctx.tombstones.push(...(data.tombstones as TombstoneEntry[]));
    console.log(`  Loaded ${ctx.tombstones.length} tombstones`);
  }

  // Load tokens from tokens: Token[] array and convert to TxfToken format
  const tokens = data.tokens as Token[] | undefined;
  if (tokens && Array.isArray(tokens)) {
    let tokenCount = 0;
    for (const token of tokens) {
      const txf = tokenToTxf(token);
      if (txf && txf.genesis?.data?.tokenId) {
        const tokenId = txf.genesis.data.tokenId;
        // Don't overwrite incoming tokens from Step 0
        if (!ctx.tokens.has(tokenId)) {
          ctx.tokens.set(tokenId, txf);
          tokenCount++;
        }
      }
    }
    console.log(`  Loaded ${tokenCount} active tokens (converted from StoredWallet format)`);
  }

  // Note: StoredWallet format doesn't have _sent, _invalid, _outbox
  // These will be loaded from IPFS in Step 2
}

async function step2_loadIpfs(ctx: SyncContext): Promise<void> {
  console.log(`🌐 [Step 2] Load from IPFS`);

  const circuitBreaker = getCircuitBreakerService();

  // Early validation: skip IPFS loading if IPNS name is not available
  // This is normal for new wallets that haven't published to IPNS yet
  if (!ctx.ipnsName || ctx.ipnsName.trim().length === 0) {
    console.log(`  ⏭️ Skipping IPFS load: no IPNS name configured (new wallet or LOCAL mode)`);
    return; // Continue with local-only data
  }

  // FAST mode optimization: use cache-only resolution when cache is known-fresh
  // This skips network round-trips (~2.5s) when we recently published locally
  // Only enabled in FAST mode (post-transfer) when WebSocket is healthy as fallback
  const httpResolver = getIpfsHttpResolver();
  const wsConnected = httpResolver.isWebSocketConnected();
  const useCacheOnly = ctx.mode === 'FAST' && wsConnected;

  if (useCacheOnly) {
    console.log(`  [FAST mode] Using cache-only IPNS resolution (WebSocket connected: ${wsConnected})`);
  }

  // Try to use IpfsTransport if available (provides better sequence tracking)
  let transport: IpfsTransport | null = null;
  try {
    transport = getIpfsTransport();
  } catch {
    // Fall back to HTTP resolver only
  }

  let remoteData: TxfStorageData | null = null;
  let ipfsOperationFailed = false;

  if (transport) {
    // Initialize transport with identity so cachedIpnsName gets set
    // This ensures IPFS is ready even if we don't need to upload later
    try {
      const initStartTime = performance.now();
      const initialized = await transport.ensureInitialized();
      console.log(`  [Timing] transport.ensureInitialized() took ${(performance.now() - initStartTime).toFixed(0)}ms`);
      if (!initialized) {
        console.log(`  ⚠️ Transport initialization failed, falling back to HTTP resolver`);
        transport = null;
      }
    } catch (err) {
      console.warn(`  ⚠️ Transport initialization error:`, err);
      transport = null;
      ipfsOperationFailed = true;
    }
  }

  if (transport) {
    // Use full transport API (better sequence tracking, dual DHT+HTTP)
    console.log(`  Using IpfsTransport for IPNS resolution...`);
    try {
      const resolveStartTime = performance.now();
      const resolution = await transport.resolveIpns({ useCacheOnly });
      console.log(`  [Timing] transport.resolveIpns() took ${(performance.now() - resolveStartTime).toFixed(0)}ms`);

      if (resolution.cid) {
        ctx.remoteCid = resolution.cid;
        ctx.remoteVersion = resolution.content?._meta?.version || 0;
        remoteData = resolution.content || null;
        console.log(`  Transport resolved: CID=${resolution.cid.slice(0, 16)}..., seq=${resolution.sequence}, version=${ctx.remoteVersion}`);
      } else {
        // Transport returned no CID - this can happen if IPFS isn't fully initialized yet
        // (cachedIpnsName not set). Fall through to HTTP resolver which doesn't require Helia.
        console.log(`  Transport IPNS resolution returned no CID, trying HTTP resolver...`);
      }
    } catch (err) {
      console.warn(`  ⚠️ Transport IPNS resolution error:`, err);
      ipfsOperationFailed = true;
    }
  }

  // Fallback to HTTP resolver if transport didn't return data
  // (either transport not available, or cachedIpnsName not set yet)
  if (!remoteData) {
    // Fallback to HTTP resolver (transport unavailable or not initialized yet)
    console.log(`  Using HTTP resolver for IPNS resolution...`);

    try {
      // 1. Resolve IPNS name to get CID and content
      const resolution = await httpResolver.resolveIpnsName(ctx.ipnsName, useCacheOnly);

      if (!resolution.success) {
        console.warn(`  IPNS resolution failed: ${resolution.error || 'unknown error'}`);
        ipfsOperationFailed = true;
        // Record failure with circuit breaker
        circuitBreaker.recordIpfsFailure();
        return; // Continue with local-only data
      }

      if (!resolution.content) {
        console.log(`  IPNS resolved but no content (new wallet or empty IPNS)`);
        // Not a failure - just no content yet
        return;
      }

      ctx.remoteCid = resolution.cid || null;
      remoteData = resolution.content;
    } catch (err) {
      console.warn(`  ⚠️ HTTP resolver error:`, err);
      ipfsOperationFailed = true;
      // Record failure with circuit breaker
      circuitBreaker.recordIpfsFailure();
      return; // Continue with local-only data
    }
  }

  if (!remoteData) {
    console.log(`  No remote data available`);
    if (ipfsOperationFailed) {
      circuitBreaker.recordIpfsFailure();
    }
    return;
  }

  // IPFS load succeeded - record success with circuit breaker
  circuitBreaker.recordIpfsSuccess();

  const processingStartTime = performance.now();

  // Extract remote version and lastCid (for auto-recovery detection)
  if (remoteData._meta) {
    ctx.remoteVersion = remoteData._meta.version || 0;
    ctx.remoteLastCid = remoteData._meta.lastCid || null;
    console.log(`  Remote version: ${ctx.remoteVersion}, Local version: ${ctx.localVersion}`);
    if (ctx.remoteLastCid) {
      console.log(`  Remote lastCid: ${ctx.remoteLastCid.slice(0, 16)}... (history available)`);
    }

    // ============================================
    // VERSION TRACKING LOGIC
    // ============================================
    //
    // Case 1: Remote version REGRESSED (remote < HWM)
    //   - This means remote has OLDER data than we've previously seen
    //   - Could be stale cache, network issue, or external corruption
    //   - We should NOT merge this data (it's outdated)
    //   - We SHOULD upload our local data to fix the remote
    //
    // Case 2: Local ahead of remote (local > remote, remote >= HWM)
    //   - Normal case: local has pending changes not yet uploaded
    //   - Skip merging remote data, keep local data
    //   - Upload local data to sync to IPFS
    //
    // Case 3: Remote ahead of local (remote > local)
    //   - Another device made changes
    //   - Merge remote data into local
    //   - Then upload merged result
    //
    // Case 4: Versions match (remote == local)
    //   - Check for content differences
    //   - Normal merge flow
    // ============================================

    // Case 1: Remote version regressed below HWM (stale IPNS cache)
    if (ctx.versionHwm > 1 && ctx.remoteVersion > 0 && ctx.remoteVersion < ctx.versionHwm) {
      console.error(`  🚨 REMOTE VERSION REGRESSED: Remote v${ctx.remoteVersion} < HWM v${ctx.versionHwm}`);
      console.error(`  🚨 This indicates stale IPNS cache - server likely has v${ctx.versionHwm}`);
      console.error(`  🚨 Skipping IPFS upload - we don't have correct lastCid for chain validation`);
      console.error(`  🚨 Try again after IPNS cache refreshes (usually within 30s)`);
      ctx.remoteVersionRegressed = true;
      // MUST set networkErrorOccurred to prevent upload with wrong lastCid
      // If we upload with stale lastCid, chain validation will fail on server
      // Wait for IPNS cache to refresh and try again on next sync
      ctx.networkErrorOccurred = true;
      const processingEndTime = performance.now();
      console.log(`  [Timing] Remote data SKIPPED (regressed, upload blocked) in ${(processingEndTime - processingStartTime).toFixed(0)}ms`);
      return;
    }

    // Case 2: Local is ahead of remote (normal pending changes)
    if (ctx.localVersion > ctx.remoteVersion) {
      console.log(`  📤 Local v${ctx.localVersion} ahead of Remote v${ctx.remoteVersion} - local has pending changes`);
      // This is NORMAL after local operations (split, receive, etc.)
      // We should still process remote data in case it has tokens we don't have locally
      // But we should NOT overwrite local tokens with older remote tokens
      // The merge logic below will handle this correctly (prefer local or newer remote)
    }

    // Case 3: Remote is ahead of local
    if (ctx.remoteVersion > ctx.localVersion) {
      console.log(`  📥 Remote v${ctx.remoteVersion} ahead of Local v${ctx.localVersion} - will merge remote changes`);
    }
  }

  // 2. Merge remote tokens into context
  // Track which tokens were only in local (for upload detection)
  const localOnlyTokenIds = new Set(ctx.tokens.keys());

  // Debug: Log all keys in remote data to diagnose missing tokens
  const allRemoteKeys = Object.keys(remoteData);
  const tokenKeys = allRemoteKeys.filter(k => isTokenKey(k));
  const nonTokenKeys = allRemoteKeys.filter(k => !isTokenKey(k));
  console.log(`  📦 Remote data keys: ${allRemoteKeys.length} total (${tokenKeys.length} tokens, ${nonTokenKeys.length} other)`);
  if (tokenKeys.length === 0 && allRemoteKeys.length > 0) {
    console.log(`  ⚠️ Non-token keys in remote: ${nonTokenKeys.slice(0, 10).join(', ')}`);
  }

  let tokensImported = 0;
  for (const key of Object.keys(remoteData)) {
    if (isTokenKey(key)) {
      const remoteTxf = remoteData[key] as TxfToken;
      if (!remoteTxf || !remoteTxf.genesis?.data?.tokenId) continue;

      // Use the storage key (tokenIdFromKey) for consistency with Step 1
      // Step 1 uses tokenIdFromKey(key) to extract tokenId, so we must match that
      const tokenId = tokenIdFromKey(key);
      const localTxf = ctx.tokens.get(tokenId);

      // Mark this token as not local-only (exists in remote)
      localOnlyTokenIds.delete(tokenId);

      // Prefer remote if: no local, or remote has more transactions
      if (!localTxf || shouldPreferRemote(localTxf, remoteTxf)) {
        ctx.tokens.set(tokenId, remoteTxf);
        if (!localTxf) tokensImported++;
      }
    }
  }

  // Any tokens still in localOnlyTokenIds are local-only (not in remote)
  if (localOnlyTokenIds.size > 0) {
    ctx.hasLocalOnlyContent = true;
    console.log(`  📤 ${localOnlyTokenIds.size} local-only token(s) not in remote - will upload`);
  }

  // 3. Merge remote tombstones (union merge)
  if (remoteData._tombstones && Array.isArray(remoteData._tombstones)) {
    const existingKeys = new Set(
      ctx.tombstones.map(t => `${t.tokenId}:${t.stateHash}`)
    );
    for (const tombstone of remoteData._tombstones as TombstoneEntry[]) {
      const key = `${tombstone.tokenId}:${tombstone.stateHash}`;
      if (!existingKeys.has(key)) {
        ctx.tombstones.push(tombstone);
      }
    }
  }

  // 4. Merge remote sent tokens (union merge by tokenId:stateHash)
  // Multiple entries with same tokenId but different stateHash are allowed
  // (supports boomerang scenarios where token returns at different states)
  // NOTE: If stateHash is unavailable (getCurrentStateHash returns undefined),
  // we still import the token using tokenId-only key to avoid losing sent history.
  console.log(`  📤 IPFS _sent folder: ${remoteData._sent ? (Array.isArray(remoteData._sent) ? remoteData._sent.length : 'not-array') : 'undefined'} entries, local: ${ctx.sent.length}`);
  if (remoteData._sent && Array.isArray(remoteData._sent)) {
    const existingKeys = new Set(
      ctx.sent.map(s => {
        const tokenId = s.token.genesis?.data?.tokenId || '';
        const stateHash = getCurrentStateHash(s.token) || '';
        return `${tokenId}:${stateHash}`;
      })
    );
    // Also track by tokenId-only for fallback deduplication
    const existingTokenIds = new Set(
      ctx.sent.map(s => s.token.genesis?.data?.tokenId || '')
    );
    let sentImported = 0;
    for (const sentEntry of remoteData._sent as SentTokenEntry[]) {
      const tokenId = sentEntry.token?.genesis?.data?.tokenId;
      if (!tokenId) continue;  // Skip invalid entries

      const stateHash = getCurrentStateHash(sentEntry.token);
      const key = `${tokenId}:${stateHash || 'unknown'}`;

      // Primary dedup: tokenId:stateHash (when stateHash available)
      // Fallback dedup: tokenId-only (when stateHash unavailable)
      const isDuplicate = stateHash
        ? existingKeys.has(key)
        : existingTokenIds.has(tokenId);

      if (!isDuplicate) {
        ctx.sent.push(sentEntry);
        existingKeys.add(key);
        // Only add to tokenId-only set when using fallback (stateHash unavailable)
        // This prevents incorrectly blocking entries with same tokenId but different stateHash
        if (!stateHash) {
          existingTokenIds.add(tokenId);
        }
        sentImported++;
      }
    }
    if (sentImported > 0) {
      console.log(`  📤 Imported ${sentImported} sent token(s) from IPFS`);
    }
  }

  // 5. Merge remote invalid tokens (union merge by tokenId:stateHash)
  // Multiple entries with same tokenId but different stateHash are allowed
  // (a token may fail validation at different states for different reasons)
  // NOTE: If stateHash is unavailable, we still import using tokenId-only key.
  if (remoteData._invalid && Array.isArray(remoteData._invalid)) {
    const existingKeys = new Set(
      ctx.invalid.map(i => {
        const tokenId = i.token.genesis?.data?.tokenId || '';
        const stateHash = getCurrentStateHash(i.token) || '';
        return `${tokenId}:${stateHash}`;
      })
    );
    // Also track by tokenId-only for fallback deduplication
    const existingTokenIds = new Set(
      ctx.invalid.map(i => i.token.genesis?.data?.tokenId || '')
    );
    let invalidImported = 0;
    for (const invalidEntry of remoteData._invalid as InvalidTokenEntry[]) {
      const tokenId = invalidEntry.token?.genesis?.data?.tokenId;
      if (!tokenId) continue;  // Skip invalid entries

      const stateHash = getCurrentStateHash(invalidEntry.token);
      const key = `${tokenId}:${stateHash || 'unknown'}`;

      // Primary dedup: tokenId:stateHash (when stateHash available)
      // Fallback dedup: tokenId-only (when stateHash unavailable)
      const isDuplicate = stateHash
        ? existingKeys.has(key)
        : existingTokenIds.has(tokenId);

      if (!isDuplicate) {
        ctx.invalid.push(invalidEntry);
        existingKeys.add(key);
        // Only add to tokenId-only set when using fallback (stateHash unavailable)
        if (!stateHash) {
          existingTokenIds.add(tokenId);
        }
        invalidImported++;
      }
    }
    if (invalidImported > 0) {
      console.log(`  ⚠️ Imported ${invalidImported} invalid token(s) from IPFS`);
    }
  }

  // 6. Merge remote nametag if present
  if (remoteData._nametag && ctx.nametags.length === 0) {
    ctx.nametags.push(remoteData._nametag);
    console.log(`  Imported nametag: ${remoteData._nametag.name}`);
  } else if (!remoteData._nametag && ctx.nametags.length > 0) {
    // Local has nametag, remote doesn't - need to upload
    ctx.hasLocalOnlyContent = true;
    console.log(`  📤 Local nametag "${ctx.nametags[0].name}" not in remote - will upload`);
  }

  ctx.stats.tokensImported = tokensImported;
  console.log(`  ✓ Loaded from IPFS: ${tokensImported} new tokens, ${ctx.tombstones.length} tombstones`);

  // Update Version High Water Mark after successfully loading remote data
  // This tracks the highest version we've seen from IPFS
  if (ctx.remoteVersion > ctx.versionHwm) {
    const storage = getInventoryStorage();
    const hwmKey = STORAGE_KEY_GENERATORS.versionHighWaterMark(ctx.address);
    storage.setItem(hwmKey, String(ctx.remoteVersion));
    console.log(`  ✓ Updated version HWM: ${ctx.versionHwm} → ${ctx.remoteVersion}`);
    ctx.versionHwm = ctx.remoteVersion;
  }

  console.log(`  [Timing] Remote data processing took ${(performance.now() - processingStartTime).toFixed(0)}ms`);
}

/**
 * Determine if remote token should be preferred over local
 * Prefers token with more transactions (more advanced state)
 */
function shouldPreferRemote(local: TxfToken, remote: TxfToken): boolean {
  const localTxCount = local.transactions?.length || 0;
  const remoteTxCount = remote.transactions?.length || 0;

  // Prefer remote if it has more transactions
  if (remoteTxCount > localTxCount) {
    return true;
  }

  // If same transaction count, prefer the one with more committed transactions
  if (remoteTxCount === localTxCount && remoteTxCount > 0) {
    const localCommitted = local.transactions.filter(tx => tx.inclusionProof !== null).length;
    const remoteCommitted = remote.transactions.filter(tx => tx.inclusionProof !== null).length;
    return remoteCommitted > localCommitted;
  }

  return false;
}

/**
 * Step 2.5: RECOVERY mode - traverse IPFS version chain
 *
 * When RECOVERY mode is active, this step traverses the _meta.lastCid chain
 * backwards through IPFS history to recover tokens from previous versions.
 *
 * This is used to recover from version regression bugs where an old/empty
 * state was accidentally published, overwriting good data.
 *
 * The version chain looks like:
 *   IPNS → CID_v2 (current, possibly corrupted)
 *            ↓ _meta.lastCid
 *          CID_v68 (previous, has good data)
 *            ↓ _meta.lastCid
 *          CID_v67
 *            ↓ ... back to v1
 *
 * Traversal stops when:
 * - recoveryDepth limit reached (if >0)
 * - No more _meta.lastCid links
 * - CID cycle detected (shouldn't happen but safety check)
 * - Network error (marks networkErrorOccurred to prevent upload)
 */
async function step2_5_traverseVersionChain(ctx: SyncContext): Promise<void> {
  // Start from the current CID's lastCid (don't re-process current version)
  const resolver = getIpfsHttpResolver();

  // First, get the current version's metadata to find lastCid
  if (!ctx.remoteCid) {
    console.log(`  ⏭️ No remote CID available for RECOVERY traversal`);
    return;
  }

  // Mark current CID as processed
  ctx.processedCids.add(ctx.remoteCid);

  // Fetch current version to get its _meta.lastCid
  let currentData: TxfStorageData | null = null;
  try {
    currentData = await resolver.fetchContentByCid(ctx.remoteCid);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (isNetworkError(errMsg)) {
      console.warn(`  ⚠️ Network error fetching current CID, stopping RECOVERY: ${errMsg}`);
      ctx.networkErrorOccurred = true;
      return;
    }
    console.warn(`  ⚠️ Failed to fetch current CID for RECOVERY: ${errMsg}`);
    return;
  }

  if (!currentData?._meta?.lastCid) {
    console.log(`  📋 No previous version link found (first version or missing _meta.lastCid)`);
    return;
  }

  let currentCid = currentData._meta.lastCid;
  const depthLimit = ctx.recoveryDepth === 0 ? Infinity : ctx.recoveryDepth;

  console.log(`🔄 [Step 2.5] RECOVERY: Traversing version chain (depth=${ctx.recoveryDepth === 0 ? 'unlimited' : ctx.recoveryDepth})...`);

  while (ctx.recoveryStats.versionsTraversed < depthLimit) {
    // Cycle detection
    if (ctx.processedCids.has(currentCid)) {
      console.log(`  ⚠️ CID cycle detected at ${currentCid.slice(0, 16)}..., stopping`);
      break;
    }
    ctx.processedCids.add(currentCid);

    // Fetch historical version
    let historicalData: TxfStorageData | null = null;
    try {
      historicalData = await resolver.fetchContentByCid(currentCid);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (isNetworkError(errMsg)) {
        console.warn(`  ⚠️ Network error during RECOVERY at ${currentCid.slice(0, 16)}...: ${errMsg}`);
        ctx.networkErrorOccurred = true;
        break;
      }
      if (is404Error(errMsg)) {
        console.warn(`  ⚠️ CID ${currentCid.slice(0, 16)}... not found (data loss or pruned), stopping`);
        ctx.recoveryStats.oldestCidReached = currentCid;
        break;
      }
      console.warn(`  ⚠️ Failed to fetch ${currentCid.slice(0, 16)}...: ${errMsg}`);
      break;
    }

    if (!historicalData) {
      console.log(`  ⚠️ Empty content at ${currentCid.slice(0, 16)}..., stopping`);
      break;
    }

    // Merge tokens from historical version
    const tokensBefore = ctx.tokens.size;
    for (const key of Object.keys(historicalData)) {
      if (isTokenKey(key)) {
        const remoteTxf = historicalData[key] as TxfToken;
        if (!remoteTxf?.genesis?.data?.tokenId) continue;

        const tokenId = tokenIdFromKey(key);
        const localTxf = ctx.tokens.get(tokenId);

        // Add token if not present, or prefer remote if it has more transactions
        if (!localTxf || shouldPreferRemote(localTxf, remoteTxf)) {
          ctx.tokens.set(tokenId, remoteTxf);
        }
      }
    }

    // Merge sent tokens from historical version (union merge)
    if (historicalData._sent && Array.isArray(historicalData._sent)) {
      const existingKeys = new Set(
        ctx.sent.map(s => {
          const tokenId = s.token.genesis?.data?.tokenId || '';
          const stateHash = getCurrentStateHash(s.token) || '';
          return `${tokenId}:${stateHash}`;
        })
      );
      for (const sentEntry of historicalData._sent as SentTokenEntry[]) {
        const tokenId = sentEntry.token?.genesis?.data?.tokenId;
        if (!tokenId) continue;
        const stateHash = getCurrentStateHash(sentEntry.token) || '';
        const key = `${tokenId}:${stateHash}`;
        if (!existingKeys.has(key)) {
          ctx.sent.push(sentEntry);
          existingKeys.add(key);
        }
      }
    }

    // Merge invalid tokens from historical version (union merge)
    if (historicalData._invalid && Array.isArray(historicalData._invalid)) {
      const existingKeys = new Set(
        ctx.invalid.map(i => {
          const tokenId = i.token.genesis?.data?.tokenId || '';
          const stateHash = getCurrentStateHash(i.token) || '';
          return `${tokenId}:${stateHash}`;
        })
      );
      for (const invalidEntry of historicalData._invalid as InvalidTokenEntry[]) {
        const tokenId = invalidEntry.token?.genesis?.data?.tokenId;
        if (!tokenId) continue;
        const stateHash = getCurrentStateHash(invalidEntry.token) || '';
        const key = `${tokenId}:${stateHash}`;
        if (!existingKeys.has(key)) {
          ctx.invalid.push(invalidEntry);
          existingKeys.add(key);
        }
      }
    }

    // Merge tombstones from historical version (union merge)
    if (historicalData._tombstones && Array.isArray(historicalData._tombstones)) {
      const existingKeys = new Set(
        ctx.tombstones.map(t => `${t.tokenId}:${t.stateHash}`)
      );
      for (const tombstone of historicalData._tombstones as TombstoneEntry[]) {
        const key = `${tombstone.tokenId}:${tombstone.stateHash}`;
        if (!existingKeys.has(key)) {
          ctx.tombstones.push(tombstone);
        }
      }
    }

    const tokensAdded = ctx.tokens.size - tokensBefore;
    ctx.recoveryStats.versionsTraversed++;
    ctx.recoveryStats.tokensRecoveredFromHistory += tokensAdded;

    // Detailed logging for debugging version chain issues
    const version = historicalData._meta?.version || '?';
    const allKeys = Object.keys(historicalData);
    const tokenKeyCount = allKeys.filter(k => isTokenKey(k)).length;
    const hasNametag = !!historicalData._nametag;
    const hasSent = Array.isArray(historicalData._sent) ? historicalData._sent.length : 0;
    const hasLastCid = !!historicalData._meta?.lastCid;

    console.log(`  📦 v${version} (${currentCid.slice(0, 12)}...): ${tokenKeyCount} token keys, nametag=${hasNametag}, sent=${hasSent}, lastCid=${hasLastCid}`);
    if (tokensAdded > 0) {
      console.log(`     ✓ Recovered ${tokensAdded} tokens (total: ${ctx.tokens.size})`);
    }

    // Get next CID in chain
    const nextCid = historicalData._meta?.lastCid;
    if (!nextCid) {
      ctx.recoveryStats.oldestCidReached = currentCid;
      console.log(`  📋 Reached end of version chain at v${version}`);
      break;
    }
    currentCid = nextCid;
  }

  // RECOVERY mode always forces upload to persist recovered state
  if (ctx.recoveryStats.tokensRecoveredFromHistory > 0 && !ctx.networkErrorOccurred) {
    ctx.uploadNeeded = true;
    console.log(`  ✓ RECOVERY complete: ${ctx.recoveryStats.versionsTraversed} versions traversed, ${ctx.recoveryStats.tokensRecoveredFromHistory} tokens recovered`);
  } else if (ctx.networkErrorOccurred) {
    console.log(`  ⚠️ RECOVERY stopped due to network error - will NOT upload to prevent data loss`);
  } else {
    console.log(`  ✓ RECOVERY complete: ${ctx.recoveryStats.versionsTraversed} versions traversed, no additional tokens found`);
  }
}

/**
 * Check if an error message indicates a network error (vs a 404 or other expected error)
 */
function isNetworkError(errMsg: string): boolean {
  const msg = errMsg.toLowerCase();
  return msg.includes('network') ||
         msg.includes('timeout') ||
         msg.includes('econnrefused') ||
         msg.includes('fetch failed') ||
         msg.includes('enotfound') ||
         msg.includes('connection refused');
}

/**
 * Check if an error message indicates a 404 (content not found)
 */
function is404Error(errMsg: string): boolean {
  const msg = errMsg.toLowerCase();
  return msg.includes('404') ||
         msg.includes('not found') ||
         msg.includes('no content');
}

function step3_normalizeProofs(ctx: SyncContext): void {
  console.log(`📋 [Step 3] Normalize Proofs`);

  let normalizedCount = 0;

  for (const txf of ctx.tokens.values()) {
    // Normalize genesis proof
    if (txf.genesis?.inclusionProof) {
      if (normalizeInclusionProof(txf.genesis.inclusionProof)) {
        normalizedCount++;
      }
    }

    // Normalize transaction proofs
    if (txf.transactions) {
      for (const tx of txf.transactions) {
        if (tx.inclusionProof) {
          if (normalizeInclusionProof(tx.inclusionProof)) {
            normalizedCount++;
          }
        }
      }
    }
  }

  if (normalizedCount > 0) {
    console.log(`  Normalized ${normalizedCount} inclusion proof(s)`);
  } else {
    console.log(`  No proofs needed normalization`);
  }
}

/**
 * Normalize an inclusion proof to ensure consistent format.
 * Returns true if any normalization was applied.
 *
 * - Ensures stateHash has "0000" prefix (Unicity hash format)
 * - Ensures merkle root has "0000" prefix
 */
function normalizeInclusionProof(proof: TxfInclusionProof): boolean {
  let normalized = false;

  // Normalize authenticator stateHash
  if (proof.authenticator?.stateHash) {
    if (!proof.authenticator.stateHash.startsWith('0000')) {
      proof.authenticator.stateHash = '0000' + proof.authenticator.stateHash;
      normalized = true;
    }
  }

  // Normalize merkle tree root
  if (proof.merkleTreePath?.root) {
    if (!proof.merkleTreePath.root.startsWith('0000')) {
      proof.merkleTreePath.root = '0000' + proof.merkleTreePath.root;
      normalized = true;
    }
  }

  return normalized;
}

async function step4_validateCommitments(ctx: SyncContext): Promise<void> {
  console.log(`✓ [Step 4] Validate Commitments`);

  const invalidTokenIds: string[] = [];
  let validatedCount = 0;

  for (const [tokenId, txf] of ctx.tokens) {
    // Step 4.1: Validate genesis commitment
    const genesisValid = validateGenesisCommitment(txf);
    if (!genesisValid.valid) {
      console.warn(`  Token ${tokenId.slice(0, 8)}... failed genesis validation: ${genesisValid.reason}`);
      invalidTokenIds.push(tokenId);
      ctx.invalid.push({
        token: txf,
        timestamp: Date.now(),
        invalidatedAt: Date.now(),
        reason: 'PROOF_MISMATCH' as InvalidReasonCode,
        details: `Genesis: ${genesisValid.reason}`
      });
      continue;
    }

    // Step 4.2: Validate each transaction commitment
    let txValid = true;
    if (txf.transactions && txf.transactions.length > 0) {
      for (let i = 0; i < txf.transactions.length; i++) {
        const tx = txf.transactions[i];
        if (tx.inclusionProof) {
          const txResult = validateTransactionCommitment(txf, i);
          if (!txResult.valid) {
            console.warn(`  Token ${tokenId.slice(0, 8)}... failed transaction ${i} validation: ${txResult.reason}`);
            invalidTokenIds.push(tokenId);
            ctx.invalid.push({
              token: txf,
              timestamp: Date.now(),
              invalidatedAt: Date.now(),
              reason: 'PROOF_MISMATCH' as InvalidReasonCode,
              details: `Transaction ${i}: ${txResult.reason}`
            });
            txValid = false;
            break;
          }
        }
      }
    }

    if (txValid) {
      validatedCount++;
    }
  }

  // Remove invalid tokens from active set
  for (const tokenId of invalidTokenIds) {
    ctx.tokens.delete(tokenId);
    ctx.stats.tokensRemoved++;
  }

  console.log(`  ✓ Validated ${validatedCount} tokens, ${invalidTokenIds.length} moved to Invalid folder`);
}

/**
 * Validate hex string format (with optional "0000" prefix)
 */
function isValidHexString(value: string, minLength: number = 64): boolean {
  if (!value || typeof value !== 'string') return false;
  // Strip "0000" prefix if present
  const hex = value.startsWith('0000') ? value.slice(4) : value;
  // Check it's valid hex of sufficient length
  return /^[0-9a-fA-F]+$/.test(hex) && hex.length >= minLength - 4;
}

/**
 * Validate genesis commitment matches inclusion proof.
 *
 * Step 4 Validation (per TOKEN_INVENTORY_SPEC.md):
 * - Structural integrity: All required fields present and properly formatted
 * - State hash chain: Genesis stateHash establishes chain root
 * - Format validation: Transaction hash and state hash are valid hex strings
 * - Genesis tokenId derivation: Verify hash(genesis.data) === tokenId (TODO)
 * - Proof payload integrity: Verify hash(proof.transaction) === transactionHash (TODO)
 *
 * Note: Full cryptographic proof verification (signature validation, merkle path)
 * is performed by the Unicity SDK in Step 5 via TokenValidationService.
 *
 * TODO (AMENDMENT 2): Enhanced validation requires SDK integration:
 * - Use Token.fromJSON() to reconstruct genesis transaction
 * - Calculate hash of genesis transaction data
 * - Verify calculated hash matches txf.genesis.data.tokenId
 * - Verify proof.transactionHash matches calculated transaction hash
 *
 * For now, we perform structural validation only. Full cryptographic validation
 * happens in Step 5 via SDK's token.verify(trustBase).
 */
function validateGenesisCommitment(txf: TxfToken): { valid: boolean; reason?: string } {
  if (!txf.genesis) {
    return { valid: false, reason: 'Missing genesis' };
  }

  if (!txf.genesis.inclusionProof) {
    return { valid: false, reason: 'Missing genesis inclusion proof' };
  }

  const proof = txf.genesis.inclusionProof;

  // Verify authenticator is present and has stateHash
  if (!proof.authenticator?.stateHash) {
    return { valid: false, reason: 'Missing authenticator stateHash' };
  }

  // Verify stateHash format (should be hex, typically with "0000" prefix)
  if (!isValidHexString(proof.authenticator.stateHash, 64)) {
    return { valid: false, reason: 'Invalid stateHash format' };
  }

  // Verify merkle path is present
  if (!proof.merkleTreePath?.root) {
    return { valid: false, reason: 'Missing merkle tree root' };
  }

  // Verify merkle root format
  if (!isValidHexString(proof.merkleTreePath.root, 64)) {
    return { valid: false, reason: 'Invalid merkle root format' };
  }

  // Verify transactionHash format if present (optional field)
  // Note: transactionHash is not required because:
  // 1. Some SDK versions/faucet tokens don't populate this field
  // 2. Full cryptographic validation happens in Step 5 via SDK's token.verify()
  // 3. Making this required causes valid tokens to be incorrectly invalidated
  if (proof.transactionHash && !isValidHexString(proof.transactionHash, 64)) {
    return { valid: false, reason: 'Invalid transactionHash format' };
  }

  // Verify genesis data is present (needed to verify transaction hash)
  if (!txf.genesis.data?.tokenId) {
    return { valid: false, reason: 'Missing genesis data tokenId' };
  }

  // TODO (AMENDMENT 2): Add cryptographic validation
  // 1. Verify hash(genesis.data) === tokenId (genesis tokenId derivation)
  // 2. Verify hash(proof.transaction) === transactionHash (inclusion proof payload)
  //
  // This requires SDK integration:
  // - const sdkToken = await Token.fromJSON(txf);
  // - const genesisTransaction = sdkToken.getGenesisTransaction();
  // - const calculatedHash = await genesisTransaction.calculateHash();
  // - if (calculatedHash.toJSON() !== txf.genesis.data.tokenId) return false;
  // - if (proof.transactionHash !== calculatedHash.toJSON()) return false;

  return { valid: true };
}

/**
 * Validate transaction commitment matches inclusion proof.
 *
 * Step 4 Validation for state transitions:
 * - State hash chain integrity: previousStateHash links correctly
 * - Format validation: All hashes are valid hex strings
 * - Structural integrity: Required proof fields present
 * - Transaction hash integrity: Verify hash(proof.transaction) === tx.transactionHash (TODO)
 *
 * Note: Full cryptographic proof verification (signature validation, merkle path)
 * is performed by the Unicity SDK in Step 5 via TokenValidationService.
 *
 * TODO (AMENDMENT 2): Enhanced validation requires SDK integration:
 * - Use Token.fromJSON() to reconstruct transaction object
 * - Calculate hash of transaction data
 * - Verify proof.transactionHash matches calculated transaction hash
 *
 * For now, we perform structural validation only. Full cryptographic validation
 * happens in Step 5 via SDK's token.verify(trustBase).
 */
function validateTransactionCommitment(txf: TxfToken, txIndex: number): { valid: boolean; reason?: string } {
  const tx = txf.transactions[txIndex];
  if (!tx) {
    return { valid: false, reason: `Transaction ${txIndex} not found` };
  }

  if (!tx.inclusionProof) {
    // Uncommitted transaction - no proof to validate
    return { valid: true };
  }

  const proof = tx.inclusionProof;

  // Verify authenticator is present
  if (!proof.authenticator?.stateHash) {
    return { valid: false, reason: 'Missing authenticator stateHash' };
  }

  // Verify stateHash format
  if (!isValidHexString(proof.authenticator.stateHash, 64)) {
    return { valid: false, reason: 'Invalid authenticator stateHash format' };
  }

  // Verify merkle path is present
  if (!proof.merkleTreePath?.root) {
    return { valid: false, reason: 'Missing merkle tree root' };
  }

  // Verify merkle root format
  if (!isValidHexString(proof.merkleTreePath.root, 64)) {
    return { valid: false, reason: 'Invalid merkle root format' };
  }

  // Verify transactionHash if present
  if (proof.transactionHash && !isValidHexString(proof.transactionHash, 64)) {
    return { valid: false, reason: 'Invalid transactionHash format' };
  }

  // Verify state hash chain integrity
  // Note: Some tokens from faucet/SDK may not have previousStateHash populated.
  // For the first transaction, we can derive it from genesis stateHash.
  // Full cryptographic validation is done by SDK in Step 5.
  if (txIndex === 0) {
    // First transaction should reference genesis state
    const genesisStateHash = txf.genesis?.inclusionProof?.authenticator?.stateHash;
    if (!genesisStateHash) {
      return { valid: false, reason: 'Cannot verify chain - missing genesis stateHash' };
    }

    // If previousStateHash is present, validate it matches genesis
    if (tx.previousStateHash) {
      if (!isValidHexString(tx.previousStateHash, 64)) {
        return { valid: false, reason: 'Invalid previousStateHash format' };
      }
      if (tx.previousStateHash !== genesisStateHash) {
        return { valid: false, reason: `Chain break: previousStateHash doesn't match genesis (expected ${genesisStateHash.slice(0, 16)}..., got ${tx.previousStateHash.slice(0, 16)}...)` };
      }
    }
    // If previousStateHash is missing on first transaction, that's OK - we know it should be genesis stateHash
    // Full SDK validation in Step 5 will verify the actual cryptographic proof
  } else {
    // Subsequent transactions - validate previousStateHash format if present
    // Note: SDK may not populate previousStateHash/newStateHash for transfers
    // Full cryptographic chain validation is done by SDK in Step 5
    if (tx.previousStateHash) {
      if (!isValidHexString(tx.previousStateHash, 64)) {
        return { valid: false, reason: 'Invalid previousStateHash format' };
      }
      // If we have both hashes, verify chain integrity
      const prevTx = txf.transactions[txIndex - 1];
      if (prevTx?.newStateHash && tx.previousStateHash !== prevTx.newStateHash) {
        return { valid: false, reason: `Chain break: previousStateHash doesn't match tx ${txIndex - 1}` };
      }
    }
    // If previousStateHash is missing, that's OK - SDK will validate the cryptographic proof
  }

  return { valid: true };
}

async function step5_validateTokens(ctx: SyncContext): Promise<void> {
  console.log(`🔍 [Step 5] Validate Tokens`);

  if (ctx.tokens.size === 0) {
    console.log(`  No tokens to validate`);
    return;
  }

  const validationService = getTokenValidationService();

  // Convert TxfTokens to LocalTokens for validation
  const tokensToValidate: Token[] = [];
  const tokenIdMap = new Map<string, string>(); // localId -> txfTokenId

  for (const [tokenId, txf] of ctx.tokens) {
    const localToken = txfToToken(tokenId, txf);
    if (localToken) {
      tokensToValidate.push(localToken);
      tokenIdMap.set(localToken.id, tokenId);
    }
  }

  if (tokensToValidate.length === 0) {
    console.log(`  No tokens could be converted for validation`);
    return;
  }

  // Validate all tokens with progress callback
  try {
    const result = await validationService.validateAllTokens(tokensToValidate, {
      batchSize: 10,  // Increased for CPU-bound validation with caching
      onProgress: (completed, total) => {
        if (completed % 10 === 0 || completed === total) {
          console.log(`  Validated ${completed}/${total} tokens`);
        }
      }
    });

    // Process issues - move invalid tokens to Invalid folder
    for (const issue of result.issues) {
      const txfTokenId = tokenIdMap.get(issue.tokenId) || issue.tokenId;
      const txf = ctx.tokens.get(txfTokenId);

      if (txf) {
        ctx.invalid.push({
          token: txf,
          timestamp: Date.now(),
          invalidatedAt: Date.now(),
          reason: 'SDK_VALIDATION' as InvalidReasonCode,
          details: issue.reason
        });
        ctx.tokens.delete(txfTokenId);
        ctx.stats.tokensRemoved++;
        console.warn(`  Token ${txfTokenId.slice(0, 8)}... failed SDK validation: ${issue.reason}`);
      }
    }

    ctx.stats.tokensValidated = tokensToValidate.length;
    console.log(`  ✓ SDK validation: ${result.validTokens.length} valid, ${result.issues.length} invalid`);

  } catch (error) {
    // SDK validation failure is non-fatal - log and continue
    console.warn(`  SDK validation error (non-fatal):`, error);
    ctx.errors.push(`SDK validation error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function step6_deduplicateTokens(ctx: SyncContext): void {
  console.log(`🔀 [Step 6] Deduplicate Tokens`);

  const beforeCount = ctx.tokens.size;
  const uniqueTokens = new Map<string, TxfToken>();

  // Deduplication strategy:
  // - Group tokens by tokenId (the actual token identity)
  // - For each tokenId, keep the most advanced version (more transactions or more committed)
  // - Track unique tokenId:stateHash combinations seen for logging

  const seenStates = new Set<string>();

  for (const [tokenId, txf] of ctx.tokens) {
    const stateHash = getCurrentStateHash(txf) || 'NO_STATE';
    const stateKey = `${tokenId}:${stateHash}`;

    // Track unique states seen
    seenStates.add(stateKey);

    const existing = uniqueTokens.get(tokenId);
    if (!existing) {
      // First time seeing this tokenId
      uniqueTokens.set(tokenId, txf);
      continue;
    }

    // Compare and keep the more advanced version
    if (shouldPreferRemote(existing, txf)) {
      // Current txf is more advanced - replace
      uniqueTokens.set(tokenId, txf);
    }
    // Otherwise keep existing (more advanced)
  }

  // Replace ctx.tokens with deduplicated map
  ctx.tokens.clear();
  for (const [tokenId, txf] of uniqueTokens) {
    ctx.tokens.set(tokenId, txf);
  }

  const afterCount = ctx.tokens.size;
  const duplicatesRemoved = beforeCount - afterCount;
  const uniqueStates = seenStates.size;

  if (duplicatesRemoved > 0) {
    console.log(`  Removed ${duplicatesRemoved} duplicate tokens (${beforeCount} → ${afterCount})`);
    console.log(`  Unique tokenId:stateHash combinations: ${uniqueStates}`);
  } else {
    console.log(`  No duplicates found (${afterCount} tokens)`);
  }
}

async function step7_detectSpentTokens(ctx: SyncContext): Promise<void> {
  console.log(`💸 [Step 7] Detect Spent Tokens`);

  if (ctx.tokens.size === 0) {
    console.log(`  No tokens to check for spent status`);
    return;
  }

  const validationService = getTokenValidationService();

  // Convert TxfTokens to LocalTokens
  const tokensToCheck: Token[] = [];
  const tokenIdMap = new Map<string, string>(); // localId -> txfTokenId

  for (const [tokenId, txf] of ctx.tokens) {
    const localToken = txfToToken(tokenId, txf);
    if (localToken) {
      tokensToCheck.push(localToken);
      tokenIdMap.set(localToken.id, tokenId);
    }
  }

  if (tokensToCheck.length === 0) {
    console.log(`  No tokens could be converted for spent checking`);
    return;
  }

  try {
    // Check spent status against aggregator
    const result = await validationService.checkSpentTokens(
      tokensToCheck,
      ctx.publicKey,
      {
        batchSize: 12,  // Increased for parallel aggregator calls
        onProgress: (completed, total) => {
          if (completed % 15 === 0 || completed === total) {
            console.log(`  Checked ${completed}/${total} tokens for spent status`);
          }
        }
      }
    );

    // Move spent tokens to Sent folder and add tombstones
    for (const spentInfo of result.spentTokens) {
      const txfTokenId = tokenIdMap.get(spentInfo.localId) || spentInfo.tokenId;
      const txf = ctx.tokens.get(txfTokenId);

      if (txf) {
        // Move to Sent folder (include stateHash for tombstone verification lookup)
        ctx.sent.push({
          token: txf,
          timestamp: Date.now(),
          spentAt: Date.now(),
          stateHash: spentInfo.stateHash
        });

        // Add tombstone
        ctx.tombstones.push({
          tokenId: spentInfo.tokenId,
          stateHash: spentInfo.stateHash,
          timestamp: Date.now()
        });

        // Remove from active
        ctx.tokens.delete(txfTokenId);
        ctx.stats.tokensRemoved++;
        ctx.stats.tombstonesAdded++;

        console.log(`  💸 Token ${spentInfo.tokenId.slice(0, 8)}... is SPENT, moved to Sent folder`);
      }
    }

    // Log errors (non-fatal)
    for (const error of result.errors) {
      ctx.errors.push(error);
    }

    console.log(`  ✓ Spent detection: ${result.spentTokens.length} spent, ${tokensToCheck.length - result.spentTokens.length} unspent`);

  } catch (error) {
    // Spent detection failure is non-fatal - log and continue
    console.warn(`  Spent detection error (non-fatal):`, error);
    ctx.errors.push(`Spent detection error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Step 7.5: Verify Tombstones Against Aggregator
 *
 * Tombstones track spent states (tokenId:stateHash).
 * Multi-device sync requires tombstone verification to prevent:
 * - False tombstones from network forks
 * - BFT finality rollbacks before PoW finality
 *
 * OPTIMIZATION: Use Sent folder proofs for local verification (99% faster).
 * When a token is spent, both a tombstone AND a Sent entry are created
 * simultaneously. The Sent entry contains the full inclusion proof, so we
 * can verify locally without querying the aggregator.
 *
 * For each tombstone:
 * 1. Look up matching Sent token by tokenId:stateHash
 * 2. If found: verify proof locally (pure crypto, no network call)
 * 3. If not found (orphan): fall back to aggregator query (parallel batches)
 * 4. If verification fails: remove tombstone, recover token to Active
 */
async function step7_5_verifyTombstones(ctx: SyncContext): Promise<void> {
  const startTime = Date.now();
  console.log(`🔍 [Step 7.5] Verify tombstones against aggregator`);

  if (ctx.tombstones.length === 0) {
    console.log(`  No tombstones to verify`);
    return;
  }

  const validationService = getTokenValidationService();
  const tombstonesToRemove: number[] = [];

  // OPTIMIZATION: Build Sent folder lookup map for O(1) lookups
  // Key: tokenId:stateHash -> SentTokenEntry
  const sentLookupMap = buildSentLookupMap(ctx.sent);
  console.log(`  Built Sent lookup map: ${sentLookupMap.size} entries`);

  // Counters for logging
  let verifiedLocal = 0;
  let verifiedAggregator = 0;

  // Collect orphan tombstones that need aggregator verification
  const orphanTombstones: { index: number; tombstone: TombstoneEntry }[] = [];

  // PHASE 1: Verify tombstones locally using Sent folder proofs
  for (let i = 0; i < ctx.tombstones.length; i++) {
    const tombstone = ctx.tombstones[i];
    const lookupKey = `${tombstone.tokenId}:${tombstone.stateHash}`;
    const sentEntry = sentLookupMap.get(lookupKey);

    if (sentEntry?.token) {
      // FAST PATH: Verify locally using Sent folder proof
      const proof = extractLastInclusionProof(sentEntry.token);
      if (proof) {
        const isSpent = await validationService.verifyInclusionProofLocally(
          proof,
          tombstone.stateHash,
          ctx.publicKey,
          tombstone.tokenId
        );

        if (isSpent) {
          verifiedLocal++;
          continue; // Tombstone verified, keep it
        }
      }
    }

    // Sent entry not found or local verification failed - mark as orphan
    orphanTombstones.push({ index: i, tombstone });
  }

  // PHASE 2: Verify orphan tombstones via aggregator (parallel batches)
  if (orphanTombstones.length > 0) {
    const BATCH_SIZE = 10; // Process 10 tombstones in parallel

    for (let batchStart = 0; batchStart < orphanTombstones.length; batchStart += BATCH_SIZE) {
      const batch = orphanTombstones.slice(batchStart, batchStart + BATCH_SIZE);

      const batchResults = await Promise.all(
        batch.map(async ({ index, tombstone }) => {
          const isSpent = await validationService.isTokenStateSpent(
            tombstone.tokenId,
            tombstone.stateHash,
            ctx.publicKey
          );
          return { index, tombstone, isSpent };
        })
      );

      for (const { index, tombstone, isSpent } of batchResults) {
        if (isSpent) {
          verifiedAggregator++;
        } else {
          console.warn(`  🔄 False tombstone detected: ${tombstone.tokenId.slice(0, 8)}... stateHash=${tombstone.stateHash.slice(0, 16)}...`);
          tombstonesToRemove.push(index);

          // Attempt to recover token from archived/forked storage
          const recoveredToken = await attemptTokenRecovery(ctx, tombstone);
          if (recoveredToken) {
            ctx.tokens.set(tombstone.tokenId, recoveredToken);
            if (!ctx.stats.tokensRecovered) {
              ctx.stats.tokensRecovered = 0;
            }
            ctx.stats.tokensRecovered++;
          }
        }
      }
    }
  }

  // Remove invalid tombstones (reverse order to maintain indices)
  for (const idx of tombstonesToRemove.sort((a, b) => b - a)) {
    ctx.tombstones.splice(idx, 1);
  }

  const elapsedMs = Date.now() - startTime;
  console.log(
    `  ✓ Verified ${ctx.tombstones.length} tombstones in ${elapsedMs}ms ` +
    `(local: ${verifiedLocal}, aggregator: ${verifiedAggregator}, false positives: ${tombstonesToRemove.length})`
  );
}

/**
 * Build a lookup map from Sent folder entries for fast tombstone verification.
 * Key format: tokenId:stateHash -> SentTokenEntry
 *
 * This allows O(1) lookup to find if we have the inclusion proof for a tombstone.
 * Uses entry.stateHash directly (if available), with fallback to computing from token.
 */
function buildSentLookupMap(sent: SentTokenEntry[]): Map<string, SentTokenEntry> {
  const map = new Map<string, SentTokenEntry>();

  for (const entry of sent) {
    if (!entry.token?.genesis?.data?.tokenId) continue;

    const tokenId = entry.token.genesis.data.tokenId;
    // Use stored stateHash (new entries) or compute from token (legacy entries)
    const stateHash = entry.stateHash || getCurrentStateHash(entry.token);

    if (stateHash) {
      const key = `${tokenId}:${stateHash}`;
      map.set(key, entry);
    }
  }

  return map;
}

/**
 * Attempt to recover a token that was falsely tombstoned
 *
 * Checks archived and forked token storage in SyncContext for a matching token.
 * If found, returns the token for restoration to active inventory.
 *
 * NOTE: Per TOKEN_INVENTORY_SPEC.md Section 6.1, we now read from SyncContext
 * instead of WalletRepository, eliminating the dual-ownership race condition.
 */
async function attemptTokenRecovery(ctx: SyncContext, tombstone: TombstoneEntry): Promise<TxfToken | null> {
  // Check archived tokens in SyncContext (loaded in Step 1)
  const archivedToken = ctx.archivedTokens.get(tombstone.tokenId);
  if (archivedToken) {
    console.log(`    ♻️ Recovered from archived: ${tombstone.tokenId.slice(0, 8)}...`);
    return archivedToken;
  }

  // Check forked tokens with exact state match
  const forkedKey = `${tombstone.tokenId}_${tombstone.stateHash}`;
  const forkedToken = ctx.forkedTokens.get(forkedKey);
  if (forkedToken) {
    console.log(`    ♻️ Recovered from forked: ${tombstone.tokenId.slice(0, 8)}... (state: ${tombstone.stateHash.slice(0, 12)}...)`);
    return forkedToken;
  }

  console.log(`    ⚠️ Cannot recover token ${tombstone.tokenId.slice(0, 8)}... - not found in SyncContext archives`);
  return null;
}

function step8_mergeInventory(ctx: SyncContext): void {
  console.log(`📦 [Step 8] Merge Inventory`);

  // Step 8.1: Handle completed transfers (mark as SPENT, move to Sent)
  if (ctx.completedList.length > 0) {
    console.log(`  Processing ${ctx.completedList.length} completed transfers`);
    for (const completed of ctx.completedList) {
      const token = ctx.tokens.get(completed.tokenId);

      if (token) {
        // Verify state hash matches (or proceed if stateHash not available)
        const currentStateHash = getCurrentStateHash(token) ?? '';
        const expectedHash = completed.stateHash ?? '';

        // Match if: both empty (SDK didn't populate stateHash), or exact match
        const hashMatches = (!expectedHash && !currentStateHash) ||
                           (expectedHash && currentStateHash === expectedHash);

        if (hashMatches) {
          // Add tombstone (use tokenId as fallback if no stateHash)
          const tombstoneHash = currentStateHash || completed.tokenId;

          // Move to Sent folder (include stateHash for tombstone verification lookup)
          ctx.sent.push({
            token,
            timestamp: Date.now(),
            spentAt: Date.now(),
            stateHash: tombstoneHash,
          });
          ctx.tokens.delete(completed.tokenId);

          // Add tombstone
          ctx.tombstones.push({
            tokenId: completed.tokenId,
            stateHash: tombstoneHash,
            timestamp: Date.now(),
          });
          ctx.stats.tombstonesAdded++;

          console.log(`  ✓ Marked ${completed.tokenId.slice(0, 8)}... as SPENT`);
        } else {
          console.warn(`  State hash mismatch for ${completed.tokenId.slice(0, 8)}... (expected ${expectedHash.slice(0, 12) || '(empty)'}..., got ${currentStateHash.slice(0, 12) || '(empty)'}...)`);
        }
      }
    }
  }

  // Step 8.2: Detect boomerang tokens (outbox tokens that returned to us)
  //
  // A "boomerang" occurs when:
  // 1. We created an outbox entry to send a token (commitment with previousStateHash = S1)
  // 2. The send succeeded and token was transferred to recipient (state became S2)
  // 3. Recipient sent the token back to us (state became S3)
  // 4. We now have the token again, but with a different state than when we sent it
  //
  // Detection: If we have a token in our inventory that matches an outbox entry's sourceTokenId,
  // AND the token's current state differs from the commitment's previousStateHash,
  // then the token has "boomeranged" back to us and the outbox entry should be removed.
  //
  // Note: If currentStateHash === previousStateHash, the send is still pending (token hasn't moved)

  const boomerangTokens: string[] = [];
  for (const outboxEntry of ctx.outbox) {
    // Check if we have a token matching this outbox entry's source
    const token = ctx.tokens.get(outboxEntry.sourceTokenId);
    if (!token) {
      // Token not in our inventory - send may have succeeded and it's with recipient
      continue;
    }

    const currentStateHash = getCurrentStateHash(token);
    if (!currentStateHash) {
      continue;
    }

    try {
      const commitment = JSON.parse(outboxEntry.commitmentJson);
      const sentFromStateHash = commitment.transactionData?.previousStateHash;

      if (!sentFromStateHash) {
        continue;
      }

      // If current state differs from the state we sent FROM, token has changed
      // This means either: send completed and token came back, OR token was spent elsewhere
      if (currentStateHash !== sentFromStateHash) {
        boomerangTokens.push(outboxEntry.id);
        console.log(`  🪃 Detected boomerang: ${outboxEntry.sourceTokenId.slice(0, 8)}... (state changed from ${sentFromStateHash.slice(0, 12)}... to ${currentStateHash.slice(0, 12)}...)`);
      }
      // If currentStateHash === sentFromStateHash, send is still pending (token hasn't moved yet)
    } catch {
      // Ignore parse errors - commitment might be malformed
    }
  }

  // Remove boomerang entries from outbox
  if (boomerangTokens.length > 0) {
    for (const outboxId of boomerangTokens) {
      const index = ctx.outbox.findIndex(e => e.id === outboxId);
      if (index !== -1) {
        ctx.outbox.splice(index, 1);
      }
    }
  }

  console.log(`  Merge complete: ${ctx.tokens.size} active, ${ctx.sent.length} sent, ${ctx.invalid.length} invalid, ${ctx.outbox.length} outbox, ${boomerangTokens.length} boomerangs removed`);
}

/**
 * Step 8.4: Extract Nametags
 *
 * Filters nametags to only include those owned by the current user.
 * Uses predicate ownership verification to ensure security.
 */
async function step8_4_extractNametags(ctx: SyncContext): Promise<NametagData[]> {
  console.log(`🏷️ [Step 8.4] Extract Nametags`);

  if (ctx.nametags.length === 0) {
    console.log(`  No nametags to filter`);
    return [];
  }

  const userNametags: NametagData[] = [];
  const pubKeyBytes = Buffer.from(ctx.publicKey, 'hex');

  for (const nametag of ctx.nametags) {
    if (!nametag.token) {
      console.warn(`  Skipping nametag ${nametag.name}: missing token data`);
      continue;
    }

    try {
      // Parse the token and verify ownership
      const tokenJson = nametag.token as Record<string, unknown>;

      // Check if token has state with predicate (required for ownership check)
      const stateJson = tokenJson.state as { predicate: string; data: string | null } | undefined;
      if (!stateJson || !stateJson.predicate) {
        console.warn(`  Skipping nametag ${nametag.name}: missing state predicate`);
        continue;
      }

      // Use TokenState.fromJSON to properly parse the hex-encoded CBOR predicate
      const { TokenState } = await import(
        '@unicitylabs/state-transition-sdk/lib/token/TokenState'
      );
      const tokenState = TokenState.fromJSON(stateJson);

      // Use PredicateEngineService to verify ownership
      const { PredicateEngineService } = await import(
        '@unicitylabs/state-transition-sdk/lib/predicate/PredicateEngineService'
      );
      const predicate = await PredicateEngineService.createPredicate(tokenState.predicate);
      const isOwner = await predicate.isOwner(pubKeyBytes);

      if (isOwner) {
        userNametags.push(nametag);
        console.log(`  ✓ ${nametag.name}: owned by current user`);
      } else {
        console.log(`  ✗ ${nametag.name}: not owned by current user (filtered)`);
      }
    } catch (error) {
      // On parse error, include the nametag but log warning
      // This prevents data loss if token format is unexpected
      console.warn(`  ⚠️ ${nametag.name}: ownership check failed, including anyway:`, error);
      userNametags.push(nametag);
    }
  }

  console.log(`  Filtered ${userNametags.length}/${ctx.nametags.length} nametags for current user`);
  return userNametags;
}

/**
 * Step 8.5: Ensure Nametag-Nostr Consistency
 *
 * For each nametag token in the inventory, verify that the nametag binding
 * is registered with Nostr relays. This ensures relays can route token
 * transfer events to the correct identity.
 *
 * Per spec Section 8.5:
 * - Query Nostr relay(s) for existing binding
 * - If binding missing or pubkey mismatch, publish binding
 * - Best-effort, non-blocking (failures don't stop sync)
 * - Security: On-chain ownership is source of truth, Nostr is routing optimization
 * - Skip in NAMETAG mode (read-only operation)
 */
async function step8_5_ensureNametagNostrBinding(ctx: SyncContext): Promise<void> {
  console.log(`🏷️ [Step 8.5] Ensure Nametag-Nostr Consistency`);

  // Skip in NAMETAG mode (read-only operation per spec section 8.5)
  if (ctx.mode === 'NAMETAG') {
    console.log(`  Skipping in NAMETAG mode (read-only)`);
    return;
  }

  if (ctx.nametags.length === 0) {
    console.log(`  No nametags to process`);
    return;
  }

  // Initialize NostrService (fail gracefully if unavailable)
  let nostrService: NostrService;
  try {
    nostrService = NostrService.getInstance(IdentityManager.getInstance());
  } catch (err) {
    console.warn(`  Failed to initialize NostrService:`, err);
    return;
  }

  let published = 0;
  let skipped = 0;
  let failed = 0;

  for (const nametag of ctx.nametags) {
    if (!nametag.name) {
      console.warn(`  Skipping nametag without name`);
      skipped++;
      continue;
    }

    // Clean the nametag name (remove @ prefix if present)
    const cleanName = nametag.name.replace(/^@/, '').trim();

    // Validate cleaned name is not empty
    if (!cleanName) {
      console.warn(`  Skipping nametag with empty name after cleanup`);
      skipped++;
      continue;
    }

    try {
      // Derive the proxy address from nametag name
      // IMPORTANT: Proxy address (where transfers go) is DIFFERENT from owner address (who controls token)
      // The proxy address is deterministically derived from the nametag name itself
      const { ProxyAddress } = await import('@unicitylabs/state-transition-sdk/lib/address/ProxyAddress');
      const proxyAddress = await ProxyAddress.fromNameTag(cleanName);
      const proxyAddressStr = proxyAddress.address;

      // Query relay for existing binding
      const existingPubkey = await nostrService.queryPubkeyByNametag(cleanName);

      if (existingPubkey && existingPubkey === proxyAddressStr) {
        // Binding exists and matches proxy address - no action needed
        console.log(`  ✓ ${cleanName}: binding already registered -> ${proxyAddressStr.slice(0, 12)}...`);
        skipped++;
        continue;
      }

      // Binding missing or address mismatch - publish binding
      // Publish the PROXY ADDRESS (where transfers to @nametag should go), not owner address
      console.log(`  Publishing binding for ${cleanName} -> ${proxyAddressStr.slice(0, 12)}...`);
      const success = await nostrService.publishNametagBinding(cleanName, proxyAddressStr);

      if (success) {
        console.log(`  ✓ ${cleanName}: binding published successfully`);
        published++;
        ctx.stats.nametagsPublished++;
      } else {
        console.warn(`  ✗ ${cleanName}: binding publish failed`);
        failed++;
      }
    } catch (error) {
      // Best-effort - don't fail sync on Nostr errors
      console.warn(`  ✗ ${cleanName}: error ensuring binding:`, error);
      failed++;
    }
  }

  console.log(`  Nametag binding summary: ${published} published, ${skipped} skipped, ${failed} failed (total: ${ctx.nametags.length})`);
}

/**
 * Step 8.5a: Ensure Nametag-Aggregator Registration
 *
 * Per TOKEN_INVENTORY_SPEC.md Section 8.5a:
 * For each nametag, verify the genesis commitment is on the aggregator.
 * If an exclusion proof is returned (authenticator === null), trigger recovery.
 *
 * This is a PROACTIVE check that runs during sync, before any token operations,
 * ensuring users don't get surprised by nametag issues during transfers.
 *
 * @param ctx - Sync context
 */
async function step8_5a_ensureNametagAggregatorRegistration(ctx: SyncContext): Promise<void> {
  console.log(`🏷️ [Step 8.5a] Ensure Nametag-Aggregator Registration`);

  // Skip in NAMETAG mode (read-only operation per spec)
  if (ctx.mode === 'NAMETAG') {
    console.log(`  Skipping in NAMETAG mode (read-only)`);
    return;
  }

  if (ctx.nametags.length === 0) {
    console.log(`  No nametags to process`);
    return;
  }

  let recovered = 0;
  let skipped = 0;
  let failed = 0;

  for (const nametag of ctx.nametags) {
    if (!nametag.name) {
      console.warn(`  Skipping nametag without name`);
      skipped++;
      continue;
    }

    // Check if nametag token has genesis data with salt (required for recovery)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nametagToken = nametag.token as any;
    if (!nametagToken?.genesis?.data?.salt) {
      console.log(`  ⏭️ Skipping ${nametag.name}: no genesis data or salt for recovery`);
      skipped++;
      continue;
    }

    try {
      // Reconstruct MintCommitment to get requestId
      const genesisData = nametagToken.genesis.data;
      const { MintTransactionData } = await import('@unicitylabs/state-transition-sdk/lib/transaction/MintTransactionData');
      const { MintCommitment } = await import('@unicitylabs/state-transition-sdk/lib/transaction/MintCommitment');

      const mintDataJson = {
        tokenId: genesisData.tokenId,
        tokenType: genesisData.tokenType,
        tokenData: genesisData.tokenData || null,
        coinData: genesisData.coinData && genesisData.coinData.length > 0 ? genesisData.coinData : null,
        recipient: genesisData.recipient,
        salt: genesisData.salt,
        recipientDataHash: genesisData.recipientDataHash,
        reason: genesisData.reason ? JSON.parse(genesisData.reason) : null,
      };

      const mintTransactionData = await MintTransactionData.fromJSON(mintDataJson);
      const commitment = await MintCommitment.create(mintTransactionData);
      const requestId = commitment.requestId;

      // Query aggregator for inclusion proof
      const { ServiceProvider } = await import('./ServiceProvider');
      const client = ServiceProvider.stateTransitionClient;
      const response = await client.getInclusionProof(requestId);

      // Check if it's an inclusion proof (has authenticator) vs exclusion proof (authenticator === null)
      if (response.inclusionProof && response.inclusionProof.authenticator !== null) {
        console.log(`  ✓ ${nametag.name}: already on aggregator`);
        skipped++;
        continue;
      }

      // Exclusion proof - need to recover
      console.log(`  ⚠️ ${nametag.name}: NOT on aggregator (exclusion proof), triggering recovery...`);

      // Get NametagService and trigger recovery
      const { NametagService } = await import('./NametagService');
      const nametagService = NametagService.getInstance(IdentityManager.getInstance());

      try {
        const recoveredToken = await nametagService.recoverNametagProofs();
        if (recoveredToken) {
          console.log(`  ✓ ${nametag.name}: recovered successfully`);
          recovered++;
          ctx.stats.nametagsRecovered = (ctx.stats.nametagsRecovered || 0) + 1;
        } else {
          console.warn(`  ✗ ${nametag.name}: recovery returned null`);
          failed++;
        }
      } catch (recoveryError) {
        // Recovery failed - log but don't block sync
        const errMsg = recoveryError instanceof Error ? recoveryError.message : String(recoveryError);
        console.warn(`  ✗ ${nametag.name}: recovery failed: ${errMsg}`);
        failed++;
      }
    } catch (error) {
      // Best-effort - don't fail sync on aggregator check errors
      const errMsg = error instanceof Error ? error.message : String(error);
      console.warn(`  ✗ ${nametag.name}: error checking aggregator: ${errMsg}`);
      failed++;
    }
  }

  console.log(`  Aggregator check summary: ${recovered} recovered, ${skipped} verified/skipped, ${failed} failed (total: ${ctx.nametags.length})`);
}

/**
 * Step 8.6: Recover Nametag-Invalidated Tokens
 *
 * Per TOKEN_INVENTORY_SPEC.md Section 13.26:
 * When tokens were invalidated due to stale embedded nametag proofs, and the
 * nametag proof is now valid, attempt to recover those tokens by:
 * 1. Updating the embedded nametag's inclusion proof within each invalid token
 * 2. Re-validating the token
 * 3. Moving recovered tokens back to active inventory
 *
 * This is triggered on every sync to catch tokens that were invalidated before
 * the nametag was recovered.
 */
async function step8_6_recoverNametagInvalidatedTokens(ctx: SyncContext): Promise<void> {
  console.log(`🔧 [Step 8.6] Recover Nametag-Invalidated Tokens`);

  // Skip if no invalid tokens
  if (ctx.invalid.length === 0) {
    console.log(`  No invalid tokens to recover`);
    return;
  }

  // Skip if no nametag with valid proof
  if (ctx.nametags.length === 0) {
    console.log(`  No nametag available - skipping recovery`);
    return;
  }

  // Get the first nametag (each identity has one nametag)
  const nametagData = ctx.nametags[0];
  const nametagToken = nametagData?.token as TxfToken | undefined;
  if (!nametagToken?.genesis?.data?.tokenId || !nametagToken?.genesis?.inclusionProof) {
    console.log(`  Nametag missing tokenId or inclusion proof - skipping recovery`);
    return;
  }

  const nametagTokenId = nametagToken.genesis.data.tokenId;
  const freshInclusionProof = nametagToken.genesis.inclusionProof;

  // Filter for tokens that failed due to nametag-related SDK_VALIDATION errors
  const nametagFailures = ctx.invalid.filter((entry: InvalidTokenEntry) => {
    if (entry.reason !== "SDK_VALIDATION") return false;
    const details = entry.details || "";
    return (
      details.includes("Inclusion proof verification failed") ||
      details.includes("Nametag verification")
    );
  });

  if (nametagFailures.length === 0) {
    console.log(`  No nametag-related failures found in ${ctx.invalid.length} invalid tokens`);
    return;
  }

  console.log(`  Found ${nametagFailures.length} tokens with nametag-related failures, attempting recovery...`);

  // Get validation service
  const validationService = getTokenValidationService();

  let recovered = 0;
  let stillInvalid = 0;
  const recoveredTokenIds = new Set<string>();

  for (const entry of nametagFailures) {
    const tokenId = entry.token.genesis?.data?.tokenId || "unknown";
    const tokenIdShort = tokenId.slice(0, 8);

    try {
      // Deep clone to avoid mutating original
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tokenClone = JSON.parse(JSON.stringify(entry.token)) as any;

      // Step 1: Refresh the token's own genesis inclusion proof
      if (tokenClone.genesis?.data) {
        console.log(`  🔍 Token ${tokenIdShort}... refreshing genesis proof`);
        const result = await reconstructMintCommitment(tokenClone.genesis);

        if (result.commitment) {
          const derivedRequestId = result.commitment.requestId.toJSON();
          let newGenesisProof = await fetchProofByRequestId(derivedRequestId);

          if (!isInclusionProofNotExclusion(newGenesisProof)) {
            // Try resubmission if exclusion proof or null
            console.log(`  ⚠️ Token ${tokenIdShort}... got exclusion/null, resubmitting genesis...`);
            const submitResult = await submitMintCommitmentToAggregator(result.commitment);

            if (submitResult.success) {
              newGenesisProof = await waitForMintProofWithSDK(result.commitment, 60000);
            }
          }

          if (isInclusionProofNotExclusion(newGenesisProof)) {
            tokenClone.genesis.inclusionProof = newGenesisProof;
            console.log(`  ✅ Token ${tokenIdShort}... genesis proof refreshed`);
          } else {
            console.warn(`  ❌ Token ${tokenIdShort}... could not refresh genesis proof`);
            stillInvalid++;
            continue;
          }
        } else {
          console.warn(`  ❌ Token ${tokenIdShort}... cannot reconstruct commitment: ${result.error}`);
          stillInvalid++;
          continue;
        }
      }

      // Step 1.5: Refresh transaction inclusion proofs (if any)
      // IMPORTANT: requestId is derived from the STATE being spent, NOT from transactionHash!
      // - requestId = RequestId.create(ownerPublicKey, stateHashBeingSpent)
      // - transactionHash is the VALUE stored in the SMT leaf (the tx data hash)
      // For each transaction at index N:
      //   - If N == 0: state being spent = genesis state hash
      //   - If N > 0: state being spent = previous transaction's newStateHash
      if (tokenClone.transactions && Array.isArray(tokenClone.transactions) && tokenClone.transactions.length > 0) {
        console.log(`  🔄 Token ${tokenIdShort}... has ${tokenClone.transactions.length} transaction(s), checking proofs`);

        // Import SDK types for requestId calculation
        const { RequestId } = await import("@unicitylabs/state-transition-sdk/lib/api/RequestId");
        const { DataHash } = await import("@unicitylabs/state-transition-sdk/lib/hash/DataHash");

        let allTxProofsValid = true;

        for (let txIndex = 0; txIndex < tokenClone.transactions.length; txIndex++) {
          const tx = tokenClone.transactions[txIndex];
          const txLabel = `tx #${txIndex}`;

          // Skip if proof is already valid (inclusion, not exclusion)
          if (isInclusionProofNotExclusion(tx.inclusionProof)) {
            console.log(`  ✓ Token ${tokenIdShort}... ${txLabel} proof already valid`);
            continue;
          }

          // Proof is stale - try to refresh
          console.log(`  🔍 Token ${tokenIdShort}... ${txLabel} proof stale, refreshing...`);

          try {
            // Determine the state hash being spent by this transaction
            let stateHashBeingSpent: string;

            if (txIndex === 0) {
              // First transaction spends the genesis state
              // Genesis state hash = tokenId with "0000" prefix, or from genesis.inclusionProof.authenticator.stateHash
              const genesisStateHash = tokenClone.genesis?.inclusionProof?.authenticator?.stateHash;
              if (genesisStateHash) {
                stateHashBeingSpent = genesisStateHash;
              } else {
                // Fallback: use tokenId with "0000" prefix
                stateHashBeingSpent = tokenId.startsWith("0000") ? tokenId : `0000${tokenId}`;
              }
            } else {
              // Subsequent transactions spend the previous transaction's newStateHash
              const prevTx = tokenClone.transactions[txIndex - 1];
              if (!prevTx.newStateHash) {
                console.warn(`  ⚠️ Token ${tokenIdShort}... ${txLabel} missing previous tx newStateHash`);
                allTxProofsValid = false;
                continue;
              }
              stateHashBeingSpent = prevTx.newStateHash;
            }

            // Calculate requestId from state hash being spent
            // requestId = key/leaf position in SMT, derived from (pubKey, stateHash)
            const pubKeyBytes = Buffer.from(ctx.publicKey, "hex");
            const stateHashObj = DataHash.fromJSON(stateHashBeingSpent);
            const requestId = await RequestId.create(pubKeyBytes, stateHashObj);
            const requestIdStr = requestId.toJSON();

            console.log(`  📍 Token ${tokenIdShort}... ${txLabel} requestId derived from state ${stateHashBeingSpent.slice(0, 16)}...`);

            // Fetch fresh proof using the correctly calculated requestId
            let newTxProof = await fetchProofByRequestId(requestIdStr);

            if (!isInclusionProofNotExclusion(newTxProof)) {
              // Proof fetch failed - try outbox recovery (has full commitment for resubmission)
              console.log(`  ⚠️ Token ${tokenIdShort}... ${txLabel} direct fetch failed, trying outbox recovery...`);

              const recovery = await tryRecoverFromOutbox(tokenId, true);

              if (recovery.recovered && recovery.proof && isInclusionProofNotExclusion(recovery.proof)) {
                newTxProof = recovery.proof;
                console.log(`  ✅ Token ${tokenIdShort}... ${txLabel} recovered via outbox`);
              } else {
                // Outbox recovery failed - likely a received token (no outbox entry)
                console.warn(`  ⚠️ Token ${tokenIdShort}... ${txLabel} outbox recovery failed: ${recovery.message}`);
                console.log(`      💡 Hint: If this is a received token, request sender to re-transfer`);
                allTxProofsValid = false;
                continue;
              }
            }

            if (isInclusionProofNotExclusion(newTxProof)) {
              tokenClone.transactions[txIndex] = {
                ...tx,
                inclusionProof: newTxProof,
              };
              console.log(`  ✅ Token ${tokenIdShort}... ${txLabel} proof refreshed`);
            } else {
              console.warn(`  ❌ Token ${tokenIdShort}... ${txLabel} could not refresh proof`);
              allTxProofsValid = false;
            }
          } catch (err) {
            console.warn(`  ❌ Token ${tokenIdShort}... ${txLabel} refresh error:`, err);
            allTxProofsValid = false;
          }
        }

        // If any transaction proof couldn't be refreshed, mark token as still invalid
        if (!allTxProofsValid) {
          console.warn(`  ❌ Token ${tokenIdShort}... one or more transaction proofs could not be refreshed`);
          stillInvalid++;
          continue;
        }
      }

      // Step 2: Update the embedded nametag's inclusion proof within the token
      const tokenWithFixedNametag = updateEmbeddedNametagProof(
        tokenClone as TxfToken,
        nametagTokenId,
        freshInclusionProof
      );

      // Convert to LocalToken for validation
      const localToken = new Token({
        id: tokenId,
        name: entry.token.genesis?.data?.tokenType === UNICITY_TOKEN_TYPE_HEX ? "Nametag" : "Token",
        type: "UCT",
        timestamp: entry.timestamp,
        status: TokenStatus.CONFIRMED,
        amount: entry.token.genesis?.data?.coinData?.[0]?.[1] || "0",
        coinId: entry.token.genesis?.data?.coinData?.[0]?.[0] || "",
        symbol: "UCT",
        jsonData: JSON.stringify(tokenWithFixedNametag),
      });

      // Re-validate with fixed embedded nametag AND refreshed genesis proof
      const validationResult = await validationService.validateToken(localToken);

      if (validationResult.isValid && validationResult.token) {
        // Convert validated Token back to TxfToken for storage
        const recoveredTxf = tokenToTxf(validationResult.token);

        if (recoveredTxf) {
          console.log(`  ✅ Token ${tokenIdShort}... fully recovered`);

          // Move to active inventory
          ctx.tokens.set(tokenId, recoveredTxf);
          ctx.stats.tokensRecovered = (ctx.stats.tokensRecovered || 0) + 1;
          recovered++;

          // Track for removal from invalid list
          recoveredTokenIds.add(tokenId);
        } else {
          console.warn(`  ⚠️ Token ${tokenIdShort}... validated but failed TxfToken conversion`);
          stillInvalid++;
        }
      } else {
        console.log(`  ❌ Token ${tokenIdShort}... still invalid: ${validationResult.reason}`);
        stillInvalid++;
      }
    } catch (err) {
      console.warn(`  ❌ Token ${tokenIdShort}... recovery failed:`, err);
      stillInvalid++;
    }
  }

  // Remove recovered tokens from invalid list
  if (recovered > 0) {
    ctx.invalid = ctx.invalid.filter((entry: InvalidTokenEntry) => {
      const entryTokenId = entry.token.genesis?.data?.tokenId;
      return !entryTokenId || !recoveredTokenIds.has(entryTokenId);
    });
    ctx.uploadNeeded = true; // Content changed, need to sync
    console.log(`  Recovery complete: ${recovered} recovered, ${stillInvalid} still invalid`);
  } else {
    console.log(`  No tokens recovered (${stillInvalid} still invalid)`);
  }
}

/**
 * Update the embedded nametag's inclusion proof within a token.
 *
 * CRITICAL: Each received token has an EMBEDDED copy of the nametag in its `nametags` array.
 * The SDK's Token.verify() validates this embedded nametag, NOT the main stored nametag.
 * This method finds and updates the matching nametag with a fresh inclusion proof.
 */
function updateEmbeddedNametagProof(
  token: TxfToken,
  nametagTokenId: string,
  freshInclusionProof: unknown
): TxfToken {
  // Deep clone to avoid mutating the original
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updatedToken = JSON.parse(JSON.stringify(token)) as any;

  // Check if token has embedded nametags
  if (!updatedToken.nametags || !Array.isArray(updatedToken.nametags)) {
    return updatedToken as TxfToken;
  }

  // Find and update matching nametag(s)
  for (let i = 0; i < updatedToken.nametags.length; i++) {
    const embeddedNametag = updatedToken.nametags[i];

    // Skip if not an object
    if (!embeddedNametag || typeof embeddedNametag !== "object") {
      continue;
    }

    // Match by tokenId
    const embeddedTokenId = embeddedNametag?.genesis?.data?.tokenId;
    if (embeddedTokenId === nametagTokenId && embeddedNametag.genesis) {
      embeddedNametag.genesis.inclusionProof = freshInclusionProof;
    }
  }

  return updatedToken as TxfToken;
}

/**
 * Compare two TxfStorageData objects for content equality.
 * Ignores _meta.version and _meta.lastCid since those change every sync.
 * Returns true if content (tokens, nametags, tombstones, etc.) is identical.
 */
function isContentEqual(a: TxfStorageData, b: TxfStorageData): boolean {
  // Compare nametag
  const nametagA = JSON.stringify(a._nametag || null);
  const nametagB = JSON.stringify(b._nametag || null);
  if (nametagA !== nametagB) return false;

  // Compare tombstones
  const tombstonesA = JSON.stringify(a._tombstones || []);
  const tombstonesB = JSON.stringify(b._tombstones || []);
  if (tombstonesA !== tombstonesB) return false;

  // Compare sent
  const sentA = JSON.stringify(a._sent || []);
  const sentB = JSON.stringify(b._sent || []);
  if (sentA !== sentB) return false;

  // Compare invalid
  const invalidA = JSON.stringify(a._invalid || []);
  const invalidB = JSON.stringify(b._invalid || []);
  if (invalidA !== invalidB) return false;

  // Compare outbox
  const outboxA = JSON.stringify(a._outbox || []);
  const outboxB = JSON.stringify(b._outbox || []);
  if (outboxA !== outboxB) return false;

  // Collect token keys (entries starting with _ that aren't special keys)
  const specialKeys = new Set(['_meta', '_nametag', '_tombstones', '_sent', '_invalid', '_outbox', '_invalidatedNametags', '_mintOutbox']);
  const getTokenKeys = (data: TxfStorageData): string[] => {
    return Object.keys(data).filter(k => !specialKeys.has(k)).sort();
  };

  const tokensKeysA = getTokenKeys(a);
  const tokensKeysB = getTokenKeys(b);

  // Compare token count
  if (tokensKeysA.length !== tokensKeysB.length) return false;

  // Compare token keys
  if (tokensKeysA.join(',') !== tokensKeysB.join(',')) return false;

  // Compare each token's content
  for (const key of tokensKeysA) {
    const tokenA = JSON.stringify(a[key]);
    const tokenB = JSON.stringify(b[key]);
    if (tokenA !== tokenB) return false;
  }

  return true;
}

/**
 * Build TxfStorageData from sync context
 *
 * Helper function to construct storage data structure from current sync state.
 */
function buildStorageDataFromContext(ctx: SyncContext): TxfStorageData {
  // Build TxfStorageData structure
  // Note: timestamp is excluded from _meta for CID stability (same content = same CID)

  // CRITICAL: For IPFS uploads, use remoteVersion + 1 (server expects exactly current + 1)
  // For first upload (no remote data), use localVersion + 1
  // This ensures the server's chain validation passes:
  // - Server has v7 → expects v8 → we send v8 ✓
  // - Local may be ahead (v9) due to failed uploads, but server doesn't know about that
  // - Content is merged from both local and remote, version is just for ordering
  // Note: If remoteVersionRegressed is true, networkErrorOccurred should also be true
  // which blocks upload, so the version calculation here won't matter for IPFS.
  const newVersion = ctx.remoteVersion > 0
    ? ctx.remoteVersion + 1
    : ctx.localVersion + 1;

  const storageData: TxfStorageData = {
    _meta: {
      version: newVersion,
      address: ctx.address,
      ipnsName: ctx.ipnsName,
      formatVersion: '2.0',
      lastCid: ctx.remoteCid || undefined,
    },
  };

  // Add nametag if present
  if (ctx.nametags.length > 0) {
    storageData._nametag = ctx.nametags[0];
  }

  // Add tombstones - deduplicate by tokenId:stateHash to prevent duplicates
  // Duplicates can accumulate from multiple sync cycles detecting the same spent token
  if (ctx.tombstones.length > 0) {
    const seenKeys = new Set<string>();
    const deduped: TombstoneEntry[] = [];
    for (const t of ctx.tombstones) {
      const key = `${t.tokenId}:${t.stateHash}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        deduped.push(t);
      }
    }
    storageData._tombstones = deduped;
    if (deduped.length < ctx.tombstones.length) {
      console.log(`  🧹 Deduplicated tombstones: ${ctx.tombstones.length} → ${deduped.length}`);
    }
  }

  // Add sent tokens - deduplicate by tokenId:stateHash to prevent duplicates
  // Uses getCurrentStateHash to get state from token structure
  if (ctx.sent.length > 0) {
    const seenKeys = new Set<string>();
    const deduped: SentTokenEntry[] = [];
    for (const s of ctx.sent) {
      const tokenId = s.token?.genesis?.data?.tokenId || '';
      const stateHash = getCurrentStateHash(s.token) || 'unknown';
      const key = `${tokenId}:${stateHash}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        deduped.push(s);
      }
    }
    storageData._sent = deduped;
    if (deduped.length < ctx.sent.length) {
      console.log(`  🧹 Deduplicated sent tokens: ${ctx.sent.length} → ${deduped.length}`);
    }
  }

  // Add invalid tokens - deduplicate by tokenId:stateHash to prevent duplicates
  if (ctx.invalid.length > 0) {
    const seenKeys = new Set<string>();
    const deduped: InvalidTokenEntry[] = [];
    for (const i of ctx.invalid) {
      const tokenId = i.token?.genesis?.data?.tokenId || '';
      const stateHash = getCurrentStateHash(i.token) || 'unknown';
      const key = `${tokenId}:${stateHash}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        deduped.push(i);
      }
    }
    storageData._invalid = deduped;
    if (deduped.length < ctx.invalid.length) {
      console.log(`  🧹 Deduplicated invalid tokens: ${ctx.invalid.length} → ${deduped.length}`);
    }
  }

  // Add outbox entries
  if (ctx.outbox.length > 0) {
    storageData._outbox = ctx.outbox;
  }

  // Add active tokens with _<tokenId> keys
  for (const [tokenId, txf] of ctx.tokens) {
    storageData[keyFromTokenId(tokenId)] = txf;
  }

  // Add archived tokens with _archived_<tokenId> keys
  for (const [tokenId, txf] of ctx.archivedTokens) {
    storageData[archivedKeyFromTokenId(tokenId)] = txf;
  }

  // Add forked tokens with _forked_<tokenId>_<stateHash> keys
  for (const [forkedKey, txf] of ctx.forkedTokens) {
    // forkedKey is already in format: tokenId_stateHash
    const [tokenId, stateHash] = forkedKey.split('_');
    if (tokenId && stateHash) {
      storageData[forkedKeyFromTokenIdAndState(tokenId, stateHash)] = txf;
    }
  }

  return storageData;
}

function step9_prepareStorage(ctx: SyncContext): void {
  console.log(`📤 [Step 9] Prepare for Storage`);

  // Per TOKEN_INVENTORY_SPEC.md Section 6.1:
  // "Only inventorySync should be allowed to access the inventory in localStorage!"
  //
  // We write directly to localStorage in TxfStorageData format (the canonical format).
  // WalletRepository should NOT be used here - it uses a different format (StoredWallet)
  // that would conflict with the TxfStorageData format we need for IPFS sync.

  // Build TxfStorageData from context
  // Note: buildStorageDataFromContext increments version internally (ctx.localVersion + 1)
  const storageData = buildStorageDataFromContext(ctx);

  // Read current localStorage to compare content
  const storageKey = STORAGE_KEY_GENERATORS.walletByAddress(ctx.address);
  const storage = getInventoryStorage();
  const existingJson = storage.getItem(storageKey);
  let existingData: TxfStorageData | null = null;
  if (existingJson) {
    try {
      existingData = JSON.parse(existingJson);
    } catch {
      // Malformed JSON - treat as no existing data (will overwrite)
      console.warn(`  ⚠️ Malformed JSON in localStorage, will overwrite`);
    }
  }

  // Compare content (excluding version and lastCid which change every sync)
  // Only write if content actually changed
  if (existingData && isContentEqual(existingData, storageData)) {
    // Content same as localStorage, but check if we have local-only content that needs upload
    if (ctx.hasLocalOnlyContent) {
      console.log(`  📤 Local-only content detected - forcing upload to IPFS`);
      // Fall through to write localStorage and mark upload needed
    } else if (ctx.localVersion > ctx.remoteVersion && ctx.remoteVersion > 0) {
      // Local is ahead of remote - previous upload may have failed
      // Force upload to sync local changes to IPFS
      console.log(`  📤 Local v${ctx.localVersion} ahead of remote v${ctx.remoteVersion} - forcing upload to sync`);
      // Fall through to write localStorage and mark upload needed
    } else {
      console.log(`  ⏭️ No content changes detected`);
      ctx.uploadNeeded = false;

      // If remote version > local version, update local to match remote
      // This prevents re-fetching IPFS data on every reload
      if (ctx.remoteVersion > existingData._meta.version) {
        console.log(`  📥 Updating local version to match remote: ${existingData._meta.version} → ${ctx.remoteVersion}`);
        existingData._meta.version = ctx.remoteVersion;
        storage.setItem(storageKey, JSON.stringify(existingData));
        ctx.localVersion = ctx.remoteVersion;
      } else {
        console.log(`  ⏭️ Skipping localStorage write (version ${existingData._meta.version} is current)`);
        ctx.localVersion = existingData._meta.version;
      }
      return;
    }
  }

  // Content changed - update version and write
  ctx.localVersion = storageData._meta.version;
  storage.setItem(storageKey, JSON.stringify(storageData));
  ctx.uploadNeeded = true;

  // CRITICAL: Store the prepared data for step 10 to avoid double-increment bug
  // Previously, step 10 called buildStorageDataFromContext() again which incremented version,
  // causing localStorage to have version N but IPFS to have version N+1.
  ctx.preparedStorageData = storageData;

  // Dispatch wallet-updated event so UI components refresh
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('wallet-updated'));
  }

  console.log(`  ✓ Wrote to localStorage: version=${storageData._meta.version}, ${ctx.tokens.size} tokens`);
  console.log(`  ✓ Folders: ${ctx.sent.length} sent, ${ctx.invalid.length} invalid, ${ctx.tombstones.length} tombstones`);
}

async function step10_uploadIpfs(ctx: SyncContext): Promise<void> {
  console.log(`📤 [Step 10] Upload to IPFS`);

  const circuitBreaker = getCircuitBreakerService();

  // CRITICAL: Prevent upload if network errors occurred during RECOVERY
  // This prevents overwriting good IPFS data with potentially incomplete data
  if (ctx.networkErrorOccurred) {
    console.log(`  ⏭️ Skipping IPFS upload: network errors during sync (preventing data loss)`);
    return;
  }

  if (!ctx.uploadNeeded) {
    console.log(`  ⏭️ Skipping IPFS upload: no changes to upload`);
    return;
  }

  // Try to get transport (gracefully skip if not available)
  let transport: IpfsTransport | null = null;
  try {
    transport = getIpfsTransport();
  } catch {
    console.log(`  ⏭️ Skipping IPFS upload: transport not available`);
    circuitBreaker.recordIpfsFailure();
    return;
  }

  // Check if transport is initialized
  let initialized = false;
  try {
    initialized = await transport.ensureInitialized();
  } catch (err) {
    console.warn(`  ❌ Transport initialization error:`, err);
    circuitBreaker.recordIpfsFailure();
    return;
  }

  if (!initialized) {
    console.log(`  ⏭️ Skipping IPFS upload: transport not initialized`);
    circuitBreaker.recordIpfsFailure();
    return;
  }

  // CRITICAL FIX: Reuse storage data from step 9 instead of rebuilding
  // This prevents the version double-increment bug where step 10 would call
  // buildStorageDataFromContext() again, incrementing version a second time.
  if (!ctx.preparedStorageData) {
    console.error(`  ❌ BUG: preparedStorageData is null - step 9 didn't run correctly`);
    ctx.errors.push('Internal error: preparedStorageData is null');
    return;
  }
  const storageData = ctx.preparedStorageData;

  // Diagnostic logging: show exactly what we're uploading
  // Token keys are _<tokenId> (e.g., "_abc123..."), not to be confused with
  // special keys like _meta, _sent, etc.
  const tokenKeys = Object.keys(storageData).filter(k => isTokenKey(k));
  const tokenCount = tokenKeys.length;
  const sentCount = storageData._sent?.length || 0;
  const tombstoneCount = storageData._tombstones?.length || 0;
  console.log(`  📦 Upload payload: version=${storageData._meta?.version}, tokens=${tokenCount}, sent=${sentCount}, tombstones=${tombstoneCount}`);
  // Log token IDs to help trace missing tokens (e.g., change tokens from splits)
  if (tokenCount <= 15) {
    const tokenIds = tokenKeys.map(k => tokenIdFromKey(k).slice(0, 8)).join(', ');
    console.log(`  📦 Token IDs: ${tokenIds}`);
  }

  // Upload content to IPFS
  const fastMode = ctx.skipExtendedVerification;
  console.log(`  📤 Uploading content to IPFS...${fastMode ? ' (fast mode)' : ''}`);
  let uploadResult;
  try {
    uploadResult = await transport.uploadContent(storageData, { skipExtendedVerification: fastMode });
  } catch (err) {
    console.warn(`  ❌ IPFS upload error:`, err);
    ctx.errors.push(`IPFS upload error: ${err instanceof Error ? err.message : String(err)}`);
    circuitBreaker.recordIpfsFailure();
    return;
  }

  if (!uploadResult.success) {
    console.warn(`  ❌ IPFS upload failed: ${uploadResult.error}`);
    ctx.errors.push(uploadResult.error || 'IPFS upload failed');
    circuitBreaker.recordIpfsFailure();
    return;
  }

  // IPFS upload succeeded - record success
  circuitBreaker.recordIpfsSuccess();

  ctx.remoteCid = uploadResult.cid;
  transport.setLastCid(uploadResult.cid);
  console.log(`  ✅ Content uploaded: CID=${uploadResult.cid.slice(0, 16)}...`);

  // NOTE: We do NOT overwrite localStorage here.
  // WalletRepository is the authoritative local store (StoredWallet format).
  // The CID is tracked by the transport layer and context.

  // Publish to IPNS
  console.log(`  📡 Publishing to IPNS...${fastMode ? ' (fast mode)' : ''}`);
  const publishResult = await transport.publishIpns(uploadResult.cid, { skipExtendedVerification: fastMode });
  if (publishResult.success) {
    ctx.ipnsPublished = true;
    console.log(`  ✅ IPNS published: seq=${publishResult.sequence}`);

    // Update Version High Water Mark after successful IPNS publish
    // The uploaded version is in the prepared storage data
    const uploadedVersion = ctx.preparedStorageData?._meta?.version;
    if (uploadedVersion && uploadedVersion > ctx.versionHwm) {
      const storage = getInventoryStorage();
      const hwmKey = STORAGE_KEY_GENERATORS.versionHighWaterMark(ctx.address);
      storage.setItem(hwmKey, String(uploadedVersion));
      console.log(`  ✓ Updated version HWM: ${ctx.versionHwm} → ${uploadedVersion}`);
      ctx.versionHwm = uploadedVersion;
    }
  } else {
    console.warn(`  ⚠️ IPNS publish failed (will retry in background): ${publishResult.error}`);
  }
}

// ============================================
// Result Builders
// ============================================

function buildSuccessResult(ctx: SyncContext): SyncResult {
  // Determine status based on IPFS/IPNS state:
  // - SUCCESS: Either no upload needed, or upload + IPNS publish both succeeded
  // - PARTIAL_SUCCESS: Content uploaded but IPNS publish failed
  const hasUploadedContent = ctx.remoteCid !== null && ctx.uploadNeeded;
  const ipnsPublishPending = hasUploadedContent && !ctx.ipnsPublished;
  const status = ipnsPublishPending ? 'PARTIAL_SUCCESS' : 'SUCCESS';

  // If sync completed successfully in NORMAL mode, clear circuit breaker
  const circuitBreaker = getCircuitBreakerService();
  if (status === 'SUCCESS' && ctx.mode === 'NORMAL') {
    circuitBreaker.recordFullSyncSuccess();
  }

  // Get current circuit breaker state for result
  const circuitBreakerState = circuitBreaker.getState();

  // Include recovery stats if RECOVERY mode OR auto-recovery was triggered
  const recoveryStats = (ctx.mode === 'RECOVERY' || ctx.autoRecoveryTriggered) && ctx.recoveryStats.versionsTraversed > 0
    ? ctx.recoveryStats
    : undefined;

  return {
    status,
    syncMode: ctx.mode,
    operationStats: ctx.stats,
    inventoryStats: buildInventoryStats(ctx),
    lastCid: ctx.remoteCid || undefined,
    ipnsName: ctx.ipnsName,
    ipnsPublished: ctx.ipnsPublished,
    ipnsPublishPending,
    syncDurationMs: Date.now() - ctx.startTime,
    timestamp: Date.now(),
    version: ctx.localVersion,
    circuitBreaker: circuitBreakerState,
    validationIssues: ctx.errors.length > 0 ? ctx.errors : undefined,
    recoveryStats,
  };
}

function buildNametagResult(ctx: SyncContext, nametags: NametagData[]): SyncResult {
  return {
    status: 'NAMETAG_ONLY',
    syncMode: 'NAMETAG',
    operationStats: ctx.stats,
    syncDurationMs: Date.now() - ctx.startTime,
    timestamp: Date.now(),
    nametags,
    ipnsPublishPending: false
  };
}

function buildErrorResult(ctx: SyncContext, error: unknown): SyncResult {
  const errorMessage = error instanceof Error ? error.message : String(error);
  return {
    status: 'ERROR',
    syncMode: ctx.mode,
    errorCode: 'UNKNOWN',
    errorMessage,
    operationStats: ctx.stats,
    syncDurationMs: Date.now() - ctx.startTime,
    timestamp: Date.now(),
    circuitBreaker: ctx.circuitBreaker,
    ipnsPublishPending: false
  };
}

function buildInventoryStats(ctx: SyncContext): TokenInventoryStats {
  return {
    activeTokens: ctx.tokens.size,
    sentTokens: ctx.sent.length,
    outboxTokens: ctx.outbox.length,
    invalidTokens: ctx.invalid.length,
    nametagTokens: ctx.nametags.length,
    tombstoneCount: ctx.tombstones.length
  };
}

// ============================================
// READ-ONLY QUERY API
// ============================================
// These functions provide direct read access to localStorage in TxfStorageData format.
// Per TOKEN_INVENTORY_SPEC.md Section 6.1, all writes should go through inventorySync().
// However, read-only queries can access localStorage directly for UI display purposes.

/**
 * Get all active tokens for an address
 * Read-only query - does not trigger sync
 * Supports both TxfStorageData format (new) and StoredWallet format (legacy)
 */
export function getTokensForAddress(address: string): Token[] {
  const storageKey = STORAGE_KEY_GENERATORS.walletByAddress(address);
  const storage = getInventoryStorage();
  const json = storage.getItem(storageKey);
  if (!json) return [];

  try {
    const data = JSON.parse(json) as Record<string, unknown>;
    const tokens: Token[] = [];
    const allKeys = Object.keys(data);
    const tokenKeys = allKeys.filter(k => isTokenKey(k));

    console.log(`📦 [getTokensForAddress] Found ${tokenKeys.length} token keys out of ${allKeys.length} total keys`);

    // Check for new TxfStorageData format (tokens stored as _<tokenId> keys)
    for (const key of allKeys) {
      if (isTokenKey(key)) {
        const txf = data[key] as TxfToken;
        const token = txfToToken(tokenIdFromKey(key), txf);
        if (token) {
          tokens.push(token);
        } else {
          console.warn(`📦 [getTokensForAddress] txfToToken returned null for key ${key}`);
        }
      }
    }

    // If no tokens found, check for legacy StoredWallet format (tokens in array)
    if (tokens.length === 0 && data.tokens && Array.isArray(data.tokens)) {
      // Legacy format: { id, name, address, tokens: Token[], nametag: {...} }
      for (const token of data.tokens as Token[]) {
        if (token && token.id) {
          tokens.push(token);
        }
      }
    }

    console.log(`📦 [getTokensForAddress] Returning ${tokens.length} tokens`);
    return tokens;
  } catch (e) {
    console.warn(`[getTokensForAddress] Failed to parse localStorage data for ${address.slice(0, 20)}...: ${e}`);
    return [];
  }
}

/**
 * Get nametag data for an address
 * Read-only query - does not trigger sync
 * Supports both TxfStorageData format (new) and StoredWallet format (legacy)
 */
export function getNametagForAddress(address: string): NametagData | null {
  const storageKey = STORAGE_KEY_GENERATORS.walletByAddress(address);
  const storage = getInventoryStorage();
  const json = storage.getItem(storageKey);
  if (!json) return null;

  try {
    const data = JSON.parse(json) as Record<string, unknown>;
    // Check new TxfStorageData format first (_nametag)
    if (data._nametag) {
      return data._nametag as NametagData;
    }
    // Fall back to legacy StoredWallet format (nametag)
    if (data.nametag) {
      return data.nametag as NametagData;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Get tombstones for an address
 * Read-only query - does not trigger sync
 * Supports both TxfStorageData format (new) and StoredWallet format (legacy)
 */
export function getTombstonesForAddress(address: string): TombstoneEntry[] {
  const storageKey = STORAGE_KEY_GENERATORS.walletByAddress(address);
  const storage = getInventoryStorage();
  const json = storage.getItem(storageKey);
  if (!json) return [];

  try {
    const data = JSON.parse(json) as Record<string, unknown>;
    // Check new TxfStorageData format first (_tombstones)
    if (data._tombstones && Array.isArray(data._tombstones)) {
      return data._tombstones as TombstoneEntry[];
    }
    // Fall back to legacy StoredWallet format (tombstones)
    if (data.tombstones && Array.isArray(data.tombstones)) {
      return data.tombstones as TombstoneEntry[];
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Get invalidated nametags for an address
 * These are nametags that failed Nostr validation (owned by different pubkey)
 * Read-only query - does not trigger sync
 * Supports both TxfStorageData format (new) and StoredWallet format (legacy)
 */
export function getInvalidatedNametagsForAddress(address: string): InvalidatedNametagEntry[] {
  const storageKey = STORAGE_KEY_GENERATORS.walletByAddress(address);
  const storage = getInventoryStorage();
  const json = storage.getItem(storageKey);
  if (!json) return [];

  try {
    const data = JSON.parse(json) as Record<string, unknown>;
    // Check new TxfStorageData format first (_invalidatedNametags)
    if (data._invalidatedNametags && Array.isArray(data._invalidatedNametags)) {
      return data._invalidatedNametags as InvalidatedNametagEntry[];
    }
    // Fall back to legacy StoredWallet format (invalidatedNametags)
    if (data.invalidatedNametags && Array.isArray(data.invalidatedNametags)) {
      return data.invalidatedNametags as InvalidatedNametagEntry[];
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Check if an address has any tokens
 * Read-only query - does not trigger sync
 */
export function hasTokensForAddress(address: string): boolean {
  return getTokensForAddress(address).length > 0;
}

/**
 * Check if an address has a nametag
 * Read-only query - does not trigger sync
 */
export function checkNametagForAddress(address: string): NametagData | null {
  return getNametagForAddress(address);
}

/**
 * Get metadata version for an address
 * Read-only query - useful for version comparison
 */
export function getVersionForAddress(address: string): number {
  const storageKey = STORAGE_KEY_GENERATORS.walletByAddress(address);
  const storage = getInventoryStorage();
  const json = storage.getItem(storageKey);
  if (!json) return 0;

  try {
    const data = JSON.parse(json) as TxfStorageData;
    return data._meta?.version || 0;
  } catch {
    return 0;
  }
}

/**
 * Get archived tokens for an address
 * Archived tokens are spent tokens kept for recovery purposes
 * Read-only query - does not trigger sync
 * Supports both TxfStorageData format (new) and StoredWallet format (legacy)
 */
export function getArchivedTokensForAddress(address: string): Map<string, TxfToken> {
  const storageKey = STORAGE_KEY_GENERATORS.walletByAddress(address);
  const storage = getInventoryStorage();
  const json = storage.getItem(storageKey);
  const result = new Map<string, TxfToken>();

  if (!json) return result;

  try {
    const data = JSON.parse(json) as Record<string, unknown>;

    // Check new TxfStorageData format first (_archived_<tokenId> keys)
    for (const key of Object.keys(data)) {
      if (isArchivedKey(key)) {
        const txf = data[key] as TxfToken;
        const tokenId = tokenIdFromArchivedKey(key);
        result.set(tokenId, txf);
      }
    }

    // If no archived tokens found, check legacy StoredWallet format (archivedTokens object)
    if (result.size === 0 && data.archivedTokens && typeof data.archivedTokens === 'object') {
      const legacyArchived = data.archivedTokens as Record<string, TxfToken>;
      for (const [tokenId, txf] of Object.entries(legacyArchived)) {
        if (txf) {
          result.set(tokenId, txf);
        }
      }
    }

    return result;
  } catch {
    return result;
  }
}

/**
 * Get forked tokens for an address
 * Forked tokens are tokens saved at specific states for conflict resolution
 * Read-only query - does not trigger sync
 */
export function getForkedTokensForAddress(address: string): Map<string, TxfToken> {
  const storageKey = STORAGE_KEY_GENERATORS.walletByAddress(address);
  const storage = getInventoryStorage();
  const json = storage.getItem(storageKey);
  const result = new Map<string, TxfToken>();

  if (!json) return result;

  try {
    const data = JSON.parse(json) as Record<string, unknown>;

    for (const key of Object.keys(data)) {
      if (isForkedKey(key)) {
        const txf = data[key] as TxfToken;
        const parsed = parseForkedKey(key);
        if (parsed) {
          const forkedKey = `${parsed.tokenId}_${parsed.stateHash}`;
          result.set(forkedKey, txf);
        }
      }
    }

    return result;
  } catch {
    return result;
  }
}

/**
 * Get a specific archived token by tokenId
 * Read-only query - does not trigger sync
 */
export function getArchivedTokenForAddress(address: string, tokenId: string): TxfToken | null {
  const archived = getArchivedTokensForAddress(address);
  return archived.get(tokenId) || null;
}

/**
 * Get a specific forked token by tokenId and stateHash
 * Read-only query - does not trigger sync
 */
export function getForkedTokenForAddress(
  address: string,
  tokenId: string,
  stateHash: string
): TxfToken | null {
  const forked = getForkedTokensForAddress(address);
  return forked.get(`${tokenId}_${stateHash}`) || null;
}

// ============================================
// WRITE API (Wrappers around inventorySync)
// ============================================
// These functions provide convenient write operations that delegate to inventorySync().
// All writes go through the centralized sync pipeline to prevent race conditions.

/**
 * Add a token to the inventory
 * Triggers inventorySync with the token as incoming
 */
export async function addToken(
  address: string,
  publicKey: string,
  ipnsName: string,
  token: Token,
  options?: { local?: boolean }
): Promise<SyncResult> {
  return inventorySync({
    address,
    publicKey,
    ipnsName,
    incomingTokens: [token],
    local: options?.local ?? false,
  });
}

/**
 * Remove a token from the inventory (mark as spent)
 * Triggers inventorySync with the completed transfer info
 */
export async function removeToken(
  address: string,
  publicKey: string,
  ipnsName: string,
  tokenId: string,
  stateHash: string,
  options?: { local?: boolean }
): Promise<SyncResult> {
  return inventorySync({
    address,
    publicKey,
    ipnsName,
    completedList: [{
      tokenId,
      stateHash,
      inclusionProof: {}, // Minimal proof for removal
    }],
    local: options?.local ?? false,
  });
}

/**
 * Set nametag for an address
 * This is a direct localStorage write since nametag is not part of token sync
 */
export function setNametagForAddress(address: string, nametag: NametagData): void {
  const storageKey = STORAGE_KEY_GENERATORS.walletByAddress(address);
  const storage = getInventoryStorage();
  const json = storage.getItem(storageKey);

  let data: TxfStorageData;
  if (json) {
    try {
      data = JSON.parse(json) as TxfStorageData;
    } catch {
      // Parse error - create fresh structure
      // Note: This preserves existing behavior. If corruption is a concern,
      // the data should be recovered from IPFS on next sync.
      data = {
        _meta: {
          version: 1,
          address,
          ipnsName: '',
          formatVersion: '2.0',
        },
      };
    }
  } else {
    data = {
      _meta: {
        version: 1,
        address,
        ipnsName: '',
        formatVersion: '2.0',
      },
    };
  }

  data._nametag = nametag;
  storage.setItem(storageKey, JSON.stringify(data));

  // Dispatch wallet-updated event so UI refreshes
  window.dispatchEvent(new Event('wallet-updated'));
}

/**
 * Clear nametag for an address
 */
export function clearNametagForAddress(address: string): void {
  const storageKey = STORAGE_KEY_GENERATORS.walletByAddress(address);
  const storage = getInventoryStorage();
  const json = storage.getItem(storageKey);
  if (!json) return;

  try {
    const data = JSON.parse(json) as TxfStorageData;
    delete data._nametag;
    storage.setItem(storageKey, JSON.stringify(data));
    window.dispatchEvent(new Event('wallet-updated'));
  } catch {
    // Ignore parse errors
  }
}

/**
 * Save a token directly to localStorage without waiting for sync.
 * Use this for immediate UI updates when sync is blocked.
 * Validation happens in background sync.
 */
export function saveTokenImmediately(address: string, token: Token): void {
  console.log(`💾 [IMMEDIATE] saveTokenImmediately called for token ${token.id.slice(0, 8)}...`);
  console.log(`💾 [IMMEDIATE] Token has jsonData: ${!!token.jsonData}, length: ${token.jsonData?.length || 0}`);

  const storageKey = STORAGE_KEY_GENERATORS.walletByAddress(address);
  const storage = getInventoryStorage();
  const json = storage.getItem(storageKey);

  let data: TxfStorageData;
  if (json) {
    try {
      data = JSON.parse(json) as TxfStorageData;
    } catch {
      data = {
        _meta: {
          version: 1,
          address,
          ipnsName: '',
          formatVersion: '2.0',
        },
      };
    }
  } else {
    data = {
      _meta: {
        version: 1,
        address,
        ipnsName: '',
        formatVersion: '2.0',
      },
    };
  }

  // Convert Token to TxfToken and save
  const txf = tokenToTxf(token);
  if (!txf) {
    console.warn(`💾 [IMMEDIATE] Token ${token.id.slice(0, 8)}... could not be converted to TXF format`);
    // Log more details to understand why
    if (token.jsonData) {
      try {
        const parsed = JSON.parse(token.jsonData);
        console.warn(`💾 [IMMEDIATE] jsonData keys: ${Object.keys(parsed).join(', ')}`);
        console.warn(`💾 [IMMEDIATE] has genesis: ${!!parsed.genesis}, has state: ${!!parsed.state}`);
      } catch (e) {
        console.warn(`💾 [IMMEDIATE] Failed to parse jsonData: ${e}`);
      }
    }
    return;
  }

  // CRITICAL: Use SDK token ID (txf.genesis.data.tokenId) as key, NOT the UI UUID (token.id)
  // This ensures consistency with the normal sync path which uses SDK token ID
  const sdkTokenId = txf.genesis.data.tokenId;
  const tokenKey = `_${sdkTokenId}`;

  // Only save if not already present
  if (!data[tokenKey]) {
    data[tokenKey] = txf;
    data._meta = data._meta || { version: 0, address, ipnsName: '', formatVersion: '2.0' };
    data._meta.version = (data._meta.version || 0) + 1;
    storage.setItem(storageKey, JSON.stringify(data));
    console.log(`💾 [IMMEDIATE] Token ${sdkTokenId.slice(0, 8)}... saved directly to localStorage`);
  }
}

/**
 * Notify UI components of wallet changes via TanStack Query invalidation.
 * This triggers refetch of token and aggregated queries.
 */
export function dispatchWalletUpdated(): void {
  // Use TanStack Query for reactive updates instead of custom events
  // Direct import (not dynamic) to avoid potential memory leaks from repeated imports
  invalidateWalletQueries();
}

// ============================================
// IMPORT FLOW FLAGS
// ============================================
// Session flags for import flow management

const IMPORT_SESSION_FLAG = "sphere_import_in_progress";

/**
 * Mark that we're in an active import flow.
 * During import, credentials are saved BEFORE wallet data, so the safeguard
 * that prevents wallet creation when credentials exist needs to be bypassed.
 * This flag is stored in sessionStorage so it's cleared on browser close.
 */
export function setImportInProgress(): void {
  console.log("📦 [IMPORT] Setting import-in-progress flag");
  sessionStorage.setItem(IMPORT_SESSION_FLAG, "true");
}

/**
 * Clear the import-in-progress flag.
 * Should be called when import completes (success or failure).
 */
export function clearImportInProgress(): void {
  console.log("📦 [IMPORT] Clearing import-in-progress flag");
  sessionStorage.removeItem(IMPORT_SESSION_FLAG);
}

/**
 * Check if we're currently in an import flow.
 */
export function isImportInProgress(): boolean {
  return sessionStorage.getItem(IMPORT_SESSION_FLAG) === "true";
}

// ============================================
// SENT TOKENS MANAGEMENT
// ============================================

/**
 * Get sent tokens for an address (from _sent folder)
 * Used by SenderRecoveryService to check for duplicates
 */
export function getSentTokensForAddress(address: string): SentTokenEntry[] {
  const storageKey = STORAGE_KEY_GENERATORS.walletByAddress(address);
  const storage = getInventoryStorage();
  const json = storage.getItem(storageKey);
  if (!json) return [];

  try {
    const data = JSON.parse(json) as TxfStorageData;
    if (data._sent && Array.isArray(data._sent)) {
      return [...data._sent] as SentTokenEntry[];
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Add a sent token entry to the _sent folder
 * Used by SenderRecoveryService during recovery
 */
export function addSentToken(
  address: string,
  entry: SentTokenEntry
): void {
  const storageKey = STORAGE_KEY_GENERATORS.walletByAddress(address);
  const storage = getInventoryStorage();
  const json = storage.getItem(storageKey);

  let data: TxfStorageData;
  if (json) {
    try {
      data = JSON.parse(json) as TxfStorageData;
    } catch {
      data = {
        _meta: {
          version: 1,
          address,
          ipnsName: '',
          formatVersion: '2.0',
        },
      };
    }
  } else {
    data = {
      _meta: {
        version: 1,
        address,
        ipnsName: '',
        formatVersion: '2.0',
      },
    };
  }

  // Initialize _sent array if needed
  if (!data._sent) {
    data._sent = [];
  }

  // Extract tokenId from TxfToken structure
  const entryTokenId = entry.token?.genesis?.data?.tokenId || '';

  // Check for duplicates by tokenId and timestamp
  const isDuplicate = data._sent.some(
    (existing: SentTokenEntry) => {
      const existingTokenId = existing.token?.genesis?.data?.tokenId || '';
      return existingTokenId === entryTokenId &&
        existing.timestamp === entry.timestamp;
    }
  );

  if (isDuplicate) {
    console.log(`📤 [addSentToken] Skipping duplicate: ${entryTokenId.slice(0, 8)}...`);
    return;
  }

  // Add entry
  data._sent.push(entry);

  // Update version
  data._meta = data._meta || { version: 0, address, ipnsName: '', formatVersion: '2.0' };
  data._meta.version = (data._meta.version || 0) + 1;

  // Save
  storage.setItem(storageKey, JSON.stringify(data));
  console.log(`📤 [addSentToken] Added sent token ${entryTokenId.slice(0, 8)}... to _sent folder`);
}
