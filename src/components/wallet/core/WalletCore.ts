/**
 * WalletCore - Pure wallet functions without side effects
 *
 * This module provides stateless functions for:
 * - Creating new wallets (mnemonic generation)
 * - Restoring wallets from mnemonic
 * - Deriving L1 addresses (Alpha blockchain)
 * - Deriving L3 addresses (Unicity network)
 *
 * No localStorage, no singletons, no React - just pure functions.
 * Can be used in browser extensions, CLI tools, tests, etc.
 */

import * as bip39 from 'bip39';
import CryptoJS from 'crypto-js';
import elliptic from 'elliptic';
import { SigningService } from '@unicitylabs/state-transition-sdk/lib/sign/SigningService';
import { TokenType } from '@unicitylabs/state-transition-sdk/lib/token/TokenType';
import { HashAlgorithm } from '@unicitylabs/state-transition-sdk/lib/hash/HashAlgorithm';
import { UnmaskedPredicateReference } from '@unicitylabs/state-transition-sdk/lib/predicate/embedded/UnmaskedPredicateReference';

import type {
  WalletKeys,
  L1Address,
  L3Address,
  UnifiedAddress,
  DerivationMode,
  WalletConfig,
} from './types';
import {
  DEFAULT_BASE_PATH,
  DEFAULT_DERIVATION_MODE,
  UNICITY_TOKEN_TYPE_HEX,
} from './types';

const ec = new elliptic.ec('secp256k1');

// secp256k1 curve order
const CURVE_ORDER = BigInt(
  '0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141'
);

// ============================================
// Wallet Creation
// ============================================

/**
 * Create a new wallet with fresh mnemonic
 *
 * @param wordCount - Number of words (12 or 24)
 * @returns Wallet keys including mnemonic
 *
 * @example
 * const { mnemonic, masterKey, chainCode } = createWallet(12);
 * // Save mnemonic securely for backup
 */
export function createWallet(wordCount: 12 | 24 = 12): WalletKeys {
  const strength = wordCount === 24 ? 256 : 128;
  const mnemonic = bip39.generateMnemonic(strength);

  const keys = restoreFromMnemonic(mnemonic);

  return {
    ...keys,
    mnemonic,
  };
}

/**
 * Restore wallet from BIP39 mnemonic phrase
 *
 * @param mnemonic - 12 or 24 word recovery phrase
 * @returns Master key and chain code
 * @throws Error if mnemonic is invalid
 *
 * @example
 * const { masterKey, chainCode } = restoreFromMnemonic("word1 word2 ...");
 */
export function restoreFromMnemonic(mnemonic: string): WalletKeys {
  if (!bip39.validateMnemonic(mnemonic)) {
    throw new Error('Invalid mnemonic phrase');
  }

  // Convert mnemonic to seed (sync version for simplicity)
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const seedHex = Buffer.from(seed).toString('hex');

  // Derive master key using BIP32 standard
  const { masterKey, chainCode } = generateMasterKeyFromSeed(seedHex);

  return {
    masterKey,
    chainCode,
    mnemonic,
  };
}

/**
 * Validate mnemonic phrase
 */
export function validateMnemonic(mnemonic: string): boolean {
  return bip39.validateMnemonic(mnemonic);
}

// ============================================
// L1 Address Derivation (Alpha blockchain)
// ============================================

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

  const { publicKey, address } = privateKeyToL1Address(privateKey);

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
// L3 Address Derivation (Unicity network)
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
  const secret = Buffer.from(privateKey, 'hex');

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

// ============================================
// Path Utilities
// ============================================

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

// ============================================
// Internal: BIP32 Key Derivation
// ============================================

/**
 * Generate master key from seed (BIP32 standard)
 */
function generateMasterKeyFromSeed(seedHex: string): {
  masterKey: string;
  chainCode: string;
} {
  const I = CryptoJS.HmacSHA512(
    CryptoJS.enc.Hex.parse(seedHex),
    CryptoJS.enc.Utf8.parse('Bitcoin seed')
  ).toString();

  const IL = I.substring(0, 64);
  const IR = I.substring(64);

  const masterKeyBigInt = BigInt('0x' + IL);
  if (masterKeyBigInt === 0n || masterKeyBigInt >= CURVE_ORDER) {
    throw new Error('Invalid master key generated');
  }

  return {
    masterKey: IL,
    chainCode: IR,
  };
}

/**
 * Standard BIP32 child key derivation
 */
function deriveChildKeyBIP32(
  parentPrivKey: string,
  parentChainCode: string,
  index: number
): { privateKey: string; chainCode: string } {
  const isHardened = index >= 0x80000000;
  let data: string;

  if (isHardened) {
    const indexHex = index.toString(16).padStart(8, '0');
    data = '00' + parentPrivKey + indexHex;
  } else {
    const keyPair = ec.keyFromPrivate(parentPrivKey, 'hex');
    const compressedPubKey = keyPair.getPublic(true, 'hex');
    const indexHex = index.toString(16).padStart(8, '0');
    data = compressedPubKey + indexHex;
  }

  const I = CryptoJS.HmacSHA512(
    CryptoJS.enc.Hex.parse(data),
    CryptoJS.enc.Hex.parse(parentChainCode)
  ).toString();

  const IL = I.substring(0, 64);
  const IR = I.substring(64);

  const ilBigInt = BigInt('0x' + IL);
  const parentKeyBigInt = BigInt('0x' + parentPrivKey);

  if (ilBigInt >= CURVE_ORDER) {
    throw new Error('Invalid key: IL >= curve order');
  }

  const childKeyBigInt = (ilBigInt + parentKeyBigInt) % CURVE_ORDER;

  if (childKeyBigInt === 0n) {
    throw new Error('Invalid key: child key is zero');
  }

  const childPrivKey = childKeyBigInt.toString(16).padStart(64, '0');

  return {
    privateKey: childPrivKey,
    chainCode: IR,
  };
}

