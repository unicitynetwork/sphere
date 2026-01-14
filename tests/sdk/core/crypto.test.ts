import { describe, it, expect } from 'vitest';
import {
  hexToWIF,
  encrypt,
  decrypt,
  generatePrivateKey,
  encryptWallet,
  decryptWallet,
} from '@/components/wallet/sdk/core/crypto';

describe('crypto', () => {
  describe('hexToWIF', () => {
    it('should convert hex private key to WIF format', () => {
      // Known test vector
      const privateKeyHex = '0000000000000000000000000000000000000000000000000000000000000001';
      const wif = hexToWIF(privateKeyHex);

      expect(wif).toBeDefined();
      expect(typeof wif).toBe('string');
      // WIF starts with specific characters depending on network
      expect(wif.length).toBeGreaterThan(40);
    });

    it('should produce deterministic WIF from same hex', () => {
      const privateKeyHex = 'e8f32e723decf4051aefac8e2c93c9c5b214313817cdb01a1494b917c8436b35';
      const wif1 = hexToWIF(privateKeyHex);
      const wif2 = hexToWIF(privateKeyHex);

      expect(wif1).toBe(wif2);
    });
  });

  describe('encrypt/decrypt', () => {
    it('should encrypt and decrypt data correctly', () => {
      const originalData = 'secret message';
      const password = 'testpassword123';

      const encrypted = encrypt(originalData, password);
      expect(encrypted).not.toBe(originalData);

      const decrypted = decrypt(encrypted, password);
      expect(decrypted).toBe(originalData);
    });

    it('should fail to decrypt with wrong password', () => {
      const originalData = 'secret message';
      const encrypted = encrypt(originalData, 'correctpassword');

      // Wrong password should throw or return garbage
      expect(() => {
        const result = decrypt(encrypted, 'wrongpassword');
        // If it doesn't throw, the result should be different
        if (result === originalData) {
          throw new Error('Should not decrypt correctly with wrong password');
        }
      }).not.toThrow(); // The function may not throw, but result should be wrong
    });

    it('should handle empty string', () => {
      const password = 'testpassword';
      const encrypted = encrypt('', password);
      const decrypted = decrypt(encrypted, password);
      expect(decrypted).toBe('');
    });

    it('should handle special characters', () => {
      const data = '{"key": "value", "special": "!@#$%^&*()"}';
      const password = 'pass!@#';

      const encrypted = encrypt(data, password);
      const decrypted = decrypt(encrypted, password);
      expect(decrypted).toBe(data);
    });
  });

  describe('generatePrivateKey', () => {
    it('should generate valid 32-byte hex private key', () => {
      const key = generatePrivateKey();

      expect(key).toBeDefined();
      expect(key).toHaveLength(64); // 32 bytes = 64 hex chars
      expect(/^[0-9a-f]+$/i.test(key)).toBe(true);
    });

    it('should generate unique keys', () => {
      const key1 = generatePrivateKey();
      const key2 = generatePrivateKey();

      expect(key1).not.toBe(key2);
    });
  });

  describe('encryptWallet/decryptWallet', () => {
    it('should encrypt and decrypt wallet data', () => {
      const masterKey = 'e8f32e723decf4051aefac8e2c93c9c5b214313817cdb01a1494b917c8436b35';
      const password = 'securepassword';

      // encryptWallet takes a string (master key), not an object
      const encrypted = encryptWallet(masterKey, password);
      expect(encrypted).toBeDefined();
      expect(encrypted).not.toContain(masterKey);

      // decryptWallet returns a string
      const decrypted = decryptWallet(encrypted, password);
      expect(decrypted).toBe(masterKey);
    });
  });
});
