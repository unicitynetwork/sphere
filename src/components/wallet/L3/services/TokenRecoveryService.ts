/**
 * Token Recovery Service
 *
 * Emergency recovery for orphaned split tokens.
 * When a split operation fails mid-way (browser crash, network error),
 * the change token may exist on the blockchain but not in the local wallet.
 *
 * This service:
 * 1. Scans archived tokens for potential orphaned splits (tokens with 0 transactions)
 * 2. Reconstructs deterministic change token IDs from the split parameters
 * 3. Queries the aggregator to verify change token exists on-chain
 * 4. Reconstructs the change token and adds it to the wallet
 */

import { Token, TokenStatus } from "../data/model";
import {
  getTokensForAddress,
  getArchivedTokensForAddress,
  addToken,
  removeToken
} from "./InventorySyncService";
import type { InvalidTokenEntry, TxfStorageData } from "./types/TxfTypes";
import { STORAGE_KEY_GENERATORS } from "../../../../config/storageKeys";
import { IdentityManager } from "./IdentityManager";
import { ServiceProvider } from "./ServiceProvider";
import type { TxfToken, TxfTransaction } from "./types/TxfTypes";
import { getCurrentStateHash, tokenToTxf } from "./TxfSerializer";
import { getTokenValidationService } from "./TokenValidationService";
import { Buffer } from "buffer";

// Unicity ID (nametag) token type identifier
const UNICITY_TOKEN_TYPE_HEX = "f8aa13834268d29355ff12183066f0cb902003629bbc5eb9ef0efbe397867509";

// ==========================================
// Error Classification Types (Aggregator Failures)
// ==========================================

/**
 * Classification of aggregator errors
 * - ALREADY_SPENT: Token state consumed by another transaction
 * - AUTHENTICATOR_FAILED: Signature/auth verification failed
 * - REQUEST_ID_MISMATCH: Request ID doesn't match expected
 * - NETWORK_ERROR: Technical/connectivity issue - skip recovery
 * - OTHER_REJECTION: Any other rejection error
 */
export type AggregatorErrorType =
  | "ALREADY_SPENT"
  | "AUTHENTICATOR_FAILED"
  | "REQUEST_ID_MISMATCH"
  | "NETWORK_ERROR"
  | "OTHER_REJECTION";

/**
 * Recovery action taken after error classification
 * - REMOVE_AND_TOMBSTONE: Token is invalid, deleted permanently
 * - REVERT_AND_KEEP: Reverted to committed state, token still valid
 * - REVERT_AND_TOMBSTONE: Reverted but sanity check found it spent
 * - NO_ACTION: No recovery action needed/possible
 */
export type FailureRecoveryAction =
  | "REMOVE_AND_TOMBSTONE"
  | "REVERT_AND_KEEP"
  | "REVERT_AND_TOMBSTONE"
  | "NO_ACTION";

/**
 * Result of a transfer failure recovery attempt
 */
export interface FailureRecoveryResult {
  success: boolean;
  action: FailureRecoveryAction;
  tokenId: string;
  tokenRestored?: boolean;         // True if token was reverted and kept
  tokenRemoved?: boolean;          // True if token was removed
  tombstoned?: boolean;            // True if tombstone was added
  skippedDueToNetworkError?: boolean; // True if skipped due to network error
  error?: string;                  // Error message if recovery failed
}

/**
 * Result of checking if a token is spent
 */
export interface SpentCheckResult {
  isSpent: boolean;
  stateHash: string;
  error?: string;
}

// ==========================================
// Orphan Recovery Types
// ==========================================

export interface RecoveredToken {
  tokenId: string;
  amount: string;
  coinId: string;
  sourceTokenId: string;
  recoveryMethod: "split_change" | "split_recipient";
}

export interface RecoveryResult {
  recoveredTokens: RecoveredToken[];
  errors: string[];
  scannedArchived: number;
}

export interface OrphanCandidate {
  archivedTokenId: string;
  archivedTxf: TxfToken;
  possibleSplitAmounts: { splitAmount: string; remainderAmount: string; coinId: string }[];
}

// ==========================================
// Nametag-Invalidated Token Recovery Types
// ==========================================

/**
 * Result of recovering tokens invalidated due to nametag proof issues
 */
export interface NametagRecoveryResult {
  /** Number of tokens recovered */
  recovered: number;
  /** Number of tokens still invalid after re-validation */
  stillInvalid: number;
  /** Token IDs that were recovered */
  recoveredTokenIds: string[];
  /** Errors encountered during recovery */
  errors: string[];
}

// ==========================================
// TokenRecoveryService
// ==========================================

export class TokenRecoveryService {
  private static instance: TokenRecoveryService | null = null;
  private identityManager: IdentityManager;
  private isRecovering: boolean = false;

  private constructor() {
    this.identityManager = IdentityManager.getInstance();
  }

  static getInstance(): TokenRecoveryService {
    if (!TokenRecoveryService.instance) {
      TokenRecoveryService.instance = new TokenRecoveryService();
    }
    return TokenRecoveryService.instance;
  }

  // ==========================================
  // Public API
  // ==========================================

