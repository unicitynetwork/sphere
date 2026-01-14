/**
 * SDK Utility Functions
 *
 * Pure utility functions used across the wallet SDK.
 * No browser APIs - can run in any JavaScript environment.
 */

// ==========================================
// Hex/Bytes Conversion
// ==========================================

/**
 * Convert Uint8Array to hex string
 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Convert hex string to Uint8Array
 */
export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

// ==========================================
// Binary Pattern Search
// ==========================================

/**
 * Find pattern in Uint8Array
 * @param data - Data to search in
 * @param pattern - Pattern to find
 * @param startIndex - Start index for search
 * @returns Index of pattern or -1 if not found
 */
export function findPattern(
  data: Uint8Array,
  pattern: Uint8Array,
  startIndex: number = 0
): number {
  for (let i = startIndex; i <= data.length - pattern.length; i++) {
    let found = true;
    for (let j = 0; j < pattern.length; j++) {
      if (data[i + j] !== pattern[j]) {
        found = false;
        break;
      }
    }
    if (found) return i;
  }
  return -1;
}

// ==========================================
// Private Key Validation
// ==========================================

/**
 * Validate if a hex string is a valid secp256k1 private key
 * Must be 0 < key < n (curve order)
 */
export function isValidPrivateKey(hex: string): boolean {
  try {
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
      return false;
    }
    const n = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');
    const key = BigInt('0x' + hex);
    return key > 0n && key < n;
  } catch {
    return false;
  }
}

// ==========================================
// Base58 Encoding/Decoding
// ==========================================

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * Base58 encode hex string
 */
export function base58Encode(hex: string): string {
  // Convert hex to big integer
  let num = BigInt('0x' + hex);
  let encoded = '';

  while (num > 0n) {
    const remainder = Number(num % 58n);
    num = num / 58n;
    encoded = BASE58_ALPHABET[remainder] + encoded;
  }

  // Add leading 1s for leading 0s in hex
  for (let i = 0; i < hex.length && hex.substring(i, i + 2) === '00'; i += 2) {
    encoded = '1' + encoded;
  }

  return encoded;
}

/**
 * Base58 decode string to Uint8Array
 */
export function base58Decode(str: string): Uint8Array {
  const ALPHABET_MAP: Record<string, number> = {};
  for (let i = 0; i < BASE58_ALPHABET.length; i++) {
    ALPHABET_MAP[BASE58_ALPHABET[i]] = i;
  }

  // Count leading zeros (represented as '1' in base58)
  let zeros = 0;
  for (let i = 0; i < str.length && str[i] === '1'; i++) {
    zeros++;
  }

  // Decode from base58 to number
  let num = BigInt(0);
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (!(char in ALPHABET_MAP)) {
      throw new Error('Invalid base58 character: ' + char);
    }
    num = num * BigInt(58) + BigInt(ALPHABET_MAP[char]);
  }

  // Convert to bytes
  const bytes: number[] = [];
  while (num > 0) {
    bytes.unshift(Number(num % BigInt(256)));
    num = num / BigInt(256);
  }

  // Add leading zeros
  for (let i = 0; i < zeros; i++) {
    bytes.unshift(0);
  }

  return new Uint8Array(bytes);
}

// ==========================================
// Text Parsing Helpers
// ==========================================

/**
 * Extract value from text using regex pattern
 * @param text - Text to search
 * @param pattern - Regex pattern with capture group
 * @returns Captured value or null
 */
export function extractFromText(text: string, pattern: RegExp): string | null {
  const match = text.match(pattern);
  return match?.[1]?.trim() ?? null;
}
