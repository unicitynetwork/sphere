/**
 * Identity Service (Platform-Independent)
 *
 * Core identity derivation logic for L3 Unicity wallet.
 * Handles key derivation and address generation without storage dependencies.
 */

import { deriveL3Address } from '../address/unified';
import { validateMnemonic } from './wallet';
import {
  SigningService,
  TokenType,
  HashAlgorithm,
  UnmaskedPredicateReference,
  type DirectAddress,
} from '../unicity-sdk';
import { UNICITY_TOKEN_TYPE_HEX } from '../types';

// ==========================================
// Types
// ==========================================

/**
 * User identity for L3 Unicity wallet.
 *
 * NOTE: The wallet address is derived using UnmaskedPredicateReference (no nonce/salt).
 * This creates a stable, reusable DirectAddress from publicKey + tokenType.
 */
export interface UserIdentity {
  privateKey: string;
  publicKey: string;
  address: string;
  mnemonic?: string;
  l1Address?: string;
  addressIndex?: number;
}

/**
 * Result of deriving L3 address from private key
 */
export interface L3DerivedAddress {
  publicKey: string;
  address: string;
}

// ==========================================
// Core Derivation Functions
// ==========================================

/**
 * Derive L3 identity from a raw private key
 * This is the core derivation function - no storage, no state
 */
export async function deriveIdentityFromPrivateKey(
  privateKey: string
): Promise<UserIdentity> {
  const l3 = await deriveL3Address(privateKey);

  return {
    privateKey,
    publicKey: l3.publicKey,
    address: l3.address,
  };
}

/**
 * Derive L3 identity from mnemonic phrase
 * Validates mnemonic and derives identity for default path
 *
 * @param mnemonic - BIP39 mnemonic phrase
 * @param deriveKeyFromMnemonic - Function to derive private key from mnemonic
 */
export async function deriveIdentityFromMnemonic(
  mnemonic: string,
  deriveKeyFromMnemonic: (mnemonic: string) => Promise<{ privateKey: string; l1Address?: string }>
): Promise<UserIdentity> {
  if (!validateMnemonic(mnemonic)) {
    throw new Error("Invalid recovery phrase. Please check your words and try again.");
  }

  const derived = await deriveKeyFromMnemonic(mnemonic);
  const l3 = await deriveL3Address(derived.privateKey);

  return {
    privateKey: derived.privateKey,
    publicKey: l3.publicKey,
    address: l3.address,
    mnemonic,
    l1Address: derived.l1Address,
  };
}

/**
 * Get DirectAddress for a given identity
 * Uses UnmaskedPredicateReference for stable, reusable address
 */
export async function getWalletDirectAddress(
  privateKey: string
): Promise<DirectAddress> {
  // Use Uint8Array directly instead of Buffer for SDK compatibility
  const secretBuffer = Buffer.from(privateKey, "hex");
  const secret = new Uint8Array(secretBuffer.buffer, secretBuffer.byteOffset, secretBuffer.byteLength);
  const signingService = await SigningService.createFromSecret(secret);
  const publicKey = signingService.publicKey;
  const tokenType = new TokenType(
    Buffer.from(UNICITY_TOKEN_TYPE_HEX, "hex")
  );

  // UnmaskedPredicateReference creates a stable, reusable DirectAddress
  // This does NOT use nonce - the address is derived only from publicKey + tokenType
  const predicateRef = UnmaskedPredicateReference.create(
    tokenType,
    signingService.algorithm,
    publicKey,
    HashAlgorithm.SHA256
  );

  return (await predicateRef).toAddress();
}

/**
 * Validate a mnemonic phrase
 */
export { validateMnemonic };

/**
 * Derive L3 address from private key (low-level)
 */
export { deriveL3Address };
