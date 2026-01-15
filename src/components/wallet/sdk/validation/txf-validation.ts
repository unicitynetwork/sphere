/**
 * TXF Token Validation (Platform-Independent)
 *
 * Pure functions for validating TXF token structure and content.
 * No external dependencies - can be used in any environment.
 */

import type { TxfToken, TxfTransaction } from '../types/txf';

// ==========================================
// Structure Validation
// ==========================================

/**
 * Check if object has valid TXF token structure
 *
 * @param obj - Object to validate
 * @returns True if object has required TXF fields
 */
export function hasValidTxfStructure(obj: unknown): obj is TxfToken {
  if (!obj || typeof obj !== "object") return false;

  const txf = obj as Record<string, unknown>;
  return !!(
    txf.genesis &&
    typeof txf.genesis === "object" &&
    txf.state &&
    typeof txf.state === "object"
  );
}

/**
 * Check if TXF token has valid genesis structure
 *
 * @param token - TXF token to validate
 * @returns True if genesis is valid
 */
export function hasValidGenesis(token: TxfToken): boolean {
  return !!(
    token.genesis &&
    token.genesis.data &&
    typeof token.genesis.data.tokenId === "string" &&
    token.genesis.inclusionProof
  );
}

/**
 * Check if TXF token has valid state structure
 *
 * @param token - TXF token to validate
 * @returns True if state is valid
 */
export function hasValidState(token: TxfToken): boolean {
  return !!(
    token.state &&
    typeof token.state.stateHash === "string"
  );
}

// ==========================================
// Transaction Validation
// ==========================================

/**
 * Get list of uncommitted transactions (no inclusion proof)
 *
 * @param token - TXF token or raw object
 * @returns Array of uncommitted transactions
 */
export function getUncommittedTransactions(token: TxfToken | unknown): TxfTransaction[] {
  if (!token || typeof token !== "object") return [];

  const txf = token as Record<string, unknown>;
  const transactions = txf.transactions as TxfTransaction[] | undefined;

  if (!transactions || !Array.isArray(transactions)) {
    return [];
  }

  return transactions.filter((tx) => tx.inclusionProof === null);
}

/**
 * Get list of committed transactions (has inclusion proof)
 *
 * @param token - TXF token
 * @returns Array of committed transactions
 */
export function getCommittedTransactions(token: TxfToken): TxfTransaction[] {
  if (!token.transactions || !Array.isArray(token.transactions)) {
    return [];
  }

  return token.transactions.filter((tx) => tx.inclusionProof !== null);
}

/**
 * Check if token has any uncommitted transactions
 *
 * @param token - TXF token
 * @returns True if there are uncommitted transactions
 */
export function hasUncommittedTxs(token: TxfToken | unknown): boolean {
  return getUncommittedTransactions(token).length > 0;
}

/**
 * Get transaction at specific index
 *
 * @param token - TXF token
 * @param index - Transaction index
 * @returns Transaction or undefined
 */
export function getTransactionAtIndex(
  token: TxfToken,
  index: number
): TxfTransaction | undefined {
  return token.transactions?.[index];
}

// ==========================================
// State Hash Utilities
// ==========================================

/**
 * Get the previous state hash for a transaction at given index
 * For first transaction, returns genesis state hash
 *
 * @param token - TXF token
 * @param txIndex - Transaction index
 * @returns Previous state hash or null if invalid
 */
export function getPreviousStateHash(
  token: TxfToken,
  txIndex: number
): string | null {
  if (txIndex < 0 || !token.transactions) return null;

  if (txIndex === 0) {
    // First transaction - source state is genesis state
    return token.genesis?.inclusionProof?.authenticator?.stateHash || null;
  }

  // Previous transaction's new state
  const prevTx = token.transactions[txIndex - 1];
  return prevTx?.newStateHash || null;
}

/**
 * Get current state hash from token (latest committed state)
 *
 * @param token - TXF token
 * @returns Current state hash
 */
export function getCurrentState(token: TxfToken): string {
  // If there are committed transactions, use the last one
  if (token.transactions && token.transactions.length > 0) {
    // Find the last committed transaction
    for (let i = token.transactions.length - 1; i >= 0; i--) {
      if (token.transactions[i].inclusionProof !== null) {
        return token.transactions[i].newStateHash;
      }
    }
  }

  // Fall back to genesis state
  return token.genesis?.inclusionProof?.authenticator?.stateHash || token.state?.stateHash || "";
}

// ==========================================
// Split Token Detection
// ==========================================

/**
 * Check if token is a split token (created from burning a parent token)
 *
 * @param token - TXF token
 * @returns True if this is a split token
 */
export function isSplitToken(token: TxfToken): boolean {
  const reason = token.genesis?.data?.reason;
  if (!reason) return false;

  if (typeof reason === "string") {
    // Check for SPLIT_MINT prefix
    if (reason.startsWith("SPLIT_MINT:")) return true;

    // Check for JSON format with burn reference
    if (reason.startsWith("{")) {
      try {
        const reasonObj = JSON.parse(reason);
        return !!(
          reasonObj.splitMintReason?.burnTransactionHash ||
          reasonObj.burnTransactionHash
        );
      } catch {
        return false;
      }
    }
  }

  return false;
}

/**
 * Extract burn transaction hash from split token
 *
 * @param token - TXF token
 * @returns Burn transaction hash or null if not a split token
 */
export function extractBurnTxHash(token: TxfToken): string | null {
  const reason = token.genesis?.data?.reason;
  if (!reason || typeof reason !== "string") return null;

  // Check for SPLIT_MINT prefix
  if (reason.startsWith("SPLIT_MINT:")) {
    return reason.substring("SPLIT_MINT:".length);
  }

  // Check for JSON format
  if (reason.startsWith("{")) {
    try {
      const reasonObj = JSON.parse(reason);
      return (
        reasonObj.splitMintReason?.burnTransactionHash ||
        reasonObj.burnTransactionHash ||
        null
      );
    } catch {
      return null;
    }
  }

  return null;
}

// ==========================================
// Validation Summary
// ==========================================

/**
 * Get validation summary for a TXF token
 *
 * @param token - TXF token
 * @returns Validation summary
 */
export function getValidationSummary(token: TxfToken): {
  hasValidStructure: boolean;
  hasValidGenesis: boolean;
  hasValidState: boolean;
  transactionCount: number;
  committedCount: number;
  uncommittedCount: number;
  isSplitToken: boolean;
  burnTxHash: string | null;
} {
  const uncommitted = getUncommittedTransactions(token);
  const committed = getCommittedTransactions(token);

  return {
    hasValidStructure: hasValidTxfStructure(token),
    hasValidGenesis: hasValidGenesis(token),
    hasValidState: hasValidState(token),
    transactionCount: (token.transactions?.length || 0),
    committedCount: committed.length,
    uncommittedCount: uncommitted.length,
    isSplitToken: isSplitToken(token),
    burnTxHash: extractBurnTxHash(token),
  };
}
