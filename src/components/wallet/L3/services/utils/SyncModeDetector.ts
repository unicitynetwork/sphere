/**
 * Sync Mode Detection Utility
 *
 * Implements mode detection logic per TOKEN_INVENTORY_SPEC.md Section 6.1
 * Modes are mutually exclusive with precedence: LOCAL > NAMETAG > FAST > NORMAL
 */

import type { SyncMode, CircuitBreakerState } from '../../types/SyncTypes';
import type { OutboxEntry } from '../types/OutboxTypes';
import type { Token } from '../../data/model';

/**
 * Parameters for sync mode detection
 */
export interface SyncModeParams {
  /** Force LOCAL mode (skip IPFS reads/writes) */
  local?: boolean;

  /** Force NAMETAG mode (fetch nametag token only) */
  nametag?: boolean;

  /** Incoming tokens from Nostr/peer transfer (triggers FAST mode) */
  incomingTokens?: Token[] | null;

  /** Outbox tokens pending send (triggers FAST mode) */
  outboxTokens?: OutboxEntry[] | null;

  /** Circuit breaker state (may auto-activate LOCAL mode) */
  circuitBreaker?: CircuitBreakerState;
}

/**
 * Detects sync mode based on input parameters and circuit breaker state
 *
 * Precedence Order (Section 6.1):
 * 1. LOCAL = true or circuit breaker active → LOCAL mode
 * 2. NAMETAG = true → NAMETAG mode
 * 3. incomingTokens OR outboxTokens non-empty → FAST mode
 * 4. Default → NORMAL mode
 *
 * @example
 * // Force LOCAL mode
 * detectSyncMode({ local: true }); // Returns 'LOCAL'
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
    incomingTokens,
    outboxTokens,
    circuitBreaker
  } = params;

  // Precedence 1: Explicit LOCAL flag
  if (local === true) {
    return 'LOCAL';
  }

  // Precedence 1b: Circuit breaker auto-activates LOCAL mode
  if (circuitBreaker?.localModeActive === true) {
    return 'LOCAL';
  }

  // Precedence 2: NAMETAG mode
  if (nametag === true) {
    return 'NAMETAG';
  }

  // Precedence 3: FAST mode (either incoming OR outbox non-empty)
  const hasIncoming = Array.isArray(incomingTokens) && incomingTokens.length > 0;
  const hasOutbox = Array.isArray(outboxTokens) && outboxTokens.length > 0;

  if (hasIncoming || hasOutbox) {
    return 'FAST';
  }

  // Precedence 4: Default to NORMAL
  return 'NORMAL';
}

/**
 * Checks if the current mode should skip IPFS operations
 * LOCAL mode skips all IPFS read/write operations
 */
export function shouldSkipIpfs(mode: SyncMode): boolean {
  return mode === 'LOCAL';
}

/**
 * Checks if the current mode should skip spent detection (Step 7)
 * FAST and LOCAL modes skip spent detection for speed
 */
export function shouldSkipSpentDetection(mode: SyncMode): boolean {
  return mode === 'FAST' || mode === 'LOCAL';
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
