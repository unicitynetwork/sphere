/**
 * Nostr SDK Types
 *
 * Platform-agnostic types for Nostr operations.
 */

import type { SigningService } from '@unicitylabs/state-transition-sdk/lib/sign/SigningService';

// ==========================================
// Configuration
// ==========================================

export interface NostrConfig {
  /** Relay URLs */
  relays?: string[];
  /** Enable debug logging */
  debug?: boolean;
}

export const DEFAULT_NOSTR_RELAYS = [
  'wss://nostr-relay.testnet.unicity.network',
];

// ==========================================
// Identity
// ==========================================

/**
 * Nostr identity with keypair
 */
export interface NostrIdentity {
  /** Private key hex */
  privateKey: string;
  /** Public key hex */
  publicKey: string;
}

/**
 * Identity provider interface
 * Implementations provide identity for Nostr operations
 */
export interface NostrIdentityProvider {
  /** Get current identity */
  getIdentity(): Promise<NostrIdentity | null>;
  /** Get signing service for state transitions */
  getSigningService(): Promise<SigningService | null>;
}

// ==========================================
// Token Transfer
// ==========================================

/**
 * Token transfer payload
 */
export interface TokenTransferPayload {
  /** Source token JSON */
  sourceToken: unknown;
  /** Transfer transaction JSON */
  transferTx: unknown;
}

/**
 * Token transfer options
 */
export interface TokenTransferOptions {
  /** Amount for display */
  amount?: bigint;
  /** Symbol for display */
  symbol?: string;
  /** Reply to event ID */
  replyToEventId?: string;
}

/**
 * Received token transfer
 */
export interface ReceivedTokenTransfer {
  /** Event ID */
  eventId: string;
  /** Sender public key */
  senderPubkey: string;
  /** Source token JSON */
  sourceToken: unknown;
  /** Transfer transaction JSON */
  transferTx: unknown;
  /** Timestamp */
  timestamp: number;
}

/**
 * Token transfer handler callback
 */
export type TokenTransferHandler = (transfer: ReceivedTokenTransfer) => Promise<boolean>;

// ==========================================
// Payment Request
// ==========================================

/**
 * Payment request data
 */
export interface PaymentRequest {
  /** Request ID */
  requestId: string;
  /** Amount requested */
  amount: string;
  /** Coin ID */
  coinId: string;
  /** Optional message */
  message?: string;
  /** Recipient nametag */
  recipientNametag?: string;
}

/**
 * Received payment request
 */
export interface ReceivedPaymentRequest {
  /** Event ID */
  eventId: string;
  /** Sender public key */
  senderPubkey: string;
  /** Request data */
  request: PaymentRequest;
  /** Timestamp */
  timestamp: number;
}

/**
 * Payment request handler callback
 */
export type PaymentRequestHandler = (request: ReceivedPaymentRequest) => void;

// ==========================================
// Nametag
// ==========================================

/**
 * Nametag binding (pubkey to nametag)
 */
export interface NametagBinding {
  /** Nametag name (without @) */
  nametag: string;
  /** Public key hex */
  pubkey: string;
  /** Unicity address (proxy address) */
  unicityAddress: string;
}

// ==========================================
// Storage Provider (for sync state)
// ==========================================

/**
 * Simple key-value storage provider for sync state
 * Implementations: localStorage (browser), file (node), AsyncStorage (RN)
 */
export interface NostrStorageProvider {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/**
 * In-memory storage provider (for testing or stateless usage)
 */
export class InMemoryNostrStorage implements NostrStorageProvider {
  private data = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.data.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.data.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.data.delete(key);
  }
}
