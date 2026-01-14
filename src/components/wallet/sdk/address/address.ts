/**
 * Address Generation Utilities
 *
 * Pure functions for converting private keys to addresses.
 * No side effects, no browser APIs - can run anywhere.
 */

import CryptoJS from 'crypto-js';
import elliptic from 'elliptic';
import { createBech32 } from './bech32';
import { deriveKeyAtPath, deriveChildKeyLegacy, deriveKeyWifHmac } from '../core/derivation';

const ec = new elliptic.ec('secp256k1');

/**
 * Compute HASH160 (SHA256 -> RIPEMD160) of a public key
 * @param publicKey - Compressed public key as hex string
 * @returns HASH160 as hex string
 */
export function computeHash160(publicKey: string): string {
  const sha = CryptoJS.SHA256(CryptoJS.enc.Hex.parse(publicKey)).toString();
  const hash160 = CryptoJS.RIPEMD160(CryptoJS.enc.Hex.parse(sha)).toString();
  return hash160;
}

/**
 * Convert HASH160 hex string to Uint8Array (witness program bytes)
 * @param hash160 - HASH160 as hex string
 * @returns 20-byte Uint8Array
 */
export function hash160ToBytes(hash160: string): Uint8Array {
  return Uint8Array.from(hash160.match(/../g)!.map((x) => parseInt(x, 16)));
}

/**
 * Generate bech32 address from public key
 * @param publicKey - Compressed public key as hex string
 * @param prefix - Address prefix (default: "alpha")
 * @param witnessVersion - Witness version (default: 0)
 * @returns Bech32 encoded address
 */
export function publicKeyToAddress(
  publicKey: string,
  prefix: string = 'alpha',
  witnessVersion: number = 0
): string {
  const hash160 = computeHash160(publicKey);
  const programBytes = hash160ToBytes(hash160);
  return createBech32(prefix, witnessVersion, programBytes);
}

/**
 * Generate address info from a private key
 * @param privateKey - Private key as hex string
 * @returns Object with address, publicKey
 */
export function privateKeyToAddressInfo(privateKey: string): {
  address: string;
  publicKey: string;
} {
  const keyPair = ec.keyFromPrivate(privateKey);
  const publicKey = keyPair.getPublic(true, 'hex');
  const address = publicKeyToAddress(publicKey);
  return { address, publicKey };
}

/**
 * Generate full address info from private key with index and path
 * @param privateKey - Private key as hex string
 * @param index - Address index
 * @param path - Derivation path
 * @returns Full address info object
 */
export function generateAddressInfo(
  privateKey: string,
  index: number,
  path: string
): {
  address: string;
  privateKey: string;
  publicKey: string;
  index: number;
  path: string;
} {
  const { address, publicKey } = privateKeyToAddressInfo(privateKey);
  return {
    address,
    privateKey,
    publicKey,
    index,
    path,
  };
}

// Re-export elliptic instance for use in other modules
export { ec };

// ============================================
// HD Address Generation (L1 specific helpers)
// ============================================

/**
 * Generate HD address using standard BIP32
 * Standard path: m/44'/0'/0'/0/{index} (external chain, non-hardened)
 * For change addresses, use isChange = true to get m/44'/0'/0'/1/{index}
 */
export function generateHDAddressBIP32(
  masterPriv: string,
  chainCode: string,
  index: number,
  basePath: string = "m/44'/0'/0'",
  isChange: boolean = false
) {
  // Chain: 0 = external (receiving), 1 = internal (change)
  const chain = isChange ? 1 : 0;
  const fullPath = `${basePath}/${chain}/${index}`;

  const derived = deriveKeyAtPath(masterPriv, chainCode, fullPath);

  return generateAddressInfo(derived.privateKey, index, fullPath);
}

/**
 * Generate address from master private key using HMAC-SHA512 derivation
 * This matches exactly the original index.html implementation
 * @param masterPrivateKey - 32-byte hex private key (64 chars)
 * @param index - Address index
 */
export function generateAddressFromMasterKey(
  masterPrivateKey: string,
  index: number
) {
  const derivationPath = `m/44'/0'/${index}'`;
  const childPrivateKey = deriveKeyWifHmac(masterPrivateKey, index);

  return generateAddressInfo(childPrivateKey, index, derivationPath);
}

// ============================================
// Legacy functions for backward compatibility
// ============================================

/**
 * @deprecated Use deriveChildKeyBIP32 for new wallets
 * Legacy HMAC-SHA512 derivation (non-standard)
 */
export function deriveChildKey(
  masterPriv: string,
  chainCode: string,
  index: number
) {
  const result = deriveChildKeyLegacy(masterPriv, chainCode, index);
  return {
    privateKey: result.privateKey,
    nextChainCode: result.chainCode,
  };
}

/**
 * @deprecated Use generateHDAddressBIP32 for new wallets
 * Legacy HD address generation (non-standard derivation)
 */
