import { describe, it, expect } from 'vitest';
import {
  generateMasterKeyFromSeed,
  deriveChildKeyBIP32,
  deriveKeyAtPath,
  deriveChildKeyLegacy,
} from '@/components/wallet/sdk/core/derivation';

describe('derivation', () => {
  // Test seed (from mnemonic "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about")
  const testSeed = '5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc19a5ac40b389cd370d086206dec8aa6c43daea6690f20ad3d8d48b2d2ce9e38e4';

  describe('generateMasterKeyFromSeed', () => {
    it('should generate master key and chain code from seed', () => {
      const result = generateMasterKeyFromSeed(testSeed);

      expect(result.masterKey).toBeDefined();
      expect(result.chainCode).toBeDefined();
      expect(result.masterKey).toHaveLength(64);
      expect(result.chainCode).toHaveLength(64);
    });

    it('should produce deterministic results', () => {
      const result1 = generateMasterKeyFromSeed(testSeed);
      const result2 = generateMasterKeyFromSeed(testSeed);

      expect(result1.masterKey).toBe(result2.masterKey);
      expect(result1.chainCode).toBe(result2.chainCode);
    });

    it('should produce different keys for different seeds', () => {
      const seed2 = 'a' + testSeed.slice(1);
      const result1 = generateMasterKeyFromSeed(testSeed);
      const result2 = generateMasterKeyFromSeed(seed2);

      expect(result1.masterKey).not.toBe(result2.masterKey);
    });
  });

  describe('deriveChildKeyBIP32', () => {
    it('should derive child key at index', () => {
      const { masterKey, chainCode } = generateMasterKeyFromSeed(testSeed);

      const child = deriveChildKeyBIP32(masterKey, chainCode, 0);

      expect(child.privateKey).toBeDefined();
      expect(child.chainCode).toBeDefined();
      expect(child.privateKey).toHaveLength(64);
      expect(child.privateKey).not.toBe(masterKey);
    });

    it('should derive different keys for different indices', () => {
      const { masterKey, chainCode } = generateMasterKeyFromSeed(testSeed);

      const child0 = deriveChildKeyBIP32(masterKey, chainCode, 0);
      const child1 = deriveChildKeyBIP32(masterKey, chainCode, 1);

      expect(child0.privateKey).not.toBe(child1.privateKey);
    });

    it('should support hardened derivation', () => {
      const { masterKey, chainCode } = generateMasterKeyFromSeed(testSeed);

      // Hardened index (>= 0x80000000)
      const hardenedIndex = 0x80000000;
      const child = deriveChildKeyBIP32(masterKey, chainCode, hardenedIndex);

      expect(child.privateKey).toBeDefined();
      expect(child.chainCode).toBeDefined();
    });

    it('should be deterministic', () => {
      const { masterKey, chainCode } = generateMasterKeyFromSeed(testSeed);

      const child1 = deriveChildKeyBIP32(masterKey, chainCode, 0);
      const child2 = deriveChildKeyBIP32(masterKey, chainCode, 0);

      expect(child1.privateKey).toBe(child2.privateKey);
      expect(child1.chainCode).toBe(child2.chainCode);
    });
  });

  describe('deriveKeyAtPath', () => {
    it('should derive key at BIP32 path', () => {
      const { masterKey, chainCode } = generateMasterKeyFromSeed(testSeed);

      // Standard BIP84 path for first address
      const path = "m/84'/1'/0'/0/0";
      const result = deriveKeyAtPath(masterKey, chainCode, path);

      expect(result.privateKey).toBeDefined();
      expect(result.privateKey).toHaveLength(64);
    });

    it('should derive different keys for different paths', () => {
      const { masterKey, chainCode } = generateMasterKeyFromSeed(testSeed);

      const key1 = deriveKeyAtPath(masterKey, chainCode, "m/84'/1'/0'/0/0");
      const key2 = deriveKeyAtPath(masterKey, chainCode, "m/84'/1'/0'/0/1");

      expect(key1.privateKey).not.toBe(key2.privateKey);
    });

    it('should be deterministic', () => {
      const { masterKey, chainCode } = generateMasterKeyFromSeed(testSeed);
      const path = "m/84'/1'/0'/0/0";

      const key1 = deriveKeyAtPath(masterKey, chainCode, path);
      const key2 = deriveKeyAtPath(masterKey, chainCode, path);

      expect(key1.privateKey).toBe(key2.privateKey);
    });

    it('should handle path without leading m/', () => {
      const { masterKey, chainCode } = generateMasterKeyFromSeed(testSeed);

      const key1 = deriveKeyAtPath(masterKey, chainCode, "m/84'/1'/0'/0/0");
      const key2 = deriveKeyAtPath(masterKey, chainCode, "84'/1'/0'/0/0");

      expect(key1.privateKey).toBe(key2.privateKey);
    });
  });

  describe('deriveChildKeyLegacy', () => {
    it('should derive child key using legacy method', () => {
      const { masterKey, chainCode } = generateMasterKeyFromSeed(testSeed);

      const child = deriveChildKeyLegacy(masterKey, chainCode, 0);

      expect(child.privateKey).toBeDefined();
      expect(child.chainCode).toBeDefined();
    });

    it('should produce different results than BIP32', () => {
      const { masterKey, chainCode } = generateMasterKeyFromSeed(testSeed);

      const bip32Child = deriveChildKeyBIP32(masterKey, chainCode, 0);
      const legacyChild = deriveChildKeyLegacy(masterKey, chainCode, 0);

      // Legacy uses different derivation, should produce different keys
      expect(bip32Child.privateKey).not.toBe(legacyChild.privateKey);
    });
  });
});