  /**
   * Scan archived tokens and attempt to recover any orphaned split change tokens.
   * Should be called:
   * - On wallet load
   * - After IPFS sync completes
   * - Manually via wallet settings
   */
  async recoverOrphanedSplitTokens(): Promise<RecoveryResult> {
    if (this.isRecovering) {
      console.log("🔧 Recovery already in progress, skipping...");
      return { recoveredTokens: [], errors: ["Recovery already in progress"], scannedArchived: 0 };
    }

    this.isRecovering = true;
    const result: RecoveryResult = {
      recoveredTokens: [],
      errors: [],
      scannedArchived: 0,
    };

    try {
      console.log("🔧 Starting orphaned split token recovery scan...");

      // Get identity context
      const identity = await this.identityManager.getCurrentIdentity();
      if (!identity) {
        throw new Error("No identity available");
      }

      // 1. Get all archived tokens
      const archivedTokens = getArchivedTokensForAddress(identity.address);
      result.scannedArchived = archivedTokens.size;

      if (archivedTokens.size === 0) {
        console.log("🔧 No archived tokens to scan");
        return result;
      }

      // 2. Get current wallet tokens for comparison
      const currentTokens = await getTokensForAddress(identity.address);
      const currentTokenIds = this.extractCurrentTokenIds(currentTokens);

      // 3. Find orphan candidates (archived tokens that look like they were split)
      const orphanCandidates = this.findOrphanCandidates(archivedTokens, currentTokenIds);

      if (orphanCandidates.length === 0) {
        console.log("🔧 No orphan candidates found");
        return result;
      }

      console.log(`🔧 Found ${orphanCandidates.length} potential orphan candidates`);

      // 4. For each candidate, try to recover change tokens
      for (const candidate of orphanCandidates) {
        try {
          const recovered = await this.attemptRecovery(candidate, currentTokenIds, identity);
          if (recovered) {
            result.recoveredTokens.push(recovered);
            // Update currentTokenIds to prevent re-recovery
            currentTokenIds.add(recovered.tokenId);
          }
        } catch (err) {
          const errorMsg = `Failed to recover from ${candidate.archivedTokenId.slice(0, 8)}...: ${err instanceof Error ? err.message : String(err)}`;
          console.error(`🔧 ${errorMsg}`);
          result.errors.push(errorMsg);
        }
      }

      console.log(`🔧 Recovery complete: ${result.recoveredTokens.length} tokens recovered, ${result.errors.length} errors`);

      return result;
    } finally {
      this.isRecovering = false;
    }
  }

