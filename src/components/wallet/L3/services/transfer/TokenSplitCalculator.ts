/**
 * Token Split Calculator - App Layer Adapter
 *
 * Thin wrapper around the SDK TokenSplitCalculator that adapts
 * app-layer Token types to the SDK's generic interface.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { WalletToken } from "../../data/model";
import {
  TokenSplitCalculator as SdkTokenSplitCalculator,
  type SplitPlan as SdkSplitPlan,
  type TokenWithAmount as SdkTokenWithAmount,
  Token,
} from "../../sdk";

// ==========================================
// App-Layer Types (for backwards compatibility)
// ==========================================

/**
 * Token with amount - app-layer version
 * Maps SDK's generic type to use UI Token
 */
export interface TokenWithAmount {
  sdkToken: Token<any>;
  amount: bigint;
  /** @deprecated Use sourceToken from SDK. Kept for backwards compatibility */
  uiToken: WalletToken;
}

/**
 * Split plan - app-layer version
 * Maps SDK's generic type to use UI Token
 */
export interface SplitPlan {
  tokensToTransferDirectly: TokenWithAmount[];
  tokenToSplit: TokenWithAmount | null;
  splitAmount: bigint | null;
  remainderAmount: bigint | null;
  totalTransferAmount: bigint;
  coinId: string;
  requiresSplit: boolean;
}

// ==========================================
// App-Layer Calculator
// ==========================================

/**
 * Token Split Calculator for L3 wallet
 *
 * This is a thin adapter that:
 * 1. Uses the SDK TokenSplitCalculator for all logic
 * 2. Maps app-layer Token to SDK's SplittableToken interface
 * 3. Maps SDK results back to app-layer types
 */
export class TokenSplitCalculator {
  private sdkCalculator: SdkTokenSplitCalculator;

  constructor() {
    this.sdkCalculator = new SdkTokenSplitCalculator();
  }

  /**
   * Calculate optimal split for a transfer
   *
   * @param availableTokens - App-layer Token array
   * @param targetAmount - Amount to transfer
   * @param targetCoinIdHex - Coin ID (hex string)
   * @returns Split plan with app-layer Token references
   */
  async calculateOptimalSplit(
    availableTokens: WalletToken[],
    targetAmount: bigint,
    targetCoinIdHex: string
  ): Promise<SplitPlan | null> {
    // The Token class already has the fields that match SplittableToken:
    // - id: string
    // - coinId?: string
    // - status: string
    // - jsonData?: string
    const sdkResult = await this.sdkCalculator.calculateOptimalSplit(
      availableTokens,
      targetAmount,
      targetCoinIdHex
    );

    if (!sdkResult) {
      return null;
    }

    // Map SDK result back to app-layer types
    return this.mapToAppLayerPlan(sdkResult);
  }

  /**
   * Map SDK split plan to app-layer split plan
   */
  private mapToAppLayerPlan(sdkPlan: SdkSplitPlan<WalletToken>): SplitPlan {
    return {
      tokensToTransferDirectly: sdkPlan.tokensToTransferDirectly.map(
        this.mapToAppLayerToken
      ),
      tokenToSplit: sdkPlan.tokenToSplit
        ? this.mapToAppLayerToken(sdkPlan.tokenToSplit)
        : null,
      splitAmount: sdkPlan.splitAmount,
      remainderAmount: sdkPlan.remainderAmount,
      totalTransferAmount: sdkPlan.totalTransferAmount,
      coinId: sdkPlan.coinId,
      requiresSplit: sdkPlan.requiresSplit,
    };
  }

  /**
   * Map SDK token with amount to app-layer version
   */
  private mapToAppLayerToken(sdkToken: SdkTokenWithAmount<WalletToken>): TokenWithAmount {
    return {
      sdkToken: sdkToken.sdkToken,
      amount: sdkToken.amount,
      uiToken: sdkToken.sourceToken, // sourceToken is the original Token
    };
  }
}
