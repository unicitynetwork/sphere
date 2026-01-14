/**
 * NametagService (SDK)
 *
 * Platform-agnostic nametag operations:
 * - Check availability
 * - Mint nametag on blockchain
 * - Publish binding to Nostr
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { Token } from '@unicitylabs/state-transition-sdk/lib/token/Token';
import { TokenId } from '@unicitylabs/state-transition-sdk/lib/token/TokenId';
import { TokenType } from '@unicitylabs/state-transition-sdk/lib/token/TokenType';
import { TokenState } from '@unicitylabs/state-transition-sdk/lib/token/TokenState';
import { SigningService } from '@unicitylabs/state-transition-sdk/lib/sign/SigningService';
import { MintCommitment } from '@unicitylabs/state-transition-sdk/lib/transaction/MintCommitment';
import { MintTransactionData } from '@unicitylabs/state-transition-sdk/lib/transaction/MintTransactionData';
import { UnmaskedPredicate } from '@unicitylabs/state-transition-sdk/lib/predicate/embedded/UnmaskedPredicate';
import { HashAlgorithm } from '@unicitylabs/state-transition-sdk/lib/hash/HashAlgorithm';
import { ProxyAddress } from '@unicitylabs/state-transition-sdk/lib/address/ProxyAddress';
import { waitInclusionProof } from '@unicitylabs/state-transition-sdk/lib/util/InclusionProofUtils';
import type { DirectAddress } from '@unicitylabs/state-transition-sdk/lib/address/DirectAddress';

import type { StateTransitionProvider } from './TokenTransferService';
import { UNICITY_TOKEN_TYPE_HEX } from '../types';

// ==========================================
// Types
// ==========================================

export type MintResult =
  | { status: 'success'; token: Token<any> }
  | { status: 'warning'; token: Token<any>; message: string }
  | { status: 'error'; message: string };

/**
 * Random bytes provider interface
 * Allows platform-specific implementations (crypto.getRandomValues, crypto.randomBytes)
 */
export interface RandomBytesProvider {
  getRandomBytes(length: number): Uint8Array;
}

/**
 * Default random bytes provider using crypto
 */
export class DefaultRandomBytesProvider implements RandomBytesProvider {
  getRandomBytes(length: number): Uint8Array {
    // Works in both browser (crypto.getRandomValues) and Node (crypto.randomBytes)
    if (typeof globalThis.crypto?.getRandomValues === 'function') {
      const bytes = new Uint8Array(length);
      globalThis.crypto.getRandomValues(bytes);
      return bytes;
    }
    // Node.js fallback
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodeCrypto = require('crypto');
    return new Uint8Array(nodeCrypto.randomBytes(length));
  }
}

// ==========================================
// NametagService
// ==========================================

/**
 * SDK service for nametag operations
 */
export class NametagMintService {
  private stateProvider: StateTransitionProvider;
  private randomProvider: RandomBytesProvider;

  constructor(
    stateProvider: StateTransitionProvider,
    randomProvider?: RandomBytesProvider
  ) {
    this.stateProvider = stateProvider;
    this.randomProvider = randomProvider ?? new DefaultRandomBytesProvider();
  }

  /**
   * Check if nametag is available
   */
  async isAvailable(nametag: string): Promise<boolean> {
    const cleanTag = this.cleanNametag(nametag);
    const nametagTokenId = await TokenId.fromNameTag(cleanTag);

    const client = this.stateProvider.getStateTransitionClient();
    const rootTrustBase = this.stateProvider.getRootTrustBase();

    const isMinted = await client.isMinted(rootTrustBase, nametagTokenId);
    return !isMinted;
  }

  /**
   * Mint nametag on blockchain
   *
   * @param nametag - Nametag to mint (without @)
   * @param ownerAddress - Owner's direct address
   * @param privateKey - Owner's private key (hex)
   * @returns Minted token or error
   */
  async mint(
    nametag: string,
    ownerAddress: DirectAddress,
    privateKey: string
  ): Promise<MintResult> {
    const cleanTag = this.cleanNametag(nametag);
    const secret = Buffer.from(privateKey, 'hex');

    try {
      const token = await this.mintOnBlockchain(cleanTag, ownerAddress, secret);
      if (!token) {
        return { status: 'error', message: 'Failed to mint nametag on blockchain' };
      }
      return { status: 'success', token };
    } catch (error) {
      console.error('[NametagMint] Critical error', error);
      return { status: 'error', message: 'Unknown minting error' };
    }
  }

  /**
   * Get proxy address for nametag
   */
  async getProxyAddress(nametag: string): Promise<string> {
    const cleanTag = this.cleanNametag(nametag);
    const proxyAddress = await ProxyAddress.fromNameTag(cleanTag);
    return proxyAddress.address;
  }

  private async mintOnBlockchain(
    nametag: string,
    ownerAddress: DirectAddress,
    secret: Buffer
  ): Promise<Token<any> | null> {
    try {
      const client = this.stateProvider.getStateTransitionClient();
      const rootTrustBase = this.stateProvider.getRootTrustBase();

      const nametagTokenId = await TokenId.fromNameTag(nametag);
      const nametagTokenType = new TokenType(Buffer.from(UNICITY_TOKEN_TYPE_HEX, 'hex'));
      const signingService = await SigningService.createFromSecret(secret);

      const MAX_RETRIES = 3;
      let commitment: MintCommitment<any> | null = null;

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          const salt = Buffer.from(this.randomProvider.getRandomBytes(32));

          const mintData = await MintTransactionData.createFromNametag(
            nametag,
            nametagTokenType,
            ownerAddress,
            salt,
            ownerAddress
          );

          commitment = await MintCommitment.create(mintData);

          console.log(`[NametagMint] Submitting commitment (attempt ${attempt})...`);
          const response = await client.submitMintCommitment(commitment);

          if (response.status === 'SUCCESS') {
            console.log('[NametagMint] Commitment success');
            break;
          } else {
            console.warn(`[NametagMint] Commitment failed: ${response.status}`);
            if (attempt === MAX_RETRIES) {
              throw new Error(`Failed after ${MAX_RETRIES} attempts`);
            }
            await this.delay(1000 * attempt);
          }
        } catch (error) {
          console.error(`[NametagMint] Attempt ${attempt} error`, error);
          if (attempt === MAX_RETRIES) throw error;
        }
      }

      if (!commitment) throw new Error('Failed to create commitment');

      console.log('[NametagMint] Waiting for inclusion proof...');
      const inclusionProof = await waitInclusionProof(rootTrustBase, client, commitment);

      const genesisTransaction = commitment.toTransaction(inclusionProof);
      const txData = commitment.transactionData;
      const mintSalt = txData.salt;

      const nametagPredicate = await UnmaskedPredicate.create(
        nametagTokenId,
        nametagTokenType,
        signingService,
        HashAlgorithm.SHA256,
        mintSalt
      );

      const token = Token.mint(
        rootTrustBase,
        new TokenState(nametagPredicate, null),
        genesisTransaction
      );

      console.log(`[NametagMint] Nametag minted: ${nametag}`);
      return token;
    } catch (error) {
      console.error('[NametagMint] Minting failed', error);
      return null;
    }
  }

  private cleanNametag(nametag: string): string {
    return nametag.replace('@unicity', '').replace('@', '').trim();
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
