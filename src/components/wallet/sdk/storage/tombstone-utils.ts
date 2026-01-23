/**
 * Tombstone Utilities (Platform-Independent)
 *
 * Tombstones track spent token states to prevent re-importing of
 * tokens that have been transferred or burned. Each tombstone
 * uniquely identifies a token state by tokenId AND stateHash,
 * allowing the same token to return with a new state after a transfer.
 */

import type { TombstoneEntry, TxfToken } from '../types/txf';
import { getCurrentStateHash } from '../types/txf';

// ==========================================
// Types
// ==========================================

/**
 * Result of validating tombstones against actual tokens
 */
export interface TombstoneValidationResult {
  /** Tombstones that point to valid spent states */
  validTombstones: TombstoneEntry[];
  /** Tombstones that don't match any known token */
  invalidTombstones: TombstoneEntry[];
  /** Tokens that were tombstoned but shouldn't be (still valid) */
  tokensToRestore: Array<{ tokenId: string; txf: TxfToken }>;
}

/**
 * Result of checking if a token is tombstoned
 */
export interface TombstoneCheckResult {
  /** Whether the token's current state is tombstoned */
  isTombstoned: boolean;
  /** The matching tombstone entry if found */
  tombstone?: TombstoneEntry;
}

// ==========================================
// Core Functions
// ==========================================

/**
 * Build a Set of tombstone keys for fast lookup
 * Key format: "tokenId:stateHash"
 */
export function buildTombstoneKeySet(tombstones: TombstoneEntry[]): Set<string> {
  const keySet = new Set<string>();
  for (const t of tombstones) {
    const key = `${t.tokenId}:${t.stateHash}`;
    keySet.add(key);
  }
  return keySet;
}

/**
 * Build a Map of tombstones by tokenId for lookup
 */
export function buildTombstoneMap(
  tombstones: TombstoneEntry[]
): Map<string, TombstoneEntry[]> {
  const map = new Map<string, TombstoneEntry[]>();
  for (const t of tombstones) {
    const existing = map.get(t.tokenId) || [];
    existing.push(t);
    map.set(t.tokenId, existing);
  }
  return map;
}

/**
 * Check if a specific token state is tombstoned
 *
 * @param tokenId - The token ID to check
 * @param stateHash - The state hash to check
 * @param tombstoneSet - Set of tombstone keys (from buildTombstoneKeySet)
 */
export function isTombstoned(
  tokenId: string,
  stateHash: string,
  tombstoneSet: Set<string>
): boolean {
  const key = `${tokenId}:${stateHash}`;
  return tombstoneSet.has(key);
}

/**
 * Check if a TxfToken's current state is tombstoned
 */
export function isTokenTombstoned(
  txf: TxfToken,
  tombstoneSet: Set<string>
): TombstoneCheckResult {
  const tokenId = txf.genesis?.data?.tokenId;
  if (!tokenId) {
    return { isTombstoned: false };
  }

  const stateHash = getCurrentStateHash(txf);
  const key = `${tokenId}:${stateHash}`;

  if (tombstoneSet.has(key)) {
    return {
      isTombstoned: true,
      tombstone: {
        tokenId,
        stateHash,
        timestamp: 0, // Unknown from set lookup
      },
    };
  }

  return { isTombstoned: false };
}

/**
 * Create a new tombstone entry for a token state
 *
 * @param tokenId - 64-char hex token ID
 * @param stateHash - State hash that was spent (with "0000" prefix)
 * @param timestamp - When tombstoned (epoch ms), defaults to now
 */
export function createTombstone(
  tokenId: string,
  stateHash: string,
  timestamp?: number
): TombstoneEntry {
  return {
    tokenId,
    stateHash,
    timestamp: timestamp ?? Date.now(),
  };
}

/**
 * Create a tombstone from a TxfToken's current state
 */
