/**
 * Wallet.dat Parsing
 *
 * Pure functions for parsing Bitcoin Core wallet.dat files.
 * Extracts keys, chain codes, and descriptors from SQLite-format wallet files.
 *
 * Note: Decryption requires CryptoJS and is handled separately due to
 * iterative hashing that may need to yield to prevent UI blocking.
 */

import CryptoJS from 'crypto-js';
import { bytesToHex, findPattern, base58Decode, isValidPrivateKey } from '../core/utils';

// ==========================================
// Types
// ==========================================

export interface CMasterKeyData {
  encryptedKey: Uint8Array;
  salt: Uint8Array;
  derivationMethod: number;
  iterations: number;
  position: number;
}

export interface WalletDatInfo {
  /** Is SQLite format */
  isSQLite: boolean;
  /** Is encrypted (has mkey records) */
  isEncrypted: boolean;
  /** Is modern descriptor wallet */
  isDescriptorWallet: boolean;
  /** Has HD chain */
  hasHDChain: boolean;
  /** Extracted descriptor private keys (unencrypted wallets) */
  descriptorKeys: string[];
  /** Extracted legacy private keys (unencrypted wallets) */
  legacyKeys: string[];
  /** Master chain code (from xpub) */
  chainCode: string | null;
  /** Descriptor path (e.g., "84'/1'/0'") */
  descriptorPath: string | null;
  /** CMasterKey structures for encrypted wallets */
  cmasterKeys: CMasterKeyData[];
  /** Descriptor ID for encrypted key lookup */
  descriptorId: Uint8Array | null;
  /** xpub string for chain code extraction */
  xpubString: string | null;
}

export interface WalletDatParseResult {
  success: boolean;
  info?: WalletDatInfo;
  masterKey?: string;
  chainCode?: string;
  descriptorPath?: string;
  error?: string;
}

// ==========================================
// SQLite Header Check
// ==========================================

/**
 * Check if data is a valid SQLite database
 */
export function isSQLiteDatabase(data: Uint8Array): boolean {
  if (data.length < 16) return false;
  const header = new TextDecoder().decode(data.slice(0, 16));
  return header.startsWith('SQLite format 3');
}

// ==========================================
// CMasterKey Detection
// ==========================================

/**
 * Find ALL CMasterKey structures in wallet.dat
 * Returns array of all found structures (wallet may have multiple)
 *
 * CMasterKey format:
 * - vchCryptedKey: compact_size (1 byte = 0x30) + encrypted_key (48 bytes)
 * - vchSalt: compact_size (1 byte = 0x08) + salt (8 bytes)
 * - nDerivationMethod: uint32 (4 bytes)
 * - nDeriveIterations: uint32 (4 bytes)
 */
export function findAllCMasterKeys(data: Uint8Array): CMasterKeyData[] {
  const results: CMasterKeyData[] = [];

  for (let pos = 0; pos < data.length - 70; pos++) {
    if (data[pos] === 0x30) { // 48 = encrypted key length
      const saltLenPos = pos + 1 + 48;
      if (saltLenPos < data.length && data[saltLenPos] === 0x08) { // 8 = salt length
        const iterPos = saltLenPos + 1 + 8 + 4; // after salt + derivation method
        if (iterPos + 4 <= data.length) {
          const iterations = data[iterPos] | (data[iterPos + 1] << 8) |
                            (data[iterPos + 2] << 16) | (data[iterPos + 3] << 24);
          // Bitcoin Core typically uses 25000-500000 iterations
          if (iterations >= 1000 && iterations <= 10000000) {
            const encryptedKey = data.slice(pos + 1, pos + 1 + 48);
            const salt = data.slice(saltLenPos + 1, saltLenPos + 1 + 8);
            const derivationMethod = data[saltLenPos + 1 + 8] | (data[saltLenPos + 1 + 8 + 1] << 8) |
                                    (data[saltLenPos + 1 + 8 + 2] << 16) | (data[saltLenPos + 1 + 8 + 3] << 24);

            results.push({ encryptedKey, salt, derivationMethod, iterations, position: pos });
          }
        }
      }
    }
  }

  return results;
}

/**
 * Check if wallet.dat is encrypted (has mkey records)
 */
export function isEncryptedWalletDat(data: Uint8Array): boolean {
  const mkeyPattern = new TextEncoder().encode('mkey');
  return findPattern(data, mkeyPattern, 0) !== -1;
}