  /**
   * Recover tokens that were invalidated due to nametag inclusion proof failures.
   *
   * Per TOKEN_INVENTORY_SPEC.md Section 13.26:
   * After the nametag proof has been recovered, tokens that previously failed
   * validation due to "Inclusion proof verification failed" in nametag verification
   * can now be re-validated and moved back to active inventory.
   *
   * This method:
   * 1. Loads invalid tokens from localStorage
   * 2. Filters for tokens that failed due to nametag-related issues
   * 3. Re-validates each token using TokenValidationService
   * 4. Moves recovered tokens back to active inventory
   * 5. Removes recovered tokens from the _invalid array
   *
   * @returns Recovery statistics including count of recovered and still-invalid tokens
   */
  async recoverNametagInvalidatedTokens(): Promise<NametagRecoveryResult> {
    const result: NametagRecoveryResult = {
      recovered: 0,
      stillInvalid: 0,
      recoveredTokenIds: [],
      errors: [],
    };

    try {
      // Get identity context
      const identity = await this.identityManager.getCurrentIdentity();
      if (!identity) {
        result.errors.push("No identity available");
        return result;
      }

      if (!identity.ipnsName) {
        result.errors.push("No IPNS name available");
        return result;
      }

      // Load invalid tokens from localStorage
      const storageKey = STORAGE_KEY_GENERATORS.walletByAddress(identity.address);
      const json = localStorage.getItem(storageKey);
      if (!json) {
        console.log("🔧 No wallet data in localStorage - nothing to recover");
        return result;
      }

      let storageData: TxfStorageData;
      try {
        storageData = JSON.parse(json);
      } catch {
        result.errors.push("Failed to parse localStorage data");
        return result;
      }

      const invalidTokens = storageData._invalid || [];
      if (invalidTokens.length === 0) {
        console.log("🔧 No invalid tokens to recover");
        return result;
      }

      console.log(`🔧 Scanning ${invalidTokens.length} invalid tokens for nametag-related failures...`);

      // Filter for tokens that failed due to nametag inclusion proof issues
      // These have SDK_VALIDATION reason with "Inclusion proof verification failed" in details
      const nametagFailures = invalidTokens.filter((entry: InvalidTokenEntry) => {
        if (entry.reason !== "SDK_VALIDATION") return false;

        const details = entry.details || "";
        // Check for nametag-related inclusion proof failures
        return (
          details.includes("Inclusion proof verification failed") ||
          details.includes("Nametag verification")
        );
      });

      if (nametagFailures.length === 0) {
        console.log("🔧 No nametag-related failures found in invalid tokens");
        return result;
      }

      console.log(`🔧 Found ${nametagFailures.length} tokens with nametag-related failures, attempting recovery...`);

      // Get validation service
      const validationService = getTokenValidationService();

      // Track which tokens to remove from _invalid
      const recoveredEntries: InvalidTokenEntry[] = [];
      const stillInvalidEntries: InvalidTokenEntry[] = [];

      // Re-validate each token
      for (const entry of nametagFailures) {
        const tokenId = entry.token.genesis?.data?.tokenId || "unknown";
        const tokenIdShort = tokenId.slice(0, 8);

        try {
          console.log(`🔧 Re-validating token ${tokenIdShort}...`);

          // Convert TxfToken to LocalToken for validation
          const localToken = new Token({
            id: tokenId,
            name: entry.token.genesis?.data?.tokenType === UNICITY_TOKEN_TYPE_HEX ? "Nametag" : "Token",
            type: "UCT",
            timestamp: entry.timestamp,
            status: TokenStatus.CONFIRMED,
            amount: entry.token.genesis?.data?.coinData?.[0]?.[1] || "0",
            coinId: entry.token.genesis?.data?.coinData?.[0]?.[0] || "",
            symbol: "UCT",
            jsonData: JSON.stringify(entry.token),
          });

          // Re-validate with current nametag (which now has valid proof)
          const validationResult = await validationService.validateToken(localToken);

          if (validationResult.isValid && validationResult.token) {
            console.log(`✅ Token ${tokenIdShort}... passed validation - recovering`);

            // Add back to active inventory via inventorySync
            await addToken(
              identity.address,
              identity.publicKey,
              identity.ipnsName,
              validationResult.token,
              { local: true }
            );

            recoveredEntries.push(entry);
            result.recovered++;
            result.recoveredTokenIds.push(tokenId);
          } else {
            console.log(`❌ Token ${tokenIdShort}... still invalid: ${validationResult.reason}`);
            stillInvalidEntries.push(entry);
            result.stillInvalid++;
          }
        } catch (err) {
          const errorMsg = `Failed to re-validate token ${tokenIdShort}...: ${err instanceof Error ? err.message : String(err)}`;
          console.error(`🔧 ${errorMsg}`);
          result.errors.push(errorMsg);
          stillInvalidEntries.push(entry);
          result.stillInvalid++;
        }
      }

      // Remove recovered tokens from _invalid array
      if (recoveredEntries.length > 0) {
        const recoveredTokenIds = new Set(recoveredEntries.map(e => e.token.genesis?.data?.tokenId));

        // Filter out recovered entries from _invalid
        storageData._invalid = invalidTokens.filter((entry: InvalidTokenEntry) => {
          const tokenId = entry.token.genesis?.data?.tokenId;
          return !recoveredTokenIds.has(tokenId);
        });

        // Save updated storage data
        localStorage.setItem(storageKey, JSON.stringify(storageData));

        console.log(`🔧 Removed ${recoveredEntries.length} recovered tokens from _invalid list`);
      }

      console.log(`🔧 Nametag token recovery complete: ${result.recovered} recovered, ${result.stillInvalid} still invalid`);

      // Trigger wallet update event
      if (result.recovered > 0) {
        window.dispatchEvent(new Event("wallet-updated"));
      }

      return result;
    } catch (err) {
      const errorMsg = `Nametag token recovery failed: ${err instanceof Error ? err.message : String(err)}`;
      console.error(`🔧 ${errorMsg}`);
      result.errors.push(errorMsg);
      return result;
    }
  }

  // ==========================================
  // Transfer Failure Recovery API
  // ==========================================

  /**
   * Detect if an error is a network/technical error that should skip recovery.
   * Network errors mean the aggregator never processed the commitment,
   * so the token state is unchanged and we should just retry later.
   */
  private isNetworkError(errorStatus: string): boolean {
    const networkPatterns = [
      // Fetch/connection errors
      /fetch failed/i,
      /network error/i,
      /failed to fetch/i,
      /network request failed/i,
      /ECONNREFUSED/i,
      /ECONNRESET/i,
      /ETIMEDOUT/i,
      /ENETUNREACH/i,
      /socket hang up/i,
      // HTTP server errors (5xx)
      /^5\d{2}$/,
      /502/i,
      /503/i,
      /504/i,
      /service unavailable/i,
      /bad gateway/i,
      /gateway timeout/i,
      // Timeout patterns
      /timeout/i,
      /timed out/i,
      /request timeout/i,
      // AbortError
      /aborted/i,
      /abort/i,
    ];

    return networkPatterns.some(pattern => pattern.test(errorStatus));
  }

