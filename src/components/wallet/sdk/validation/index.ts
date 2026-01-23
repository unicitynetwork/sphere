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

// Proof Provider
export {
  AggregatorProofProvider,
  FetchHttpClient,
  fetchProofFromAggregator,
  createAggregatorProofProvider,
} from './proof-provider';

export type {
  HttpClient,
  HttpClientOptions,
  ProofFetchResult,
  AggregatorProofProviderConfig,
} from './proof-provider';

// Trust Base Provider
export {
  CachedTrustBaseProvider,
  InMemoryTrustBaseProvider,
  createCachedTrustBaseProvider,
  createInMemoryTrustBaseProvider,
} from './trust-base-provider';

export type {
  TrustBaseProvider,
  TrustBaseProviderConfig,
  TrustBaseLoader,
} from './trust-base-provider';

// Token Validator
export {
  TokenValidator,
  createTokenValidator,
} from './token-validator';

export type {
  TokenValidatorConfig,
  ValidatableToken,
  BurnVerificationResult,
} from './token-validator';

// Spent Token Checker
export {
  SpentTokenChecker,
  SdkTokenStateProvider,
  createSpentTokenChecker,
  createSdkTokenStateProvider,
} from './spent-token-checker';

export type {
  SpentTokenCheckerConfig,
  SpentCheckableToken,
} from './spent-token-checker';
