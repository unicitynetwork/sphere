/**
 * Tests for IPNS Utilities
 *
 * Tests IPNS name derivation from secp256k1 private keys.
 */

import { describe, it, expect } from 'vitest';
import {
  deriveEd25519KeyMaterial,
  deriveIpnsNameFromPrivateKey,
  deriveEd25519KeyPair,
  derivePeerIdFromPrivateKey,
  IPNS_HKDF_INFO,
} from '../../../src/components/wallet/sdk/ipns/utils';

// Test private key (32 bytes hex)
const TEST_PRIVATE_KEY = 'e8f32e723decf4051aefac8e2c93c9c5b214313817cdb01a1494b917c8436b35';

describe('IPNS Utils', () => {
  describe('IPNS_HKDF_INFO constant', () => {
    it('should have correct value', () => {
      expect(IPNS_HKDF_INFO).toBe('ipfs-storage-ed25519-v1');
    });
  });

  describe('deriveEd25519KeyMaterial', () => {
    it('should derive 32-byte key material', () => {
      const keyMaterial = deriveEd25519KeyMaterial(TEST_PRIVATE_KEY);
      expect(keyMaterial).toBeInstanceOf(Uint8Array);
      expect(keyMaterial.length).toBe(32);
    });

    it('should derive consistent key material for same input', () => {
      const key1 = deriveEd25519KeyMaterial(TEST_PRIVATE_KEY);
      const key2 = deriveEd25519KeyMaterial(TEST_PRIVATE_KEY);
      expect(Buffer.from(key1).toString('hex')).toBe(Buffer.from(key2).toString('hex'));
    });

    it('should derive different key material for different inputs', () => {
      const key1 = deriveEd25519KeyMaterial(TEST_PRIVATE_KEY);
      const key2 = deriveEd25519KeyMaterial(
        'a8f32e723decf4051aefac8e2c93c9c5b214313817cdb01a1494b917c8436b35'
      );
      expect(Buffer.from(key1).toString('hex')).not.toBe(Buffer.from(key2).toString('hex'));
    });

    it('should derive different key material with different info', () => {
      const key1 = deriveEd25519KeyMaterial(TEST_PRIVATE_KEY, IPNS_HKDF_INFO);
      const key2 = deriveEd25519KeyMaterial(TEST_PRIVATE_KEY, 'different-info');
      expect(Buffer.from(key1).toString('hex')).not.toBe(Buffer.from(key2).toString('hex'));
    });
  });

  describe('deriveIpnsNameFromPrivateKey', () => {
    it('should derive IPNS name (PeerId string)', async () => {
      const ipnsName = await deriveIpnsNameFromPrivateKey(TEST_PRIVATE_KEY);
      expect(typeof ipnsName).toBe('string');
      // IPNS names typically start with "12D3KooW" for Ed25519 keys
      expect(ipnsName).toMatch(/^12D3KooW/);
    });

    it('should derive consistent IPNS name for same input', async () => {
      const name1 = await deriveIpnsNameFromPrivateKey(TEST_PRIVATE_KEY);
      const name2 = await deriveIpnsNameFromPrivateKey(TEST_PRIVATE_KEY);
      expect(name1).toBe(name2);
    });

    it('should derive different IPNS names for different inputs', async () => {
      const name1 = await deriveIpnsNameFromPrivateKey(TEST_PRIVATE_KEY);
      const name2 = await deriveIpnsNameFromPrivateKey(
        'a8f32e723decf4051aefac8e2c93c9c5b214313817cdb01a1494b917c8436b35'
      );
      expect(name1).not.toBe(name2);
    });

    it('should produce valid base58 encoded name', async () => {
      const ipnsName = await deriveIpnsNameFromPrivateKey(TEST_PRIVATE_KEY);
      // Base58 characters (no 0, O, I, l)
      expect(ipnsName).toMatch(/^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/);
    });
  });

  describe('deriveEd25519KeyPair', () => {
    it('should derive Ed25519 key pair', async () => {
      const keyPair = await deriveEd25519KeyPair(TEST_PRIVATE_KEY);
      expect(keyPair).toBeDefined();
      expect(keyPair.type).toBe('Ed25519');
    });

    it('should derive consistent key pair', async () => {
      const kp1 = await deriveEd25519KeyPair(TEST_PRIVATE_KEY);
      const kp2 = await deriveEd25519KeyPair(TEST_PRIVATE_KEY);

      const pub1 = Buffer.from(kp1.publicKey.raw).toString('hex');
      const pub2 = Buffer.from(kp2.publicKey.raw).toString('hex');
      expect(pub1).toBe(pub2);
    });
  });

  describe('derivePeerIdFromPrivateKey', () => {
    it('should derive PeerId object', async () => {
      const peerId = await derivePeerIdFromPrivateKey(TEST_PRIVATE_KEY);
      expect(peerId).toBeDefined();
      expect(typeof peerId.toString()).toBe('string');
    });

    it('should produce same PeerId as deriveIpnsNameFromPrivateKey', async () => {
      const peerId = await derivePeerIdFromPrivateKey(TEST_PRIVATE_KEY);
      const ipnsName = await deriveIpnsNameFromPrivateKey(TEST_PRIVATE_KEY);
      expect(peerId.toString()).toBe(ipnsName);
    });

    it('should have type property', async () => {
      const peerId = await derivePeerIdFromPrivateKey(TEST_PRIVATE_KEY);
      expect(peerId.type).toBe('Ed25519');
    });
  });

  describe('Integration', () => {
    it('should produce same IPNS name regardless of derivation path', async () => {
      // Method 1: Direct name derivation
      const name1 = await deriveIpnsNameFromPrivateKey(TEST_PRIVATE_KEY);

      // Method 2: Via PeerId
      const peerId = await derivePeerIdFromPrivateKey(TEST_PRIVATE_KEY);
      const name2 = peerId.toString();

      expect(name1).toBe(name2);
    });
  });
});
