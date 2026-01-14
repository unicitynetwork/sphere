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
import { getCurrentStateHash, tokenToTxf } from "./TxfSerializer";

// ==========================================
// Validation Action Types
// ==========================================

/**
 * Describes what action should be taken based on validation result
 * - ACCEPT: Token is valid, can be used
 * - RETRY_LATER: Proof not available yet, retry submission later
 * - DISCARD_FORK: Transaction can NEVER succeed (source state spent), should be discarded
 */
export type ValidationAction = "ACCEPT" | "RETRY_LATER" | "DISCARD_FORK";

/**
 * Extended validation result with action guidance
 */
export interface ExtendedValidationResult extends TokenValidationResult {
  action?: ValidationAction;
}

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

  // Spent state verification cache
  // SPENT results are immutable - cache forever (persisted to localStorage)
  // UNSPENT results could change - cache with 5-min TTL (in-memory only)
  private spentStateCache = new Map<string, {
    isSpent: boolean;
    timestamp: number;
  }>();
  private readonly UNSPENT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes for UNSPENT
  private spentCacheLoadedFromStorage = false;

  // localStorage key for persisting SPENT cache entries
  private static readonly SPENT_CACHE_STORAGE_KEY = "unicity_spent_token_cache";

  constructor(aggregatorUrl: string = DEFAULT_AGGREGATOR_URL) {
    this.aggregatorUrl = aggregatorUrl;
  }

  // ==========================================
  // Spent State Cache Methods
  // ==========================================

  /**
   * Generate cache key for spent state verification
   * Format: tokenId:stateHash:publicKey
   */
  private getSpentStateCacheKey(
    tokenId: string,
    stateHash: string,
    publicKey: string
  ): string {
    return `${tokenId}:${stateHash}:${publicKey}`;
  }

  /**
   * Load SPENT cache entries from localStorage (lazy load on first access)
   * Only SPENT entries are persisted - UNSPENT entries remain in-memory only.
   */
  private loadSpentCacheFromStorage(): void {
    if (this.spentCacheLoadedFromStorage) return;
    this.spentCacheLoadedFromStorage = true;

    try {
      const stored = localStorage.getItem(TokenValidationService.SPENT_CACHE_STORAGE_KEY);
      if (!stored) return;

      const entries = JSON.parse(stored) as Array<{ key: string; timestamp: number }>;
      let loadedCount = 0;

      for (const entry of entries) {
        // Only load SPENT entries (isSpent is always true for persisted entries)
        this.spentStateCache.set(entry.key, {
          isSpent: true,
          timestamp: entry.timestamp,
        });
        loadedCount++;
      }

      if (loadedCount > 0) {
        console.log(`📦 Loaded ${loadedCount} SPENT cache entries from localStorage`);
      }
    } catch (err) {
      console.warn("📦 Failed to load SPENT cache from localStorage:", err);
      // Clear corrupted data
      try {
        localStorage.removeItem(TokenValidationService.SPENT_CACHE_STORAGE_KEY);
      } catch { /* ignore */ }
    }
  }

  /**
   * Persist SPENT cache entries to localStorage
   * Only SPENT entries are persisted - they are immutable and safe to cache forever.
   */
  private persistSpentCacheToStorage(): void {
    try {
      const entries: Array<{ key: string; timestamp: number }> = [];

      for (const [key, entry] of this.spentStateCache.entries()) {
        // Only persist SPENT entries
        if (entry.isSpent) {
          entries.push({ key, timestamp: entry.timestamp });
        }
      }

      if (entries.length === 0) {
        localStorage.removeItem(TokenValidationService.SPENT_CACHE_STORAGE_KEY);
      } else {
        localStorage.setItem(
          TokenValidationService.SPENT_CACHE_STORAGE_KEY,
          JSON.stringify(entries)
        );
      }
    } catch (err) {
      console.warn("📦 Failed to persist SPENT cache to localStorage:", err);
    }
  }

  /**
   * Check if spent state is cached
   * Returns: true (SPENT), false (UNSPENT), or null (not cached/expired)
   */
  private getSpentStateFromCache(cacheKey: string): boolean | null {
    // Lazy load from localStorage on first access
    this.loadSpentCacheFromStorage();

    const cached = this.spentStateCache.get(cacheKey);
    if (!cached) return null;

    // SPENT results never expire (immutable)
    if (cached.isSpent) {
      return true;
    }

    // UNSPENT results expire after TTL (state could have changed)
    const isExpired = Date.now() - cached.timestamp > this.UNSPENT_CACHE_TTL_MS;
    if (isExpired) {
      this.spentStateCache.delete(cacheKey);
      return null;
    }

    return false;
  }

  /**
   * Store spent state result in cache
   * SPENT entries are persisted to localStorage; UNSPENT entries are in-memory only.
   */
  private cacheSpentState(cacheKey: string, isSpent: boolean): void {
    this.spentStateCache.set(cacheKey, {
      isSpent,
      timestamp: Date.now(),
    });

    // Persist SPENT entries to localStorage (they're immutable)
    if (isSpent) {
      this.persistSpentCacheToStorage();
    }
  }

  /**
   * Clear spent state cache (call on logout/address change or when refreshing Unicity proofs)
   * Also clears localStorage persistence.
   */
  clearSpentStateCache(): void {
    const size = this.spentStateCache.size;
    this.spentStateCache.clear();
    this.spentCacheLoadedFromStorage = false;

    // Also clear localStorage
    try {
      localStorage.removeItem(TokenValidationService.SPENT_CACHE_STORAGE_KEY);
    } catch { /* ignore */ }

    if (size > 0) {
      console.log(`📦 Cleared spent state cache (${size} entries) and localStorage`);
    }
  }

  /**
   * Clear only UNSPENT cache entries
   * Called after IPFS sync detects inventory changes
   * SPENT entries remain cached (immutable)
   */
  clearUnspentCacheEntries(): void {
    let clearedCount = 0;
    for (const [key, entry] of this.spentStateCache.entries()) {
      if (!entry.isSpent) {
        this.spentStateCache.delete(key);
        clearedCount++;
      }
    }
    if (clearedCount > 0) {
      console.log(`📦 Cleared ${clearedCount} UNSPENT cache entries after IPFS inventory change`);
    }
  }

  /**
   * Get cache statistics for debugging
   */
  getSpentStateCacheStats(): { size: number; spentCount: number; unspentCount: number } {
    let spentCount = 0;
    let unspentCount = 0;
    for (const entry of this.spentStateCache.values()) {
      if (entry.isSpent) spentCount++;
      else unspentCount++;
    }
    return { size: this.spentStateCache.size, spentCount, unspentCount };
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
    const tokenIdPrefix = token.id.slice(0, 8);

    // Check if token has jsonData
    if (!token.jsonData) {
      console.log(`📦 Validation FAIL [${tokenIdPrefix}]: no jsonData`);
      return {
        isValid: false,
        reason: "Token has no jsonData field",
      };
    }

    let txfToken: unknown;
    try {
      txfToken = JSON.parse(token.jsonData);
    } catch {
      console.log(`📦 Validation FAIL [${tokenIdPrefix}]: invalid JSON`);
      return {
        isValid: false,
        reason: "Failed to parse token jsonData as JSON",
      };
    }

    // Check basic structure
    if (!this.hasValidTxfStructure(txfToken)) {
      console.log(`📦 Validation FAIL [${tokenIdPrefix}]: missing TXF structure (genesis/state)`);
      return {
        isValid: false,
        reason: "Token jsonData missing required TXF fields (genesis, state)",
      };
    }

    // Check for uncommitted transactions
    const uncommitted = this.getUncommittedTransactions(txfToken);
    if (uncommitted.length > 0) {
      const recovered = await this.fetchMissingProofs(token);
      if (recovered) {
        return { isValid: true, token: recovered };
      }

      console.warn(`📦 Validation FAIL [${tokenIdPrefix}]: uncommitted transactions, proofs not recoverable`);
      return {
        isValid: false,
        reason: `${uncommitted.length} uncommitted transaction(s), could not fetch proofs from aggregator`,
      };
    }

    // Verify token using SDK (if trust base available)
    try {
      const verificationResult = await this.verifyWithSdk(txfToken);
      if (!verificationResult.success) {
        console.warn(`📦 Validation FAIL [${tokenIdPrefix}]: SDK verification failed - ${verificationResult.error}`);
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
      if (tx.inclusionProof === null && tx.newStateHash) {
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
  // Pending Transaction Validation
  // ==========================================

  /**
   * Check if a pending transaction can still be submitted
   * Returns false if the source state is already spent (transaction is dead)
   *
   * CRITICAL: This prevents tokens from being stuck in PENDING state forever
   * when another device has already committed a different transaction from the same state
   */
  async isPendingTransactionSubmittable(
    token: LocalToken,
    pendingTxIndex: number
  ): Promise<{ submittable: boolean; reason?: string; action?: ValidationAction }> {
    const txf = tokenToTxf(token);
    if (!txf) {
      return { submittable: false, reason: "Invalid token", action: "DISCARD_FORK" };
    }

    const pendingTx = txf.transactions[pendingTxIndex];
    if (!pendingTx) {
      return { submittable: false, reason: "Transaction index out of bounds", action: "DISCARD_FORK" };
    }

    // If already committed, it's not pending
    if (pendingTx.inclusionProof !== null) {
      return { submittable: true, action: "ACCEPT" };
    }

    // Get the state hash BEFORE this pending transaction
    let prevStateHash: string;
    if (pendingTxIndex === 0) {
      // First transaction - source state is genesis state
      prevStateHash = txf.genesis.inclusionProof.authenticator.stateHash;
    } else {
      // Previous transaction's new state
      const prevTx = txf.transactions[pendingTxIndex - 1];
      if (!prevTx) {
        return { submittable: false, reason: "Previous transaction not found", action: "DISCARD_FORK" };
      }
      if (!prevTx.newStateHash) {
        // Old token format without newStateHash - can't verify, assume submittable
        return { submittable: true, reason: "Cannot verify - missing newStateHash on previous tx", action: "RETRY_LATER" };
      }
      prevStateHash = prevTx.newStateHash;
    }

    // Check if that state is already spent
    const trustBase = await this.getTrustBase();
    if (!trustBase) {
      // Can't verify - assume submittable (retry later)
      return { submittable: true, reason: "Cannot verify - trust base unavailable", action: "RETRY_LATER" };
    }

    let client: unknown;
    try {
      const { ServiceProvider } = await import("./ServiceProvider");
      client = ServiceProvider.stateTransitionClient;
    } catch {
      return { submittable: true, reason: "Cannot verify - client unavailable", action: "RETRY_LATER" };
    }

    if (!client) {
      return { submittable: true, reason: "Cannot verify - client is null", action: "RETRY_LATER" };
    }

    try {
      // Use SDK to check if source state is spent
      const { Token } = await import("@unicitylabs/state-transition-sdk/lib/token/Token");
      const sdkToken = await Token.fromJSON(txf);

      // Get token owner public key from IdentityManager
      const { IdentityManager } = await import("./IdentityManager");
      const identity = await IdentityManager.getInstance().getCurrentIdentity();
      if (!identity?.publicKey) {
        return { submittable: true, reason: "Cannot verify - no identity", action: "RETRY_LATER" };
      }

      const pubKeyBytes = Buffer.from(identity.publicKey, "hex");

      // Check if token state is spent
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const isSpent = await (client as any).isTokenStateSpent(
        trustBase,
        sdkToken,
        pubKeyBytes
      );

      if (isSpent) {
        return {
          submittable: false,
          reason: `Source state ${prevStateHash.slice(0, 12)}... already spent - transaction can never be committed`,
          action: "DISCARD_FORK"
        };
      }

      return { submittable: true, action: "ACCEPT" };
    } catch (err) {
      // On error, assume submittable but retry later
      console.warn(`📦 isPendingTransactionSubmittable: Error checking state:`, err);
      return {
        submittable: true,
        reason: `Verification error: ${err instanceof Error ? err.message : String(err)}`,
        action: "RETRY_LATER"
      };
    }
  }

  /**
   * Check all pending transactions in a token and return their status
   * Useful for UI to show which transactions are dead vs just pending
   */
  async checkAllPendingTransactions(
    token: LocalToken
  ): Promise<{
    pendingCount: number;
    submittable: number;
    dead: number;
    deadTransactions: { index: number; reason: string }[];
  }> {
    const txf = tokenToTxf(token);
    if (!txf) {
      return { pendingCount: 0, submittable: 0, dead: 0, deadTransactions: [] };
    }

    let pendingCount = 0;
    let submittable = 0;
    let dead = 0;
    const deadTransactions: { index: number; reason: string }[] = [];

    for (let i = 0; i < txf.transactions.length; i++) {
      const tx = txf.transactions[i];
      if (tx.inclusionProof === null) {
        pendingCount++;
        const result = await this.isPendingTransactionSubmittable(token, i);
        if (result.submittable) {
          submittable++;
        } else {
          dead++;
          deadTransactions.push({ index: i, reason: result.reason || "Unknown" });
        }
      }
    }

    return { pendingCount, submittable, dead, deadTransactions };
  }

  // ==========================================
  // Split Token Validation
  // ==========================================

  /**
   * Validate that split tokens are still valid
   *
   * CRITICAL: Split tokens are only valid if their parent burn transaction was committed.
   * If token was split on Device A (burn + mints), but Device B spent the original
   * token first, Device A's burn is REJECTED and split tokens can NEVER exist.
   *
   * This method:
   * 1. Identifies split tokens (by checking genesis.data.reason for SPLIT_MINT pattern)
   * 2. Verifies the referenced burn transaction was committed on Unicity
   * 3. Returns valid/invalid token lists for the caller to handle
   */
  async validateSplitTokens(
    tokens: LocalToken[]
  ): Promise<{
    valid: LocalToken[];
    invalid: LocalToken[];
    errors: { tokenId: string; reason: string }[];
  }> {
    const valid: LocalToken[] = [];
    const invalid: LocalToken[] = [];
    const errors: { tokenId: string; reason: string }[] = [];

    for (const token of tokens) {
      const txf = tokenToTxf(token);
      if (!txf) {
        invalid.push(token);
        errors.push({ tokenId: token.id, reason: "Invalid TXF structure" });
        continue;
      }

      // Check if this is a split token by examining genesis.data.reason
      // Split tokens typically have a reason field referencing the parent burn
      const genesisData = txf.genesis?.data;
      const reason = genesisData?.reason;

      // If no reason field, not a split token - assume valid
      if (!reason) {
        valid.push(token);
        continue;
      }

      // Parse the reason to check if it's a split mint
      // Common patterns: "SPLIT_MINT:<burnTxHash>" or JSON with splitMintReason
      let burnTxHash: string | null = null;

      if (typeof reason === "string") {
        // Check for SPLIT_MINT prefix
        if (reason.startsWith("SPLIT_MINT:")) {
          burnTxHash = reason.substring("SPLIT_MINT:".length);
        }
        // Check for JSON format
        else if (reason.startsWith("{")) {
          try {
            const reasonObj = JSON.parse(reason);
            if (reasonObj.splitMintReason?.burnTransactionHash) {
              burnTxHash = reasonObj.splitMintReason.burnTransactionHash;
            } else if (reasonObj.burnTransactionHash) {
              burnTxHash = reasonObj.burnTransactionHash;
            }
          } catch {
            // Not JSON, continue checking other formats
          }
        }
      }

      // If no burn transaction reference found, not a split token - assume valid
      if (!burnTxHash) {
        valid.push(token);
        continue;
      }

      // This is a split token - verify the burn was committed
      const burnCommitted = await this.checkBurnTransactionCommitted(burnTxHash);

      if (burnCommitted.committed) {
        valid.push(token);
      } else {
        invalid.push(token);
        errors.push({
          tokenId: token.id,
          reason: burnCommitted.error || "Burn transaction not committed - split token invalid"
        });
        console.warn(`⚠️ Split token ${token.id.slice(0, 8)}... is INVALID: ${burnCommitted.error}`);
      }
    }
    return { valid, invalid, errors };
  }

  /**
   * Check if a burn transaction was committed on Unicity
   * Used to validate split tokens whose existence depends on the burn being committed
   */
  private async checkBurnTransactionCommitted(
    burnTxHash: string
  ): Promise<{ committed: boolean; error?: string }> {
    // Get trust base for verification
    const trustBase = await this.getTrustBase();
    if (!trustBase) {
      // Can't verify - assume committed (safe fallback to avoid false negatives)
      return { committed: true, error: "Cannot verify - trust base unavailable" };
    }

    try {
      // Try to fetch the inclusion proof for the burn transaction
      // If it exists, the burn was committed
      const proof = await this.fetchProofFromAggregator(burnTxHash);

      if (proof) {
        return { committed: true };
      }

      // No proof found - check if it's just pending or actually rejected
      // For safety, we can't definitively say it's rejected without more context
      // Return not committed but allow retry
      return {
        committed: false,
        error: "Burn transaction proof not found - may be pending or rejected"
      };
    } catch (err) {
      return {
        committed: false,
        error: `Failed to verify burn: ${err instanceof Error ? err.message : String(err)}`
      };
    }
  }

  /**
   * Identify which tokens in a list are split tokens
   * Useful for filtering before validation
   */
  identifySplitTokens(tokens: LocalToken[]): {
    splitTokens: LocalToken[];
    regularTokens: LocalToken[];
  } {
    const splitTokens: LocalToken[] = [];
    const regularTokens: LocalToken[] = [];

    for (const token of tokens) {
      const txf = tokenToTxf(token);
      if (!txf) {
        regularTokens.push(token);
        continue;
      }

      const reason = txf.genesis?.data?.reason;

      // Check if reason indicates a split token
      const isSplit = reason && (
        (typeof reason === "string" && reason.startsWith("SPLIT_MINT:")) ||
        (typeof reason === "string" && reason.includes("burnTransactionHash"))
      );

      if (isSplit) {
        splitTokens.push(token);
      } else {
        regularTokens.push(token);
      }
    }

    return { splitTokens, regularTokens };
  }

  // ==========================================
  // Spent Token Detection
  // ==========================================

  /**
   * Check which tokens are NOT spent (unspent) on Unicity
   * Used for sanity check when importing remote tombstones/missing tokens
   * Requires full TxfToken data for SDK-based verification
   * Returns array of tokenIds that are still valid/unspent
   *
   * NOTE: This now uses checkSingleTokenSpent internally to respect dev mode bypass
   *
   * @param options.treatErrorsAsUnspent - If true (default), network errors assume token is unspent.
   *   Use false for tombstone recovery where errors should NOT restore tokens.
   *   - true: errors → assume unspent → for live tokens, safe (don't delete)
   *   - false: errors → assume spent → for tombstones, safe (don't restore)
   */
  async checkUnspentTokens(
    tokens: Map<string, TxfToken>,
    publicKey: string,
    options?: { treatErrorsAsUnspent?: boolean }
  ): Promise<string[]> {
    if (tokens.size === 0) return [];

    // Default to true for backward compatibility (safe for live token sanity checks)
    const treatErrorsAsUnspent = options?.treatErrorsAsUnspent ?? true;

    const unspentTokenIds: string[] = [];

    console.log(`📦 Sanity check (checkUnspentTokens): Verifying ${tokens.size} token(s) with aggregator...`);

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

    // Use checkSingleTokenSpent which has dev mode bypass logic
    for (const [tokenId, txfToken] of tokens) {
      try {
        // Create a LocalToken-like object for checkSingleTokenSpent
        const localToken = {
          id: tokenId,
          jsonData: JSON.stringify(txfToken),
        } as LocalToken;

        const result = await this.checkSingleTokenSpent(localToken, publicKey, trustBase, client);

        if (result.error) {
          if (treatErrorsAsUnspent) {
            // Safe fallback for live tokens: assume unspent → don't delete
            unspentTokenIds.push(tokenId);
          }
          // Safe fallback for tombstones: assume spent → don't restore (no action needed)
        } else if (!result.spent) {
          unspentTokenIds.push(tokenId);
        }
        // If spent, no action needed
      } catch (err) {
        console.warn(`📦 Sanity check: Exception checking token ${tokenId.slice(0, 8)}...:`, err);
        if (treatErrorsAsUnspent) {
          // Safe fallback for live tokens: assume unspent → don't delete
          unspentTokenIds.push(tokenId);
        }
        // Safe fallback for tombstones: assume spent → don't restore (no action needed)
      }
    }
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
   * Check if a single token's current state is spent.
   *
   * Uses SDK's getInclusionProof to query the aggregator:
   * - Inclusion proof (authenticator !== null) = SPENT
   * - Exclusion proof (authenticator === null) = UNSPENT
   *
   * When trust base verification is skipped (dev mode), we skip the
   * cryptographic verification of the proof but still use the SDK's
   * aggregator query logic.
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
    const localStateHash = getCurrentStateHash(txfToken);

    // Try cache lookup if we have a local stateHash
    if (localStateHash) {
      const cacheKey = this.getSpentStateCacheKey(tokenId, localStateHash, publicKey);
      const cachedResult = this.getSpentStateFromCache(cacheKey);
      if (cachedResult !== null) {
        return {
          tokenId,
          localId: token.id,
          stateHash: localStateHash,
          spent: cachedResult,
        };
      }
    }

    // CACHE MISS - query aggregator
    try {
      const { ServiceProvider } = await import("./ServiceProvider");
      const skipVerification = ServiceProvider.isTrustBaseVerificationSkipped();

      let spent: boolean;

      if (skipVerification) {
        // DEV MODE: Use SDK Token object directly, skip trust base verification only
        // This ensures we create the exact same RequestId as the SDK
        const { Token } = await import(
          "@unicitylabs/state-transition-sdk/lib/token/Token"
        );
        const { RequestId } = await import(
          "@unicitylabs/state-transition-sdk/lib/api/RequestId"
        );

        // Parse TXF into SDK Token object
        const sdkToken = await Token.fromJSON(txfToken);
        const pubKeyBytes = Buffer.from(publicKey, "hex");

        // Verify ownership - the publicKey must match the token's predicate
        const { PredicateEngineService } = await import(
          "@unicitylabs/state-transition-sdk/lib/predicate/PredicateEngineService"
        );
        const predicate = await PredicateEngineService.createPredicate(sdkToken.state.predicate);
        const isOwner = await predicate.isOwner(pubKeyBytes);
        if (!isOwner) {
          console.warn(`⚠️ [SpentCheck] PublicKey does NOT match token predicate - wrong key being used`);
        }

        // Use SDK's method to calculate state hash (matches what TransferCommitment uses)
        const calculatedStateHash = await sdkToken.state.calculateHash();

        // Create RequestId exactly as SDK does internally
        const requestId = await RequestId.create(pubKeyBytes, calculatedStateHash);

        const calculatedStateHashStr = calculatedStateHash.toJSON();
        const hashesMatch = !localStateHash || calculatedStateHashStr === localStateHash;

        // CRITICAL FIX: If calculated hash doesn't match expected hash, DON'T query aggregator
        // Querying with wrong hash will check wrong SMT slot and may return false "spent" result
        // This protects against incorrectly archiving valid tokens
        if (!hashesMatch) {
          console.warn(`⚠️ [SpentCheck] Hash mismatch for ${tokenId.slice(0, 16)}... - treating as UNSPENT (safe default)`);

          // Return unspent - don't archive tokens when we can't verify their state
          return {
            tokenId,
            localId: token.id,
            stateHash: localStateHash || calculatedStateHashStr,
            spent: false,
            error: "Hash mismatch - treating as unspent for safety",
          };
        }

        // Query aggregator for inclusion/exclusion proof
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const response = await (client as any).getInclusionProof(requestId);

        if (!response.inclusionProof) {
          spent = false;
        } else {
          const proof = response.inclusionProof;

          // CRITICAL: Verify the hashpath cryptographically corresponds to our RequestId
          // This prevents accepting a proof meant for a different RequestId
          const pathResult = await proof.merkleTreePath.verify(
            requestId.toBitString().toBigInt()
          );

          if (!pathResult.isPathValid) {
            // Hashpath doesn't hash to claimed root - invalid proof
            throw new Error("Invalid hashpath - does not verify against root");
          } else if (pathResult.isPathIncluded && proof.authenticator !== null) {
            // Valid INCLUSION proof: path leads to RequestId AND authenticator present
            spent = true;
          } else if (!pathResult.isPathIncluded && proof.authenticator === null) {
            // Valid EXCLUSION proof: path shows deviation point, no authenticator
            spent = false;
          } else if (pathResult.isPathIncluded && proof.authenticator === null) {
            // SECURITY: Path leads to our RequestId but no authenticator!
            // This is INVALID - a rogue aggregator might be hiding the spent status
            console.error(`❌ SECURITY VIOLATION: pathIncluded=true but authenticator=null for token ${tokenId.slice(0, 16)}...`);
            throw new Error("Invalid proof: path included but missing authenticator");
          } else {
            // Contradictory: authenticator present but path doesn't lead to RequestId
            throw new Error("Invalid proof: authenticator present but path not included");
          }
        }
        // Cache using SDK-calculated state hash
        const sdkCacheKey = this.getSpentStateCacheKey(tokenId, calculatedStateHashStr, publicKey);
        this.cacheSpentState(sdkCacheKey, spent);

        return {
          tokenId,
          localId: token.id,
          stateHash: calculatedStateHashStr,
          spent,
        };
      } else {
        // PRODUCTION MODE: Use SDK's isTokenStateSpent with full verification
        const { Token } = await import(
          "@unicitylabs/state-transition-sdk/lib/token/Token"
        );
        const sdkToken = await Token.fromJSON(txfToken);
        const pubKeyBytes = Buffer.from(publicKey, "hex");

        // Get state hash for caching/return
        const prodStateHash = await sdkToken.state.calculateHash();
        const prodStateHashStr = prodStateHash.toJSON();

        // CRITICAL FIX: Check for hash mismatch in production mode too
        const prodHashesMatch = !localStateHash || prodStateHashStr === localStateHash;
        if (!prodHashesMatch) {
          console.warn(`⚠️ [SpentCheck/Prod] Hash mismatch for ${tokenId.slice(0, 16)}... - treating as UNSPENT (safe default)`);

          return {
            tokenId,
            localId: token.id,
            stateHash: localStateHash || prodStateHashStr,
            spent: false,
            error: "Hash mismatch - treating as unspent for safety",
          };
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const isSpent = await (client as any).isTokenStateSpent(
          trustBase,
          sdkToken,
          pubKeyBytes
        );

        spent = isSpent === true;

        // Cache using SDK-calculated state hash
        const prodCacheKey = this.getSpentStateCacheKey(tokenId, prodStateHashStr, publicKey);
        this.cacheSpentState(prodCacheKey, spent);

        return {
          tokenId,
          localId: token.id,
          stateHash: prodStateHashStr,
          spent,
        };
      }
    } catch (err) {
      // Don't cache errors - allow retry
      return {
        tokenId,
        localId: token.id,
        stateHash: localStateHash || "",
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
      // Skip SDK verification if trust base verification is bypassed (dev mode)
      const { ServiceProvider } = await import("./ServiceProvider");
      if (ServiceProvider.isTrustBaseVerificationSkipped()) {
        return { success: true };
      }

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
        console.warn(`📦 SDK verify: FAILED - ${String(result)}`);
        return {
          success: false,
          error: String(result) || "Verification failed",
        };
      }

      return { success: true };
    } catch (err) {
      // Log the specific error for debugging
      console.warn(`📦 SDK verification exception:`, err instanceof Error ? err.message : err);
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
