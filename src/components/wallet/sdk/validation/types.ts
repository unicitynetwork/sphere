/**
 * Token Validation Types (Platform-Independent)
 */

import type { TxfToken } from '../types/txf';

// ==========================================
// Validation Result Types
// ==========================================

/**
 * Validation action describes what should be taken based on validation result
 * - ACCEPT: Token is valid, can be used
 * - RETRY_LATER: Proof not available yet, retry submission later
 * - DISCARD_FORK: Transaction can NEVER succeed (source state spent), should be discarded
 */
export type ValidationAction = "ACCEPT" | "RETRY_LATER" | "DISCARD_FORK";

/**
 * Result of validating a single token
 */
export interface TokenValidationResult<T = unknown> {
  isValid: boolean;
  reason?: string;
  token?: T;
  action?: ValidationAction;
}

/**
 * Issue found during validation
 */
export interface ValidationIssue {
  tokenId: string;
  reason: string;
  recoverable: boolean;
}

/**
 * Result of validating multiple tokens
 */
export interface ValidationResult<T = unknown> {
  validTokens: T[];
  issues: ValidationIssue[];
}

// ==========================================
// Spent Token Detection Types
// ==========================================

/**
 * Information about a spent token
 */
export interface SpentTokenInfo {
  tokenId: string;     // SDK token ID from genesis
  localId: string;     // Local Token.id for repository removal
  stateHash: string;   // Current state hash being checked
}

/**
 * Result of checking for spent tokens
 */
export interface SpentTokenResult {
  spentTokens: SpentTokenInfo[];
  errors: string[];
}

// ==========================================
// Pending Transaction Types
// ==========================================

/**
 * Result of checking if a pending transaction is submittable
 */
export interface PendingTransactionCheckResult {
  submittable: boolean;
  reason?: string;
  action?: ValidationAction;
}

/**
 * Summary of all pending transactions in a token
 */
export interface PendingTransactionsSummary {
  pendingCount: number;
  submittable: number;
  dead: number;
  deadTransactions: { index: number; reason: string }[];
}

// ==========================================
// Validation Options
// ==========================================

/**
 * Options for batch validation
 */
export interface BatchValidationOptions {
  batchSize?: number;
  onProgress?: (completed: number, total: number) => void;
}

// ==========================================
// Validation Provider Interface
// ==========================================

/**
 * Interface for proof fetching (dependency injection)
 */
export interface ProofProvider {
  fetchProof(stateHash: string): Promise<unknown | null>;
}

/**
 * Interface for token state checking (dependency injection)
 */
export interface TokenStateProvider {
  isTokenStateSpent(token: TxfToken, publicKey: string): Promise<boolean>;
  getTrustBase(): Promise<unknown | null>;
}
