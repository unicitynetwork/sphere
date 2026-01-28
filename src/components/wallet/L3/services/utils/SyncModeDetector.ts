/**
 * Sync Mode Detection Utility
 *
 * Implements mode detection logic per TOKEN_INVENTORY_SPEC.md Section 6.1
 * Modes are mutually exclusive with precedence: LOCAL > NAMETAG > FAST > NORMAL
 */

import type { SyncMode, CircuitBreakerState } from '../../types/SyncTypes';
import type { OutboxEntry } from '../types/OutboxTypes';
import type { Token } from '../../data/model';
import type { CompletedTransfer } from '../types/QueueTypes';
import type { PaymentSession } from '../../types/InstantTransferTypes';

/**
 * Parameters for sync mode detection
 */
export interface SyncModeParams {
  /** Force LOCAL mode (skip IPFS reads/writes) */
  local?: boolean;

  /** Force NAMETAG mode (fetch nametag token only) */
  nametag?: boolean;

  /** Recovery depth for RECOVERY mode (0 = unlimited, >0 = max versions to traverse) */
  recoveryDepth?: number;

  /** Incoming tokens from Nostr/peer transfer (triggers FAST mode) */
  incomingTokens?: Token[] | null;

  /** Outbox tokens pending send (triggers FAST mode) */
  outboxTokens?: OutboxEntry[] | null;

  /** Completed transfers with proof (triggers FAST mode) */
  completedList?: CompletedTransfer[] | null;

  /** Circuit breaker state (may auto-activate LOCAL mode) */
  circuitBreaker?: CircuitBreakerState;

  /** Enable INSTANT_SEND mode (skip IPFS reads, Nostr-first) */
  instantSend?: boolean;

  /** Enable INSTANT_RECEIVE mode (immediate localStorage, deferred IPFS) */
  instantReceive?: boolean;

  /** Associated payment session (for instant modes) */
  paymentSession?: PaymentSession;
}

/**
 * Detects sync mode based on input parameters and circuit breaker state
 *
 * Precedence Order (Section 6.1):
 * 1. LOCAL = true or circuit breaker active → LOCAL mode
 * 2. recoveryDepth set (>=0) → RECOVERY mode
 * 3. NAMETAG = true → NAMETAG mode
 * 4. incomingTokens OR outboxTokens OR completedList non-empty → FAST mode
 * 5. Default → NORMAL mode
 *
 * @example
 * // Force LOCAL mode
 * detectSyncMode({ local: true }); // Returns 'LOCAL'
 *
 * @example
 * // RECOVERY mode with depth limit
 * detectSyncMode({ recoveryDepth: 10 }); // Returns 'RECOVERY'
 *
 * @example
 * // FAST mode from incoming tokens
 * detectSyncMode({ incomingTokens: [token] }); // Returns 'FAST'
 *
 * @example
 * // Default NORMAL mode
 * detectSyncMode({}); // Returns 'NORMAL'
 */
export function detectSyncMode(params: SyncModeParams): SyncMode {
  const {
    local = false,
    nametag = false,
    recoveryDepth,
    incomingTokens,
    outboxTokens,
    completedList,
    circuitBreaker,
    instantSend = false,
    instantReceive = false,
    paymentSession
  } = params;

  // Precedence 1: Explicit LOCAL flag
  if (local === true) {
    return 'LOCAL';
  }

  // Precedence 1b: Circuit breaker auto-activates LOCAL mode
  if (circuitBreaker?.localModeActive === true) {
    return 'LOCAL';
  }

  // Precedence 2: RECOVERY mode (explicit recovery depth set)
  // Note: recoveryDepth=0 means unlimited recovery, so we check !== undefined
  if (recoveryDepth !== undefined && recoveryDepth >= 0) {
    return 'RECOVERY';
  }

  // Precedence 3: NAMETAG mode
  if (nametag === true) {
    return 'NAMETAG';
  }

  // Precedence 4: INSTANT_SEND mode (v3.5 - Nostr-first delivery)
  if (instantSend && paymentSession?.direction === 'SEND') {
    return 'INSTANT_SEND';
  }

  // Precedence 5: INSTANT_RECEIVE mode (v3.5 - immediate localStorage)
  if (instantReceive && paymentSession?.direction === 'RECEIVE') {
    return 'INSTANT_RECEIVE';
  }

  // Precedence 6: FAST mode (incoming OR outbox OR completed non-empty)
  const hasIncoming = Array.isArray(incomingTokens) && incomingTokens.length > 0;
  const hasOutbox = Array.isArray(outboxTokens) && outboxTokens.length > 0;
  const hasCompleted = Array.isArray(completedList) && completedList.length > 0;

  if (hasIncoming || hasOutbox || hasCompleted) {
    return 'FAST';
  }

  // Precedence 7: Default to NORMAL
  return 'NORMAL';
}

/**
 * Checks if the current mode should skip IPFS operations
 * LOCAL mode skips all IPFS read/write operations
 * Also skips if IPFS is disabled via VITE_ENABLE_IPFS=false
 */
export function shouldSkipIpfs(mode: SyncMode): boolean {
  // Check if IPFS is disabled via environment variable
  const ipfsDisabled = import.meta.env.VITE_ENABLE_IPFS === 'false';
  return mode === 'LOCAL' || ipfsDisabled;
}

/**
 * Checks if the current mode should skip IPFS reads (but may still write)
 * INSTANT_SEND skips IPFS reads for speed but writes are deferred to background
 */
export function shouldSkipIpfsRead(mode: SyncMode): boolean {
  return mode === 'INSTANT_SEND' || mode === 'LOCAL';
}

/**
 * Checks if the current mode should skip spent detection (Step 7)
 * FAST, LOCAL, and INSTANT modes skip spent detection for speed
 */
export function shouldSkipSpentDetection(mode: SyncMode): boolean {
  return mode === 'FAST' || mode === 'LOCAL' || mode === 'INSTANT_SEND' || mode === 'INSTANT_RECEIVE';
}

/**
 * Checks if the mode is an instant transfer mode
 */
export function isInstantMode(mode: SyncMode): boolean {
  return mode === 'INSTANT_SEND' || mode === 'INSTANT_RECEIVE';
}

/**
 * Checks if the current mode is read-only (no IPFS writes)
 * NAMETAG mode is read-only
 */
export function isReadOnlyMode(mode: SyncMode): boolean {
  return mode === 'NAMETAG';
}

/**
 * Checks if the current mode should acquire sync lock
 * NAMETAG mode does NOT acquire lock (allows parallel reads)
 */
export function shouldAcquireSyncLock(mode: SyncMode): boolean {
  return mode !== 'NAMETAG';
}
