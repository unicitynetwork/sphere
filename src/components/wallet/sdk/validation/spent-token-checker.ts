/**
 * Spent Token Checker (Platform-Independent)
 *
 * Checks if tokens have been spent on the Unicity blockchain.
 * Uses SDK to query token state via aggregator.
 */

import type { TxfToken } from '../types/txf';
import { getCurrentStateHash } from '../types/txf';
import type {
  TokenStateProvider,
  SpentTokenInfo,
  SpentTokenResult,
  BatchValidationOptions,
  PendingTransactionCheckResult,
  PendingTransactionsSummary,
  ValidationAction,
} from './types';

import type { TrustBaseProvider } from './trust-base-provider';
import { getUncommittedTransactions } from './txf-validation';

// ==========================================
// Types
// ==========================================

/**
 * Configuration for SpentTokenChecker
 */
export interface SpentTokenCheckerConfig {
  /** Trust base provider for SDK verification */
  trustBaseProvider: TrustBaseProvider;
  /** Token state provider (uses SDK client) */
  stateProvider: TokenStateProvider;
}

/**
 * Token entry for spent checking
 */
export interface SpentCheckableToken {
  /** Token ID (local) */
  localId: string;
  /** TXF token data */
  txf: TxfToken;
}

// ==========================================
// SpentTokenChecker
// ==========================================

/**
 * Checks if tokens are spent on Unicity blockchain
 *
 * Usage:
 * ```typescript
 * const checker = new SpentTokenChecker({
 *   trustBaseProvider,
 *   stateProvider,
 * });
 *
 * const result = await checker.checkSpentTokens(
 *   tokenMap,
 *   ownerPublicKey
 * );
 *
 * for (const spent of result.spentTokens) {
 *   console.log(`Token ${spent.tokenId} is spent`);
 * }
 * ```
 */
export class SpentTokenChecker {
  // @ts-expect-error Stored for potential future use (e.g., direct trust base access)
  private _trustBaseProvider: TrustBaseProvider;
  private stateProvider: TokenStateProvider;

  constructor(config: SpentTokenCheckerConfig) {
    this._trustBaseProvider = config.trustBaseProvider;
    this.stateProvider = config.stateProvider;
  }

  // ==========================================
  // Public API
  // ==========================================

  /**
   * Check if a single token is spent
   */
  async isTokenSpent(
    txfToken: TxfToken,
    ownerPublicKey: string
  ): Promise<boolean> {
    return this.stateProvider.isTokenStateSpent(txfToken, ownerPublicKey);
  }

  /**
   * Check multiple tokens for spent state
   * Returns list of spent tokens with their IDs
   */
  async checkSpentTokens(
    tokens: Map<string, TxfToken>,
    ownerPublicKey: string,
    options?: BatchValidationOptions
  ): Promise<SpentTokenResult> {
    if (tokens.size === 0) {
      return { spentTokens: [], errors: [] };
    }

    const spentTokens: SpentTokenInfo[] = [];
    const errors: string[] = [];

    const batchSize = options?.batchSize ?? 3;
    const tokenEntries = [...tokens.entries()];
    const total = tokenEntries.length;
    let completed = 0;

    console.log(`📦 Checking ${total} token(s) for spent state...`);

    // Process in batches
    for (let i = 0; i < tokenEntries.length; i += batchSize) {
      const batch = tokenEntries.slice(i, i + batchSize);

      const batchResults = await Promise.allSettled(
        batch.map(async ([localId, txfToken]) => {
          const isSpent = await this.stateProvider.isTokenStateSpent(
            txfToken,
            ownerPublicKey
          );
          return { localId, txfToken, isSpent };
        })
      );

      for (const result of batchResults) {
        completed++;

        if (result.status === 'fulfilled') {
          const { localId, txfToken, isSpent } = result.value;
          if (isSpent) {
            const tokenId = txfToken.genesis?.data?.tokenId || localId;
            const stateHash = getCurrentStateHash(txfToken);
            spentTokens.push({
              tokenId,
              localId,
              stateHash,
            });
            console.log(`📦 Token ${tokenId.slice(0, 8)}... is SPENT`);
          }
        } else {
          const index = batchResults.indexOf(result);
          const [localId] = batch[index] || ['unknown'];
          errors.push(`Failed to check ${localId}: ${result.reason}`);
        }
      }

      if (options?.onProgress) {
        options.onProgress(completed, total);
      }
    }

    console.log(`📦 Spent check complete: ${spentTokens.length} spent, ${errors.length} errors`);
    return { spentTokens, errors };
  }

