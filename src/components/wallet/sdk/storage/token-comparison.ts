/**
 * Token Version Comparison (Platform-Independent)
 *
 * Provides deterministic comparison of TXF token versions for sync decisions.
 * Rules:
 * 1) Committed beats pending (committed transactions always win over pending-only)
 * 2) Longer COMMITTED chain wins (not total chain length!)
 * 3) More proofs wins (including genesis proof)
 * 4) Identical state hashes = equal
 * 5) Deterministic tiebreaker for forks (genesis hash comparison)
 */

import type { TxfToken, TxfTransaction } from '../types/txf';
import { getCurrentStateHash, countProofs } from '../types/txf';

// ==========================================
// Types
// ==========================================

/**
 * Result of comparing two token versions
 */
export interface TokenComparisonResult {
  /** Which version wins: 'local', 'remote', or 'equal' */
  winner: 'local' | 'remote' | 'equal';
  /** Human-readable reason for the decision */
  reason: string;
  /** Number of committed transactions in local */
  localCommitted: number;
  /** Number of committed transactions in remote */
  remoteCommitted: number;
  /** Number of total proofs in local */
  localProofs: number;
  /** Number of total proofs in remote */
  remoteProofs: number;
}

/**
 * Detailed stats about a token's transaction state
 */
export interface TokenTransactionStats {
  /** Total number of transactions */
  totalTransactions: number;
  /** Number of committed (with proof) transactions */
  committedTransactions: number;
  /** Number of pending (no proof) transactions */
  pendingTransactions: number;
  /** Total inclusion proofs (genesis + committed txs) */
  totalProofs: number;
  /** Current state hash */
  currentStateHash: string;
  /** Whether token has any pending transactions */
  hasPending: boolean;
}

// ==========================================
// Core Functions
// ==========================================

/**
 * Count committed transactions (those with inclusion proof)
 */
export function countCommittedTransactions(txf: TxfToken): number {
  if (!txf.transactions) return 0;
  return txf.transactions.filter(
    (tx: TxfTransaction) => tx.inclusionProof !== null
  ).length;
}

/**
 * Count pending transactions (those without inclusion proof)
 */
export function countPendingTransactions(txf: TxfToken): number {
  if (!txf.transactions) return 0;
  return txf.transactions.filter(
    (tx: TxfTransaction) => tx.inclusionProof === null
  ).length;
}

/**
 * Check if token has any pending transactions
 */
export function hasPendingTransactions(txf: TxfToken): boolean {
  if (!txf.transactions) return false;
  return txf.transactions.some(
    (tx: TxfTransaction) => tx.inclusionProof === null
  );
}

/**
 * Get detailed transaction stats for a token
 */
export function getTokenTransactionStats(txf: TxfToken): TokenTransactionStats {
  const totalTransactions = txf.transactions?.length || 0;
  const committedTransactions = countCommittedTransactions(txf);
  const pendingTransactions = totalTransactions - committedTransactions;

  return {
    totalTransactions,
    committedTransactions,
    pendingTransactions,
    totalProofs: countProofs(txf),
    currentStateHash: getCurrentStateHash(txf),
    hasPending: pendingTransactions > 0,
  };
}

/**
 * Compare two token versions and determine which should be preferred
 *
 * Priority rules:
 * 1) Committed transactions ALWAYS beat pending-only
 * 2) Longer committed chain wins (not total length!)
 * 3) More total proofs wins (including genesis)
 * 4) Identical state hashes = equal
 * 5) Deterministic tiebreaker using genesis hash
 *
 * @param localTxf - Local token version
 * @param remoteTxf - Remote token version
 * @returns Comparison result with winner and reason
 */
