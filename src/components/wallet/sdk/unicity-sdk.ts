/**
 * Re-exports from @unicitylabs/state-transition-sdk
 *
 * This module centralizes all imports from the Unicity SDK,
 * making it easier to manage dependencies and potential future migrations.
 */

// ============================================================================
// SIGNING
// ============================================================================

export { SigningService } from '@unicitylabs/state-transition-sdk/lib/sign/SigningService';

// ============================================================================
// ADDRESSES
// ============================================================================

export { AddressScheme } from '@unicitylabs/state-transition-sdk/lib/address/AddressScheme';
export { ProxyAddress } from '@unicitylabs/state-transition-sdk/lib/address/ProxyAddress';
export type { DirectAddress } from '@unicitylabs/state-transition-sdk/lib/address/DirectAddress';
export type { IAddress } from '@unicitylabs/state-transition-sdk/lib/address/IAddress';

// ============================================================================
// TOKENS
// ============================================================================

export { Token } from '@unicitylabs/state-transition-sdk/lib/token/Token';
export { TokenId } from '@unicitylabs/state-transition-sdk/lib/token/TokenId';
export { TokenType } from '@unicitylabs/state-transition-sdk/lib/token/TokenType';
export { TokenState } from '@unicitylabs/state-transition-sdk/lib/token/TokenState';

// Fungible tokens
export { CoinId } from '@unicitylabs/state-transition-sdk/lib/token/fungible/CoinId';
export { TokenCoinData } from '@unicitylabs/state-transition-sdk/lib/token/fungible/TokenCoinData';

// ============================================================================
// TRANSACTIONS
// ============================================================================

export { TransferCommitment } from '@unicitylabs/state-transition-sdk/lib/transaction/TransferCommitment';
export { TransferTransaction } from '@unicitylabs/state-transition-sdk/lib/transaction/TransferTransaction';
export { MintCommitment } from '@unicitylabs/state-transition-sdk/lib/transaction/MintCommitment';
export { MintTransactionData } from '@unicitylabs/state-transition-sdk/lib/transaction/MintTransactionData';
export { TokenSplitBuilder } from '@unicitylabs/state-transition-sdk/lib/transaction/split/TokenSplitBuilder';

// ============================================================================
// PREDICATES
// ============================================================================

export { UnmaskedPredicate } from '@unicitylabs/state-transition-sdk/lib/predicate/embedded/UnmaskedPredicate';
export { UnmaskedPredicateReference } from '@unicitylabs/state-transition-sdk/lib/predicate/embedded/UnmaskedPredicateReference';

// ============================================================================
// HASHING
// ============================================================================

export { HashAlgorithm } from '@unicitylabs/state-transition-sdk/lib/hash/HashAlgorithm';

// ============================================================================
// CLIENTS
// ============================================================================

export { StateTransitionClient } from '@unicitylabs/state-transition-sdk/lib/StateTransitionClient';
export { AggregatorClient } from '@unicitylabs/state-transition-sdk/lib/api/AggregatorClient';
export { RootTrustBase } from '@unicitylabs/state-transition-sdk/lib/bft/RootTrustBase';

// ============================================================================
// UTILITIES
// ============================================================================

export { waitInclusionProof } from '@unicitylabs/state-transition-sdk/lib/util/InclusionProofUtils';

// ============================================================================
// NOSTR SDK (@unicitylabs/nostr-js-sdk)
// ============================================================================

import {
  NostrClient as _NostrClient,
  NostrKeyManager as _NostrKeyManager,
  EventKinds as _EventKinds,
  TokenTransferProtocol as _TokenTransferProtocol,
  PaymentRequestProtocol as _PaymentRequestProtocol,
  Filter as _Filter,
} from '@unicitylabs/nostr-js-sdk';

import type {
  Event as _Event,
} from '@unicitylabs/nostr-js-sdk';

// Re-export as values
export const NostrClient = _NostrClient;
export const NostrKeyManager = _NostrKeyManager;
export const EventKinds = _EventKinds;
export const TokenTransferProtocol = _TokenTransferProtocol;
export const PaymentRequestProtocol = _PaymentRequestProtocol;
export const NostrFilter = _Filter;

// Re-export types
export type NostrEvent = _Event;
