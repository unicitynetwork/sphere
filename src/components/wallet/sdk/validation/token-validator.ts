/**
 * Token Validator (Platform-Independent)
 *
 * Validates tokens against TXF structure and blockchain state.
 * Uses provider interfaces for proof fetching and trust base.
 */

import type { TxfToken, TxfTransaction, TxfInclusionProof } from '../types/txf';
import type {
  ProofProvider,
  TokenValidationResult,
  ValidationIssue,
  ValidationResult,
  BatchValidationOptions,
} from './types';

import {
  hasValidTxfStructure,
  getUncommittedTransactions,
  isSplitToken,
  extractBurnTxHash,
} from './txf-validation';

import type { TrustBaseProvider } from './trust-base-provider';

// ==========================================
// Types
// ==========================================

/**
 * Configuration for TokenValidator
 */
export interface TokenValidatorConfig {
  /** Provider for fetching inclusion proofs */
  proofProvider: ProofProvider;
  /** Provider for trust base (optional, for SDK verification) */
  trustBaseProvider?: TrustBaseProvider;
  /** Whether to verify tokens using SDK (requires trust base) */
  enableSdkVerification?: boolean;
}

/**
 * Extended token for validation (generic)
 */
export interface ValidatableToken {
  /** Unique token ID */
  id: string;
  /** TXF JSON data as string */
  jsonData?: string;
  /** Token status */
  status?: string;
}

/**
 * Result of verifying burn transaction
 */
export interface BurnVerificationResult {
  committed: boolean;
  error?: string;
}

// ==========================================
// TokenValidator
// ==========================================

/**
 * Validates tokens using platform-independent logic
 *
 * Usage:
 * ```typescript
 * const validator = new TokenValidator({
 *   proofProvider: new AggregatorProofProvider({ aggregatorUrl, httpClient }),
 *   trustBaseProvider: trustBaseProvider,
 * });
 *
 * // Validate a single token
 * const result = await validator.validateToken(token);
 *
 * // Validate with proof recovery
 * const recovered = await validator.fetchMissingProofs(txfToken);
 * ```
 */
export class TokenValidator {
  private proofProvider: ProofProvider;
  private trustBaseProvider: TrustBaseProvider | undefined;
  private enableSdkVerification: boolean;

  constructor(config: TokenValidatorConfig) {
    this.proofProvider = config.proofProvider;
    this.trustBaseProvider = config.trustBaseProvider;
    this.enableSdkVerification = config.enableSdkVerification ?? false;
  }

  // ==========================================
  // Public API
  // ==========================================

  /**
   * Validate TXF token structure
   * Returns validation result without network calls
   */
  validateStructure(txfToken: unknown): TokenValidationResult {
    if (!hasValidTxfStructure(txfToken)) {
      return {
        isValid: false,
        reason: 'Token missing required TXF fields (genesis, state)',
      };
    }

    return { isValid: true };
  }

  /**
   * Validate a token with optional proof recovery
   *
   * @param token - Token with id and jsonData fields
   * @returns Validation result, potentially with recovered token
   */
  async validateToken<T extends ValidatableToken>(
    token: T
  ): Promise<TokenValidationResult<T>> {
    // Check if token has jsonData
    if (!token.jsonData) {
      return {
        isValid: false,
        reason: 'Token has no jsonData field',
      };
    }

    let txfToken: unknown;
    try {
      txfToken = JSON.parse(token.jsonData);
    } catch {
      return {
        isValid: false,
        reason: 'Failed to parse token jsonData as JSON',
      };
    }

    // Check structure
    const structureResult = this.validateStructure(txfToken);
    if (!structureResult.isValid) {
      return structureResult as TokenValidationResult<T>;
    }

    // Check for uncommitted transactions
    const uncommitted = getUncommittedTransactions(txfToken as TxfToken);
    if (uncommitted.length > 0) {
      console.log(
        `📦 Token ${token.id.slice(0, 8)}... has ${uncommitted.length} uncommitted transaction(s)`
      );

      // Try to fetch missing proofs
      const recoveredTxf = await this.fetchMissingProofs(txfToken as TxfToken);
      if (recoveredTxf) {
        // Check if all proofs are now available
        const stillUncommitted = getUncommittedTransactions(recoveredTxf);
        if (stillUncommitted.length === 0) {
          console.log(`📦 Token ${token.id.slice(0, 8)}... proofs recovered`);
          return {
            isValid: true,
            token: {
              ...token,
              jsonData: JSON.stringify(recoveredTxf),
              status: 'CONFIRMED',
            } as T,
          };
        }
      }

      return {
        isValid: false,
        reason: `${uncommitted.length} uncommitted transaction(s), could not fetch proofs`,
      };
    }

    // Optional: SDK verification
    if (this.enableSdkVerification && this.trustBaseProvider) {
      try {
        const verificationResult = await this.verifyWithSdk(txfToken as TxfToken);
        if (!verificationResult.success) {
          return {
            isValid: false,
            reason: verificationResult.error || 'SDK verification failed',
          };
        }
      } catch (err) {
        // SDK verification is optional - log warning but don't fail
        console.warn(
          `📦 SDK verification skipped for token ${token.id.slice(0, 8)}...:`,
          err instanceof Error ? err.message : err
        );
      }
    }

    return { isValid: true, token };
  }

