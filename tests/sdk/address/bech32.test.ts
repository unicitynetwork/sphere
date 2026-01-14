import { describe, it, expect } from 'vitest';
import {
  createBech32,
  decodeBech32,
  convertBits,
  CHARSET,
} from '@/components/wallet/sdk/address/bech32';

describe('bech32', () => {
  describe('CHARSET', () => {
    it('should have 32 characters', () => {
      expect(CHARSET).toHaveLength(32);
    });

    it('should not contain confusing characters', () => {
      // Bech32 excludes 1, b, i, o to avoid confusion
      expect(CHARSET).not.toContain('1');
      expect(CHARSET).not.toContain('b');
      expect(CHARSET).not.toContain('i');
      expect(CHARSET).not.toContain('o');
    });
  });

  describe('convertBits', () => {
    it('should convert 8-bit to 5-bit', () => {
      const data = [0xff];
      const result = convertBits(data, 8, 5, true);

      expect(result).toBeDefined();
      expect(result!.length).toBeGreaterThan(1);
    });

    it('should convert 5-bit to 8-bit', () => {
      const data = [31, 31]; // Max 5-bit values
      const result = convertBits(data, 5, 8, false);

      expect(result).toBeDefined();
    });

    it('should roundtrip 8->5->8', () => {
      const original = [1, 2, 3, 4, 5];
      const fiveBit = convertBits(original, 8, 5, true);
      expect(fiveBit).toBeDefined();

      const eightBit = convertBits(fiveBit!, 5, 8, false);
      expect(eightBit).toBeDefined();
      expect(eightBit).toEqual(original);
    });
  });

  describe('createBech32', () => {
    it('should create valid bech32 address', () => {
      const hrp = 'alpha';
      const version = 0;
      const data = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);

      const address = createBech32(hrp, version, data);

      expect(address).toBeDefined();
      expect(address.startsWith(hrp + '1')).toBe(true);
    });

    it('should create deterministic addresses', () => {
      const hrp = 'alpha';
      const version = 0;
      const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);

      const addr1 = createBech32(hrp, version, data);
      const addr2 = createBech32(hrp, version, data);

      expect(addr1).toBe(addr2);
    });

    it('should create different addresses for different data', () => {
      const hrp = 'alpha';
      const version = 0;
      const data1 = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
      const data2 = new Uint8Array([20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);

      const addr1 = createBech32(hrp, version, data1);
      const addr2 = createBech32(hrp, version, data2);

      expect(addr1).not.toBe(addr2);
    });
  });

  describe('decodeBech32', () => {
    it('should decode valid bech32 address', () => {
      const hrp = 'alpha';
      const version = 0;
      const originalData = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
      const address = createBech32(hrp, version, originalData);

      const decoded = decodeBech32(address);

      expect(decoded).toBeDefined();
      expect(decoded!.hrp).toBe(hrp);
      expect(decoded!.witnessVersion).toBe(version);
      expect(decoded!.data).toEqual(originalData);
    });

    it('should return null for invalid address', () => {
      const result = decodeBech32('invalid_address');
      expect(result).toBeNull();
    });

    it('should return null for address with wrong checksum', () => {
      const hrp = 'alpha';
      const version = 0;
      const data = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
      let address = createBech32(hrp, version, data);

      // Corrupt the last character
      address = address.slice(0, -1) + 'q';

      const result = decodeBech32(address);
      expect(result).toBeNull();
    });
  });

  describe('roundtrip', () => {
    it('should encode and decode correctly', () => {
      const testCases = [
        { hrp: 'alpha', version: 0, data: new Uint8Array(20).fill(0) },
        { hrp: 'alpha', version: 0, data: new Uint8Array(20).fill(255) },
        { hrp: 'test', version: 0, data: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]) },
      ];

      for (const { hrp, version, data } of testCases) {
        const encoded = createBech32(hrp, version, data);
        const decoded = decodeBech32(encoded);

        expect(decoded).toBeDefined();
        expect(decoded!.hrp).toBe(hrp);
        expect(decoded!.witnessVersion).toBe(version);
        expect(decoded!.data).toEqual(data);
      }
    });
  });
});
