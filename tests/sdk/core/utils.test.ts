import { describe, it, expect } from 'vitest';
import {
  bytesToHex,
  hexToBytes,
  findPattern,
  isValidPrivateKey,
  base58Encode,
  base58Decode,
  extractFromText,
} from '@/components/wallet/sdk/core/utils';

describe('utils', () => {
  describe('bytesToHex', () => {
    it('should convert bytes to hex string', () => {
      const bytes = new Uint8Array([0, 1, 255, 128]);
      const hex = bytesToHex(bytes);
      expect(hex).toBe('0001ff80');
    });

    it('should handle empty array', () => {
      const bytes = new Uint8Array([]);
      const hex = bytesToHex(bytes);
      expect(hex).toBe('');
    });

    it('should handle single byte', () => {
      expect(bytesToHex(new Uint8Array([0]))).toBe('00');
      expect(bytesToHex(new Uint8Array([255]))).toBe('ff');
      expect(bytesToHex(new Uint8Array([16]))).toBe('10');
    });
  });

  describe('hexToBytes', () => {
    it('should convert hex string to bytes', () => {
      const hex = '0001ff80';
      const bytes = hexToBytes(hex);
      expect(bytes).toEqual(new Uint8Array([0, 1, 255, 128]));
    });

    it('should handle empty string', () => {
      const bytes = hexToBytes('');
      expect(bytes).toEqual(new Uint8Array([]));
    });

    it('should handle uppercase hex', () => {
      const bytes = hexToBytes('AABBCC');
      expect(bytes).toEqual(new Uint8Array([170, 187, 204]));
    });
  });

  describe('bytesToHex and hexToBytes roundtrip', () => {
    it('should roundtrip correctly', () => {
      const original = new Uint8Array([0, 1, 2, 127, 128, 255]);
      const hex = bytesToHex(original);
      const result = hexToBytes(hex);
      expect(result).toEqual(original);
    });
  });

  describe('findPattern', () => {
    it('should find pattern in buffer', () => {
      const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
      const pattern = new Uint8Array([3, 4, 5]);
      const result = findPattern(data, pattern);
      expect(result).toBe(2);
    });

    it('should return -1 when pattern not found', () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      const pattern = new Uint8Array([9, 10]);
      const result = findPattern(data, pattern);
      expect(result).toBe(-1);
    });

    it('should find pattern at start', () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      const pattern = new Uint8Array([1, 2]);
      const result = findPattern(data, pattern);
      expect(result).toBe(0);
    });
  });

  describe('isValidPrivateKey', () => {
    it('should return true for valid 64-char hex', () => {
      const key = 'e8f32e723decf4051aefac8e2c93c9c5b214313817cdb01a1494b917c8436b35';
      expect(isValidPrivateKey(key)).toBe(true);
    });

    it('should return false for invalid length', () => {
      expect(isValidPrivateKey('abc123')).toBe(false);
      expect(isValidPrivateKey('')).toBe(false);
    });

    it('should return false for non-hex characters', () => {
      const key = 'g8f32e723decf4051aefac8e2c93c9c5b214313817cdb01a1494b917c8436b35';
      expect(isValidPrivateKey(key)).toBe(false);
    });

    it('should return false for all zeros', () => {
      const key = '0000000000000000000000000000000000000000000000000000000000000000';
      expect(isValidPrivateKey(key)).toBe(false);
    });
  });

  describe('base58Encode/base58Decode', () => {
    it('should encode and decode correctly', () => {
      // base58Encode takes hex string
      const hex = '0102030405';
      const encoded = base58Encode(hex);
      expect(typeof encoded).toBe('string');
      expect(encoded.length).toBeGreaterThan(0);

      const decoded = base58Decode(encoded);
      expect(bytesToHex(decoded)).toBe(hex);
    });

    it('should handle leading zeros', () => {
      const hex = '00000102030405';
      const encoded = base58Encode(hex);
      // Leading zeros should be encoded as '1's
      expect(encoded.startsWith('1')).toBe(true);

      const decoded = base58Decode(encoded);
      expect(bytesToHex(decoded)).toBe(hex);
    });
  });

  describe('extractFromText', () => {
    it('should extract mnemonic from text', () => {
      const text = 'some text abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about more text';
      // extractFromText takes a RegExp
      const mnemonicRegex = /\b((?:abandon\s+){11}about)\b/i;
      const result = extractFromText(text, mnemonicRegex);

      expect(result).toBeDefined();
      if (result) {
        expect(result.split(/\s+/).length).toBe(12);
      }
    });

    it('should extract private key from text', () => {
      const key = 'e8f32e723decf4051aefac8e2c93c9c5b214313817cdb01a1494b917c8436b35';
      const text = `Some text with key: ${key} and more`;
      const keyRegex = /\b([a-f0-9]{64})\b/i;
      const result = extractFromText(text, keyRegex);

      expect(result).toBe(key);
    });

    it('should return null when nothing found', () => {
      const text = 'some random text without valid data';
      const keyRegex = /\b([a-f0-9]{64})\b/i;
      const result = extractFromText(text, keyRegex);
      expect(result).toBeNull();
    });
  });
});
