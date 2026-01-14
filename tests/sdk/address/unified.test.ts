import { describe, it, expect } from 'vitest';
import {
  parsePathComponents,
  getAddressPath,
  deriveL3Address,
  deriveL1Address,
  deriveDefaultL1Address,
  deriveNextL1Address,
  deriveUnifiedAddress,
  deriveDefaultUnifiedAddress,
  deriveNextUnifiedAddress,
} from '@/components/wallet/sdk/address/unified';
import { generateMasterKeyFromSeed } from '@/components/wallet/sdk/core/derivation';

describe('unified address', () => {
  // Test seed from mnemonic "abandon abandon abandon..."
  const testSeed = '5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc19a5ac40b389cd370d086206dec8aa6c43daea6690f20ad3d8d48b2d2ce9e38e4';
  const testPrivateKey = '0c28fca386c7a227600b2fe50b7cae11ec86d3bf1fbe471be89827e19d72aa1d';

  describe('parsePathComponents', () => {
    it('should parse 5-level BIP32 path', () => {
      const result = parsePathComponents("m/44'/0'/0'/0/5");

      expect(result.index).toBe(5);
      expect(result.isChange).toBe(false);
      expect(result.basePath).toBe("m/44'/0'/0'");
    });

    it('should detect change addresses', () => {
      const result = parsePathComponents("m/44'/0'/0'/1/3");

      expect(result.index).toBe(3);
      expect(result.isChange).toBe(true);
    });

    it('should parse 3-level HMAC path', () => {
      const result = parsePathComponents("m/44'/0'/5");

      expect(result.index).toBe(5);
      expect(result.isChange).toBe(false);
    });

    it('should throw for invalid path', () => {
      expect(() => parsePathComponents('invalid')).toThrow('Invalid BIP32 path');
    });
  });

  describe('getAddressPath', () => {
    it('should generate external path', () => {
      const path = getAddressPath(0, false, "m/44'/0'/0'");
      expect(path).toBe("m/44'/0'/0'/0/0");
    });

    it('should generate change path', () => {
      const path = getAddressPath(5, true, "m/44'/0'/0'");
      expect(path).toBe("m/44'/0'/0'/1/5");
    });

    it('should use default base path', () => {
      const path = getAddressPath(0);
      expect(path).toMatch(/^m\/\d+'\/\d+'\/\d+'\/0\/0$/);
    });
  });

  describe('deriveL3Address', () => {
    it('should derive L3 address from private key', async () => {
      const l3 = await deriveL3Address(testPrivateKey);

      expect(l3.address).toBeDefined();
      expect(l3.privateKey).toBe(testPrivateKey);
      expect(l3.publicKey).toBeDefined();
      expect(l3.publicKey).toHaveLength(66); // Compressed public key (33 bytes)
    });

    it('should be deterministic', async () => {
      const l3_1 = await deriveL3Address(testPrivateKey);
      const l3_2 = await deriveL3Address(testPrivateKey);

      expect(l3_1.address).toBe(l3_2.address);
    });

    it('should generate different addresses for different keys', async () => {
      const key2 = 'e8f32e723decf4051aefac8e2c93c9c5b214313817cdb01a1494b917c8436b35';
      const l3_1 = await deriveL3Address(testPrivateKey);
      const l3_2 = await deriveL3Address(key2);

      expect(l3_1.address).not.toBe(l3_2.address);
    });
  });

  describe('deriveL1Address', () => {
    it('should derive L1 address using BIP32', () => {
      const { masterKey, chainCode } = generateMasterKeyFromSeed(testSeed);
      const path = "m/44'/0'/0'/0/0";

      const l1 = deriveL1Address(masterKey, chainCode, path, 'bip32');

      expect(l1.address).toBeDefined();
      expect(l1.address.startsWith('alpha1')).toBe(true);
      expect(l1.index).toBe(0);
      expect(l1.isChange).toBe(false);
    });

    it('should derive change address', () => {
      const { masterKey, chainCode } = generateMasterKeyFromSeed(testSeed);
      const path = "m/44'/0'/0'/1/5";

      const l1 = deriveL1Address(masterKey, chainCode, path, 'bip32');

      expect(l1.isChange).toBe(true);
      expect(l1.index).toBe(5);
    });

    it('should derive using WIF HMAC mode', () => {
      const { masterKey } = generateMasterKeyFromSeed(testSeed);
      const path = "m/44'/0'/0";

      const l1 = deriveL1Address(masterKey, null, path, 'wif_hmac');

      expect(l1.address).toBeDefined();
      expect(l1.address.startsWith('alpha1')).toBe(true);
    });
  });

  describe('deriveDefaultL1Address', () => {
    it('should derive first L1 address', () => {
      const { masterKey, chainCode } = generateMasterKeyFromSeed(testSeed);

      const l1 = deriveDefaultL1Address(masterKey, chainCode);

      expect(l1.index).toBe(0);
      expect(l1.isChange).toBe(false);
      expect(l1.address.startsWith('alpha1')).toBe(true);
    });
  });

  describe('deriveNextL1Address', () => {
    it('should derive next L1 address in sequence', () => {
      const { masterKey, chainCode } = generateMasterKeyFromSeed(testSeed);

      const current = deriveDefaultL1Address(masterKey, chainCode);
      const next = deriveNextL1Address(masterKey, chainCode, current.index);

      expect(next.index).toBe(1);
      expect(next.address).not.toBe(current.address);
    });
  });

  describe('deriveUnifiedAddress', () => {
    it('should derive both L1 and L3 addresses', async () => {
      const { masterKey, chainCode } = generateMasterKeyFromSeed(testSeed);
      const path = "m/44'/0'/0'/0/0";

      const unified = await deriveUnifiedAddress(masterKey, chainCode, path);

      expect(unified.l1Address).toBeDefined();
      expect(unified.l3Address).toBeDefined();
      expect(unified.l1Address.startsWith('alpha1')).toBe(true);
      expect(unified.privateKey).toBeDefined();
      expect(unified.publicKey).toBeDefined();
      expect(unified.index).toBe(0);
      expect(unified.isChange).toBe(false);
    });

    it('should be deterministic', async () => {
      const { masterKey, chainCode } = generateMasterKeyFromSeed(testSeed);
      const path = "m/44'/0'/0'/0/5";

      const unified1 = await deriveUnifiedAddress(masterKey, chainCode, path);
      const unified2 = await deriveUnifiedAddress(masterKey, chainCode, path);

      expect(unified1.l1Address).toBe(unified2.l1Address);
      expect(unified1.l3Address).toBe(unified2.l3Address);
    });

    it('should generate different addresses for different paths', async () => {
      const { masterKey, chainCode } = generateMasterKeyFromSeed(testSeed);

      const unified0 = await deriveUnifiedAddress(masterKey, chainCode, "m/44'/0'/0'/0/0");
      const unified1 = await deriveUnifiedAddress(masterKey, chainCode, "m/44'/0'/0'/0/1");

      expect(unified0.l1Address).not.toBe(unified1.l1Address);
      expect(unified0.l3Address).not.toBe(unified1.l3Address);
    });
  });

  describe('deriveDefaultUnifiedAddress', () => {
    it('should derive first unified address', async () => {
      const { masterKey, chainCode } = generateMasterKeyFromSeed(testSeed);

      const unified = await deriveDefaultUnifiedAddress(masterKey, chainCode);

      expect(unified.index).toBe(0);
      expect(unified.isChange).toBe(false);
      expect(unified.l1Address).toBeDefined();
      expect(unified.l3Address).toBeDefined();
    });
  });

  describe('deriveNextUnifiedAddress', () => {
    it('should derive next unified address in sequence', async () => {
      const { masterKey, chainCode } = generateMasterKeyFromSeed(testSeed);

      const current = await deriveDefaultUnifiedAddress(masterKey, chainCode);
      const next = await deriveNextUnifiedAddress(masterKey, chainCode, current.index);

      expect(next.index).toBe(1);
      expect(next.l1Address).not.toBe(current.l1Address);
      expect(next.l3Address).not.toBe(current.l3Address);
    });
  });
});
