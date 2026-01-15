/**
 * Tests for sdk/core/identity.ts
 *
 * Critical tests to ensure identity derivation uses correct constants
 * and produces consistent addresses across the SDK.
 */

import { describe, it, expect } from 'vitest';
import {
  deriveIdentityFromPrivateKey,
  getWalletDirectAddress,
  UNICITY_TOKEN_TYPE_HEX,
} from '../../../src/components/wallet/sdk';
import { deriveL3Address } from '../../../src/components/wallet/sdk/address/unified';
import { UNICITY_TOKEN_TYPE_HEX as TYPE_FROM_TYPES } from '../../../src/components/wallet/sdk/types';

// Test private key (32 bytes hex)
const TEST_PRIVATE_KEY = 'e8f32e723decf4051aefac8e2c93c9c5b214313817cdb01a1494b917c8436b35';

describe('Identity Module', () => {
  describe('UNICITY_TOKEN_TYPE_HEX constant', () => {
    it('should export correct UNICITY_TOKEN_TYPE_HEX from sdk/index.ts', () => {
      // This is the critical test - ensure the token type is the correct one
      expect(UNICITY_TOKEN_TYPE_HEX).toBe('f8aa13834268d29355ff12183066f0cb902003629bbc5eb9ef0efbe397867509');
    });

    it('should have same UNICITY_TOKEN_TYPE_HEX in types module', () => {
      // Ensure types module has the same value
      expect(TYPE_FROM_TYPES).toBe('f8aa13834268d29355ff12183066f0cb902003629bbc5eb9ef0efbe397867509');
    });

    it('should have matching UNICITY_TOKEN_TYPE_HEX across all modules', () => {
      // Both exports should be identical
      expect(UNICITY_TOKEN_TYPE_HEX).toBe(TYPE_FROM_TYPES);
    });

    it('should be a valid 64-character hex string', () => {
      expect(UNICITY_TOKEN_TYPE_HEX).toMatch(/^[0-9a-f]{64}$/);
      expect(UNICITY_TOKEN_TYPE_HEX.length).toBe(64);
    });
  });

  describe('deriveIdentityFromPrivateKey', () => {
    it('should derive identity with correct structure', async () => {
      const identity = await deriveIdentityFromPrivateKey(TEST_PRIVATE_KEY);

      expect(identity).toHaveProperty('privateKey');
      expect(identity).toHaveProperty('publicKey');
      expect(identity).toHaveProperty('address');
      expect(identity.privateKey).toBe(TEST_PRIVATE_KEY);
    });

    it('should derive consistent address for same private key', async () => {
      const identity1 = await deriveIdentityFromPrivateKey(TEST_PRIVATE_KEY);
      const identity2 = await deriveIdentityFromPrivateKey(TEST_PRIVATE_KEY);

      expect(identity1.address).toBe(identity2.address);
      expect(identity1.publicKey).toBe(identity2.publicKey);
    });

    it('should derive different addresses for different private keys', async () => {
      const identity1 = await deriveIdentityFromPrivateKey(TEST_PRIVATE_KEY);
      const identity2 = await deriveIdentityFromPrivateKey(
        'a8f32e723decf4051aefac8e2c93c9c5b214313817cdb01a1494b917c8436b35'
      );

      expect(identity1.address).not.toBe(identity2.address);
    });

    it('should produce valid hex public key', async () => {
      const identity = await deriveIdentityFromPrivateKey(TEST_PRIVATE_KEY);

      expect(identity.publicKey).toMatch(/^[0-9a-f]+$/);
      // secp256k1 compressed public key is 33 bytes (66 hex chars)
      expect(identity.publicKey.length).toBe(66);
    });
  });

  describe('getWalletDirectAddress', () => {
    it('should return DirectAddress object', async () => {
      const address = await getWalletDirectAddress(TEST_PRIVATE_KEY);

      expect(address).toBeDefined();
      expect(typeof address.toString()).toBe('string');
    });

    it('should return consistent address for same private key', async () => {
      const address1 = await getWalletDirectAddress(TEST_PRIVATE_KEY);
      const address2 = await getWalletDirectAddress(TEST_PRIVATE_KEY);

      expect(address1.toString()).toBe(address2.toString());
    });

    it('should match address from deriveIdentityFromPrivateKey', async () => {
      const identity = await deriveIdentityFromPrivateKey(TEST_PRIVATE_KEY);
      const directAddress = await getWalletDirectAddress(TEST_PRIVATE_KEY);

      // Both should produce the same address string
      expect(identity.address).toBe(directAddress.toString());
    });

    it('should match address from deriveL3Address', async () => {
      const l3Address = await deriveL3Address(TEST_PRIVATE_KEY);
      const directAddress = await getWalletDirectAddress(TEST_PRIVATE_KEY);

      expect(l3Address.address).toBe(directAddress.toString());
    });
  });

  describe('Address consistency across SDK', () => {
    it('should produce identical addresses from all derivation methods', async () => {
      // This is the critical integration test
      // All these methods should produce the same address for the same private key
      const [identity, l3Address, directAddress] = await Promise.all([
        deriveIdentityFromPrivateKey(TEST_PRIVATE_KEY),
        deriveL3Address(TEST_PRIVATE_KEY),
        getWalletDirectAddress(TEST_PRIVATE_KEY),
      ]);

      const addressFromIdentity = identity.address;
      const addressFromL3 = l3Address.address;
      const addressFromDirect = directAddress.toString();

      expect(addressFromIdentity).toBe(addressFromL3);
      expect(addressFromL3).toBe(addressFromDirect);
      expect(addressFromIdentity).toBe(addressFromDirect);
    });

    it('should produce identical public keys from all derivation methods', async () => {
      const identity = await deriveIdentityFromPrivateKey(TEST_PRIVATE_KEY);
      const l3Address = await deriveL3Address(TEST_PRIVATE_KEY);

      expect(identity.publicKey).toBe(l3Address.publicKey);
    });
  });
});