export function createTombstoneFromToken(
  txf: TxfToken,
  timestamp?: number
): TombstoneEntry | null {
  const tokenId = txf.genesis?.data?.tokenId;
  if (!tokenId) {
    return null;
  }

  const stateHash = getCurrentStateHash(txf);
  return createTombstone(tokenId, stateHash, timestamp);
}

/**
 * Merge two tombstone arrays, deduplicating by tokenId+stateHash
 * Later tombstones (by timestamp) are preferred when duplicates exist
 *
 * @param local - Local tombstones
 * @param remote - Remote tombstones
 * @returns Merged tombstones (union)
 */
export function mergeTombstones(
  local: TombstoneEntry[],
  remote: TombstoneEntry[]
): TombstoneEntry[] {
  // Use Map for deduplication by tokenId+stateHash key
  const tombstoneMap = new Map<string, TombstoneEntry>();

  // Add local tombstones first
  for (const t of local) {
    const key = `${t.tokenId}:${t.stateHash}`;
    tombstoneMap.set(key, t);
  }

  // Add remote tombstones (may override local if same key)
  // Prefer the one with later timestamp
  for (const t of remote) {
    const key = `${t.tokenId}:${t.stateHash}`;
    const existing = tombstoneMap.get(key);
    if (!existing || t.timestamp > existing.timestamp) {
      tombstoneMap.set(key, t);
    }
  }

  return [...tombstoneMap.values()];
}

/**
 * Filter tombstones to only include those for specific token IDs
 */
export function filterTombstonesByTokenIds(
  tombstones: TombstoneEntry[],
  tokenIds: Set<string>
): TombstoneEntry[] {
  return tombstones.filter(t => tokenIds.has(t.tokenId));
}

/**
 * Get all tombstones for a specific token ID
 * A token can have multiple tombstones (one per spent state)
 */
export function getTombstonesForToken(
  tombstones: TombstoneEntry[],
  tokenId: string
): TombstoneEntry[] {
  return tombstones.filter(t => t.tokenId === tokenId);
}

/**
 * Find new tombstones that exist in source but not in target
 */
export function findNewTombstones(
  source: TombstoneEntry[],
  target: TombstoneEntry[]
): TombstoneEntry[] {
  const targetKeySet = buildTombstoneKeySet(target);
  return source.filter(t => {
    const key = `${t.tokenId}:${t.stateHash}`;
    return !targetKeySet.has(key);
  });
}

/**
 * Remove expired tombstones (older than specified age)
 *
 * @param tombstones - Tombstones to filter
 * @param maxAgeMs - Maximum age in milliseconds (default: 30 days)
 */
export function removeExpiredTombstones(
  tombstones: TombstoneEntry[],
  maxAgeMs: number = 30 * 24 * 60 * 60 * 1000
): TombstoneEntry[] {
  const cutoffTime = Date.now() - maxAgeMs;
  return tombstones.filter(t => t.timestamp >= cutoffTime);
}

/**
 * Extract unique token IDs from tombstones
 */
export function extractTombstonedTokenIds(
  tombstones: TombstoneEntry[]
): Set<string> {
  return new Set(tombstones.map(t => t.tokenId));
}

/**
 * Check if a token state matches any tombstone in the array
 */
export function findMatchingTombstone(
  tokenId: string,
  stateHash: string,
  tombstones: TombstoneEntry[]
): TombstoneEntry | undefined {
  return tombstones.find(
    t => t.tokenId === tokenId && t.stateHash === stateHash
  );
}

/**
 * Validate tombstones format
 * Returns true if all tombstones have valid structure
 */
export function validateTombstones(tombstones: TombstoneEntry[]): boolean {
  for (const t of tombstones) {
    // tokenId should be 64-char hex
    if (!/^[0-9a-fA-F]{64}$/.test(t.tokenId)) {
      return false;
    }
    // stateHash should start with "0000" (standard prefix)
    if (!t.stateHash || !t.stateHash.startsWith('0000')) {
      return false;
    }
    // timestamp should be positive number
    if (typeof t.timestamp !== 'number' || t.timestamp < 0) {
      return false;
    }
  }
  return true;
}