/**
 * Derive key at full BIP32 path
 */
function deriveKeyAtPath(
  masterPrivKey: string,
  masterChainCode: string,
  path: string
): { privateKey: string; chainCode: string } {
  const pathParts = path.replace('m/', '').split('/');

  let currentKey = masterPrivKey;
  let currentChainCode = masterChainCode;

  for (const part of pathParts) {
    const isHardened = part.endsWith("'") || part.endsWith('h');
    const indexStr = part.replace(/['h]$/, '');
    let index = parseInt(indexStr, 10);

    if (isHardened) {
      index += 0x80000000;
    }

    const derived = deriveChildKeyBIP32(currentKey, currentChainCode, index);
    currentKey = derived.privateKey;
    currentChainCode = derived.chainCode;
  }

  return {
    privateKey: currentKey,
    chainCode: currentChainCode,
  };
}

/**
 * Legacy HMAC derivation (non-standard)
 */
function deriveChildKeyLegacy(
  masterPriv: string,
  chainCode: string,
  index: number
): { privateKey: string; chainCode: string } {
  const data = masterPriv + index.toString(16).padStart(8, '0');

  const I = CryptoJS.HmacSHA512(
    CryptoJS.enc.Hex.parse(data),
    CryptoJS.enc.Hex.parse(chainCode)
  ).toString();

  return {
    privateKey: I.substring(0, 64),
    chainCode: I.substring(64),
  };
}

/**
 * WIF HMAC derivation (without chain code)
 */
function deriveKeyWifHmac(masterKey: string, index: number): string {
  const derivationPath = `m/44'/0'/${index}'`;

  const hmacOutput = CryptoJS.HmacSHA512(
    CryptoJS.enc.Hex.parse(masterKey),
    CryptoJS.enc.Utf8.parse(derivationPath)
  ).toString();

  return hmacOutput.substring(0, 64);
}

// ============================================
// Internal: L1 Address Generation
// ============================================

/**
 * Convert private key to L1 (Alpha) address
 */
function privateKeyToL1Address(privateKey: string): {
  publicKey: string;
  address: string;
} {
  const keyPair = ec.keyFromPrivate(privateKey, 'hex');
  const publicKey = keyPair.getPublic(true, 'hex');

  // HASH160 = RIPEMD160(SHA256(publicKey))
  const sha = CryptoJS.SHA256(CryptoJS.enc.Hex.parse(publicKey)).toString();
  const hash160 = CryptoJS.RIPEMD160(CryptoJS.enc.Hex.parse(sha)).toString();

  // Convert to bech32
  const programBytes = Uint8Array.from(
    hash160.match(/../g)!.map((x) => parseInt(x, 16))
  );
  const address = createBech32('alpha', 0, programBytes);

  return { publicKey, address };
}

// ============================================
// Internal: Bech32 Encoding
// ============================================

const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

function convertBits(
  data: number[],
  fromBits: number,
  toBits: number,
  pad: boolean
): number[] | null {
  let acc = 0;
  let bits = 0;
  const ret: number[] = [];
  const maxv = (1 << toBits) - 1;

  for (const value of data) {
    if (value < 0 || value >> fromBits !== 0) return null;
    acc = (acc << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      ret.push((acc >> bits) & maxv);
    }
  }

  if (pad) {
    if (bits > 0) {
      ret.push((acc << (toBits - bits)) & maxv);
    }
  } else if (bits >= fromBits || (acc << (toBits - bits)) & maxv) {
    return null;
  }

  return ret;
}

function bech32Polymod(values: number[]): number {
  const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) {
      if ((top >> i) & 1) chk ^= GENERATOR[i];
    }
  }
  return chk;
}

function hrpExpand(hrp: string): number[] {
  const ret: number[] = [];
  for (let i = 0; i < hrp.length; i++) ret.push(hrp.charCodeAt(i) >> 5);
  ret.push(0);
  for (let i = 0; i < hrp.length; i++) ret.push(hrp.charCodeAt(i) & 31);
  return ret;
}

function bech32Checksum(hrp: string, data: number[]): number[] {
  const values = hrpExpand(hrp).concat(data).concat([0, 0, 0, 0, 0, 0]);
  const mod = bech32Polymod(values) ^ 1;

  const ret: number[] = [];
  for (let p = 0; p < 6; p++) {
    ret.push((mod >> (5 * (5 - p))) & 31);
  }
  return ret;
}

function createBech32(hrp: string, version: number, program: Uint8Array): string {
  if (version < 0 || version > 16) {
    throw new Error('Invalid witness version');
  }

  const data = [version].concat(convertBits(Array.from(program), 8, 5, true)!);
  const checksum = bech32Checksum(hrp, data);
  const combined = data.concat(checksum);

  let out = hrp + '1';
  for (const c of combined) {
    out += BECH32_CHARSET[c];
  }

  return out;
}
