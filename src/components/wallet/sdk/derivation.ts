/**
 * BIP32 Key Derivation
 *
 * Pure functions for deriving child keys from master key.
 * Supports standard BIP32 and legacy HMAC derivation modes.
 * No side effects, no browser APIs - can run anywhere.
 */

import CryptoJS from 'crypto-js';
import elliptic from 'elliptic';

const ec = new elliptic.ec('secp256k1');

// secp256k1 curve order
const CURVE_ORDER = BigInt(
  '0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141'
);

/**
 * Generate master key from seed (BIP32 standard)
 */
export function generateMasterKeyFromSeed(seedHex: string): {
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
export function deriveChildKeyBIP32(
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
export function deriveKeyAtPath(
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
 * @deprecated Use deriveChildKeyBIP32 for new wallets
 */
export function deriveChildKeyLegacy(
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
 * Used for simple wallets imported from webwallet without chain code
 */
export function deriveKeyWifHmac(masterKey: string, index: number): string {
  const derivationPath = `m/44'/0'/${index}'`;

  const hmacOutput = CryptoJS.HmacSHA512(
    CryptoJS.enc.Hex.parse(masterKey),
    CryptoJS.enc.Utf8.parse(derivationPath)
  ).toString();

  return hmacOutput.substring(0, 64);
}

// ==========================================
// Path Parsing Helpers
// ==========================================

/**
 * Extract base path (descriptor path) from a full BIP32 address path
 * e.g., "m/84'/1'/0'/0/0" → "84'/1'/0'"
 *
 * @param fullPath - Full BIP32 path like "m/84'/1'/0'/0/5"
 * @returns Base path without 'm/' prefix and without chain/index, or null if invalid
 */
export function extractBasePathFromFullPath(fullPath: string): string | null {
  // Match standard 5-level BIP32 paths: m/purpose'/coinType'/account'/chain/index
  const match = fullPath.match(/^m\/(\d+'\/\d+'\/\d+')\/\d+\/\d+$/);
  return match?.[1] ?? null;
}
