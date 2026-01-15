/**
 * Token Validation - platform-independent
 */

// Types
export type {
  ValidationAction,
  TokenValidationResult,
  ValidationIssue,
  ValidationResult,
  SpentTokenInfo,
  SpentTokenResult,
  PendingTransactionCheckResult,
  PendingTransactionsSummary,
  BatchValidationOptions,
  ProofProvider,
  TokenStateProvider,
} from './types';

// TXF Validation
export {
  // Structure validation
  hasValidTxfStructure,
  hasValidGenesis,
  hasValidState,
  // Transaction validation
  getUncommittedTransactions,
  getCommittedTransactions,
  hasUncommittedTxs,
  getTransactionAtIndex,
  // State hash utilities
  getPreviousStateHash,
  getCurrentState,
  // Split token detection
  isSplitToken,
  extractBurnTxHash,
  // Validation summary
  getValidationSummary,
} from './txf-validation';
