/**
 * L3Wallet - Unicity Token Network SDK
 *
 * Full L3 wallet functionality:
 * - Identity creation from private key
 * - Address derivation
 * - Token queries via aggregator
 * - Token transfers (via L3TransferService)
 * - Balance queries
 *
 * Platform implementations need to provide:
 * - L3TokenStorageProvider for token persistence
 * - L3NostrProvider for P2P messaging
 */

import { SigningService } from '@unicitylabs/state-transition-sdk/lib/sign/SigningService';
import { TokenType } from '@unicitylabs/state-transition-sdk/lib/token/TokenType';
import { StateTransitionClient } from '@unicitylabs/state-transition-sdk/lib/StateTransitionClient';
import { AggregatorClient } from '@unicitylabs/state-transition-sdk/lib/api/AggregatorClient';
import { RootTrustBase } from '@unicitylabs/state-transition-sdk/lib/bft/RootTrustBase';
import { UNICITY_TOKEN_TYPE_HEX } from '../types';
import { deriveL3Address } from '../address/unified';
import {
  L3TransferService,
  type L3TokenStorageProvider,
  type L3NostrProvider,
  type L3TransferResult,
} from './L3TransferService';

// ==========================================
// Configuration
// ==========================================

const DEFAULT_AGGREGATOR_URL = 'https://goggregator-test.unicity.network';
const DEFAULT_API_KEY = 'sk_06365a9c44654841a366068bcfc68986';

// ==========================================
// Types
// ==========================================

export interface L3WalletConfig {
  /** Aggregator URL */
  aggregatorUrl?: string;
  /** API key for aggregator */
  apiKey?: string;
  /** Trust base JSON for verification */
  trustBaseJson?: object;
  /** Token storage provider (required for transfers) */
  tokenStorage?: L3TokenStorageProvider;
  /** Nostr provider (required for transfers) */
  nostrProvider?: L3NostrProvider;
}

export interface L3Identity {
  /** Private key hex */
  privateKey: string;
  /** Public key hex */
  publicKey: string;
  /** DirectAddress as string */
  address: string;
  /** SigningService for transactions */
  signingService: SigningService;
}

// ==========================================
// L3Wallet Class
// ==========================================

/**
 * L3 Wallet SDK for Unicity Token Network
 *
 * Usage:
 * ```typescript
 * // Basic usage (queries only)
 * const l3 = new L3Wallet({ aggregatorUrl: '...' });
 * const identity = await l3.createIdentity(privateKeyHex);
 *
 * // Full usage with transfers
 * const l3 = new L3Wallet({
 *   tokenStorage: myStorageProvider,
 *   nostrProvider: myNostrProvider,
 *   trustBaseJson: trustBaseData,
 * });
 *
 * // Send tokens
 * const result = await l3.send({
 *   recipientNametag: 'alice',
 *   amount: '1000000',
 *   coinId: 'abc123...',
 *   privateKey: identity.privateKey,
 * });
 *
 * // Get balance
 * const balance = await l3.getBalance('abc123...');
 * ```
 */
export class L3Wallet {
  private aggregatorClient: AggregatorClient;
  private stateTransitionClient: StateTransitionClient;
  private tokenType: TokenType;
  private config: L3WalletConfig;
  private trustBase: RootTrustBase | null = null;
  private transferService: L3TransferService | null = null;

  constructor(config: L3WalletConfig = {}) {
    this.config = config;
    const aggregatorUrl = config.aggregatorUrl ?? DEFAULT_AGGREGATOR_URL;
    const apiKey = config.apiKey ?? DEFAULT_API_KEY;

    this.aggregatorClient = new AggregatorClient(aggregatorUrl, apiKey);
    this.stateTransitionClient = new StateTransitionClient(this.aggregatorClient);
    this.tokenType = new TokenType(Buffer.from(UNICITY_TOKEN_TYPE_HEX, 'hex'));

    // Initialize trust base if provided
    if (config.trustBaseJson) {
      this.trustBase = RootTrustBase.fromJSON(config.trustBaseJson);
    }

    // Initialize transfer service if providers are available
    if (config.tokenStorage && config.nostrProvider && this.trustBase) {
      this.transferService = new L3TransferService({
        stateTransitionClient: this.stateTransitionClient,
        trustBase: this.trustBase,
        tokenStorage: config.tokenStorage,
        nostr: config.nostrProvider,
      });
    }
  }