export function generateHDAddress(
  masterPriv: string,
  chainCode: string,
  index: number
) {
  const child = deriveChildKey(masterPriv, chainCode, index);
  const path = `m/44'/0'/0'/${index}`;

  return generateAddressInfo(child.privateKey, index, path);
}

// ============================================
// Address Key Recovery Functions
// ============================================

export interface RecoveredAddressKey {
  privateKey: string;
  publicKey: string;
  path: string;
  index: number;
  isChange?: boolean;
}

export interface RecoverKeyResult {
  success: boolean;
  key?: RecoveredAddressKey;
  error?: string;
}

/**
 * Recover private key for an address using WIF HMAC derivation (standard wallets)
 * Scans indices 0-99 to find matching address
 *
 * @param masterPrivateKey - Master private key hex
 * @param targetAddress - Address to find key for
 * @param maxIndex - Maximum index to scan (default 100)
 * @returns Recovery result with key info or error
 */
export function recoverKeyWifHmac(
  masterPrivateKey: string,
  targetAddress: string,
  maxIndex: number = 100
): RecoverKeyResult {
  for (let i = 0; i < maxIndex; i++) {
    const childKey = deriveKeyWifHmac(masterPrivateKey, i);
    const keyPair = ec.keyFromPrivate(childKey);
    const publicKey = keyPair.getPublic(true, 'hex');
    const derivedAddress = publicKeyToAddress(publicKey, 'alpha', 0);

    if (derivedAddress === targetAddress) {
      return {
        success: true,
        key: {
          privateKey: childKey,
          publicKey,
          path: `m/44'/0'/${i}'`,
          index: i,
        },
      };
    }
  }

  return {
    success: false,
    error: `Could not find derivation for address ${targetAddress} in indices 0-${maxIndex - 1}`,
  };
}

/**
 * Recover private key for an address using BIP32 derivation at specific path
 *
 * @param masterPrivateKey - Master private key hex
 * @param chainCode - Chain code hex
 * @param path - Derivation path (e.g., "m/84'/1'/0'/0/0")
 * @param targetAddress - Expected address for verification
 * @returns Recovery result with key info or error
 */
export function recoverKeyBIP32AtPath(
  masterPrivateKey: string,
  chainCode: string,
  path: string,
  targetAddress: string
): RecoverKeyResult {
  try {
    const derived = deriveKeyAtPath(masterPrivateKey, chainCode, path);
    const keyPair = ec.keyFromPrivate(derived.privateKey);
    const publicKey = keyPair.getPublic(true, 'hex');
    const derivedAddress = publicKeyToAddress(publicKey, 'alpha', 0);

    if (derivedAddress !== targetAddress) {
      return {
        success: false,
        error: `Address mismatch: expected ${targetAddress}, got ${derivedAddress}`,
      };
    }

    // Determine if change address from path
    const pathParts = path.split('/');
    let isChange = false;
    let index = 0;
    if (pathParts.length >= 5) {
      const chain = parseInt(pathParts[pathParts.length - 2], 10);
      isChange = chain === 1;
      index = parseInt(pathParts[pathParts.length - 1], 10);
    }

    return {
      success: true,
      key: {
        privateKey: derived.privateKey,
        publicKey,
        path,
        index,
        isChange,
      },
    };
  } catch (e) {
    return {
      success: false,
      error: `Failed to derive at path ${path}: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/**
 * Recover private key for an address by scanning BIP32 paths
 * Scans both external (chain 0) and change (chain 1) addresses
 *
 * @param masterPrivateKey - Master private key hex
 * @param chainCode - Chain code hex
 * @param targetAddress - Address to find key for
 * @param basePath - Base derivation path (default "84'/1'/0'")
 * @param maxIndex - Maximum index to scan per chain (default 100)
 * @returns Recovery result with key info or error
 */
export function recoverKeyBIP32Scan(
  masterPrivateKey: string,
  chainCode: string,
  targetAddress: string,
  basePath: string = "84'/1'/0'",
  maxIndex: number = 100
): RecoverKeyResult {
  // Scan both chains (0=external, 1=change)
  for (const chain of [0, 1]) {
    for (let i = 0; i < maxIndex; i++) {
      const path = `m/${basePath}/${chain}/${i}`;
      try {
        const derived = deriveKeyAtPath(masterPrivateKey, chainCode, path);
        const keyPair = ec.keyFromPrivate(derived.privateKey);
        const publicKey = keyPair.getPublic(true, 'hex');
        const derivedAddress = publicKeyToAddress(publicKey, 'alpha', 0);

        if (derivedAddress === targetAddress) {
          return {
            success: true,
            key: {
              privateKey: derived.privateKey,
              publicKey,
              path,
              index: i,
              isChange: chain === 1,
            },
          };
        }
      } catch {
        // Continue on derivation errors
      }
    }
  }

  return {
    success: false,
    error: `Could not find BIP32 derivation for address ${targetAddress}`,
  };
}
