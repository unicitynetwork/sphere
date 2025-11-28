/* eslint-disable @typescript-eslint/no-explicit-any */
import { Token } from "../../data/model";
import { Token as SdkToken } from "@unicitylabs/state-transition-sdk/lib/token/Token";

export interface TokenWithAmount {
  sdkToken: SdkToken<any>;
  amount: bigint;
  uiToken: Token;
}

export interface SplitPlan {
  tokensToTransferDirectly: TokenWithAmount[];
  tokenToSplit: TokenWithAmount | null;
  splitAmount: bigint | null;
  remainderAmount: bigint | null;
  totalTransferAmount: bigint;
  coinId: string;
  requiresSplit: boolean;
}

export class TokenSplitCalculator {
  async calculateOptimalSplit(
    availableTokens: Token[],
    targetAmount: bigint,
    targetCoinIdHex: string
  ): Promise<SplitPlan | null> {
    console.log(
      `🧮 Calculating split for ${targetAmount} of ${targetCoinIdHex}`
    );

    const candidates: TokenWithAmount[] = [];

    for (const t of availableTokens) {
      if (t.coinId !== targetCoinIdHex) continue;
      if (t.status !== "CONFIRMED") continue;
      if (!t.jsonData) continue;

      try {
        const parsed = JSON.parse(t.jsonData);
        const sdkToken = await SdkToken.fromJSON(parsed);
        const realAmount = this.getRealAmountFromSdk(sdkToken);

        if (realAmount <= 0n) {
          console.warn(`Token ${t.id} has 0 balance in SDK structure.`);
          continue;
        }

        console.log(realAmount)

        candidates.push({
          sdkToken: sdkToken,
          amount: realAmount,
          uiToken: t,
        });
      } catch (e) {
        console.warn("Failed to parse candidate token", t.id, e);
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
      console.log("🎯 Found exact match token");
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

    const toTransfer: TokenWithAmount[] = [];
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

  private getRealAmountFromSdk(sdkToken: SdkToken<any>): bigint {
    try {
      const coinsOpt = sdkToken.coins;
      const coinData = coinsOpt;

      if (coinData && coinData.coins) {
        const rawCoins = coinData.coins;
        let val: any = null;

        const firstItem = rawCoins[0];
        if (Array.isArray(firstItem) && firstItem.length === 2) {
          val = firstItem[1];
        }

        if (Array.isArray(val)) {
          return BigInt(val[1]?.toString() || "0");
        } else if (val) {
          return BigInt(val.toString());
        }
      }
    } catch (e) {
      console.error("Error extracting amount from SDK token", e);
    }
    return 0n;
  }

  // === PRIVATE HELPERS ===

  private createDirectPlan(
    tokens: TokenWithAmount[],
    total: bigint,
    coinId: string
  ): SplitPlan {
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

  private findCombinationOfSize(
    tokens: TokenWithAmount[],
    targetAmount: bigint,
    size: Int
  ): TokenWithAmount[] | null {
    const generator = this.generateCombinations(tokens, size);

    for (const combo of generator) {
      const sum = combo.reduce((acc, t) => acc + t.amount, 0n);
      if (sum === targetAmount) {
        return combo;
      }
    }
    return null;
  }

  private *generateCombinations(
    tokens: TokenWithAmount[],
    k: number,
    start: number = 0,
    current: TokenWithAmount[] = []
  ): Generator<TokenWithAmount[]> {
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

// TypeScript alias for Integer to match intent
type Int = number;