// ==========================================
// Descriptor Extraction
// ==========================================

/**
 * Find wpkh descriptor and extract xpub + descriptor ID
 */
export function findWpkhDescriptor(data: Uint8Array): {
  descriptorId: Uint8Array | null;
  xpubString: string | null;
  descriptorPath: string | null;
} {
  const descriptorPattern = new TextEncoder().encode('walletdescriptor');
  let descriptorIndex = 0;

  while ((descriptorIndex = findPattern(data, descriptorPattern, descriptorIndex)) !== -1) {
    // Skip descriptor ID (32 bytes) - it's between the prefix and the value
    let scanPos = descriptorIndex + descriptorPattern.length + 32;

    // Read the descriptor value (starts with compact size)
    const descLen = data[scanPos];
    scanPos++;

    const descBytes = data.slice(scanPos, scanPos + Math.min(descLen, 200));
    let descStr = '';
    for (let i = 0; i < descBytes.length && descBytes[i] >= 32 && descBytes[i] <= 126; i++) {
      descStr += String.fromCharCode(descBytes[i]);
    }

    // Look for native SegWit receive descriptor: wpkh(...84h/1h/0h/0/*)
    if (descStr.startsWith('wpkh(xpub') && descStr.includes('/0/*)')) {
      // Extract xpub
      const xpubMatch = descStr.match(/xpub[1-9A-HJ-NP-Za-km-z]{100,}/);
      if (xpubMatch) {
        // Extract descriptor ID (32 bytes after "walletdescriptor" prefix)
        const descIdStart = descriptorIndex + descriptorPattern.length;
        const descriptorId = data.slice(descIdStart, descIdStart + 32);

        // Parse descriptor path from descriptor string
        // Format: wpkh([fingerprint/84'/0'/0']xpub.../0/*)
        const pathMatch = descStr.match(/\[[\da-f]+\/(\d+'\/\d+'\/\d+')\]/);
        const descriptorPath = pathMatch ? pathMatch[1] : "84'/1'/0'";

        return {
          descriptorId,
          xpubString: xpubMatch[0],
          descriptorPath,
        };
      }
    }

    descriptorIndex++;
  }

  return { descriptorId: null, xpubString: null, descriptorPath: null };
}

/**
 * Extract chain code from xpub string
 */
export function extractChainCodeFromXpub(xpubString: string): string {
  const decoded = base58Decode(xpubString);
  // Chain code is at bytes 13-45 (32 bytes)
  return bytesToHex(decoded.slice(13, 45));
}

/**
 * Find master chain code from depth-0 xpub
 */
export function findMasterChainCode(data: Uint8Array): string | null {
  const xpubPattern = new TextEncoder().encode('xpub');
  const base58Chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let searchPos = 0;

  while (searchPos < data.length) {
    const xpubIndex = findPattern(data, xpubPattern, searchPos);
    if (xpubIndex === -1) break;

    // Extract the full xpub
    let xpubStr = 'xpub';
    let pos = xpubIndex + 4;

    while (pos < data.length && xpubStr.length < 120) {
      const char = String.fromCharCode(data[pos]);
      if (base58Chars.includes(char)) {
        xpubStr += char;
        pos++;
      } else {
        break;
      }
    }

    if (xpubStr.length > 100) {
      try {
        // Decode the xpub to check depth
        const decoded = base58Decode(xpubStr);
        const depth = decoded[4];

        // We want the master key at depth 0
        if (depth === 0) {
          return bytesToHex(decoded.slice(13, 45));
        }
      } catch {
        // Invalid xpub, continue
      }
    }

    searchPos = xpubIndex + 4;
  }

  return null;
}

// ==========================================
// Key Extraction (Unencrypted)
// ==========================================

/**
 * Extract descriptor keys from unencrypted wallet.dat
 */
export function extractDescriptorKeys(data: Uint8Array): string[] {
  const keys: string[] = [];
  const descriptorKeyPattern = new TextEncoder().encode('walletdescriptorkey');

  let index = 0;
  while ((index = findPattern(data, descriptorKeyPattern, index)) !== -1) {
    // Search for DER-encoded private key directly after walletdescriptorkey
    for (let checkPos = index + descriptorKeyPattern.length;
         checkPos < Math.min(index + descriptorKeyPattern.length + 200, data.length - 40);
         checkPos++) {
      // Look for DER sequence markers: d30201010420
      if (data[checkPos] === 0xd3 &&
          data[checkPos + 1] === 0x02 &&
          data[checkPos + 2] === 0x01 &&
          data[checkPos + 3] === 0x01 &&
          data[checkPos + 4] === 0x04 &&
          data[checkPos + 5] === 0x20) {
        // Extract the 32-byte private key
        const privKey = data.slice(checkPos + 6, checkPos + 38);
        const privKeyHex = bytesToHex(privKey);

        if (isValidPrivateKey(privKeyHex)) {
          keys.push(privKeyHex);
          break;
        }
      }
    }
    index++;
  }

  return keys;
}

/**
 * Extract legacy keys from unencrypted wallet.dat
 */
export function extractLegacyKeys(data: Uint8Array): string[] {
  const keys: string[] = [];
  const keyPattern = new TextEncoder().encode('key');

  let index = 0;
  while ((index = findPattern(data, keyPattern, index)) !== -1) {
    // Extract private key using simple pattern search
    const searchPattern = new Uint8Array([0x04, 0x20]); // DER encoding for 32-byte octet string
    for (let i = index; i < Math.min(index + 200, data.length - 34); i++) {
      if (data[i] === searchPattern[0] && data[i + 1] === searchPattern[1]) {
        const privKey = data.slice(i + 2, i + 34);
        const privKeyHex = bytesToHex(privKey);

        if (isValidPrivateKey(privKeyHex)) {
          keys.push(privKeyHex);
          break;
        }
      }
    }
    index++;
  }

  return keys;
}

/**
 * Check if wallet has HD chain
 */
export function hasHDChain(data: Uint8Array): boolean {
  const hdChainPattern = new TextEncoder().encode('hdchain');
  return findPattern(data, hdChainPattern, 0) !== -1;
}

// ==========================================
// Main Parse Function
// ==========================================

/**
 * Parse wallet.dat file and extract all available information
 * This is a pure function - no async, no browser APIs
 *
 * For encrypted wallets, returns CMasterKey data for decryption by caller
 */
export function parseWalletDat(data: Uint8Array): WalletDatParseResult {
  // Check SQLite header
  if (!isSQLiteDatabase(data)) {
    return {
      success: false,
      error: 'Invalid wallet.dat file - not an SQLite database',
    };
  }

  const isEncrypted = isEncryptedWalletDat(data);
  const cmasterKeys = isEncrypted ? findAllCMasterKeys(data) : [];
  const descriptorKeys = isEncrypted ? [] : extractDescriptorKeys(data);
  const legacyKeys = isEncrypted ? [] : extractLegacyKeys(data);
  const isDescriptorWallet = descriptorKeys.length > 0 ||
    findPattern(data, new TextEncoder().encode('walletdescriptorkey'), 0) !== -1;

  // Find descriptor info (for both encrypted and unencrypted)
  const { descriptorId, xpubString, descriptorPath: descPath } = findWpkhDescriptor(data);

  // Get chain code
  let chainCode: string | null = null;
  if (xpubString) {
    try {
      chainCode = extractChainCodeFromXpub(xpubString);
    } catch {
      // Try to find master chain code from depth-0 xpub
      chainCode = findMasterChainCode(data);
    }
  } else {
    chainCode = findMasterChainCode(data);
  }

  const info: WalletDatInfo = {
    isSQLite: true,
    isEncrypted,
    isDescriptorWallet,
    hasHDChain: hasHDChain(data),
    descriptorKeys,
    legacyKeys,
    chainCode,
    descriptorPath: descPath,
    cmasterKeys,
    descriptorId,
    xpubString,
  };

  // For unencrypted wallets, extract the master key
  if (!isEncrypted) {
    let masterKey: string | null = null;

    if (isDescriptorWallet && descriptorKeys.length > 0) {
      masterKey = descriptorKeys[0];
    } else if (legacyKeys.length > 0) {
      masterKey = legacyKeys[0];
    }

    if (masterKey) {
      return {
        success: true,
        info,
        masterKey,
        chainCode: chainCode ?? undefined,
        descriptorPath: descPath ?? "84'/1'/0'",
      };
    }

    return {
      success: false,
      info,
      error: 'No valid private keys found in wallet.dat file',
    };
  }

  // For encrypted wallets, return info for decryption
  if (cmasterKeys.length === 0) {
    return {
      success: false,
      info,
      error: 'Encrypted wallet but no CMasterKey structures found',
    };
  }

  return {
    success: true,
    info,
    // masterKey will be filled after decryption
  };
}

// ==========================================
// Encrypted Key Lookup Helper
// ==========================================

/**
 * Find encrypted private key for descriptor ID
 * Used after master key decryption
 */
export function findEncryptedKeyForDescriptor(
  data: Uint8Array,
  descriptorId: Uint8Array
): { pubkey: Uint8Array; encryptedKey: Uint8Array } | null {
  const ckeyPattern = new TextEncoder().encode('walletdescriptorckey');
  let ckeyIndex = findPattern(data, ckeyPattern, 0);

  while (ckeyIndex !== -1) {
    // Check if this record matches our descriptor ID
    const recordDescId = data.slice(ckeyIndex + ckeyPattern.length, ckeyIndex + ckeyPattern.length + 32);

    if (Array.from(recordDescId).every((b, i) => b === descriptorId[i])) {
      // Found matching record - extract pubkey and encrypted key
      let keyPos = ckeyIndex + ckeyPattern.length + 32;
      const pubkeyLen = data[keyPos];
      keyPos++;
      const pubkey = data.slice(keyPos, keyPos + pubkeyLen);

      // Find the value field (encrypted key)
      for (let searchPos = keyPos + pubkeyLen;
           searchPos < Math.min(keyPos + pubkeyLen + 100, data.length - 50);
           searchPos++) {
        const valueLen = data[searchPos];
        if (valueLen >= 32 && valueLen <= 64) {
          const encryptedKey = data.slice(searchPos + 1, searchPos + 1 + valueLen);
          return { pubkey, encryptedKey };
        }
      }
    }

    ckeyIndex = findPattern(data, ckeyPattern, ckeyIndex + 1);
  }

  return null;
}

// ==========================================
// Decryption Functions
// ==========================================

/**
 * Progress callback for long-running decryption operations
 * Called periodically during iterative hashing
 */
export type DecryptionProgressCallback = (iteration: number, total: number) => Promise<void> | void;

/**
 * Convert Uint8Array to CryptoJS WordArray
 */
function uint8ArrayToWordArray(u8arr: Uint8Array): CryptoJS.lib.WordArray {
  const hex = bytesToHex(u8arr);
  return CryptoJS.enc.Hex.parse(hex);
}

/**
 * Decrypt master key from CMasterKey structure
 * Uses iterative SHA-512 (Bitcoin Core's BytesToKeySHA512AES method from crypter.cpp)
 *
 * @param cmk - CMasterKey data structure
 * @param password - User password
 * @param onProgress - Optional callback for progress updates (allows UI to remain responsive)
 * @returns Decrypted master key hex string
 */
export async function decryptCMasterKey(
  cmk: CMasterKeyData,
  password: string,
  onProgress?: DecryptionProgressCallback
): Promise<string> {
  const { encryptedKey, salt, iterations } = cmk;

  // Derive key and IV using iterative SHA-512
  // First hash: SHA512(password + salt)
  const passwordHex = bytesToHex(new TextEncoder().encode(password));
  const saltHex = bytesToHex(salt);
  const inputHex = passwordHex + saltHex;

  let hash = CryptoJS.SHA512(CryptoJS.enc.Hex.parse(inputHex));

  // Process remaining iterations
  const BATCH_SIZE = 1000;
  for (let i = 0; i < iterations - 1; i++) {
    hash = CryptoJS.SHA512(hash);
    // Call progress callback periodically
    if (onProgress && i % BATCH_SIZE === 0) {
      await onProgress(i, iterations);
    }
  }

  // Key is first 32 bytes (8 words), IV is next 16 bytes (4 words)
  const derivedKey = CryptoJS.lib.WordArray.create(hash.words.slice(0, 8));
  const derivedIv = CryptoJS.lib.WordArray.create(hash.words.slice(8, 12));

  // Decrypt master key using AES-256-CBC
  const encryptedWords = uint8ArrayToWordArray(encryptedKey);

  const decrypted = CryptoJS.AES.decrypt(
    { ciphertext: encryptedWords } as CryptoJS.lib.CipherParams,
    derivedKey,
    { iv: derivedIv, padding: CryptoJS.pad.Pkcs7, mode: CryptoJS.mode.CBC }
  );

  const result = CryptoJS.enc.Hex.stringify(decrypted);

  if (!result || result.length !== 64) {
    throw new Error('Master key decryption failed - incorrect password');
  }

  return result;
}

/**
 * Decrypt a private key using the decrypted master key
 * Uses AES-256-CBC with IV derived from double SHA256 of pubkey
 *
 * @param encryptedKey - Encrypted private key bytes
 * @param pubkey - Public key (used to derive IV)
 * @param masterKeyHex - Decrypted master key (hex)
 * @returns Decrypted private key hex string
 */
export function decryptPrivateKey(
  encryptedKey: Uint8Array,
  pubkey: Uint8Array,
  masterKeyHex: string
): string {
  // IV is derived from double SHA256 of pubkey (first 16 bytes)
  const pubkeyWords = uint8ArrayToWordArray(pubkey);
  const pubkeyHashWords = CryptoJS.SHA256(CryptoJS.SHA256(pubkeyWords));
  const ivWords = CryptoJS.lib.WordArray.create(pubkeyHashWords.words.slice(0, 4));

  const masterKeyWords = CryptoJS.enc.Hex.parse(masterKeyHex);
  const encryptedWords = uint8ArrayToWordArray(encryptedKey);

  const decrypted = CryptoJS.AES.decrypt(
    { ciphertext: encryptedWords } as CryptoJS.lib.CipherParams,
    masterKeyWords,
    { iv: ivWords, padding: CryptoJS.pad.Pkcs7, mode: CryptoJS.mode.CBC }
  );

  return CryptoJS.enc.Hex.stringify(decrypted);
}

export interface DecryptWalletDatResult {
  success: boolean;
  masterKey?: string;
  chainCode?: string;
  descriptorPath?: string;
  error?: string;
}

/**
 * Decrypt encrypted wallet.dat and extract BIP32 master key
 *
 * @param data - Raw wallet.dat file contents
 * @param password - User password
 * @param onProgress - Optional progress callback for UI responsiveness
 * @returns Decrypted wallet data or error
 */
export async function decryptWalletDat(
  data: Uint8Array,
  password: string,
  onProgress?: DecryptionProgressCallback
): Promise<DecryptWalletDatResult> {
  // Parse wallet structure first
  const parseResult = parseWalletDat(data);

  if (!parseResult.success || !parseResult.info) {
    return {
      success: false,
      error: parseResult.error || 'Failed to parse wallet.dat',
    };
  }

  const { info } = parseResult;

  if (!info.isEncrypted) {
    // Not encrypted - return parsed data directly
    return {
      success: true,
      masterKey: parseResult.masterKey,
      chainCode: parseResult.chainCode,
      descriptorPath: parseResult.descriptorPath,
    };
  }

  // Encrypted wallet - need to decrypt
  if (info.cmasterKeys.length === 0) {
    return {
      success: false,
      error: 'Encrypted wallet but no CMasterKey structures found',
    };
  }

  // Try to decrypt each CMasterKey until one succeeds
  let masterKeyHex: string | null = null;
  for (const cmk of info.cmasterKeys) {
    try {
      masterKeyHex = await decryptCMasterKey(cmk, password, onProgress);
      if (masterKeyHex && masterKeyHex.length === 64) {
        break;
      }
    } catch {
      // Try next CMasterKey
      continue;
    }
  }

  if (!masterKeyHex || masterKeyHex.length !== 64) {
    return {
      success: false,
      error: 'Master key decryption failed - incorrect password',
    };
  }

  // Find and decrypt BIP32 master private key
  if (!info.descriptorId) {
    return {
      success: false,
      error: 'Could not find native SegWit receive descriptor',
    };
  }

  const encryptedKeyData = findEncryptedKeyForDescriptor(data, info.descriptorId);
  if (!encryptedKeyData) {
    return {
      success: false,
      error: 'Could not find encrypted private key for descriptor',
    };
  }

  const bip32MasterKey = decryptPrivateKey(
    encryptedKeyData.encryptedKey,
    encryptedKeyData.pubkey,
    masterKeyHex
  );

  if (!bip32MasterKey || bip32MasterKey.length !== 64) {
    return {
      success: false,
      error: 'Could not decrypt BIP32 master private key',
    };
  }

  return {
    success: true,
    masterKey: bip32MasterKey,
    chainCode: info.chainCode ?? undefined,
    descriptorPath: info.descriptorPath ?? "84'/1'/0'",
  };
}
