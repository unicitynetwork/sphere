/**
 * Inventory Sync Service
 *
 * Implements the 10-step sync flow per TOKEN_INVENTORY_SPEC.md Section 6.1
 * This is the central orchestrator for all token inventory operations.
 */

import type { Token } from '../data/model';
import type {
  SyncMode, SyncResult,
  SyncOperationStats, TokenInventoryStats, CircuitBreakerState,
} from '../types/SyncTypes';
import type { TxfToken, TxfStorageData, SentTokenEntry, InvalidTokenEntry, TombstoneEntry } from './types/TxfTypes';
import type { OutboxEntry } from './types/OutboxTypes';
import type { NametagData } from '../../../../repositories/WalletRepository';
import {
  detectSyncMode,
  shouldSkipIpfs,
  shouldSkipSpentDetection,
  shouldAcquireSyncLock
} from './utils/SyncModeDetector';
import {
  createDefaultSyncOperationStats,
  createDefaultCircuitBreakerState
} from '../types/SyncTypes';
import { isTokenKey, keyFromTokenId, tokenIdFromKey } from './types/TxfTypes';
import type { TxfInclusionProof } from './types/TxfTypes';
import { tokenToTxf, txfToToken, getCurrentStateHash } from './TxfSerializer';
import { STORAGE_KEY_GENERATORS } from '../../../../config/storageKeys';
import { getIpfsHttpResolver, computeCidFromContent } from './IpfsHttpResolver';
import { getTokenValidationService } from './TokenValidationService';
import type { InvalidReasonCode } from '../types/SyncTypes';
import { getAllBackendGatewayUrls } from '../../../../config/ipfs.config';
import { NostrService } from './NostrService';
import { IdentityManager } from './IdentityManager';

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

  // Statistics
  stats: SyncOperationStats;

  // Circuit breaker
  circuitBreaker: CircuitBreakerState;

  // Errors
  errors: string[];
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
  const startTime = Date.now();

  // Detect sync mode based on inputs
  const mode = detectSyncMode({
    local: params.local,
    nametag: params.nametag,
    incomingTokens: params.incomingTokens as Token[] | undefined,
    outboxTokens: params.outboxTokens
  });

  console.log(`🔄 [InventorySync] Starting sync in ${mode} mode`);

  // Initialize context
  const ctx = initializeContext(params, mode, startTime);

  try {
    // NAMETAG mode: simplified flow (Steps 1, 2, 8.4 only)
    if (mode === 'NAMETAG') {
      return await executeNametagSync(ctx, params);
    }

    // All other modes: acquire sync lock
    if (shouldAcquireSyncLock(mode)) {
      // TODO: Integrate with SyncCoordinator
      // For now, proceed without lock
    }

    // Execute full sync pipeline
    return await executeFullSync(ctx, params);

  } catch (error) {
    console.error(`❌ [InventorySync] Error:`, error);
    return buildErrorResult(ctx, error);
  }
}

// ============================================
// Sync Execution Flows
// ============================================

/**
 * Execute NAMETAG mode sync (simplified flow)
 */
async function executeNametagSync(ctx: SyncContext, _params: SyncParams): Promise<SyncResult> {
  // Step 1: Load nametags from localStorage only
  await step1_loadLocalStorage(ctx);

  // Step 2: Load nametags from IPFS
  await step2_loadIpfs(ctx);

  // Step 8.4: Extract nametags for current user (filters for ownership)
  const nametags = await step8_4_extractNametags(ctx);

  return buildNametagResult(ctx, nametags);
}

/**
 * Execute full sync (NORMAL/FAST/LOCAL modes)
 */