  /**
   * Classify an aggregator error to determine recovery action
   * For ambiguous errors, checks if token state is actually spent
   */
  async classifyAggregatorError(
    errorStatus: string,
    token: Token,
    publicKey: string
  ): Promise<AggregatorErrorType> {
    // First: Check if this is a network error (skip recovery)
    if (this.isNetworkError(errorStatus)) {
      console.log(`📦 Recovery: Detected network error: ${errorStatus}`);
      return "NETWORK_ERROR";
    }

    // Direct mapping for known error statuses
    if (errorStatus === "AUTHENTICATOR_VERIFICATION_FAILED") {
      return "AUTHENTICATOR_FAILED";
    }
    if (errorStatus === "REQUEST_ID_MISMATCH") {
      return "REQUEST_ID_MISMATCH";
    }

    // For CHECK_SPENT flag or unknown errors, verify token state
    if (errorStatus === "CHECK_SPENT" || errorStatus === "ALREADY_SPENT") {
      const spentCheck = await this.checkTokenSpent(token, publicKey);
      if (spentCheck.isSpent) {
        return "ALREADY_SPENT";
      }
    }

    // For other errors, also check if token is spent
    // (could be a race condition where token was spent during submission)
    const spentCheck = await this.checkTokenSpent(token, publicKey);
    if (spentCheck.isSpent) {
      return "ALREADY_SPENT";
    }

    return "OTHER_REJECTION";
  }

