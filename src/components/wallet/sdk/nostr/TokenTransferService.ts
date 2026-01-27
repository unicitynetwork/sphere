/**
 * TokenTransferService
 *
 * Handles token transfer finalization and state transition logic.
 * Platform-agnostic service for processing incoming token transfers.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { Token } from '@unicitylabs/state-transition-sdk/lib/token/Token';
import { TransferTransaction } from '@unicitylabs/state-transition-sdk/lib/transaction/TransferTransaction';
import { AddressScheme } from '@unicitylabs/state-transition-sdk/lib/address/AddressScheme';
import { UnmaskedPredicate } from '@unicitylabs/state-transition-sdk/lib/predicate/embedded/UnmaskedPredicate';
import { HashAlgorithm } from '@unicitylabs/state-transition-sdk/lib/hash/HashAlgorithm';
import { TokenState } from '@unicitylabs/state-transition-sdk/lib/token/TokenState';
import { ProxyAddress } from '@unicitylabs/state-transition-sdk/lib/address/ProxyAddress';
import type { StateTransitionClient } from '@unicitylabs/state-transition-sdk/lib/StateTransitionClient';
import type { RootTrustBase } from '@unicitylabs/state-transition-sdk/lib/bft/RootTrustBase';

import type { ReceivedTokenTransfer, NostrIdentityProvider } from './types';

// ==========================================
// Types
// ==========================================

/**
 * Nametag token provider for proxy address resolution
 */
export interface NametagTokenProvider {
  /** Get all nametag tokens owned by current identity */
  getNametagTokens(): Promise<Token<any>[]>;
}

/**
 * Token receiver callback - called when transfer is finalized
 */
export type TokenReceivedCallback = (
  token: Token<any>,
  senderPubkey: string,
  metadata: TokenMetadata
) => Promise<boolean>;

/**
 * Token metadata extracted during finalization
 */
export interface TokenMetadata {
  /** Amount (if fungible) */
  amount?: string;
  /** Coin ID */
  coinId?: string;
}

/**
 * Service provider interface for SDK clients
 */
export interface StateTransitionProvider {
  getStateTransitionClient(): StateTransitionClient;
  getRootTrustBase(): RootTrustBase;
}

// ==========================================
// TokenTransferService
// ==========================================

/**
 * Service for handling incoming token transfers
 */
export class TokenTransferService {
  private identityProvider: NostrIdentityProvider;
  private stateProvider: StateTransitionProvider;
  private nametagProvider: NametagTokenProvider;
  private onTokenReceived: TokenReceivedCallback;

  constructor(
    identityProvider: NostrIdentityProvider,
    stateProvider: StateTransitionProvider,
    nametagProvider: NametagTokenProvider,
    onTokenReceived: TokenReceivedCallback
  ) {
    this.identityProvider = identityProvider;
    this.stateProvider = stateProvider;
    this.nametagProvider = nametagProvider;
    this.onTokenReceived = onTokenReceived;
  }

  /**
   * Process incoming token transfer
   * Returns true if successfully processed, false if should retry
   */
  async processTransfer(transfer: ReceivedTokenTransfer): Promise<boolean> {
    try {
      // Parse source token
      let sourceTokenInput = transfer.sourceToken;
      let transferTxInput = transfer.transferTx;

      // Handle string inputs
      if (typeof sourceTokenInput === 'string') {
        try {
          sourceTokenInput = JSON.parse(sourceTokenInput);
        } catch {
          console.error('[TokenTransfer] Failed to parse sourceToken string');
          return false;
        }
      }

      if (typeof transferTxInput === 'string') {
        try {
          transferTxInput = JSON.parse(transferTxInput);
        } catch {
          console.error('[TokenTransfer] Failed to parse transferTx string');
          return false;
        }
      }

      if (!sourceTokenInput || !transferTxInput) {
        console.error('[TokenTransfer] Missing sourceToken or transferTx');
        return false;
      }

      const sourceToken = await Token.fromJSON(sourceTokenInput);
      const transferTx = await TransferTransaction.fromJSON(transferTxInput);

      return await this.finalizeTransfer(sourceToken, transferTx, transfer.senderPubkey);
    } catch (error) {
      console.error('[TokenTransfer] Error processing transfer', error);
      return false;
    }
  }

