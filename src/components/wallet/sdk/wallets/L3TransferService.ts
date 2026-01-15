/**
 * L3 Transfer Service (Platform-Independent)
 *
 * Orchestrates L3 token transfers including:
 * - Split calculation and execution
 * - On-chain commitment and proof fetching
 * - Nostr P2P delivery
 *
 * Platform implementations need to provide:
 * - TokenStorageProvider for token persistence
 * - NostrProvider for P2P messaging
 * - RandomBytesProvider for salt generation
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { Buffer } from 'buffer';
import { SigningService } from '@unicitylabs/state-transition-sdk/lib/sign/SigningService';
import { TokenId } from '@unicitylabs/state-transition-sdk/lib/token/TokenId';
import { Token as SdkToken } from '@unicitylabs/state-transition-sdk/lib/token/Token';
import { ProxyAddress } from '@unicitylabs/state-transition-sdk/lib/address/ProxyAddress';
import { TransferCommitment } from '@unicitylabs/state-transition-sdk/lib/transaction/TransferCommitment';
import { StateTransitionClient } from '@unicitylabs/state-transition-sdk/lib/StateTransitionClient';
import { RootTrustBase } from '@unicitylabs/state-transition-sdk/lib/bft/RootTrustBase';
import { waitInclusionProof } from '@unicitylabs/state-transition-sdk/lib/util/InclusionProofUtils';
import type { IAddress } from '@unicitylabs/state-transition-sdk/lib/address/IAddress';

import {
  TokenSplitCalculator,
  type SplittableToken,
  type SplitPlan,
} from '../transaction/token-split';

import { TokenSplitExecutor } from '../transaction/split-executor';
import type { SplitOutboxProvider, SplitOutboxContext } from '../transaction/split-types';

// ==========================================
// Provider Interfaces
// ==========================================

/**
 * Provider for token storage operations
 */
export interface L3TokenStorageProvider {
  /** Get all tokens for a coin ID */
  getTokensByCoinId(coinId: string): SplittableToken[];
  /** Get all tokens */
  getAllTokens(): SplittableToken[];
  /** Remove a token by ID */
  removeToken(tokenId: string): void;
  /** Save a new token (e.g., change from split) */
  saveToken(token: {
    id: string;
    coinId: string;
    amount: string;
    jsonData: string;
    status: string;
  }): void;
}

/**
 * Provider for Nostr P2P messaging
 */
export interface L3NostrProvider {
  /** Query pubkey by nametag */
  queryPubkeyByNametag(nametag: string): Promise<string | null>;
  /** Send token transfer payload */
  sendTokenTransfer(recipientPubkey: string, payloadJson: string): Promise<boolean>;
}

/**
 * Provider for random bytes (for salt generation)
 */
export interface L3RandomBytesProvider {
  /** Generate random bytes */
  getRandomBytes(length: number): Uint8Array;
}

/**
 * Transfer result
 */
export interface L3TransferResult {
  success: boolean;
  /** Transaction IDs for on-chain operations */
  txIds: string[];
  /** Error message if failed */
  error?: string;
}

/**
 * Transfer request parameters
 */
export interface L3TransferRequest {
  /** Recipient nametag (e.g., "alice") */
  recipientNametag: string;
  /** Amount to send (as string for bigint safety) */
  amount: string;
  /** Coin ID (hex string) */
  coinId: string;
  /** Sender's private key (hex) */
  privateKey: string;
}

// ==========================================
// Default Random Bytes Provider
// ==========================================

/**
 * Browser/Node.js compatible random bytes provider
 */
export class DefaultL3RandomBytesProvider implements L3RandomBytesProvider {
  getRandomBytes(length: number): Uint8Array {
    const bytes = new Uint8Array(length);
    if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) {
      globalThis.crypto.getRandomValues(bytes);
    } else {
      // Fallback for environments without Web Crypto
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const nodeCrypto = require('crypto');
      const randomBuffer = nodeCrypto.randomBytes(length);
      bytes.set(new Uint8Array(randomBuffer));
    }
    return bytes;
  }
}

// ==========================================
// L3 Transfer Service
// ==========================================

export interface L3TransferServiceConfig {
  /** State transition client */
  stateTransitionClient: StateTransitionClient;
  /** Root trust base for verification */
  trustBase: RootTrustBase;
  /** Token storage provider */
  tokenStorage: L3TokenStorageProvider;
  /** Nostr provider */
  nostr: L3NostrProvider;
  /** Random bytes provider (optional, defaults to crypto) */
  randomBytes?: L3RandomBytesProvider;
  /** Outbox provider for split recovery (optional) */
  outboxProvider?: SplitOutboxProvider;
}

/**
 * L3 Transfer Service
 *
 * Handles complete token transfer flow:
 * 1. Resolve recipient nametag to pubkey
 * 2. Calculate optimal token split
 * 3. Execute on-chain transfers/splits
 * 4. Send via Nostr P2P
 */