  /**
   * Validate multiple tokens with batching
   */
  async validateAllTokens<T extends ValidatableToken>(
    tokens: T[],
    options?: BatchValidationOptions
  ): Promise<ValidationResult<T>> {
    const validTokens: T[] = [];
    const issues: ValidationIssue[] = [];

    const batchSize = options?.batchSize ?? 5;
    const total = tokens.length;
    let completed = 0;

    for (let i = 0; i < tokens.length; i += batchSize) {
      const batch = tokens.slice(i, i + batchSize);

      const batchResults = await Promise.allSettled(
        batch.map(async (token) => {
          try {
            const result = await this.validateToken(token);
            return { token, result };
          } catch (err) {
            return {
              token,
              result: {
                isValid: false,
                reason: err instanceof Error ? err.message : String(err),
              } as TokenValidationResult<T>,
            };
          }
        })
      );

      for (const settledResult of batchResults) {
        completed++;

        if (settledResult.status === 'fulfilled') {
          const { token, result } = settledResult.value;
          if (result.isValid && result.token) {
            validTokens.push(result.token);
          } else if (result.isValid) {
            validTokens.push(token);
          } else {
            issues.push({
              tokenId: token.id,
              reason: result.reason || 'Unknown validation error',
              recoverable: false,
            });
          }
        } else {
          const index = batchResults.indexOf(settledResult);
          issues.push({
            tokenId: batch[index]?.id || 'unknown',
            reason: String(settledResult.reason),
            recoverable: false,
          });
        }
      }

      if (options?.onProgress) {
        options.onProgress(completed, total);
      }
    }

    return { validTokens, issues };
  }

  /**
   * Fetch missing inclusion proofs from aggregator
   * Returns updated TXF token or null if no changes made
   */
  async fetchMissingProofs(txfToken: TxfToken): Promise<TxfToken | null> {
    const transactions = txfToken.transactions;
    if (!transactions || transactions.length === 0) {
      return null;
    }

    let modified = false;
    const updatedTransactions = [...transactions];

    for (let i = 0; i < updatedTransactions.length; i++) {
      const tx = updatedTransactions[i];
      if (tx.inclusionProof === null) {
        try {
          const proof = await this.proofProvider.fetchProof(tx.newStateHash);
          if (proof) {
            updatedTransactions[i] = {
              ...tx,
              inclusionProof: proof as TxfInclusionProof,
            };
            modified = true;
          }
        } catch (err) {
          console.warn(
            `📦 Failed to fetch proof for transaction ${i}:`,
            err instanceof Error ? err.message : err
          );
        }
      }
    }

    if (!modified) {
      return null;
    }

    return {
      ...txfToken,
      transactions: updatedTransactions as TxfTransaction[],
    };
  }

  /**
   * Verify token using SDK (requires trust base)
   */
  async verifyWithSdk(
    txfToken: TxfToken
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.trustBaseProvider) {
      return { success: false, error: 'No trust base provider configured' };
    }

    const trustBase = await this.trustBaseProvider.getTrustBase();
    if (!trustBase) {
      return { success: false, error: 'Trust base not available' };
    }

    try {
      // Dynamic import to avoid bundling SDK if not needed
      const { Token: SdkToken } = await import(
        '@unicitylabs/state-transition-sdk/lib/token/Token'
      );

      const sdkToken = await SdkToken.fromJSON(txfToken);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const verification = await sdkToken.verify(trustBase as any);

      if (!verification.isSuccessful) {
        return {
          success: false,
          error: `SDK verification failed: ${verification}`,
        };
      }

      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // ==========================================
  // Split Token Validation
  // ==========================================

  /**
   * Check if a token is a split token
   */
  isSplitToken(txfToken: TxfToken): boolean {
    return isSplitToken(txfToken);
  }

  /**
   * Extract burn transaction hash from split token
   */
  extractBurnTxHash(txfToken: TxfToken): string | null {
    return extractBurnTxHash(txfToken);
  }

  /**
   * Check if a burn transaction was committed
   */
  async checkBurnTransactionCommitted(
    burnTxHash: string
  ): Promise<BurnVerificationResult> {
    try {
      const proof = await this.proofProvider.fetchProof(burnTxHash);

      if (proof) {
        return { committed: true };
      }

      return {
        committed: false,
        error: 'Burn transaction proof not found - may be pending or rejected',
      };
    } catch (err) {
      return {
        committed: false,
        error: `Failed to verify burn: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * Validate split tokens by checking burn transaction status
   */
  async validateSplitTokens<T extends ValidatableToken>(
    tokens: T[]
  ): Promise<{
    valid: T[];
    invalid: T[];
    errors: Array<{ tokenId: string; reason: string }>;
  }> {
    const valid: T[] = [];
    const invalid: T[] = [];
    const errors: Array<{ tokenId: string; reason: string }> = [];

    for (const token of tokens) {
      if (!token.jsonData) {
        invalid.push(token);
        errors.push({ tokenId: token.id, reason: 'No jsonData' });
        continue;
      }

      let txfToken: TxfToken;
      try {
        txfToken = JSON.parse(token.jsonData);
      } catch {
        invalid.push(token);
        errors.push({ tokenId: token.id, reason: 'Invalid JSON' });
        continue;
      }

      if (!this.isSplitToken(txfToken)) {
        valid.push(token);
        continue;
      }

      const burnTxHash = this.extractBurnTxHash(txfToken);
      if (!burnTxHash) {
        valid.push(token);
        continue;
      }

      console.log(
        `📦 Validating split token ${token.id.slice(0, 8)}... (burn: ${burnTxHash.slice(0, 12)}...)`
      );

      const burnResult = await this.checkBurnTransactionCommitted(burnTxHash);

      if (burnResult.committed) {
        valid.push(token);
      } else {
        invalid.push(token);
        errors.push({
          tokenId: token.id,
          reason: burnResult.error || 'Burn not committed',
        });
      }
    }

    return { valid, invalid, errors };
  }
}

// ==========================================
// Factory
// ==========================================

/**
 * Create a TokenValidator instance
 */
export function createTokenValidator(
  config: TokenValidatorConfig
): TokenValidator {
  return new TokenValidator(config);
}