export function compareTokenVersions(
  localTxf: TxfToken,
  remoteTxf: TxfToken
): TokenComparisonResult {
  const localCommitted = countCommittedTransactions(localTxf);
  const remoteCommitted = countCommittedTransactions(remoteTxf);
  const localHasPending = hasPendingTransactions(localTxf);
  const remoteHasPending = hasPendingTransactions(remoteTxf);
  const localProofs = countProofs(localTxf);
  const remoteProofs = countProofs(remoteTxf);

  const baseResult = {
    localCommitted,
    remoteCommitted,
    localProofs,
    remoteProofs,
  };

  // 1. COMMITTED transactions ALWAYS beat pending
  // Token with committed transactions beats token with only pending transactions
  if (localCommitted > 0 && remoteCommitted === 0 && remoteHasPending) {
    return {
      ...baseResult,
      winner: 'local',
      reason: `Local has ${localCommitted} committed transaction(s), remote has only pending`,
    };
  }
  if (remoteCommitted > 0 && localCommitted === 0 && localHasPending) {
    return {
      ...baseResult,
      winner: 'remote',
      reason: `Remote has ${remoteCommitted} committed transaction(s), local has only pending`,
    };
  }

  // 2. Compare COMMITTED chain lengths (not total length!)
  if (localCommitted > remoteCommitted) {
    return {
      ...baseResult,
      winner: 'local',
      reason: `Local has more committed transactions (${localCommitted} vs ${remoteCommitted})`,
    };
  }
  if (remoteCommitted > localCommitted) {
    return {
      ...baseResult,
      winner: 'remote',
      reason: `Remote has more committed transactions (${remoteCommitted} vs ${localCommitted})`,
    };
  }

  // 3. Same committed count - check total proofs (including genesis)
  if (localProofs > remoteProofs) {
    return {
      ...baseResult,
      winner: 'local',
      reason: `Local has more proofs (${localProofs} vs ${remoteProofs})`,
    };
  }
  if (remoteProofs > localProofs) {
    return {
      ...baseResult,
      winner: 'remote',
      reason: `Remote has more proofs (${remoteProofs} vs ${localProofs})`,
    };
  }

  // 4. Check if last transaction states differ (fork detection)
  const localStateHash = getCurrentStateHash(localTxf);
  const remoteStateHash = getCurrentStateHash(remoteTxf);

  if (localStateHash === remoteStateHash) {
    return {
      ...baseResult,
      winner: 'equal',
      reason: 'Identical state hashes - tokens are equal',
    };
  }

  // 5. Deterministic tiebreaker for forks (use genesis hash)
  const localGenesisHash = localTxf._integrity?.genesisDataJSONHash || '';
  const remoteGenesisHash = remoteTxf._integrity?.genesisDataJSONHash || '';

  if (localGenesisHash > remoteGenesisHash) {
    return {
      ...baseResult,
      winner: 'local',
      reason: 'Deterministic tiebreaker: local genesis hash wins',
    };
  }
  if (remoteGenesisHash > localGenesisHash) {
    return {
      ...baseResult,
      winner: 'remote',
      reason: 'Deterministic tiebreaker: remote genesis hash wins',
    };
  }

  // Ultimate fallback: prefer local
  return {
    ...baseResult,
    winner: 'local',
    reason: 'Identical tokens - preferring local by default',
  };
}

/**
 * Simplified comparison returning just the winner
 * Useful for quick comparisons without detailed stats
 */
export function compareTokenVersionsSimple(
  localTxf: TxfToken,
  remoteTxf: TxfToken
): 'local' | 'remote' | 'equal' {
  return compareTokenVersions(localTxf, remoteTxf).winner;
}

/**
 * Check if local token is strictly better than remote
 */
export function isLocalBetter(localTxf: TxfToken, remoteTxf: TxfToken): boolean {
  return compareTokenVersions(localTxf, remoteTxf).winner === 'local';
}

/**
 * Check if remote token is strictly better than local
 */
export function isRemoteBetter(localTxf: TxfToken, remoteTxf: TxfToken): boolean {
  return compareTokenVersions(localTxf, remoteTxf).winner === 'remote';
}

/**
 * Check if tokens are equal (same state)
 */
export function areTokensEqual(localTxf: TxfToken, remoteTxf: TxfToken): boolean {
  return compareTokenVersions(localTxf, remoteTxf).winner === 'equal';
}
