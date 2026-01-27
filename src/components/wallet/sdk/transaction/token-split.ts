/**
 * Token Split Calculator (Platform-Independent)
 *
 * Pure business logic for calculating optimal token splits for transfers.
 * No browser APIs, no app-layer dependencies.
 *
 * The calculator works with any token type that implements SplittableToken interface.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { Token as SdkToken } from '../unicity-sdk';

// ==========================================
// Generic Token Interface
// ==========================================

/**
 * Minimal interface for a token that can be used in split calculations.
 * App-layer tokens should implement this interface.
 */
export interface SplittableToken {
  /** Unique identifier for the token */
  id: string;
  /** Coin ID (hex string) this token represents */
  coinId?: string;
  /** Token status - only CONFIRMED tokens are used */
  status: string;
  /** Serialized SDK token JSON */
  jsonData?: string;
}

/**
 * Token with parsed amount and SDK token reference
 * Generic over the app-layer token type
 */
export interface TokenWithAmount<T extends SplittableToken = SplittableToken> {
  /** The parsed SDK token */
  sdkToken: SdkToken<any>;
  /** Real amount from SDK token structure */
  amount: bigint;
  /** Reference to the original app-layer token */
  sourceToken: T;
}

/**
 * Split plan result
 * Generic over the app-layer token type
 */
export interface SplitPlan<T extends SplittableToken = SplittableToken> {
  /** Tokens that can be transferred directly without splitting */
  tokensToTransferDirectly: TokenWithAmount<T>[];
  /** Token that needs to be split (if any) */
  tokenToSplit: TokenWithAmount<T> | null;
  /** Amount to split off for transfer */
  splitAmount: bigint | null;
  /** Amount remaining after split */
  remainderAmount: bigint | null;
  /** Total amount being transferred */
  totalTransferAmount: bigint;
  /** Coin ID for the transfer */
  coinId: string;
  /** Whether a split operation is required */
  requiresSplit: boolean;
}

// ==========================================
// Token Split Calculator
// ==========================================

/**
 * Calculator for optimal token splits
 *
 * Strategies:
 * 1. Find exact match (single token equals target amount)
 * 2. Find exact combination (multiple tokens sum to target)
 * 3. Greedy selection with split (use smaller tokens, split one if needed)
 */
export class TokenSplitCalculator {
  /**
   * Calculate optimal split plan for a transfer
   *
   * @param availableTokens - Array of tokens to choose from
   * @param targetAmount - Amount to transfer
   * @param targetCoinIdHex - Coin ID to transfer (hex string)
   * @returns Split plan or null if insufficient funds
   */
  async calculateOptimalSplit<T extends SplittableToken>(
    availableTokens: T[],
    targetAmount: bigint,
    targetCoinIdHex: string
  ): Promise<SplitPlan<T> | null> {
    console.log(
      `🧮 Calculating split for ${targetAmount} of ${targetCoinIdHex}`
    );

    const candidates: TokenWithAmount<T>[] = [];

    for (const t of availableTokens) {
      if (t.coinId !== targetCoinIdHex) continue;
      if (t.status !== 'CONFIRMED') continue;
      if (!t.jsonData) continue;

      try {
        const parsed = JSON.parse(t.jsonData);
        const sdkToken = await SdkToken.fromJSON(parsed);
        const realAmount = this.getRealAmountFromSdk(sdkToken);

        if (realAmount <= 0n) {
          console.warn(`Token ${t.id} has 0 balance in SDK structure.`);
          continue;
        }

        console.log(realAmount);

        candidates.push({
          sdkToken: sdkToken,
          amount: realAmount,
          sourceToken: t,
        });
      } catch (e) {
        console.warn('Failed to parse candidate token', t.id, e);
      }
    }

    candidates.sort((a, b) => (a.amount < b.amount ? -1 : 1));

    const totalAvailable = candidates.reduce((sum, t) => sum + t.amount, 0n);
    if (totalAvailable < targetAmount) {
      console.error(
        `Insufficient funds. Available: ${totalAvailable}, Required: ${targetAmount}`
      );
      return null;
    }

    const exactMatch = candidates.find((t) => t.amount === targetAmount);
    if (exactMatch) {
      console.log('🎯 Found exact match token');
      return this.createDirectPlan([exactMatch], targetAmount, targetCoinIdHex);
    }

    const maxCombinationSize = Math.min(5, candidates.length);

    for (let size = 2; size <= maxCombinationSize; size++) {
      const combo = this.findCombinationOfSize(candidates, targetAmount, size);
      if (combo) {
        console.log(`🎯 Found exact combination of ${size} tokens`);
        return this.createDirectPlan(combo, targetAmount, targetCoinIdHex);
      }
    }

    const toTransfer: TokenWithAmount<T>[] = [];
    let currentSum = 0n;

    for (const candidate of candidates) {
      const newSum = currentSum + candidate.amount;

      if (newSum === targetAmount) {
        toTransfer.push(candidate);
        return this.createDirectPlan(toTransfer, targetAmount, targetCoinIdHex);
      } else if (newSum < targetAmount) {
        toTransfer.push(candidate);
        currentSum = newSum;
      } else {
        const neededFromThisToken = targetAmount - currentSum;
        const remainderForMe = candidate.amount - neededFromThisToken;

        console.log(`✂️ Splitting required. Remainder: ${remainderForMe}`);

        return {
          tokensToTransferDirectly: toTransfer,
          tokenToSplit: candidate,
          splitAmount: neededFromThisToken,
          remainderAmount: remainderForMe,
          totalTransferAmount: targetAmount,
          coinId: targetCoinIdHex,
          requiresSplit: true,
        };
      }
    }

    return null;
  }

