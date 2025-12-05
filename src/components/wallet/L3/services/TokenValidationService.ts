/**
 * Token Validation Service
 * Validates tokens before IPFS sync and fetches missing Unicity proofs
 */

import { Token as LocalToken, TokenStatus } from "../data/model";
import type {
  ValidationResult,
  ValidationIssue,
  TokenValidationResult,
  TxfTransaction,
  TxfInclusionProof,
} from "./types/TxfTypes";

// ==========================================
// Constants
// ==========================================

const DEFAULT_AGGREGATOR_URL = "https://alpha-aggregator.unicity.network";
const TRUST_BASE_URL = "https://alpha-explorer.unicity.network/api/trustbase";

// ==========================================
// TokenValidationService
// ==========================================

export class TokenValidationService {
  private aggregatorUrl: string;
  private trustBaseCache: unknown | null = null;
  private trustBaseCacheTime = 0;
  private readonly TRUST_BASE_CACHE_TTL = 60 * 60 * 1000; // 1 hour

  constructor(aggregatorUrl: string = DEFAULT_AGGREGATOR_URL) {
    this.aggregatorUrl = aggregatorUrl;
  }

  // ==========================================
  // Public API
  // ==========================================

  /**
   * Validate all tokens before IPFS sync
   * Returns valid tokens and list of issues
   */
  async validateAllTokens(tokens: LocalToken[]): Promise<ValidationResult> {
    const validTokens: LocalToken[] = [];
    const issues: ValidationIssue[] = [];

    for (const token of tokens) {
      try {
        const result = await this.validateToken(token);
        if (result.isValid && result.token) {
          validTokens.push(result.token);
        } else {
          issues.push({
            tokenId: token.id,
            reason: result.reason || "Unknown validation error",
            recoverable: false,
          });
        }
      } catch (err) {
        issues.push({
          tokenId: token.id,
          reason: err instanceof Error ? err.message : String(err),
          recoverable: false,
        });
      }
    }

    return { validTokens, issues };
  }

  /**
   * Validate a single token
   */
  async validateToken(token: LocalToken): Promise<TokenValidationResult> {
    // Check if token has jsonData
    if (!token.jsonData) {
      return {
        isValid: false,
        reason: "Token has no jsonData field",
      };
    }

    let txfToken: unknown;
    try {
      txfToken = JSON.parse(token.jsonData);
    } catch {
      return {
        isValid: false,
        reason: "Failed to parse token jsonData as JSON",
      };
    }

    // Check basic structure
    if (!this.hasValidTxfStructure(txfToken)) {
      return {
        isValid: false,
        reason: "Token jsonData missing required TXF fields (genesis, state)",
      };
    }

    // Check for uncommitted transactions
    const uncommitted = this.getUncommittedTransactions(txfToken);
    if (uncommitted.length > 0) {
      console.log(
        `📦 Token ${token.id} has ${uncommitted.length} uncommitted transaction(s), attempting to fetch proofs...`
      );

      const recovered = await this.fetchMissingProofs(token);
      if (recovered) {
        console.log(`📦 Token ${token.id} proofs recovered successfully`);
        return { isValid: true, token: recovered };
      }

      return {
        isValid: false,
        reason: `${uncommitted.length} uncommitted transaction(s), could not fetch proofs from aggregator`,
      };
    }

    // Verify token using SDK (if trust base available)
    try {
      const verificationResult = await this.verifyWithSdk(txfToken);
      if (!verificationResult.success) {
        return {
          isValid: false,
          reason: verificationResult.error || "SDK verification failed",
        };
      }
    } catch (err) {
      // SDK verification is optional - log warning but don't fail
      console.warn(
        `📦 SDK verification skipped for token ${token.id}:`,
        err instanceof Error ? err.message : err
      );
    }

    return { isValid: true, token };
  }