  /**
   * Check if a token's current state is spent
   */
  async checkTokenSpent(
    token: Token,
    publicKey: string
  ): Promise<SpentCheckResult> {
    const txf = tokenToTxf(token);
    if (!txf) {
      return { isSpent: false, stateHash: "", error: "Invalid token structure" };
    }

    const stateHash = getCurrentStateHash(txf) ?? "";
    const tokenId = txf.genesis?.data?.tokenId || token.id;

    try {
      const validationService = getTokenValidationService();
      const result = await validationService.checkSpentTokens([token], publicKey);

      // Check if this specific token was found as spent
      const isSpent = result.spentTokens.some(
        s => s.tokenId === tokenId || s.localId === token.id
      );

      return { isSpent, stateHash };
    } catch (err) {
      return {
        isSpent: false,
        stateHash,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Revert a token to its last committed state
   * Strips uncommitted transactions (those without inclusion proof)
   */
  revertToCommittedState(token: Token): Token | null {
    const txf = tokenToTxf(token);
    if (!txf) {
      console.warn(`📦 Recovery: Cannot parse token ${token.id.slice(0, 8)}... for reversion`);
      return null;
    }

    const transactions = txf.transactions || [];

    // Find the last committed transaction (has inclusionProof)
    let lastCommittedIndex = -1;
    for (let i = 0; i < transactions.length; i++) {
      if (transactions[i].inclusionProof !== null) {
        lastCommittedIndex = i;
      }
    }

    // Check if there are uncommitted transactions to strip
    const hasUncommitted = transactions.length > 0 && lastCommittedIndex < transactions.length - 1;
    if (!hasUncommitted) {
      // All transactions are committed (or no transactions), nothing to revert
      console.log(`📦 Recovery: Token ${token.id.slice(0, 8)}... has no uncommitted transactions`);
      return token;
    }

    // Strip uncommitted transactions
    if (lastCommittedIndex === -1) {
      // No committed transactions, keep only genesis state
      txf.transactions = [];
      console.log(`📦 Recovery: Reverted token ${token.id.slice(0, 8)}... to genesis state`);
    } else {
      // Keep only committed transactions
      txf.transactions = transactions.slice(0, lastCommittedIndex + 1);
      console.log(`📦 Recovery: Reverted token ${token.id.slice(0, 8)}... to transaction ${lastCommittedIndex}`);
    }

    // Create new Token with reverted jsonData
    return new Token({
      ...token,
      jsonData: JSON.stringify(txf),
      status: TokenStatus.CONFIRMED
    });
  }

  /**
   * Handle a failed transfer by recovering the token
   * Main entry point for immediate failure handling
   */
  async handleTransferFailure(
    token: Token,
    errorStatus: string,
    publicKey: string
  ): Promise<FailureRecoveryResult> {
    const tokenId = token.id;
    console.log(`📦 Recovery: Handling transfer failure for token ${tokenId.slice(0, 8)}..., error: ${errorStatus}`);

    // Check for network error first - skip recovery, let retry cycle handle it
    if (this.isNetworkError(errorStatus)) {
      console.log(`📦 Recovery: Network error detected (${errorStatus}), skipping recovery - will retry later`);
      return {
        success: true,
        action: "NO_ACTION",
        tokenId,
        skippedDueToNetworkError: true,
      };
    }

    try {
      // Classify the error
      const errorType = await this.classifyAggregatorError(errorStatus, token, publicKey);
      console.log(`📦 Recovery: Error classified as ${errorType}`);

      if (errorType === "ALREADY_SPENT") {
        // Token state is consumed - remove and tombstone
        return this.removeAndTombstoneToken(token);
      }

      // For other errors, revert to last committed state
      const revertedToken = this.revertToCommittedState(token);
      if (!revertedToken) {
        return {
          success: false,
          action: "NO_ACTION",
          tokenId,
          error: "Failed to revert token state",
        };
      }

      // Run sanity check on reverted token
      const spentCheck = await this.checkTokenSpent(revertedToken, publicKey);
      if (spentCheck.isSpent) {
        // Even after reversion, token is spent - remove and tombstone
        console.log(`📦 Recovery: Reverted token is still spent, removing`);
        return this.removeAndTombstoneToken(token);
      }

      // Token is valid, save the reverted state
      // Get identity context
      const identity = await this.identityManager.getCurrentIdentity();
      if (!identity) {
        return {
          success: false,
          action: "NO_ACTION",
          tokenId,
          error: "No identity available",
        };
      }

      // Add the reverted token back to inventory
      if (!identity.ipnsName) {
        console.warn('No IPNS name available for token recovery');
        return {
          success: false,
          action: "NO_ACTION",
          tokenId,
          error: "No IPNS name available",
        };
      }
      await addToken(
        identity.address,
        identity.publicKey,
        identity.ipnsName,
        revertedToken,
        { local: true } // skipHistory equivalent
      );

      console.log(`📦 Recovery: Token ${tokenId.slice(0, 8)}... reverted and saved`);
      return {
        success: true,
        action: "REVERT_AND_KEEP",
        tokenId,
        tokenRestored: true,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`📦 Recovery: Error handling transfer failure:`, err);
      return {
        success: false,
        action: "NO_ACTION",
        tokenId,
        error: errorMsg,
      };
    }
  }

  /**
   * Handle a failed split burn by restoring the original token
   * Special handling for split operation failures
   */
  async handleSplitBurnFailure(
    originalToken: Token,
    errorStatus: string,
    publicKey: string
  ): Promise<FailureRecoveryResult> {
    const tokenId = originalToken.id;
    console.log(`📦 Recovery: Handling split burn failure for token ${tokenId.slice(0, 8)}..., error: ${errorStatus}`);

    // Check for network error first - skip recovery, let retry cycle handle it
    if (this.isNetworkError(errorStatus)) {
      console.log(`📦 Recovery: Network error detected during burn (${errorStatus}), skipping recovery - will retry later`);
      return {
        success: true,
        action: "NO_ACTION",
        tokenId,
        skippedDueToNetworkError: true,
      };
    }

    // For split burns, the token may have been modified in preparation
    // Try to revert it to the last committed state
    return this.handleTransferFailure(originalToken, errorStatus, publicKey);
  }

  /**
   * Remove a token and add tombstone for its current state
   */
  private async removeAndTombstoneToken(token: Token): Promise<FailureRecoveryResult> {
    const tokenId = token.id;

    console.log(`📦 Recovery: Removing spent token ${tokenId.slice(0, 8)}... and adding tombstone`);

    // Get identity context
    const identity = await this.identityManager.getCurrentIdentity();
    if (!identity) {
      return {
        success: false,
        action: "NO_ACTION",
        tokenId,
        error: "No identity available",
      };
    }

    // Extract state hash from token
    const txf = tokenToTxf(token);
    if (!txf) {
      return {
        success: false,
        action: "NO_ACTION",
        tokenId,
        error: "Cannot convert token to TXF format",
      };
    }

    const stateHash = getCurrentStateHash(txf);
    if (!stateHash) {
      return {
        success: false,
        action: "NO_ACTION",
        tokenId,
        error: "Cannot extract state hash from token",
      };
    }

    // Remove token - this will archive it AND add tombstone automatically
    if (!identity.ipnsName) {
      console.warn('No IPNS name available for tombstone');
      return {
        success: false,
        action: "NO_ACTION",
        tokenId,
        error: "No IPNS name available",
      };
    }
    await removeToken(
      identity.address,
      identity.publicKey,
      identity.ipnsName,
      tokenId,
      stateHash,
      { local: true } // skipHistory equivalent
    );

    return {
      success: true,
      action: "REMOVE_AND_TOMBSTONE",
      tokenId,
      tokenRemoved: true,
      tombstoned: true,
    };
  }

  // ==========================================
  // Private Methods (Orphan Recovery)
  // ==========================================

  /**
   * Extract SDK token IDs from current wallet tokens
   */
  private extractCurrentTokenIds(tokens: Token[]): Set<string> {
    const ids = new Set<string>();

    for (const token of tokens) {
      if (!token.jsonData) continue;

      try {
        const txf = JSON.parse(token.jsonData);
        const tokenId = txf.genesis?.data?.tokenId;
        if (tokenId) {
          ids.add(tokenId);
        }
      } catch {
        // Skip invalid JSON
      }
    }

    return ids;
  }

  /**
   * Find archived tokens that look like they were split but have missing change tokens.
   *
   * Criteria for orphan candidates:
   * 1. Archived token has transactions.length === 0 (was burned directly, not transferred)
   * 2. OR archived token's last transaction is a burn (to a burn predicate address)
   * 3. No corresponding change token in current wallet
   */
  private findOrphanCandidates(
    archivedTokens: Map<string, TxfToken>,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _currentTokenIds: Set<string>
  ): OrphanCandidate[] {
    const candidates: OrphanCandidate[] = [];

    for (const [tokenId, txf] of archivedTokens) {
      // Check if this looks like a potential split source
      // For a split, the original token gets burned (transferred to a burn predicate)

      const transactions = txf.transactions || [];

      // Case 1: Token has exactly 0 transactions in archive
      // This could mean it was archived before the burn tx was recorded
      // OR it was a pristine token that got split
      if (transactions.length === 0) {
        // This token was archived in genesis state - potentially split
        const coinData = txf.genesis?.data?.coinData || [];
        const possibleAmounts = this.extractPossibleSplitAmounts(coinData);

        if (possibleAmounts.length > 0) {
          candidates.push({
            archivedTokenId: tokenId,
            archivedTxf: txf,
            possibleSplitAmounts: possibleAmounts,
          });
        }
        continue;
      }

      // Case 2: Check if last transaction is a burn
      const lastTx = transactions[transactions.length - 1] as TxfTransaction;
      if (this.looksLikeBurnTransaction(lastTx)) {
        const coinData = txf.genesis?.data?.coinData || [];
        const possibleAmounts = this.extractPossibleSplitAmounts(coinData);

        if (possibleAmounts.length > 0) {
          candidates.push({
            archivedTokenId: tokenId,
            archivedTxf: txf,
            possibleSplitAmounts: possibleAmounts,
          });
        }
      }
    }

    return candidates;
  }

  /**
   * Check if a transaction looks like a burn (to burn predicate)
   */
  private looksLikeBurnTransaction(tx: TxfTransaction): boolean {
    // Burn transactions typically have a predicate that encodes the burn destination
    // The predicate format for burns starts with a specific prefix
    // For now, we can check if the newStateHash has the burn pattern
    // This is heuristic - real validation happens when we query the aggregator

    if (!tx.inclusionProof) return false;

    // A burn transaction has been committed (has proof) but the token is archived
    // This suggests the token was spent via burn
    return true; // Conservative: treat any committed final tx as potential burn
  }

  /**
   * Extract possible split amounts from coin data.
   * Returns combinations that could have been split.
   */
  private extractPossibleSplitAmounts(
    coinData: [string, string][]
  ): { splitAmount: string; remainderAmount: string; coinId: string }[] {
    const results: { splitAmount: string; remainderAmount: string; coinId: string }[] = [];

    for (const [coinId, amountStr] of coinData) {
      const totalAmount = BigInt(amountStr || "0");
      if (totalAmount <= BigInt(0)) continue;

      // We don't know the exact split ratio, so we'll try common patterns
      // For recovery, we primarily care about the _sender (change) token
      // The seed string format is: `${tokenIdHex}_${splitAmount}_${remainderAmount}`

      // Strategy: Try to find transactions in history that might reveal split amounts
      // For now, we'll generate candidates based on common split patterns

      // Add the full amount as a candidate (covers case where token wasn't actually split)
      results.push({
        splitAmount: "0",
        remainderAmount: totalAmount.toString(),
        coinId,
      });

      // For real recovery, we'd need to query transaction history or use heuristics
      // The key insight is that split amounts should match what the aggregator has
    }

    return results;
  }

  /**
   * Attempt to recover a change token from an orphan candidate
   */
  private async attemptRecovery(
    candidate: OrphanCandidate,
    currentTokenIds: Set<string>,
    identity: Awaited<ReturnType<typeof IdentityManager.prototype.getCurrentIdentity>>
  ): Promise<RecoveredToken | null> {
    if (!identity) {
      return null;
    }
    const { archivedTokenId, archivedTxf } = candidate;

    console.log(`🔧 Attempting recovery for archived token ${archivedTokenId.slice(0, 8)}...`);

    // Get coin data from genesis
    const coinData = archivedTxf.genesis?.data?.coinData || [];
    if (coinData.length === 0) {
      console.log(`🔧 No coin data in archived token, skipping`);
      return null;
    }

    const [coinId, totalAmountStr] = coinData[0];
    const totalAmount = BigInt(totalAmountStr || "0");

    if (totalAmount <= BigInt(0)) {
      console.log(`🔧 Zero amount in archived token, skipping`);
      return null;
    }

    // Try to find the change token by querying common split patterns
    // We need to iterate through possible split/remainder combinations

    // Strategy 1: Check if there's a transaction history entry that hints at split amounts
    // Strategy 2: Query aggregator for all possible seed combinations

    // For now, implement a conservative approach: check if any deterministic
    // change token ID exists on the aggregator

    // The deterministic ID formula from TokenSplitExecutor:
    // const seedString = `${tokenIdHex}_${splitAmount}_${remainderAmount}`;
    // const senderTokenId = sha256(seedString + "_sender");

    // Try common split ratios (this is a heuristic - real implementation would track actual splits)
    const splitsToTry = this.generatePossibleSplits(totalAmount);

    for (const split of splitsToTry) {
      const seedString = `${archivedTokenId}_${split.splitAmount}_${split.remainderAmount}`;
      const changeTokenId = await this.sha256Hex(seedString + "_sender");

      // Skip if we already have this token
      if (currentTokenIds.has(changeTokenId)) {
        console.log(`🔧 Change token ${changeTokenId.slice(0, 8)}... already in wallet`);
        continue;
      }

      // Query aggregator to see if this token exists
      const exists = await this.checkTokenExistsOnAggregator(changeTokenId);

      if (exists) {
        console.log(`🔧 Found orphaned change token ${changeTokenId.slice(0, 8)}... on aggregator!`);

        // Reconstruct the token
        const reconstructed = await this.reconstructChangeToken(
          changeTokenId,
          archivedTxf,
          split.remainderAmount,
          coinId,
          seedString
        );

        if (reconstructed) {
          // Add to wallet
          if (!identity.ipnsName) {
            console.warn('No IPNS name available for recovered token');
            return null;
          }
          await addToken(
            identity.address,
            identity.publicKey,
            identity.ipnsName,
            reconstructed,
            { local: true } // skipHistory equivalent
          );

          return {
            tokenId: changeTokenId,
            amount: split.remainderAmount,
            coinId,
            sourceTokenId: archivedTokenId,
            recoveryMethod: "split_change",
          };
        }
      }
    }

    console.log(`🔧 No orphaned change token found for ${archivedTokenId.slice(0, 8)}...`);
    return null;
  }

  /**
   * Generate possible split combinations to try
   * This is heuristic - in production, we'd track actual split params in outbox
   */
  private generatePossibleSplits(totalAmount: bigint): { splitAmount: string; remainderAmount: string }[] {
    const splits: { splitAmount: string; remainderAmount: string }[] = [];

    // Common split patterns:
    // - Split exact amount (e.g., 4 ETH from 32 ETH -> remainder 28 ETH)
    // - Split half
    // - Split to common denominations

    const commonAmounts = [
      BigInt("1000000000000000000"),     // 1 ETH
      BigInt("4000000000000000000"),     // 4 ETH
      BigInt("10000000000000000000"),    // 10 ETH
      BigInt("100000000000000000"),      // 0.1 ETH
    ];

    for (const splitAmt of commonAmounts) {
      if (splitAmt > BigInt(0) && splitAmt < totalAmount) {
        const remainder = totalAmount - splitAmt;
        splits.push({
          splitAmount: splitAmt.toString(),
          remainderAmount: remainder.toString(),
        });
      }
    }

    // Also try percentages
    const halfAmount = totalAmount / BigInt(2);
    if (halfAmount > BigInt(0)) {
      splits.push({
        splitAmount: halfAmount.toString(),
        remainderAmount: (totalAmount - halfAmount).toString(),
      });
    }

    return splits;
  }

  /**
   * Check if a token exists on the aggregator by its state hash
   *
   * Per TOKEN_INVENTORY_SPEC v3.2 Section 13.13:
   * Query aggregator to verify orphaned token exists before recovery.
   *
   * For a freshly minted change token, the tokenId IS the genesis state hash.
   * We query the aggregator for an inclusion proof using this state hash.
   * If an INCLUSION proof exists (pathIncluded=true, authenticator present),
   * the token has been spent at that state - meaning it was minted and exists.
   *
   * Note: For a newly minted token that hasn't been transferred, we expect
   * an EXCLUSION proof (unspent). For orphan recovery, we're looking for
   * ANY evidence the token exists on-chain, so both inclusion and exclusion
   * proofs indicate the token exists.
   */
  private async checkTokenExistsOnAggregator(tokenId: string): Promise<boolean> {
    try {
      console.log(`🔧 Checking aggregator for token ${tokenId.slice(0, 8)}...`);

      // Get identity for public key
      const identity = await this.identityManager.getCurrentIdentity();
      if (!identity) {
        console.warn(`🔧 No identity available for aggregator check`);
        return false;
      }

      // Import SDK modules
      const { RequestId } = await import(
        "@unicitylabs/state-transition-sdk/lib/api/RequestId"
      );
      const { DataHash } = await import(
        "@unicitylabs/state-transition-sdk/lib/hash/DataHash"
      );

      // Get aggregator client
      const client = ServiceProvider.aggregatorClient;

      // The tokenId is derived from genesis data hash, which serves as the genesis state hash
      // Construct RequestId from owner's public key and the genesis state hash
      const pubKeyBytes = Buffer.from(identity.publicKey, "hex");

      // For genesis state, the stateHash is the tokenId with "0000" prefix (Unicity format)
      const stateHashStr = tokenId.startsWith("0000") ? tokenId : `0000${tokenId}`;
      const stateHashObj = DataHash.fromJSON(stateHashStr);

      const requestId = await RequestId.create(pubKeyBytes, stateHashObj);

      // Query aggregator for inclusion/exclusion proof
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await (client as any).getInclusionProof(requestId);

      if (!response.inclusionProof) {
        // No proof at all - token may not exist
        console.log(`🔧 No proof returned for token ${tokenId.slice(0, 8)}... - token may not exist`);
        return false;
      }

      const proof = response.inclusionProof;

      // Verify the hashpath is valid for our RequestId
      const pathResult = await proof.merkleTreePath.verify(
        requestId.toBitString().toBigInt()
      );

      if (!pathResult.isPathValid) {
        console.warn(`🔧 Invalid hashpath for token ${tokenId.slice(0, 8)}...`);
        return false;
      }

      // Check if we have a valid proof (either inclusion or exclusion)
      if (pathResult.isPathIncluded && proof.authenticator !== null) {
        // INCLUSION proof: state was committed (token exists and was spent at this state)
        console.log(`🔧 Found INCLUSION proof for token ${tokenId.slice(0, 8)}... - token exists (spent at genesis)`);
        return true;
      } else if (!pathResult.isPathIncluded && proof.authenticator === null) {
        // EXCLUSION proof: state is known but unspent (token was minted but not yet transferred)
        console.log(`🔧 Found EXCLUSION proof for token ${tokenId.slice(0, 8)}... - token exists (unspent)`);
        return true;
      }

      // Unexpected proof state
      console.warn(`🔧 Unexpected proof state for token ${tokenId.slice(0, 8)}... - assuming not exists`);
      return false;
    } catch (err) {
      console.error(`🔧 Aggregator check failed for ${tokenId.slice(0, 8)}...:`, err);
      return false;
    }
  }

  /**
   * Reconstruct a change token from recovered data
   */
  private async reconstructChangeToken(
    tokenId: string,
    sourceTokenTxf: TxfToken,
    amount: string,
    coinId: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _seedString: string
  ): Promise<Token | null> {
    try {
      // Reconstruct TxfToken structure for the change token
      const tokenType = sourceTokenTxf.genesis?.data?.tokenType || "";
      const isNft = tokenType === "455ad8720656b08e8dbd5bac1f3c73eeea5431565f6c1c3af742b1aa12d41d89";

      // NOTE: Full reconstruction requires:
      // 1. The mint inclusion proof from aggregator
      // 2. The predicate structure
      // 3. The salt used during minting

      // For now, create a placeholder token that marks this as recovered
      // The actual reconstruction would need SDK integration

      const token = new Token({
        id: tokenId,
        name: isNft ? "NFT (Recovered)" : "Token (Recovered)",
        type: isNft ? "NFT" : "UCT",
        timestamp: Date.now(),
        status: TokenStatus.CONFIRMED,
        amount: amount,
        coinId: coinId,
        symbol: isNft ? "NFT" : "UCT",
        // Note: jsonData would need proper TxfToken reconstruction with proofs
      });

      console.log(`🔧 Reconstructed change token ${tokenId.slice(0, 8)}... (needs proof fetch)`);

      // TODO: Fetch actual proof from aggregator and build full TxfToken
      // The token is marked as recovered but may need validation pass to fill in proofs

      return token;
    } catch (err) {
      console.error(`🔧 Failed to reconstruct token ${tokenId.slice(0, 8)}...:`, err);
      return null;
    }
  }

  /**
   * SHA-256 hash helper that returns hex string
   */
  private async sha256Hex(input: string): Promise<string> {
    const data = new TextEncoder().encode(input);
    const hashBuffer = await window.crypto.subtle.digest("SHA-256", data);
    return Buffer.from(hashBuffer).toString("hex");
  }

  // ==========================================
  // Manual Recovery API
  // ==========================================

  /**
   * Attempt to recover a specific token by its expected parameters.
   * Used when user knows the exact split details.
   */
  async recoverSpecificToken(
    sourceTokenId: string,
    splitAmount: string,
    remainderAmount: string
  ): Promise<RecoveredToken | null> {
    console.log(`🔧 Attempting specific recovery for split of ${sourceTokenId.slice(0, 8)}...`);

    // Get identity context
    const identity = await this.identityManager.getCurrentIdentity();
    if (!identity) {
      console.log(`🔧 No identity available`);
      return null;
    }

    const seedString = `${sourceTokenId}_${splitAmount}_${remainderAmount}`;
    const changeTokenId = await this.sha256Hex(seedString + "_sender");

    // Check current wallet
    const currentTokens = await getTokensForAddress(identity.address);
    const currentIds = this.extractCurrentTokenIds(currentTokens);

    if (currentIds.has(changeTokenId)) {
      console.log(`🔧 Token ${changeTokenId.slice(0, 8)}... already in wallet`);
      return null;
    }

    // Check aggregator
    const exists = await this.checkTokenExistsOnAggregator(changeTokenId);

    if (!exists) {
      console.log(`🔧 Token ${changeTokenId.slice(0, 8)}... not found on aggregator`);
      return null;
    }

    // Get source token info from archive
    const archivedTokens = getArchivedTokensForAddress(identity.address);
    const sourceTxf = archivedTokens.get(sourceTokenId);

    if (!sourceTxf) {
      console.log(`🔧 Source token ${sourceTokenId.slice(0, 8)}... not in archive`);
      return null;
    }

    const coinData = sourceTxf.genesis?.data?.coinData || [];
    const coinId = coinData[0]?.[0] || "";

    const reconstructed = await this.reconstructChangeToken(
      changeTokenId,
      sourceTxf,
      remainderAmount,
      coinId,
      seedString
    );

    if (reconstructed) {
      if (!identity.ipnsName) {
        console.warn('No IPNS name available for recovered token');
        return null;
      }
      await addToken(
        identity.address,
        identity.publicKey,
        identity.ipnsName,
        reconstructed,
        { local: true } // skipHistory equivalent
      );

      return {
        tokenId: changeTokenId,
        amount: remainderAmount,
        coinId,
        sourceTokenId,
        recoveryMethod: "split_change",
      };
    }

    return null;
  }
}
