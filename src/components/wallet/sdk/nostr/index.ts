/**
 * Unicity Wallet SDK - Nostr Module
 *
 * Platform-agnostic Nostr services for token transfers and nametags.
 *
 * Usage:
 * ```typescript
 * import {
 *   NostrClientWrapper,
 *   TokenTransferService,
 *   NametagMintService,
 * } from '@unicity/wallet-sdk/nostr';
 *
 * // Create client with identity provider
 * const nostr = new NostrClientWrapper(identityProvider, storage);
 * await nostr.connect();
 *
 * // Set up token transfer handling
 * const transferService = new TokenTransferService(
 *   identityProvider,
 *   stateProvider,
 *   nametagProvider,
 *   async (token, sender, metadata) => {
 *     // Save received token
 *     return true;
 *   }
 * );
 *
 * nostr.onTokenTransfer((transfer) =>
 *   transferService.processTransfer(transfer)
 * );
 *
 * // Send token
 * await nostr.sendTokenTransfer(recipientPubkey, payloadJson);
 *
 * // Mint nametag
 * const nametagService = new NametagMintService(stateProvider);
 * const result = await nametagService.mint('myname', ownerAddress, privateKey);
 * if (result.status === 'success') {
 *   await nostr.publishNametagBinding('myname', proxyAddress);
 * }
 * ```
 */

// Core client
export { NostrClientWrapper } from './NostrClientWrapper';

// Token transfer service
export {
  TokenTransferService,
  createTokenTransferPayload,
} from './TokenTransferService';
export type {
  NametagTokenProvider,
  TokenReceivedCallback,
  TokenMetadata,
  StateTransitionProvider,
} from './TokenTransferService';

// Nametag service
export {
  NametagMintService,
  DefaultRandomBytesProvider,
} from './NametagService';
export type { MintResult, RandomBytesProvider } from './NametagService';

// Types
export {
  DEFAULT_NOSTR_RELAYS,
  InMemoryNostrStorage,
} from './types';
export type {
  NostrConfig,
  NostrIdentity,
  NostrUserIdentity,
  NostrIdentityProvider,
  TokenTransferPayload,
  TokenTransferOptions,
  ReceivedTokenTransfer,
  PaymentRequest,
  ReceivedPaymentRequest,
  ProcessedPaymentRequest,
  TokenTransferHandler,
  PaymentRequestHandler,
  NametagBinding,
  NostrStorageProvider,
} from './types';
export { PaymentRequestStatus } from './types';