export class L3TransferService {
  private client: StateTransitionClient;
  private trustBase: RootTrustBase;
  private tokenStorage: L3TokenStorageProvider;
  private nostr: L3NostrProvider;
  private randomBytes: L3RandomBytesProvider;
  private splitCalculator: TokenSplitCalculator;
  private splitExecutor: TokenSplitExecutor;
  private outboxProvider: SplitOutboxProvider | undefined;

  constructor(config: L3TransferServiceConfig) {
    this.client = config.stateTransitionClient;
    this.trustBase = config.trustBase;
    this.tokenStorage = config.tokenStorage;
    this.nostr = config.nostr;
    this.randomBytes = config.randomBytes ?? new DefaultL3RandomBytesProvider();
    this.splitCalculator = new TokenSplitCalculator();
    this.outboxProvider = config.outboxProvider;
    this.splitExecutor = new TokenSplitExecutor({
      stateTransitionClient: config.stateTransitionClient,
      trustBase: config.trustBase,
      outboxProvider: config.outboxProvider,
    });
  }

  /**
   * Send tokens to a recipient by nametag
   */
  async send(request: L3TransferRequest): Promise<L3TransferResult> {
    const { recipientNametag, amount, coinId, privateKey } = request;
    const targetAmount = BigInt(amount);

    console.log(`🚀 L3 Transfer: ${amount} of ${coinId} to @${recipientNametag}`);

    try {
      // 1. Create signing service
      const secret = Buffer.from(privateKey, 'hex');
      const signingService = await SigningService.createFromSecret(
        new Uint8Array(secret.buffer, secret.byteOffset, secret.byteLength)
      );

      // 2. Resolve recipient
      const recipientPubkey = await this.nostr.queryPubkeyByNametag(recipientNametag);
      if (!recipientPubkey) {
        return { success: false, txIds: [], error: `Recipient @${recipientNametag} not found` };
      }

      const recipientTokenId = await TokenId.fromNameTag(recipientNametag);
      const recipientAddress = await ProxyAddress.fromTokenId(recipientTokenId);

      // 3. Calculate split plan
      const allTokens = this.tokenStorage.getAllTokens();
      const plan = await this.splitCalculator.calculateOptimalSplit(
        allTokens,
        targetAmount,
        coinId
      );

      if (!plan) {
        return { success: false, txIds: [], error: 'Insufficient funds' };
      }

      console.log('📋 Transfer Plan:', {
        direct: plan.tokensToTransferDirectly.length,
        split: plan.requiresSplit,
      });

      const txIds: string[] = [];

      // 4. Execute direct transfers
      for (const item of plan.tokensToTransferDirectly) {
        const result = await this.executeDirectTransfer(
          item.sdkToken,
          item.sourceToken.id,
          recipientAddress,
          recipientPubkey,
          signingService
        );
        if (result.txId) txIds.push(result.txId);
      }

      // 5. Execute split if needed
      if (plan.requiresSplit && plan.tokenToSplit && plan.splitAmount && plan.remainderAmount) {
        const splitResult = await this.executeSplitTransfer(
          plan,
          recipientAddress,
          recipientPubkey,
          signingService,
          coinId
        );
        txIds.push(...splitResult.txIds);
      }

      return { success: true, txIds };
    } catch (error) {
      console.error('L3 Transfer failed:', error);
      return {
        success: false,
        txIds: [],
        error: error instanceof Error ? error.message : 'Transfer failed',
      };
    }
  }

  /**
   * Execute a direct transfer (no split needed)
   */
  private async executeDirectTransfer(
    sourceToken: SdkToken<any>,
    tokenId: string,
    recipientAddress: IAddress,
    recipientPubkey: string,
    signingService: SigningService
  ): Promise<{ success: boolean; txId?: string }> {
    console.log(`➡️ Direct transfer: ${tokenId.slice(0, 8)}...`);

    // Generate salt
    const salt = this.randomBytes.getRandomBytes(32);

    // Create transfer commitment
    const commitment = await TransferCommitment.create(
      sourceToken,
      recipientAddress,
      salt,
      null,
      null,
      signingService
    );

    // Submit to aggregator
    const response = await this.client.submitTransferCommitment(commitment);
    if (response.status !== 'SUCCESS' && response.status !== 'REQUEST_ID_EXISTS') {
      throw new Error(`Transfer commitment failed: ${response.status}`);
    }

    // Wait for inclusion proof
    const inclusionProof = await waitInclusionProof(this.trustBase, this.client, commitment);
    const transferTx = commitment.toTransaction(inclusionProof);

    // Build payload for Nostr
    const payload = JSON.stringify({
      sourceToken: JSON.stringify(sourceToken.toJSON()),
      transferTx: JSON.stringify(transferTx.toJSON()),
    });

    // Send via Nostr
    const sent = await this.nostr.sendTokenTransfer(recipientPubkey, payload);
    if (!sent) {
      console.warn('Nostr delivery failed, but on-chain transfer succeeded');
    }

    // Remove from local storage
    this.tokenStorage.removeToken(tokenId);

    // Get request ID as hex string
    const requestIdBytes = commitment.requestId;
    const txId = requestIdBytes instanceof Uint8Array
      ? Buffer.from(requestIdBytes).toString('hex')
      : String(requestIdBytes);

    return {
      success: true,
      txId,
    };
  }