  /**
   * Extract the real amount from an SDK token structure
   */
  private getRealAmountFromSdk(sdkToken: SdkToken<any>): bigint {
    try {
      const coinsOpt = sdkToken.coins;
      const coinData = coinsOpt;

      if (coinData && coinData.coins) {
        const rawCoins = coinData.coins;
        let val: unknown = null;

        const firstItem = rawCoins[0];
        if (Array.isArray(firstItem) && firstItem.length === 2) {
          val = firstItem[1];
        }

        if (Array.isArray(val)) {
          return BigInt(val[1]?.toString() || '0');
        } else if (val) {
          return BigInt(val.toString());
        }
      }
    } catch (e) {
      console.error('Error extracting amount from SDK token', e);
    }
    return 0n;
  }

  // === PRIVATE HELPERS ===

  private createDirectPlan<T extends SplittableToken>(
    tokens: TokenWithAmount<T>[],
    total: bigint,
    coinId: string
  ): SplitPlan<T> {
    return {
      tokensToTransferDirectly: tokens,
      tokenToSplit: null,
      splitAmount: null,
      remainderAmount: null,
      totalTransferAmount: total,
      coinId: coinId,
      requiresSplit: false,
    };
  }

  private findCombinationOfSize<T extends SplittableToken>(
    tokens: TokenWithAmount<T>[],
    targetAmount: bigint,
    size: number
  ): TokenWithAmount<T>[] | null {
    const generator = this.generateCombinations(tokens, size);

    for (const combo of generator) {
      const sum = combo.reduce((acc, t) => acc + t.amount, 0n);
      if (sum === targetAmount) {
        return combo;
      }
    }
    return null;
  }

  private *generateCombinations<T extends SplittableToken>(
    tokens: TokenWithAmount<T>[],
    k: number,
    start: number = 0,
    current: TokenWithAmount<T>[] = []
  ): Generator<TokenWithAmount<T>[]> {
    if (k === 0) {
      yield current;
      return;
    }

    for (let i = start; i < tokens.length; i++) {
      yield* this.generateCombinations(tokens, k - 1, i + 1, [
        ...current,
        tokens[i],
      ]);
    }
  }
}

// ==========================================
// Factory
// ==========================================

/**
 * Create a new token split calculator instance
 */
export function createTokenSplitCalculator(): TokenSplitCalculator {
  return new TokenSplitCalculator();
}