  // ==========================================
  // Identity Management
  // ==========================================

  /**
   * Create L3 identity from private key
   *
   * @param privateKeyHex - Private key in hex format (same as L1)
   * @returns L3 identity with signing capability
   */
  async createIdentity(privateKeyHex: string): Promise<L3Identity> {
    // Create secret as Uint8Array for SDK compatibility
    const secretBuffer = Buffer.from(privateKeyHex, 'hex');
    const secret = new Uint8Array(secretBuffer.buffer, secretBuffer.byteOffset, secretBuffer.byteLength);

    // Create signing service
    const signingService = await SigningService.createFromSecret(secret);

    const publicKey = signingService.publicKey;
    const publicKeyHex = Buffer.from(publicKey).toString('hex');

    // Derive address using SDK address derivation
    const l3Info = await deriveL3Address(privateKeyHex);

    return {
      privateKey: privateKeyHex,
      publicKey: publicKeyHex,
      address: l3Info.address,
      signingService,
    };
  }

  /**
   * Derive L3 address from private key
   */
  async deriveAddress(privateKeyHex: string): Promise<string> {
    const l3Info = await deriveL3Address(privateKeyHex);
    return l3Info.address;
  }

  // ==========================================
  // Token Operations
  // ==========================================

  /**
   * Send tokens to a recipient
   *
   * Requires tokenStorage and nostrProvider in config.
   *
   * @param params - Transfer parameters
   * @returns Transfer result
   */
  async send(params: {
    recipientNametag: string;
    amount: string;
    coinId: string;
    privateKey: string;
  }): Promise<L3TransferResult> {
    if (!this.transferService) {
      return {
        success: false,
        txIds: [],
        error: 'Transfer service not configured. Provide tokenStorage, nostrProvider, and trustBaseJson.',
      };
    }

    return this.transferService.send(params);
  }

  /**
   * Get balance for a coin ID
   *
   * Requires tokenStorage in config.
   */
  async getBalance(coinId: string): Promise<bigint> {
    if (!this.transferService) {
      throw new Error('Token storage not configured');
    }
    return this.transferService.getBalance(coinId);
  }

  /**
   * Check if transfer functionality is available
   */
  isTransferEnabled(): boolean {
    return this.transferService !== null;
  }

  // ==========================================
  // Aggregator Access
  // ==========================================

  /**
   * Get the aggregator client for direct operations
   */
  getAggregatorClient(): AggregatorClient {
    return this.aggregatorClient;
  }

  /**
   * Get the state transition client for direct operations
   */
  getStateTransitionClient(): StateTransitionClient {
    return this.stateTransitionClient;
  }

  /**
   * Get the token type
   */
  getTokenType(): TokenType {
    return this.tokenType;
  }

  /**
   * Get aggregator URL
   */
  getAggregatorUrl(): string {
    return this.config.aggregatorUrl ?? DEFAULT_AGGREGATOR_URL;
  }

  /**
   * Get trust base (if configured)
   */
  getTrustBase(): RootTrustBase | null {
    return this.trustBase;
  }

  /**
   * Set trust base after construction
   */
  setTrustBase(trustBaseJson: object): void {
    this.trustBase = RootTrustBase.fromJSON(trustBaseJson);

    // Re-initialize transfer service if storage providers are available
    if (this.config.tokenStorage && this.config.nostrProvider) {
      this.transferService = new L3TransferService({
        stateTransitionClient: this.stateTransitionClient,
        trustBase: this.trustBase,
        tokenStorage: this.config.tokenStorage,
        nostr: this.config.nostrProvider,
      });
    }
  }

  /**
   * Configure storage providers after construction
   */
  configureProviders(
    tokenStorage: L3TokenStorageProvider,
    nostrProvider: L3NostrProvider
  ): void {
    this.config.tokenStorage = tokenStorage;
    this.config.nostrProvider = nostrProvider;

    // Re-initialize transfer service if trust base is available
    if (this.trustBase) {
      this.transferService = new L3TransferService({
        stateTransitionClient: this.stateTransitionClient,
        trustBase: this.trustBase,
        tokenStorage,
        nostr: nostrProvider,
      });
    }
  }
}