  /**
   * Execute split transfer using TokenSplitExecutor
   */
  private async executeSplitTransfer(
    plan: SplitPlan<SplittableToken>,
    recipientAddress: IAddress,
    recipientPubkey: string,
    signingService: SigningService,
    _coinId: string // eslint-disable-line @typescript-eslint/no-unused-vars
  ): Promise<{ success: boolean; txIds: string[] }> {
    if (!plan.tokenToSplit || !plan.splitAmount || !plan.remainderAmount) {
      throw new Error('Invalid split plan');
    }

    console.log(`✂️ Split transfer: ${plan.splitAmount} to recipient, ${plan.remainderAmount} back`);

    // Build outbox context if outbox provider is available
    const outboxContext: SplitOutboxContext | undefined = this.outboxProvider
      ? {
          walletAddress: '', // Caller should set this via extended config
          recipientNametag: '', // Not available here, would need extended request
          recipientPubkey: recipientPubkey,
        }
      : undefined;

    // Execute the split using the SDK executor
    const result = await this.splitExecutor.executeSplitPlan(
      plan,
      recipientAddress,
      signingService,
      (tokenId) => {
        // Remove burned token from storage
        this.tokenStorage.removeToken(tokenId);
        console.log(`🔥 Token ${tokenId.slice(0, 8)}... burned and removed`);
      },
      outboxContext
    );

    // Save the change token to storage
    if (result.tokensKeptBySender.length > 0) {
      for (const changeToken of result.tokensKeptBySender) {
        const tokenIdHex = Buffer.from(changeToken.id.bytes).toString('hex');
        const amount = this.extractAmount(changeToken);
        this.tokenStorage.saveToken({
          id: tokenIdHex,
          coinId: plan.coinId,
          amount: amount.toString(),
          jsonData: JSON.stringify(changeToken.toJSON()),
          status: 'CONFIRMED',
        });
        console.log(`💰 Change token ${tokenIdHex.slice(0, 8)}... saved (${amount})`);
      }
    }

    // Send recipient tokens via Nostr
    for (let i = 0; i < result.tokensForRecipient.length; i++) {
      const token = result.tokensForRecipient[i];
      const transferTx = result.recipientTransferTxs[i];

      const payload = JSON.stringify({
        sourceToken: JSON.stringify(token.toJSON()),
        transferTx: JSON.stringify(transferTx.toJSON()),
      });

      const sent = await this.nostr.sendTokenTransfer(recipientPubkey, payload);
      if (!sent) {
        console.warn('Nostr delivery failed for split token, but on-chain transfer succeeded');
      }
    }

    // Build txIds from transfer transactions (use transaction hash or index)
    const txIds: string[] = result.recipientTransferTxs.map((tx, index) => {
      try {
        // TransferTransaction doesn't have requestId, use JSON to extract hash
        const txJson = tx.toJSON();
        if (txJson && typeof txJson === 'object' && 'transactionHash' in txJson) {
          return String(txJson.transactionHash);
        }
        return `split-transfer-${index}`;
      } catch {
        return `split-transfer-${index}`;
      }
    });

    return { success: true, txIds };
  }

  /**
   * Get balance for a coin ID
   */
  async getBalance(coinId: string): Promise<bigint> {
    const tokens = this.tokenStorage.getTokensByCoinId(coinId);
    let total = 0n;

    for (const token of tokens) {
      if (token.status !== 'CONFIRMED' || !token.jsonData) continue;
      try {
        const parsed = JSON.parse(token.jsonData);
        const sdkToken = await SdkToken.fromJSON(parsed);
        const amount = this.extractAmount(sdkToken);
        total += amount;
      } catch {
        // Skip invalid tokens
      }
    }

    return total;
  }

  /**
   * Extract amount from SDK token
   */
  private extractAmount(sdkToken: SdkToken<any>): bigint {
    try {
      const coinData = sdkToken.coins;
      if (coinData && coinData.coins) {
        const rawCoins = coinData.coins;
        const firstItem = rawCoins[0];
        if (Array.isArray(firstItem) && firstItem.length === 2) {
          const val = firstItem[1];
          if (Array.isArray(val)) {
            return BigInt(val[1]?.toString() || '0');
          } else if (val) {
            return BigInt(val.toString());
          }
        }
      }
    } catch {
      // Ignore extraction errors
    }
    return 0n;
  }
}

// ==========================================
// Factory
// ==========================================

/**
 * Create L3 transfer service
 */
export function createL3TransferService(
  config: L3TransferServiceConfig
): L3TransferService {
  return new L3TransferService(config);
}