async function executeFullSync(ctx: SyncContext, params: SyncParams): Promise<SyncResult> {
  // Step 0: Input Processing
  step0_inputProcessing(ctx, params);

  // Step 1: Load from localStorage
  await step1_loadLocalStorage(ctx);

  // Step 2: Load from IPFS (skip in LOCAL mode)
  if (!shouldSkipIpfs(ctx.mode)) {
    await step2_loadIpfs(ctx);
  }

  // Step 3: Proof Normalization
  step3_normalizeProofs(ctx);

  // Step 4: Commitment Validation
  await step4_validateCommitments(ctx);

  // Step 5: Token Validation
  await step5_validateTokens(ctx);

  // Step 6: Token Deduplication
  step6_deduplicateTokens(ctx);

  // Step 7: Spent Token Detection (skip in FAST/LOCAL mode)
  if (!shouldSkipSpentDetection(ctx.mode)) {
    await step7_detectSpentTokens(ctx);
  }

  // Step 8: Folder Assignment / Merge Inventory
  step8_mergeInventory(ctx);

  // Step 8.4: Filter nametags for current user ownership
  ctx.nametags = await step8_4_extractNametags(ctx);

  // Step 8.5: Ensure nametag bindings are registered with Nostr
  // Best-effort, non-blocking - failures don't stop sync
  await step8_5_ensureNametagNostrBinding(ctx);

  // Step 9: Prepare for Storage
  step9_prepareStorage(ctx);

  // Step 10: Upload to IPFS (skip in LOCAL mode)
  if (ctx.uploadNeeded && !shouldSkipIpfs(ctx.mode)) {
    await step10_uploadIpfs(ctx);
  }

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
    stats: createDefaultSyncOperationStats(),
    circuitBreaker: createDefaultCircuitBreakerState(),
    errors: []
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

  const storageKey = STORAGE_KEY_GENERATORS.walletByAddress(ctx.address);
  const json = localStorage.getItem(storageKey);

  if (!json) {
    console.log(`  No localStorage data found for address ${ctx.address.slice(0, 20)}...`);
    return;
  }

  try {
    const data = JSON.parse(json) as TxfStorageData;

    // NAMETAG mode: only load nametag
    if (ctx.mode === 'NAMETAG') {
      if (data._nametag) {
        ctx.nametags.push(data._nametag);
        console.log(`  Loaded nametag: ${data._nametag.name}`);
      }
      return;
    }

    // Load metadata
    if (data._meta) {
      ctx.localVersion = data._meta.version || 0;
      console.log(`  Loaded metadata: version=${ctx.localVersion}`);
    }

    // Load nametag
    if (data._nametag) {
      ctx.nametags.push(data._nametag);
      console.log(`  Loaded nametag: ${data._nametag.name}`);
    }

    // Load tombstones (state-hash-aware)
    if (data._tombstones && Array.isArray(data._tombstones)) {
      for (const entry of data._tombstones) {
        // Only load TombstoneEntry objects (new format with stateHash)
        if (
          typeof entry === 'object' &&
          entry !== null &&
          'tokenId' in entry &&
          'stateHash' in entry &&
          'timestamp' in entry
        ) {
          ctx.tombstones.push(entry as TombstoneEntry);
        }
        // Discard legacy string format (no state hash info)
      }
      console.log(`  Loaded ${ctx.tombstones.length} tombstones`);
    }

    // Load sent tokens
    if (data._sent && Array.isArray(data._sent)) {
      ctx.sent.push(...(data._sent as SentTokenEntry[]));
      console.log(`  Loaded ${ctx.sent.length} sent tokens`);
    }

    // Load invalid tokens
    if (data._invalid && Array.isArray(data._invalid)) {
      ctx.invalid.push(...(data._invalid as InvalidTokenEntry[]));
      console.log(`  Loaded ${ctx.invalid.length} invalid tokens`);
    }

    // Load outbox entries (merge with input from Step 0)
    if (data._outbox && Array.isArray(data._outbox)) {
      ctx.outbox.push(...(data._outbox as OutboxEntry[]));
      console.log(`  Loaded ${data._outbox.length} outbox entries`);
    }

    // Load active tokens
    let tokenCount = 0;
    for (const key of Object.keys(data)) {
      if (isTokenKey(key)) {
        const txfToken = data[key] as TxfToken;
        if (txfToken && txfToken.genesis?.data?.tokenId) {
          const tokenId = txfToken.genesis.data.tokenId;
          ctx.tokens.set(tokenId, txfToken);
          tokenCount++;
        }
      }
    }
    console.log(`  Loaded ${tokenCount} active tokens from localStorage`);

  } catch (err) {
    console.error(`  Failed to parse localStorage data:`, err);
    ctx.errors.push(`localStorage parse error: ${err}`);
  }
}