  /**
   * Check which tokens are NOT spent (unspent)
   * Returns list of unspent token IDs
   */
  async checkUnspentTokens(
    tokens: Map<string, TxfToken>,
    ownerPublicKey: string
  ): Promise<string[]> {
    if (tokens.size === 0) return [];

    const unspentTokenIds: string[] = [];

    console.log(`📦 Sanity check: Verifying ${tokens.size} token(s)...`);

    for (const [tokenId, txfToken] of tokens) {
      try {
        const isSpent = await this.stateProvider.isTokenStateSpent(
          txfToken,
          ownerPublicKey
        );

        if (!isSpent) {
          unspentTokenIds.push(tokenId);
        } else {
          console.log(`📦 Token ${tokenId.slice(0, 8)}... is spent (will be removed)`);
        }
      } catch (err) {
        // On error, assume unspent (safe fallback)
        console.warn(
          `📦 Could not verify token ${tokenId.slice(0, 8)}..., assuming unspent:`,
          err instanceof Error ? err.message : err
        );
        unspentTokenIds.push(tokenId);
      }
    }

    console.log(`📦 Sanity check: ${unspentTokenIds.length}/${tokens.size} tokens are unspent`);
    return unspentTokenIds;
  }

  // ==========================================
  // Pending Transaction Validation
  // ==========================================

  /**
   * Check if a pending transaction can still be submitted
   * Returns false if the source state is already spent (transaction is dead)
   */
  async isPendingTransactionSubmittable(
    txfToken: TxfToken,
    pendingTxIndex: number,
    ownerPublicKey: string
  ): Promise<PendingTransactionCheckResult> {
    const transactions = txfToken.transactions;

    if (!transactions || pendingTxIndex >= transactions.length) {
      return {
        submittable: false,
        reason: 'Transaction index out of bounds',
        action: 'DISCARD_FORK',
      };
    }

    const pendingTx = transactions[pendingTxIndex];

    // If already committed, it's not pending
    if (pendingTx.inclusionProof !== null) {
      return { submittable: true, action: 'ACCEPT' };
    }

    // Get the state hash BEFORE this pending transaction
    let prevStateHash: string;
    if (pendingTxIndex === 0) {
      // First transaction - source state is genesis state
      prevStateHash = txfToken.genesis.inclusionProof.authenticator.stateHash;
    } else {
      const prevTx = transactions[pendingTxIndex - 1];
      if (!prevTx) {
        return {
          submittable: false,
          reason: 'Previous transaction not found',
          action: 'DISCARD_FORK',
        };
      }
      prevStateHash = prevTx.newStateHash;
    }

    // Check if that state is already spent
    try {
      const isSpent = await this.stateProvider.isTokenStateSpent(
        txfToken,
        ownerPublicKey
      );

      if (isSpent) {
        return {
          submittable: false,
          reason: `Source state ${prevStateHash.slice(0, 12)}... already spent`,
          action: 'DISCARD_FORK',
        };
      }

      return { submittable: true, action: 'ACCEPT' };
    } catch (err) {
      // On error, assume submittable but retry later
      return {
        submittable: true,
        reason: `Verification error: ${err instanceof Error ? err.message : String(err)}`,
        action: 'RETRY_LATER',
      };
    }
  }