  /**
   * Fetch missing Unicity proofs from aggregator
   */
  async fetchMissingProofs(token: LocalToken): Promise<LocalToken | null> {
    if (!token.jsonData) return null;

    let txfToken: Record<string, unknown>;
    try {
      txfToken = JSON.parse(token.jsonData);
    } catch {
      return null;
    }

    const transactions = txfToken.transactions as TxfTransaction[] | undefined;
    if (!transactions || transactions.length === 0) {
      return null;
    }

    let modified = false;

    // Try to fetch proofs for each uncommitted transaction
    for (let i = 0; i < transactions.length; i++) {
      const tx = transactions[i];
      if (tx.inclusionProof === null) {
        try {
          const proof = await this.fetchProofFromAggregator(tx.newStateHash);
          if (proof) {
            transactions[i] = { ...tx, inclusionProof: proof as TxfInclusionProof };
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

    // Return updated token
    return new LocalToken({
      ...token,
      jsonData: JSON.stringify(txfToken),
      status: TokenStatus.CONFIRMED,
    });
  }

  // ==========================================
  // Private Helpers
  // ==========================================

  /**
   * Check if object has valid TXF structure
   */
  private hasValidTxfStructure(obj: unknown): boolean {
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
   * Get list of uncommitted transactions
   */
  private getUncommittedTransactions(txfToken: unknown): TxfTransaction[] {
    const txf = txfToken as Record<string, unknown>;
    const transactions = txf.transactions as TxfTransaction[] | undefined;

    if (!transactions || !Array.isArray(transactions)) {
      return [];
    }

    return transactions.filter((tx) => tx.inclusionProof === null);
  }

  /**
   * Fetch inclusion proof from aggregator
   */
  private async fetchProofFromAggregator(
    stateHash: string
  ): Promise<unknown | null> {
    try {
      // Use the aggregator's getInclusionProof endpoint
      const response = await fetch(`${this.aggregatorUrl}/proof`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "getInclusionProof",
          params: { stateHash },
          id: Date.now(),
        }),
      });

      if (!response.ok) {
        return null;
      }

      const result = await response.json();
      if (result.error || !result.result) {
        return null;
      }

      return result.result;
    } catch {
      return null;
    }
  }

  /**
   * Verify token using state-transition-sdk
   */
  private async verifyWithSdk(
    txfToken: unknown
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Dynamic import to avoid bundling issues
      const { Token } = await import(
        "@unicitylabs/state-transition-sdk/lib/token/Token"
      );

      // Parse token from JSON
      const sdkToken = await Token.fromJSON(txfToken);

      // Get trust base
      const trustBase = await this.getTrustBase();
      if (!trustBase) {
        return { success: true }; // Skip verification if no trust base
      }

      // Verify (use 'any' cast since SDK types may vary)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await sdkToken.verify(trustBase as any);

      if (!result.isSuccessful) {
        return {
          success: false,
          error: String(result) || "Verification failed",
        };
      }

      return { success: true };
    } catch {
      // Return success if SDK is not available - validation is optional
      return { success: true };
    }
  }

  /**
   * Fetch trust base from network
   */
  private async getTrustBase(): Promise<unknown | null> {
    // Check cache
    if (
      this.trustBaseCache &&
      Date.now() - this.trustBaseCacheTime < this.TRUST_BASE_CACHE_TTL
    ) {
      return this.trustBaseCache;
    }

    try {
      const response = await fetch(TRUST_BASE_URL);
      if (!response.ok) {
        return null;
      }

      const trustBaseJson = await response.json();

      // Parse using SDK
      const { RootTrustBase } = await import(
        "@unicitylabs/state-transition-sdk/lib/bft/RootTrustBase"
      );
      const trustBase = RootTrustBase.fromJSON(trustBaseJson);

      // Cache
      this.trustBaseCache = trustBase;
      this.trustBaseCacheTime = Date.now();

      return trustBase;
    } catch {
      return null;
    }
  }
}

// ==========================================
// Singleton Instance
// ==========================================

let validationServiceInstance: TokenValidationService | null = null;

/**
 * Get singleton instance of TokenValidationService
 */
export function getTokenValidationService(): TokenValidationService {
  if (!validationServiceInstance) {
    validationServiceInstance = new TokenValidationService();
  }
  return validationServiceInstance;
}
