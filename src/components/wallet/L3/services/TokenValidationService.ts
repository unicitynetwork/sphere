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
  TxfToken,
} from "./types/TxfTypes";
import { getCurrentStateHash } from "./TxfSerializer";

// ==========================================
// Spent Token Detection Types
// ==========================================

export interface SpentTokenInfo {
  tokenId: string;     // SDK token ID from genesis
  localId: string;     // Local Token.id for repository removal
  stateHash: string;   // Current state hash being checked
}

export interface SpentTokenResult {
  spentTokens: SpentTokenInfo[];
  errors: string[];
}

// ==========================================
// Constants
// ==========================================

const DEFAULT_AGGREGATOR_URL = "https://alpha-aggregator.unicity.network";

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
   * Validate all tokens before IPFS sync (parallel with batch limit)
   * Returns valid tokens and list of issues
   */
  async validateAllTokens(
    tokens: LocalToken[],
    options?: { batchSize?: number; onProgress?: (completed: number, total: number) => void }
  ): Promise<ValidationResult> {
    const validTokens: LocalToken[] = [];
    const issues: ValidationIssue[] = [];

    const batchSize = options?.batchSize ?? 5; // Default: 5 concurrent validations
    const total = tokens.length;
    let completed = 0;

    // Process in batches for controlled parallelism
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
              } as TokenValidationResult,
            };
          }
        })
      );

      // Process batch results
      for (const settledResult of batchResults) {
        completed++;

        if (settledResult.status === "fulfilled") {
          const { token, result } = settledResult.value;
          if (result.isValid && result.token) {
            validTokens.push(result.token);
          } else {
            issues.push({
              tokenId: token.id,
              reason: result.reason || "Unknown validation error",
              recoverable: false,
            });
          }
        } else {
          // Promise rejected (shouldn't happen due to try/catch above, but handle anyway)
          issues.push({
            tokenId: batch[batchResults.indexOf(settledResult)]?.id || "unknown",
            reason: String(settledResult.reason),
            recoverable: false,
          });
        }
      }

      // Report progress
      if (options?.onProgress) {
        options.onProgress(completed, total);
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
  // Spent Token Detection
  // ==========================================

  /**
   * Check which tokens are NOT spent (unspent) on Unicity
   * Used for sanity check when importing remote tombstones/missing tokens
   * Requires full TxfToken data for SDK-based verification
   * Returns array of tokenIds that are still valid/unspent
   */
  async checkUnspentTokens(
    tokens: Map<string, TxfToken>,
    publicKey: string
  ): Promise<string[]> {
    if (tokens.size === 0) return [];

    const unspentTokenIds: string[] = [];

    console.log(`📦 Sanity check: Verifying ${tokens.size} token(s) with aggregator...`);

    // Get trust base and client
    const trustBase = await this.getTrustBase();
    if (!trustBase) {
      console.warn("📦 Sanity check: Trust base not available, assuming all tokens unspent (safe fallback)");
      return [...tokens.keys()];
    }

    let client: unknown;
    try {
      const { ServiceProvider } = await import("./ServiceProvider");
      client = ServiceProvider.stateTransitionClient;
    } catch {
      console.warn("📦 Sanity check: StateTransitionClient not available, assuming all tokens unspent");
      return [...tokens.keys()];
    }

    if (!client) {
      console.warn("📦 Sanity check: StateTransitionClient is null, assuming all tokens unspent");
      return [...tokens.keys()];
    }

    for (const [tokenId, txfToken] of tokens) {
      try {
        // Parse SDK token from TXF data
        const { Token } = await import(
          "@unicitylabs/state-transition-sdk/lib/token/Token"
        );
        const sdkToken = await Token.fromJSON(txfToken);

        // Convert public key to bytes for SDK
        const pubKeyBytes = Buffer.from(publicKey, "hex");

        // Check if token state is spent using SDK
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const isSpent = await (client as any).isTokenStateSpent(
          trustBase,
          sdkToken,
          pubKeyBytes
        );

        if (!isSpent) {
          unspentTokenIds.push(tokenId);
          console.log(`📦 Token ${tokenId.slice(0, 8)}... is NOT spent`);
        } else {
          console.log(`📦 Token ${tokenId.slice(0, 8)}... is SPENT`);
        }
      } catch (err) {
        console.warn(`📦 Sanity check: Error checking token ${tokenId.slice(0, 8)}...:`, err);
        // On error, assume unspent (safe fallback to avoid data loss)
        unspentTokenIds.push(tokenId);
      }
    }

    console.log(`📦 Sanity check result: ${unspentTokenIds.length} unspent, ${tokens.size - unspentTokenIds.length} spent`);
    return unspentTokenIds;
  }

  /**
   * Check all tokens for spent state against aggregator
   * Returns list of spent tokens that should be removed
   */
  async checkSpentTokens(
    tokens: LocalToken[],
    publicKey: string,
    options?: { batchSize?: number; onProgress?: (completed: number, total: number) => void }
  ): Promise<SpentTokenResult> {
    const spentTokens: SpentTokenInfo[] = [];
    const errors: string[] = [];

    const batchSize = options?.batchSize ?? 3; // Smaller batch for network calls
    const total = tokens.length;
    let completed = 0;

    // Get trust base
    const trustBase = await this.getTrustBase();
    if (!trustBase) {
      console.warn("📦 Sanity check: Trust base not available, skipping");
      return { spentTokens: [], errors: ["Trust base not available"] };
    }

    // Get state transition client
    let client: unknown;
    try {
      const { ServiceProvider } = await import("./ServiceProvider");
      client = ServiceProvider.stateTransitionClient;
    } catch {
      console.warn("📦 Sanity check: StateTransitionClient not available");
      return { spentTokens: [], errors: ["StateTransitionClient not available"] };
    }

    // Process in batches
    for (let i = 0; i < tokens.length; i += batchSize) {
      const batch = tokens.slice(i, i + batchSize);

      const batchResults = await Promise.allSettled(
        batch.map(async (token) => {
          try {
            return await this.checkSingleTokenSpent(token, publicKey, trustBase, client);
          } catch (err) {
            return {
              tokenId: token.id,
              localId: token.id,
              stateHash: "",
              spent: false,
              error: err instanceof Error ? err.message : String(err),
            };
          }
        })
      );

      for (const result of batchResults) {
        completed++;
        if (result.status === "fulfilled") {
          if (result.value.spent) {
            spentTokens.push({
              tokenId: result.value.tokenId,
              localId: result.value.localId,
              stateHash: result.value.stateHash,
            });
          }
          if (result.value.error) {
            errors.push(`Token ${result.value.tokenId}: ${result.value.error}`);
          }
        } else {
          errors.push(String(result.reason));
        }
      }

      if (options?.onProgress) {
        options.onProgress(completed, total);
      }
    }

    return { spentTokens, errors };
  }

  /**
   * Check if a single token's current state is spent
   */
  private async checkSingleTokenSpent(
    token: LocalToken,
    publicKey: string,
    trustBase: unknown,
    client: unknown
  ): Promise<{
    tokenId: string;
    localId: string;
    stateHash: string;
    spent: boolean;
    error?: string;
  }> {
    if (!token.jsonData) {
      return {
        tokenId: token.id,
        localId: token.id,
        stateHash: "",
        spent: false,
        error: "No jsonData",
      };
    }

    let txfToken: TxfToken;
    try {
      txfToken = JSON.parse(token.jsonData);
    } catch {
      return {
        tokenId: token.id,
        localId: token.id,
        stateHash: "",
        spent: false,
        error: "Invalid JSON",
      };
    }

    // Get SDK token ID and state hash
    const tokenId = txfToken.genesis?.data?.tokenId || token.id;
    const stateHash = getCurrentStateHash(txfToken);

    try {
      // Parse SDK token
      const { Token } = await import(
        "@unicitylabs/state-transition-sdk/lib/token/Token"
      );
      const sdkToken = await Token.fromJSON(txfToken);

      // Convert public key to bytes for SDK
      const pubKeyBytes = Buffer.from(publicKey, "hex");

      // Check if token state is spent using SDK client
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const isSpent = await (client as any).isTokenStateSpent(
        trustBase,
        sdkToken,
        pubKeyBytes
      );

      return {
        tokenId,
        localId: token.id,
        stateHash,
        spent: isSpent === true,
      };
    } catch (err) {
      return {
        tokenId,
        localId: token.id,
        stateHash,
        spent: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
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
   * Get trust base from ServiceProvider (local file)
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
      // Use ServiceProvider which loads from local trustbase-testnet.json
      const { ServiceProvider } = await import("./ServiceProvider");
      const trustBase = ServiceProvider.getRootTrustBase();

      // Cache
      this.trustBaseCache = trustBase;
      this.trustBaseCacheTime = Date.now();

      return trustBase;
    } catch (err) {
      console.warn("📦 Failed to get trust base from ServiceProvider:", err);
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