  /**
   * Check all pending transactions in a token
   */
  async checkAllPendingTransactions(
    txfToken: TxfToken,
    ownerPublicKey: string
  ): Promise<PendingTransactionsSummary> {
    const transactions = txfToken.transactions || [];
    let pendingCount = 0;
    let submittable = 0;
    let dead = 0;
    const deadTransactions: Array<{ index: number; reason: string }> = [];

    for (let i = 0; i < transactions.length; i++) {
      const tx = transactions[i];
      if (tx.inclusionProof === null) {
        pendingCount++;

        const result = await this.isPendingTransactionSubmittable(
          txfToken,
          i,
          ownerPublicKey
        );

        if (result.submittable) {
          submittable++;
        } else {
          dead++;
          deadTransactions.push({
            index: i,
            reason: result.reason || 'Unknown',
          });
        }
      }
    }

    return { pendingCount, submittable, dead, deadTransactions };
  }

  /**
   * Determine validation action based on token state
   */
  async getValidationAction(
    txfToken: TxfToken,
    ownerPublicKey: string
  ): Promise<ValidationAction> {
    const uncommitted = getUncommittedTransactions(txfToken);

    if (uncommitted.length === 0) {
      return 'ACCEPT';
    }

    // Check if first pending transaction is submittable
    const firstPendingIndex = txfToken.transactions.findIndex(
      tx => tx.inclusionProof === null
    );

    if (firstPendingIndex === -1) {
      return 'ACCEPT';
    }

    const result = await this.isPendingTransactionSubmittable(
      txfToken,
      firstPendingIndex,
      ownerPublicKey
    );

    return result.action || 'RETRY_LATER';
  }
}

// ==========================================
// SDK-Based Token State Provider
// ==========================================

/**
 * Token state provider using Unicity SDK
 *
 * Requires StateTransitionClient from SDK to query blockchain state.
 */
export class SdkTokenStateProvider implements TokenStateProvider {
  private client: unknown; // StateTransitionClient
  private trustBaseProvider: TrustBaseProvider;

  constructor(client: unknown, trustBaseProvider: TrustBaseProvider) {
    this.client = client;
    this.trustBaseProvider = trustBaseProvider;
  }

  async isTokenStateSpent(
    txfToken: TxfToken,
    publicKey: string
  ): Promise<boolean> {
    const trustBase = await this.trustBaseProvider.getTrustBase();
    if (!trustBase) {
      throw new Error('Trust base not available');
    }

    if (!this.client) {
      throw new Error('State transition client not available');
    }

    try {
      // Dynamic import to avoid bundling SDK
      const { Token: SdkToken } = await import(
        '@unicitylabs/state-transition-sdk/lib/token/Token'
      );

      const sdkToken = await SdkToken.fromJSON(txfToken);
      const pubKeyBytes = Buffer.from(publicKey, 'hex');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const isSpent = await (this.client as any).isTokenStateSpent(
        trustBase,
        sdkToken,
        pubKeyBytes
      );

      return isSpent;
    } catch (err) {
      console.warn(
        '📦 Failed to check token state:',
        err instanceof Error ? err.message : err
      );
      throw err;
    }
  }

  async getTrustBase(): Promise<unknown | null> {
    return this.trustBaseProvider.getTrustBase();
  }
}

// ==========================================
// Factory Functions
// ==========================================

/**
 * Create a SpentTokenChecker instance
 */
export function createSpentTokenChecker(
  config: SpentTokenCheckerConfig
): SpentTokenChecker {
  return new SpentTokenChecker(config);
}

/**
 * Create an SDK-based token state provider
 */
export function createSdkTokenStateProvider(
  client: unknown,
  trustBaseProvider: TrustBaseProvider
): SdkTokenStateProvider {
  return new SdkTokenStateProvider(client, trustBaseProvider);
}
