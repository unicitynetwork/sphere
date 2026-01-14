/**
 * L3Wallet - Unicity Token Network SDK
 *
 * Basic L3 wallet operations:
 * - Identity creation from private key
 * - Address derivation
 * - Token queries via aggregator
 *
 * Note: Full transfer functionality requires Nostr P2P layer
 * which is implemented in the Sphere application.
 */

import { SigningService } from '@unicitylabs/state-transition-sdk/lib/sign/SigningService';
import { TokenType } from '@unicitylabs/state-transition-sdk/lib/token/TokenType';
import { StateTransitionClient } from '@unicitylabs/state-transition-sdk/lib/StateTransitionClient';
import { AggregatorClient } from '@unicitylabs/state-transition-sdk/lib/api/AggregatorClient';
import { UNICITY_TOKEN_TYPE_HEX } from './types';
import { deriveL3Address } from './unified';

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
 * const l3 = new L3Wallet({ aggregatorUrl: '...' });
 * const identity = await l3.createIdentity(privateKeyHex);
 *
 * // For full transfer functionality, use Sphere's transfer services
 * ```
 */
export class L3Wallet {
  private aggregatorClient: AggregatorClient;
  private stateTransitionClient: StateTransitionClient;
  private tokenType: TokenType;
  private config: L3WalletConfig;

  constructor(config: L3WalletConfig = {}) {
    this.config = config;
    const aggregatorUrl = config.aggregatorUrl ?? DEFAULT_AGGREGATOR_URL;
    const apiKey = config.apiKey ?? DEFAULT_API_KEY;

    this.aggregatorClient = new AggregatorClient(aggregatorUrl, apiKey);
    this.stateTransitionClient = new StateTransitionClient(this.aggregatorClient);
    this.tokenType = new TokenType(Buffer.from(UNICITY_TOKEN_TYPE_HEX, 'hex'));
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
    // Create secret buffer from hex
    const secret = Buffer.from(privateKeyHex, 'hex');

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
}