async function step2_loadIpfs(ctx: SyncContext): Promise<void> {
  console.log(`🌐 [Step 2] Load from IPFS`);

  const resolver = getIpfsHttpResolver();

  // 1. Resolve IPNS name to get CID and content
  const resolution = await resolver.resolveIpnsName(ctx.ipnsName);

  if (!resolution.success) {
    console.warn(`  IPNS resolution failed: ${resolution.error || 'unknown error'}`);
    return; // Continue with local-only data
  }

  if (!resolution.content) {
    console.log(`  IPNS resolved but no content (new wallet or empty IPNS)`);
    return;
  }

  ctx.remoteCid = resolution.cid || null;
  const remoteData = resolution.content;

  // Extract remote version
  if (remoteData._meta) {
    ctx.remoteVersion = remoteData._meta.version || 0;
    console.log(`  Remote version: ${ctx.remoteVersion}, Local version: ${ctx.localVersion}`);
  }

  // 2. Merge remote tokens into context
  let tokensImported = 0;
  for (const key of Object.keys(remoteData)) {
    if (isTokenKey(key)) {
      const remoteTxf = remoteData[key] as TxfToken;
      if (!remoteTxf || !remoteTxf.genesis?.data?.tokenId) continue;

      const tokenId = tokenIdFromKey(key);
      const localTxf = ctx.tokens.get(tokenId);

      // Prefer remote if: no local, or remote has more transactions
      if (!localTxf || shouldPreferRemote(localTxf, remoteTxf)) {
        ctx.tokens.set(tokenId, remoteTxf);
        if (!localTxf) tokensImported++;
      }
    }
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
  if (remoteData._sent && Array.isArray(remoteData._sent)) {
    const existingKeys = new Set(
      ctx.sent.map(s => {
        const tokenId = s.token.genesis?.data?.tokenId || '';
        const stateHash = getCurrentStateHash(s.token) || '';
        return `${tokenId}:${stateHash}`;
      })
    );
    for (const sentEntry of remoteData._sent as SentTokenEntry[]) {
      const tokenId = sentEntry.token?.genesis?.data?.tokenId;
      const stateHash = getCurrentStateHash(sentEntry.token);
      const key = `${tokenId}:${stateHash}`;
      if (tokenId && stateHash && !existingKeys.has(key)) {
        ctx.sent.push(sentEntry);
        existingKeys.add(key);  // Track newly added to avoid duplicates
      }
    }
  }

  // 5. Merge remote invalid tokens (union merge by tokenId:stateHash)
  // Multiple entries with same tokenId but different stateHash are allowed
  // (a token may fail validation at different states for different reasons)
  if (remoteData._invalid && Array.isArray(remoteData._invalid)) {
    const existingKeys = new Set(
      ctx.invalid.map(i => {
        const tokenId = i.token.genesis?.data?.tokenId || '';
        const stateHash = getCurrentStateHash(i.token) || '';
        return `${tokenId}:${stateHash}`;
      })
    );
    for (const invalidEntry of remoteData._invalid as InvalidTokenEntry[]) {
      const tokenId = invalidEntry.token?.genesis?.data?.tokenId;
      const stateHash = getCurrentStateHash(invalidEntry.token);
      const key = `${tokenId}:${stateHash}`;
      if (tokenId && stateHash && !existingKeys.has(key)) {
        ctx.invalid.push(invalidEntry);
        existingKeys.add(key);  // Track newly added to avoid duplicates
      }
    }
  }

  // 6. Merge remote nametag if present
  if (remoteData._nametag && ctx.nametags.length === 0) {
    ctx.nametags.push(remoteData._nametag);
    console.log(`  Imported nametag: ${remoteData._nametag.name}`);
  }

  ctx.stats.tokensImported = tokensImported;
  console.log(`  ✓ Loaded from IPFS: ${tokensImported} new tokens, ${ctx.tombstones.length} tombstones`);
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

function step3_normalizeProofs(ctx: SyncContext): void {
  console.log(`📋 [Step 3] Normalize Proofs`);

  let normalizedCount = 0;

  for (const [_tokenId, txf] of ctx.tokens) {
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
 *
 * Note: Full cryptographic proof verification (signature validation, merkle path)
 * is performed by the Unicity SDK in Step 5 via TokenValidationService.
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

  // Verify transactionHash is present and properly formatted
  if (!proof.transactionHash) {
    return { valid: false, reason: 'Missing transactionHash' };
  }

  if (!isValidHexString(proof.transactionHash, 64)) {
    return { valid: false, reason: 'Invalid transactionHash format' };
  }

  // Verify genesis data is present (needed to verify transaction hash)
  if (!txf.genesis.data?.tokenId) {
    return { valid: false, reason: 'Missing genesis data tokenId' };
  }

  return { valid: true };
}

/**
 * Validate transaction commitment matches inclusion proof.
 *
 * Step 4 Validation for state transitions:
 * - State hash chain integrity: previousStateHash links correctly
 * - Format validation: All hashes are valid hex strings
 * - Structural integrity: Required proof fields present
 *
 * Note: Full cryptographic proof verification (signature validation, merkle path)
 * is performed by the Unicity SDK in Step 5 via TokenValidationService.
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

  // Verify previousStateHash format
  if (!tx.previousStateHash || !isValidHexString(tx.previousStateHash, 64)) {
    return { valid: false, reason: 'Invalid or missing previousStateHash' };
  }

  // Verify state hash chain integrity
  if (txIndex === 0) {
    // First transaction should reference genesis state
    const genesisStateHash = txf.genesis?.inclusionProof?.authenticator?.stateHash;
    if (!genesisStateHash) {
      return { valid: false, reason: 'Cannot verify chain - missing genesis stateHash' };
    }
    if (tx.previousStateHash !== genesisStateHash) {
      return { valid: false, reason: `Chain break: previousStateHash doesn't match genesis (expected ${genesisStateHash.slice(0, 16)}..., got ${tx.previousStateHash.slice(0, 16)}...)` };
    }
  } else {
    // Subsequent transactions should reference previous tx's new state
    const prevTx = txf.transactions[txIndex - 1];
    if (prevTx?.newStateHash && tx.previousStateHash !== prevTx.newStateHash) {
      return { valid: false, reason: `Chain break: previousStateHash doesn't match tx ${txIndex - 1}` };
    }
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
      batchSize: 5,
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
        batchSize: 3,
        onProgress: (completed, total) => {
          if (completed % 5 === 0 || completed === total) {
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
        // Move to Sent folder
        ctx.sent.push({
          token: txf,
          timestamp: Date.now(),
          spentAt: Date.now()
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

function step8_mergeInventory(ctx: SyncContext): void {
  console.log(`📦 [Step 8] Merge Inventory`);

  // Step 8.1: Handle completed transfers (mark as SPENT, move to Sent)
  if (ctx.completedList.length > 0) {
    console.log(`  Processing ${ctx.completedList.length} completed transfers`);
    for (const completed of ctx.completedList) {
      const token = ctx.tokens.get(completed.tokenId);

      if (token) {
        // Verify state hash matches
        const currentStateHash = getCurrentStateHash(token);
        if (currentStateHash === completed.stateHash) {
          // Move to Sent folder
          ctx.sent.push({
            token,
            timestamp: Date.now(),
            spentAt: Date.now(),
          });
          ctx.tokens.delete(completed.tokenId);

          // Add tombstone
          ctx.tombstones.push({
            tokenId: completed.tokenId,
            stateHash: completed.stateHash,
            timestamp: Date.now(),
          });

          console.log(`  ✓ Marked ${completed.tokenId.slice(0, 8)}... as SPENT`);
        } else {
          console.warn(`  State hash mismatch for ${completed.tokenId.slice(0, 8)}... (expected ${completed.stateHash.slice(0, 12)}..., got ${currentStateHash?.slice(0, 12)}...)`);
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
      const state = tokenJson.state as Record<string, unknown> | undefined;
      if (!state || !state.predicate) {
        console.warn(`  Skipping nametag ${nametag.name}: missing state predicate`);
        continue;
      }

      // Use PredicateEngineService to verify ownership
      const { PredicateEngineService } = await import(
        '@unicitylabs/state-transition-sdk/lib/predicate/PredicateEngineService'
      );
      const predicate = await PredicateEngineService.createPredicate(state.predicate as Uint8Array);
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

function step9_prepareStorage(ctx: SyncContext): void {
  console.log(`📤 [Step 9] Prepare for Storage`);

  // Build TxfStorageData structure
  const storageData: TxfStorageData = {
    _meta: {
      version: ctx.localVersion + 1, // Increment version
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

  // Add tombstones
  if (ctx.tombstones.length > 0) {
    storageData._tombstones = ctx.tombstones;
  }

  // Add sent tokens
  if (ctx.sent.length > 0) {
    storageData._sent = ctx.sent;
  }

  // Add invalid tokens
  if (ctx.invalid.length > 0) {
    storageData._invalid = ctx.invalid;
  }

  // Add outbox entries
  if (ctx.outbox.length > 0) {
    storageData._outbox = ctx.outbox;
  }

  // Add active tokens with _<tokenId> keys
  for (const [tokenId, txf] of ctx.tokens) {
    storageData[keyFromTokenId(tokenId)] = txf;
  }

  // Write to localStorage
  const storageKey = STORAGE_KEY_GENERATORS.walletByAddress(ctx.address);
  const json = JSON.stringify(storageData);
  localStorage.setItem(storageKey, json);

  // Update local version in context
  ctx.localVersion = storageData._meta.version;

  // Set upload flag if tokens changed
  ctx.uploadNeeded = true;

  console.log(`  ✓ Prepared storage: version=${ctx.localVersion}, ${ctx.tokens.size} tokens, ${json.length} bytes`);
  console.log(`  📝 Written to localStorage: ${storageKey}`);
}

async function step10_uploadIpfs(ctx: SyncContext): Promise<void> {
  console.log(`☁️ [Step 10] Upload to IPFS`);

  // Skip upload if not needed (no changes or LOCAL mode)
  if (!ctx.uploadNeeded) {
    console.log(`  ⏭️ No upload needed (no changes)`);
    return;
  }

  // 1. Read the prepared TxfStorageData from localStorage
  const storageKey = STORAGE_KEY_GENERATORS.walletByAddress(ctx.address);
  const json = localStorage.getItem(storageKey);
  if (!json) {
    console.error(`  ❌ No storage data found at ${storageKey}`);
    ctx.errors.push('No storage data to upload');
    return;
  }

  let storageData: TxfStorageData;
  try {
    storageData = JSON.parse(json) as TxfStorageData;
  } catch (e) {
    console.error(`  ❌ Failed to parse storage data:`, e);
    ctx.errors.push('Failed to parse storage data for upload');
    return;
  }

  // 2. Get configured gateways
  const gatewayUrls = getAllBackendGatewayUrls();
  if (gatewayUrls.length === 0) {
    console.warn(`  ⚠️ No IPFS gateways configured - skipping upload`);
    ctx.errors.push('No IPFS gateways configured');
    return;
  }

  // 3. Compute expected CID for verification
  let expectedCid: string;
  try {
    expectedCid = await computeCidFromContent(storageData);
    console.log(`  📋 Expected CID: ${expectedCid.slice(0, 16)}...`);
  } catch (e) {
    console.error(`  ❌ Failed to compute CID:`, e);
    ctx.errors.push('Failed to compute content CID');
    return;
  }

  // 4. Check if CID changed from last sync
  const previousCid = storageData._meta?.lastCid;
  if (previousCid === expectedCid) {
    console.log(`  ✓ CID unchanged (${expectedCid.slice(0, 16)}...) - skipping upload`);
    ctx.remoteCid = expectedCid;
    return;
  }

  // 5. Upload to all gateways in parallel
  console.log(`  📤 Uploading to ${gatewayUrls.length} IPFS node(s)...`);

  const jsonBlob = new Blob([json], { type: 'application/json' });

  const uploadPromises = gatewayUrls.map(async (gatewayUrl) => {
    try {
      const formData = new FormData();
      formData.append('file', jsonBlob, 'wallet.json');

      const response = await fetch(
        `${gatewayUrl}/api/v0/add?pin=true&cid-version=1`,
        {
          method: 'POST',
          body: formData,
          signal: AbortSignal.timeout(30000), // 30s timeout
        }
      );

      if (response.ok) {
        const result = await response.json();
        const hostname = new URL(gatewayUrl).hostname;
        const returnedCid = result.Hash || result.Cid;
        console.log(`    ✓ Uploaded to ${hostname}: ${returnedCid?.slice(0, 16)}...`);
        return { success: true, host: gatewayUrl, cid: returnedCid };
      }

      const errorText = await response.text().catch(() => '');
      console.warn(`    ⚠️ Upload to ${new URL(gatewayUrl).hostname} failed: HTTP ${response.status}`);
      return { success: false, host: gatewayUrl, error: `HTTP ${response.status}: ${errorText.slice(0, 100)}` };
    } catch (error) {
      const hostname = new URL(gatewayUrl).hostname;
      console.warn(`    ⚠️ Upload to ${hostname} failed:`, error);
      return { success: false, host: gatewayUrl, error: error instanceof Error ? error.message : String(error) };
    }
  });

  const results = await Promise.allSettled(uploadPromises);
  const successful = results.filter(
    (r): r is PromiseFulfilledResult<{ success: true; host: string; cid: string }> =>
      r.status === 'fulfilled' && r.value.success
  );

  if (successful.length === 0) {
    console.error(`  ❌ Upload failed on all gateways`);
    ctx.errors.push('IPFS upload failed on all gateways');
    return;
  }

  console.log(`  ✓ Content uploaded to ${successful.length}/${gatewayUrls.length} nodes`);

  // 6. Verify the returned CID matches expected
  const returnedCid = successful[0].value.cid;
  if (returnedCid !== expectedCid) {
    console.warn(`  ⚠️ CID mismatch: expected ${expectedCid.slice(0, 16)}..., got ${returnedCid?.slice(0, 16)}...`);
    // Non-fatal - use the returned CID (gateway may use different encoding)
  }

  // 7. Update context with CID
  ctx.remoteCid = returnedCid || expectedCid;

  // 8. Update localStorage meta with new CID
  storageData._meta.lastCid = ctx.remoteCid;
  localStorage.setItem(storageKey, JSON.stringify(storageData));

  console.log(`  ✓ Upload complete: CID=${ctx.remoteCid.slice(0, 16)}...`);

  // NOTE: IPNS publishing is handled by IpfsStorageService's background retry loop.
  // For now, we mark ipnsPublishPending in the result to trigger retry.
  // Future enhancement: Integrate IPNS publishing directly here.
  console.log(`  ℹ️ IPNS publish pending (to be handled by background retry)`);
}

// ============================================
// Result Builders
// ============================================

function buildSuccessResult(ctx: SyncContext): SyncResult {
  // IPFS upload succeeded but IPNS publish is handled separately
  // Mark as PARTIAL_SUCCESS with ipnsPublishPending=true if content was uploaded
  const hasUploadedContent = ctx.remoteCid !== null && ctx.uploadNeeded;

  return {
    status: hasUploadedContent ? 'PARTIAL_SUCCESS' : 'SUCCESS',
    syncMode: ctx.mode,
    operationStats: ctx.stats,
    inventoryStats: buildInventoryStats(ctx),
    lastCid: ctx.remoteCid || undefined,
    ipnsName: ctx.ipnsName,
    ipnsPublished: false,  // We don't publish IPNS in step10 currently
    ipnsPublishPending: hasUploadedContent,  // IPNS publish needed if we uploaded
    syncDurationMs: Date.now() - ctx.startTime,
    timestamp: Date.now(),
    version: ctx.localVersion,
    circuitBreaker: ctx.circuitBreaker,
    validationIssues: ctx.errors.length > 0 ? ctx.errors : undefined
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
