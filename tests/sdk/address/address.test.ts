import { describe, it, expect } from 'vitest';
import {
  computeHash160,
  hash160ToBytes,
  publicKeyToAddress,
  privateKeyToAddressInfo,
  generateAddressInfo,
  generateHDAddressBIP32,
  generateAddressFromMasterKey,
  recoverKeyWifHmac,
  recoverKeyBIP32AtPath,
  recoverKeyBIP32Scan,
} from '@/components/wallet/sdk/address/address';
import { generateMasterKeyFromSeed } from '@/components/wallet/sdk/core/derivation';

describe('address', () => {
  // Test data - well-known keys for deterministic testing
  const testPrivateKey = '0c28fca386c7a227600b2fe50b7cae11ec86d3bf1fbe471be89827e19d72aa1d';

  // Test seed from mnemonic "abandon abandon abandon..."
  const testSeed = '5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc19a5ac40b389cd370d086206dec8aa6c43daea6690f20ad3d8d48b2d2ce9e38e4';

  describe('computeHash160', () => {
    it('should compute HASH160 from public key', () => {
      // Using a known compressed public key
      const publicKey = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
      const hash160 = computeHash160(publicKey);

      expect(hash160).toBeDefined();
      expect(hash160).toHaveLength(40); // 20 bytes = 40 hex chars
    });

    it('should produce deterministic results', () => {
      const publicKey = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
      const hash1 = computeHash160(publicKey);
      const hash2 = computeHash160(publicKey);

      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different keys', () => {
      const key1 = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
      const key2 = '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5';

      const hash1 = computeHash160(key1);
      const hash2 = computeHash160(key2);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('hash160ToBytes', () => {
    it('should convert hex to Uint8Array', () => {
      const hash160 = '751e76e8199196d454941c45d1b3a323f1433bd6';
      const bytes = hash160ToBytes(hash160);

      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(bytes).toHaveLength(20);
    });

    it('should correctly convert hex values', () => {
      const hash160 = 'ff00ab12cd34ef56';
      const bytes = hash160ToBytes(hash160);

      expect(bytes[0]).toBe(0xff);
      expect(bytes[1]).toBe(0x00);
      expect(bytes[2]).toBe(0xab);
      expect(bytes[3]).toBe(0x12);
    });
  });

  describe('publicKeyToAddress', () => {
    it('should generate bech32 address from public key', () => {
      const publicKey = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
      const address = publicKeyToAddress(publicKey);

      expect(address).toBeDefined();
      expect(address.startsWith('alpha1')).toBe(true);
    });

    it('should use custom prefix', () => {
      const publicKey = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
      const address = publicKeyToAddress(publicKey, 'test');

      expect(address.startsWith('test1')).toBe(true);
    });

    it('should be deterministic', () => {
      const publicKey = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
      const addr1 = publicKeyToAddress(publicKey);
      const addr2 = publicKeyToAddress(publicKey);

      expect(addr1).toBe(addr2);
    });
  });

  describe('privateKeyToAddressInfo', () => {
    it('should generate address info from private key', () => {
      const info = privateKeyToAddressInfo(testPrivateKey);

      expect(info.address).toBeDefined();
      expect(info.publicKey).toBeDefined();
      expect(info.address.startsWith('alpha1')).toBe(true);
      expect(info.publicKey).toHaveLength(66); // Compressed pubkey
    });

    it('should be deterministic', () => {
      const info1 = privateKeyToAddressInfo(testPrivateKey);
      const info2 = privateKeyToAddressInfo(testPrivateKey);

      expect(info1.address).toBe(info2.address);
      expect(info1.publicKey).toBe(info2.publicKey);
    });
  });

  describe('generateAddressInfo', () => {
    it('should generate full address info', () => {
      const info = generateAddressInfo(testPrivateKey, 5, "m/44'/0'/0'/0/5");

      expect(info.address).toBeDefined();
      expect(info.privateKey).toBe(testPrivateKey);
      expect(info.publicKey).toBeDefined();
      expect(info.index).toBe(5);
      expect(info.path).toBe("m/44'/0'/0'/0/5");
    });
  });

  describe('generateHDAddressBIP32', () => {
    it('should generate HD address at index', () => {
      const { masterKey, chainCode } = generateMasterKeyFromSeed(testSeed);
      const info = generateHDAddressBIP32(masterKey, chainCode, 0);

      expect(info.address).toBeDefined();
      expect(info.address.startsWith('alpha1')).toBe(true);
      expect(info.index).toBe(0);
    });

    it('should generate different addresses for different indices', () => {
      const { masterKey, chainCode } = generateMasterKeyFromSeed(testSeed);
      const addr0 = generateHDAddressBIP32(masterKey, chainCode, 0);
      const addr1 = generateHDAddressBIP32(masterKey, chainCode, 1);

      expect(addr0.address).not.toBe(addr1.address);
    });

    it('should generate change addresses', () => {
      const { masterKey, chainCode } = generateMasterKeyFromSeed(testSeed);
      const external = generateHDAddressBIP32(masterKey, chainCode, 0, "m/44'/0'/0'", false);
      const change = generateHDAddressBIP32(masterKey, chainCode, 0, "m/44'/0'/0'", true);

      expect(external.address).not.toBe(change.address);
      expect(external.path).toContain('/0/');
      expect(change.path).toContain('/1/');
    });
  });

  describe('generateAddressFromMasterKey', () => {
    it('should generate address using HMAC derivation', () => {
      const { masterKey } = generateMasterKeyFromSeed(testSeed);
      const info = generateAddressFromMasterKey(masterKey, 0);

      expect(info.address).toBeDefined();
      expect(info.address.startsWith('alpha1')).toBe(true);
      expect(info.index).toBe(0);
    });

    it('should generate different addresses for different indices', () => {
      const { masterKey } = generateMasterKeyFromSeed(testSeed);
      const addr0 = generateAddressFromMasterKey(masterKey, 0);
      const addr1 = generateAddressFromMasterKey(masterKey, 1);

      expect(addr0.address).not.toBe(addr1.address);
    });
  });

  describe('recoverKeyWifHmac', () => {
    it('should recover key for generated address', () => {
      const { masterKey } = generateMasterKeyFromSeed(testSeed);
      const generated = generateAddressFromMasterKey(masterKey, 5);

      const result = recoverKeyWifHmac(masterKey, generated.address, 10);

      expect(result.success).toBe(true);
      expect(result.key).toBeDefined();
      expect(result.key!.privateKey).toBe(generated.privateKey);
      expect(result.key!.index).toBe(5);
    });

    it('should fail for non-existent address', () => {
      const { masterKey } = generateMasterKeyFromSeed(testSeed);
      const result = recoverKeyWifHmac(masterKey, 'alpha1invalid', 10);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('recoverKeyBIP32AtPath', () => {
    it('should recover key at specific path', () => {
      const { masterKey, chainCode } = generateMasterKeyFromSeed(testSeed);
      const path = "m/44'/0'/0'/0/3";
      const generated = generateHDAddressBIP32(masterKey, chainCode, 3);

      const result = recoverKeyBIP32AtPath(masterKey, chainCode, path, generated.address);

      expect(result.success).toBe(true);
      expect(result.key).toBeDefined();
      expect(result.key!.privateKey).toBe(generated.privateKey);
    });

    it('should fail for wrong address', () => {
      const { masterKey, chainCode } = generateMasterKeyFromSeed(testSeed);
      const path = "m/44'/0'/0'/0/3";

      const result = recoverKeyBIP32AtPath(masterKey, chainCode, path, 'alpha1wrongaddress');

      expect(result.success).toBe(false);
      expect(result.error).toContain('mismatch');
    });
  });

  describe('recoverKeyBIP32Scan', () => {
    it('should scan and recover key', () => {
      const { masterKey, chainCode } = generateMasterKeyFromSeed(testSeed);
      // Generate address at index 5 on external chain
      const basePath = "44'/0'/0'";
      const generated = generateHDAddressBIP32(masterKey, chainCode, 5, "m/44'/0'/0'", false);

      const result = recoverKeyBIP32Scan(masterKey, chainCode, generated.address, basePath, 10);

      expect(result.success).toBe(true);
      expect(result.key).toBeDefined();
      expect(result.key!.index).toBe(5);
      expect(result.key!.isChange).toBe(false);
    });

    it('should find change address', () => {
      const { masterKey, chainCode } = generateMasterKeyFromSeed(testSeed);
      const basePath = "44'/0'/0'";
      const generated = generateHDAddressBIP32(masterKey, chainCode, 2, "m/44'/0'/0'", true);

      const result = recoverKeyBIP32Scan(masterKey, chainCode, generated.address, basePath, 10);

      expect(result.success).toBe(true);
      expect(result.key!.isChange).toBe(true);
      expect(result.key!.index).toBe(2);
    });

    it('should fail if address not found', () => {
      const { masterKey, chainCode } = generateMasterKeyFromSeed(testSeed);
      const result = recoverKeyBIP32Scan(masterKey, chainCode, 'alpha1notfound', "44'/0'/0'", 5);

      expect(result.success).toBe(false);
    });
  });
});
