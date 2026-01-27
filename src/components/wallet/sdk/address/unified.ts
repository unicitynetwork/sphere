/**
 * L3 Address Derivation (Unicity network)
 *
 * Functions for deriving L3 addresses using the Unicity SDK.
 */

import { SigningService } from '@unicitylabs/state-transition-sdk/lib/sign/SigningService';
import { TokenType } from '@unicitylabs/state-transition-sdk/lib/token/TokenType';
import { HashAlgorithm } from '@unicitylabs/state-transition-sdk/lib/hash/HashAlgorithm';
import { UnmaskedPredicateReference } from '@unicitylabs/state-transition-sdk/lib/predicate/embedded/UnmaskedPredicateReference';

import type { L3Address, UnifiedAddress, DerivationMode, WalletConfig } from '../types';
import { DEFAULT_BASE_PATH, DEFAULT_DERIVATION_MODE, UNICITY_TOKEN_TYPE_HEX } from '../types';
import { deriveKeyAtPath, deriveChildKeyLegacy, deriveKeyWifHmac } from '../core/derivation';
import { privateKeyToAddressInfo } from './address';

// ============================================
// L1 Address Derivation (needed for unified)
// ============================================

/**
 * Parse path to extract components
 */
export function parsePathComponents(path: string): {
  index: number;
  isChange: boolean;
  basePath: string;
} {
  // Try 5-level BIP32: m/44'/0'/0'/0/5
  const bip32Match = path.match(/^(m\/\d+'\/\d+'\/\d+')\/(\d+)\/(\d+)$/);
  if (bip32Match) {
    const chain = parseInt(bip32Match[2], 10);
    const index = parseInt(bip32Match[3], 10);
    return {
      basePath: bip32Match[1],
      index,
      isChange: chain === 1,
    };
  }

  // Try 3-level HMAC: m/44'/0'/0'
  const hmacMatch = path.match(/^(m\/\d+'\/\d+')\/(\d+)'?$/);
  if (hmacMatch) {
    const index = parseInt(hmacMatch[2], 10);
    return {
      basePath: hmacMatch[1],
      index,
      isChange: false,
    };
  }

  throw new Error(`Invalid BIP32 path: ${path}`);
}

/**
 * Get path for address at specific index
 */
export function getAddressPath(
  index: number,
  isChange: boolean = false,
  basePath: string = DEFAULT_BASE_PATH
): string {
  const chain = isChange ? 1 : 0;
  return `${basePath}/${chain}/${index}`;
}

// ============================================
// L3 Address Derivation
// ============================================

/**
 * Derive L3 address from private key
 *
 * Uses UnmaskedPredicateReference for stable, reusable DirectAddress.
 * The L3 address is derived from publicKey + tokenType (no nonce/salt).
 *
 * @param privateKey - Private key (hex)
 * @returns L3 address info
 *
 * @example
 * const l3 = await deriveL3Address(privateKey);
 * console.log(l3.address); // 0x...
 */
export async function deriveL3Address(privateKey: string): Promise<L3Address> {
  // Use Uint8Array directly instead of Buffer for SDK compatibility
  const secretBuffer = Buffer.from(privateKey, 'hex');
  const secret = new Uint8Array(secretBuffer.buffer, secretBuffer.byteOffset, secretBuffer.byteLength);

  const signingService = await SigningService.createFromSecret(secret);
  const publicKey = Buffer.from(signingService.publicKey).toString('hex');

  const tokenTypeBytes = Buffer.from(UNICITY_TOKEN_TYPE_HEX, 'hex');
  const tokenType = new TokenType(tokenTypeBytes);

  // UnmaskedPredicateReference creates stable address (no nonce)
  const predicateRef = UnmaskedPredicateReference.create(
    tokenType,
    signingService.algorithm,
    signingService.publicKey,
    HashAlgorithm.SHA256
  );

  const address = (await (await predicateRef).toAddress()).toString();

  return {
    address,
    privateKey,
    publicKey,
  };
}

// ============================================
// L1 Address Derivation (Alpha blockchain)
// ============================================

import type { L1Address } from '../types';

/**
 * Derive L1 address from master key at specific path
 *
 * @param masterKey - Master private key (hex)
 * @param chainCode - Chain code (hex)
 * @param path - Full BIP32 path (e.g., "m/44'/0'/0'/0/0")
 * @param mode - Derivation mode (default: bip32)
 * @returns L1 address info
 *
 * @example
 * const addr = deriveL1Address(masterKey, chainCode, "m/44'/0'/0'/0/0");
 * console.log(addr.address); // alpha1...
 */
export function deriveL1Address(
  masterKey: string,
  chainCode: string | null,
  path: string,
  mode: DerivationMode = DEFAULT_DERIVATION_MODE
): L1Address {
  const { index, isChange } = parsePathComponents(path);

  let privateKey: string;

  if (mode === 'bip32' && chainCode) {
    // Standard BIP32 derivation
    const derived = deriveKeyAtPath(masterKey, chainCode, path);
    privateKey = derived.privateKey;
  } else if (mode === 'legacy_hmac' && chainCode) {
    // Legacy HMAC derivation
    const derived = deriveChildKeyLegacy(masterKey, chainCode, index);
    privateKey = derived.privateKey;
  } else {
    // WIF HMAC derivation (no chain code needed)
    privateKey = deriveKeyWifHmac(masterKey, index);
  }

  const { publicKey, address } = privateKeyToAddressInfo(privateKey);

  return {
    address,
    privateKey,
    publicKey,
    index,
    path,
    isChange,
  };
}

/**
 * Derive the first (default) L1 address
 */
export function deriveDefaultL1Address(
  masterKey: string,
  chainCode: string,
  config: WalletConfig = {}
): L1Address {
  const basePath = config.basePath || DEFAULT_BASE_PATH;
  const path = `${basePath}/0/0`;
  return deriveL1Address(masterKey, chainCode, path, config.derivationMode);
}

/**
 * Derive next L1 address in sequence
 */
export function deriveNextL1Address(
  masterKey: string,
  chainCode: string,
  currentIndex: number,
  config: WalletConfig = {}
): L1Address {
  const basePath = config.basePath || DEFAULT_BASE_PATH;
  const nextIndex = currentIndex + 1;
  const path = `${basePath}/0/${nextIndex}`;
  return deriveL1Address(masterKey, chainCode, path, config.derivationMode);
}

// ============================================
// Unified Address (L1 + L3)
// ============================================

/**
 * Derive unified address (both L1 and L3) from master key
 *
 * This is the main function for deriving a complete address.
 * Same private key is used for both L1 and L3.
 *
 * @param masterKey - Master private key (hex)
 * @param chainCode - Chain code (hex)
 * @param path - Full BIP32 path
 * @param mode - Derivation mode
 * @returns Unified address with both L1 and L3 info
 *
 * @example
 * const addr = await deriveUnifiedAddress(masterKey, chainCode, "m/44'/0'/0'/0/0");
 * console.log(addr.l1Address); // alpha1...
 * console.log(addr.l3Address); // 0x...
 */
export async function deriveUnifiedAddress(
  masterKey: string,
  chainCode: string | null,
  path: string,
  mode: DerivationMode = DEFAULT_DERIVATION_MODE
): Promise<UnifiedAddress> {
  // Derive L1 address (includes private key)
  const l1 = deriveL1Address(masterKey, chainCode, path, mode);

  // Derive L3 address from same private key
  const l3 = await deriveL3Address(l1.privateKey);

  return {
    path,
    index: l1.index,
    isChange: l1.isChange,
    l1Address: l1.address,
    privateKey: l1.privateKey,
    publicKey: l1.publicKey,
    l3Address: l3.address,
  };
}

/**
 * Derive default unified address (first address)
 */
export async function deriveDefaultUnifiedAddress(
  masterKey: string,
  chainCode: string,
  config: WalletConfig = {}
): Promise<UnifiedAddress> {
  const basePath = config.basePath || DEFAULT_BASE_PATH;
  const path = `${basePath}/0/0`;
  return deriveUnifiedAddress(masterKey, chainCode, path, config.derivationMode);
}

/**
 * Derive next unified address in sequence
 */
export async function deriveNextUnifiedAddress(
  masterKey: string,
  chainCode: string,
  currentIndex: number,
  config: WalletConfig = {}
): Promise<UnifiedAddress> {
  const basePath = config.basePath || DEFAULT_BASE_PATH;
  const nextIndex = currentIndex + 1;
  const path = `${basePath}/0/${nextIndex}`;
  return deriveUnifiedAddress(masterKey, chainCode, path, config.derivationMode);
}
