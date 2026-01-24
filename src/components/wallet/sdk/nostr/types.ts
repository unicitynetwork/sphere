/**
 * Nostr SDK Types
 *
 * Platform-agnostic types for Nostr operations.
 * Extends core SDK types with Nostr-specific fields.
 */

import type { SigningService } from '@unicitylabs/state-transition-sdk/lib/sign/SigningService';
import type { UserIdentity } from '../core/identity';

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
 * Nostr identity with keypair (minimal, for Nostr operations only)
 */
export interface NostrIdentity {
  /** Private key hex */
  privateKey: string;
  /** Public key hex */
  publicKey: string;
}

/**
 * Extended user identity with Nostr nametag
 * Extends core UserIdentity with human-readable nametag for P2P transfers
 */
export interface NostrUserIdentity extends UserIdentity {
  /** Human-readable nametag (e.g., "alice", without @) */
  nametag?: string;
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

/**
 * Payment request status for UI tracking
 */
export const PaymentRequestStatus = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
  PAID: 'PAID',
} as const;

export type PaymentRequestStatus =
  (typeof PaymentRequestStatus)[keyof typeof PaymentRequestStatus];

/**
 * Processed payment request for UI display
 * Extends ReceivedPaymentRequest with flattened fields and UI state
 */
export interface ProcessedPaymentRequest extends ReceivedPaymentRequest {
  /** Unique ID (same as eventId) */
  id: string;
  /** Amount as bigint (parsed from request.amount) */
  amount: bigint;
  /** Coin ID (from request) */
  coinId: string;
  /** Token symbol for display */
  symbol: string;
  /** Optional message (from request) */
  message?: string;
  /** Recipient nametag (from request) */
  recipientNametag: string;
  /** Request ID (from request) */
  requestId: string;
  /** Current status for UI */
  status: PaymentRequestStatus;
}

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