  private async finalizeTransfer(
    sourceToken: Token<any>,
    transferTx: TransferTransaction,
    senderPubkey: string
  ): Promise<boolean> {
    try {
      const recipientAddress = transferTx.data.recipient;
      const addressScheme = recipientAddress.scheme;

      if (addressScheme === AddressScheme.PROXY) {
        // Proxy address - finalization required
        console.log('[TokenTransfer] Transfer to PROXY address - finalization required');

        const nametags = await this.nametagProvider.getNametagTokens();
        if (nametags.length === 0) {
          console.error('[TokenTransfer] No nametags configured');
          return false;
        }

        // Find matching nametag
        let myNametagToken: Token<any> | null = null;
        for (const nametag of nametags) {
          const proxy = await ProxyAddress.fromTokenId(nametag.id);
          if (proxy.address === recipientAddress.address) {
            myNametagToken = nametag;
            break;
          }
        }

        if (!myNametagToken) {
          console.error('[TokenTransfer] Transfer not for any of my nametags');
          return false;
        }

        // Get signing service
        const signingService = await this.identityProvider.getSigningService();
        if (!signingService) {
          console.error('[TokenTransfer] No signing service available');
          return false;
        }

        // Create recipient predicate
        const transferSalt = transferTx.data.salt;
        const recipientPredicate = await UnmaskedPredicate.create(
          sourceToken.id,
          sourceToken.type,
          signingService,
          HashAlgorithm.SHA256,
          transferSalt
        );

        const recipientState = new TokenState(recipientPredicate, null);

        // Finalize via state transition client
        const client = this.stateProvider.getStateTransitionClient();
        const rootTrustBase = this.stateProvider.getRootTrustBase();

        const finalizedToken = await client.finalizeTransaction(
          rootTrustBase,
          sourceToken,
          recipientState,
          transferTx,
          [myNametagToken]
        );

        console.log('[TokenTransfer] Token finalized successfully');
        return this.deliverToken(finalizedToken, senderPubkey);
      } else {
        // Direct address - no finalization needed
        console.log('[TokenTransfer] Transfer to DIRECT address - saving directly');
        return this.deliverToken(sourceToken, senderPubkey);
      }
    } catch (error) {
      console.error('[TokenTransfer] Error finalizing transfer', error);
      return false;
    }
  }

  private async deliverToken(token: Token<any>, senderPubkey: string): Promise<boolean> {
    const metadata = this.extractTokenMetadata(token);
    return this.onTokenReceived(token, senderPubkey, metadata);
  }

  private extractTokenMetadata(token: Token<any>): TokenMetadata {
    const metadata: TokenMetadata = {};

    const coinsOpt = token.coins;
    if (!coinsOpt) return metadata;

    const rawCoins = coinsOpt.coins;
    let key: any = null;
    let val: any = null;

    if (Array.isArray(rawCoins)) {
      const firstItem = rawCoins[0];
      if (Array.isArray(firstItem) && firstItem.length === 2) {
        key = firstItem[0];
        val = firstItem[1];
      }
    } else if (typeof rawCoins === 'object') {
      const keys = Object.keys(rawCoins);
      if (keys.length > 0) {
        key = keys[0];
        val = (rawCoins as any)[key];
      }
    }

    if (val) {
      metadata.amount = val.toString();
    }

    if (key) {
      const bytes = key.data || key;
      metadata.coinId = Buffer.from(bytes).toString('hex');
    }

    return metadata;
  }
}

/**
 * Create token transfer payload for sending
 */
export function createTokenTransferPayload(
  sourceToken: Token<any>,
  transferTx: TransferTransaction
): string {
  return JSON.stringify({
    sourceToken: sourceToken.toJSON(),
    transferTx: transferTx.toJSON(),
  });
}
