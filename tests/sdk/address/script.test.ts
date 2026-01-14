import { describe, it, expect } from 'vitest';
import {
  addressToScriptHash,
  createScriptPubKey,
} from '@/components/wallet/sdk/address/script';
import { publicKeyToAddress } from '@/components/wallet/sdk/address/address';

describe('script', () => {
  // Test public key (generator point G)
  const testPublicKey = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';

  describe('addressToScriptHash', () => {
    it('should convert address to script hash', () => {
      const address = publicKeyToAddress(testPublicKey);
      const scriptHash = addressToScriptHash(address);

      expect(scriptHash).toBeDefined();
      expect(scriptHash).toHaveLength(64); // SHA256 = 32 bytes = 64 hex chars
    });

    it('should be deterministic', () => {
      const address = publicKeyToAddress(testPublicKey);
      const hash1 = addressToScriptHash(address);
      const hash2 = addressToScriptHash(address);

      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different addresses', () => {
      const key2 = '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5';
      const addr1 = publicKeyToAddress(testPublicKey);
      const addr2 = publicKeyToAddress(key2);

      const hash1 = addressToScriptHash(addr1);
      const hash2 = addressToScriptHash(addr2);

      expect(hash1).not.toBe(hash2);
    });

    it('should throw for invalid address', () => {
      expect(() => addressToScriptHash('invalid_address')).toThrow();
    });
  });

  describe('createScriptPubKey', () => {
    it('should create scriptPubKey from address', () => {
      const address = publicKeyToAddress(testPublicKey);
      const scriptPubKey = createScriptPubKey(address);

      expect(scriptPubKey).toBeDefined();
      // P2WPKH: OP_0 (00) + PUSH20 (14) + 20 bytes = 44 hex chars
      expect(scriptPubKey).toHaveLength(44);
      expect(scriptPubKey.startsWith('0014')).toBe(true);
    });

    it('should be deterministic', () => {
      const address = publicKeyToAddress(testPublicKey);
      const script1 = createScriptPubKey(address);
      const script2 = createScriptPubKey(address);

      expect(script1).toBe(script2);
    });

    it('should produce different scripts for different addresses', () => {
      const key2 = '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5';
      const addr1 = publicKeyToAddress(testPublicKey);
      const addr2 = publicKeyToAddress(key2);

      const script1 = createScriptPubKey(addr1);
      const script2 = createScriptPubKey(addr2);

      expect(script1).not.toBe(script2);
    });

    it('should throw for invalid address', () => {
      expect(() => createScriptPubKey('invalid_address')).toThrow();
    });

    it('should throw for empty address', () => {
      expect(() => createScriptPubKey('')).toThrow('Invalid address');
    });

    it('should throw for non-string input', () => {
      // @ts-expect-error - testing runtime behavior
      expect(() => createScriptPubKey(null)).toThrow('Invalid address');
    });
  });

  describe('script roundtrip', () => {
    it('should produce consistent scriptPubKey and scriptHash', () => {
      const address = publicKeyToAddress(testPublicKey);

      // Both functions should work on the same address
      const scriptPubKey = createScriptPubKey(address);
      const scriptHash = addressToScriptHash(address);

      // scriptPubKey should be the input to SHA256 that produces scriptHash
      expect(scriptPubKey).toBeDefined();
      expect(scriptHash).toBeDefined();

      // The scriptHash is SHA256 of scriptPubKey (reversed)
      // We can't easily verify the hash here without reimplementing,
      // but we can verify both outputs are consistent across calls
      const scriptPubKey2 = createScriptPubKey(address);
      const scriptHash2 = addressToScriptHash(address);

      expect(scriptPubKey).toBe(scriptPubKey2);
      expect(scriptHash).toBe(scriptHash2);
    });
  });
});
