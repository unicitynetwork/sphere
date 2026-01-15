/**
 * Tests for TXF Zod Schemas
 *
 * Validates that TXF schemas correctly parse and validate token data.
 */

import { describe, it, expect } from 'vitest';
import {
  parseTxfToken,
  safeParseTxfToken,
  parseTxfMeta,
  safeParseTxfMeta,
  parseTxfStorageData,
  safeParseTxfStorageData,
  validateTokenEntry,
  TxfTokenSchema,
  TxfMetaSchema,
} from '../../../src/components/wallet/sdk/types/txf-schemas';

// Valid mock data for testing
const validTxfToken = {
  version: "2.0" as const,
  genesis: {
    data: {
      tokenId: 'a'.repeat(64),
      tokenType: 'b'.repeat(64),
      coinData: [['coinId1', '1000']],
      tokenData: 'test data',
      salt: 'c'.repeat(64),
      recipient: 'recipient_address',
      recipientDataHash: null,
      reason: null,
    },
    inclusionProof: {
      authenticator: {
        algorithm: 'secp256k1',
        publicKey: 'd'.repeat(66),
        signature: 'e'.repeat(128),
        stateHash: 'state_hash',
      },
      merkleTreePath: {
        root: 'root_hash',
        steps: [{ data: 'step_data', path: 'L' }],
      },
      transactionHash: 'tx_hash',
      unicityCertificate: 'cert',
    },
  },
  state: {
    data: 'state_data',
    predicate: 'predicate_data',
  },
  transactions: [],
  nametags: [],
  _integrity: {
    genesisDataJSONHash: 'integrity_hash',
  },
};

const validTxfMeta = {
  version: 1,
  address: 'wallet_address',
  ipnsName: 'k51qzi...',
  formatVersion: "2.0" as const,
  lastCid: 'bafybeig...',
  deviceId: 'device-123',
};

describe('TXF Schemas', () => {
  describe('TxfTokenSchema', () => {
    it('should parse valid token data', () => {
      const result = TxfTokenSchema.safeParse(validTxfToken);
      expect(result.success).toBe(true);
    });

    it('should reject invalid version', () => {
      const invalid = { ...validTxfToken, version: "1.0" };
      const result = TxfTokenSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should reject missing genesis', () => {
      const { genesis, ...invalid } = validTxfToken;
      const result = TxfTokenSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should reject invalid tokenId (not 64 chars)', () => {
      const invalid = {
        ...validTxfToken,
        genesis: {
          ...validTxfToken.genesis,
          data: {
            ...validTxfToken.genesis.data,
            tokenId: 'abc', // Invalid: should be 64 chars
          },
        },
      };
      const result = TxfTokenSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });

  describe('parseTxfToken', () => {
    it('should return parsed token for valid data', () => {
      const token = parseTxfToken(validTxfToken);
      expect(token.version).toBe("2.0");
      expect(token.genesis.data.tokenId).toBe('a'.repeat(64));
    });

    it('should throw for invalid data', () => {
      expect(() => parseTxfToken({ invalid: true })).toThrow();
    });
  });

  describe('safeParseTxfToken', () => {
    it('should return token for valid data', () => {
      const token = safeParseTxfToken(validTxfToken);
      expect(token).not.toBeNull();
      expect(token?.version).toBe("2.0");
    });

    it('should return null for invalid data', () => {
      const token = safeParseTxfToken({ invalid: true });
      expect(token).toBeNull();
    });

    it('should return null for null input', () => {
      const token = safeParseTxfToken(null);
      expect(token).toBeNull();
    });
  });

  describe('TxfMetaSchema', () => {
    it('should parse valid meta', () => {
      const result = TxfMetaSchema.safeParse(validTxfMeta);
      expect(result.success).toBe(true);
    });

    it('should reject invalid formatVersion', () => {
      const invalid = { ...validTxfMeta, formatVersion: "1.0" };
      const result = TxfMetaSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should reject negative version', () => {
      const invalid = { ...validTxfMeta, version: -1 };
      const result = TxfMetaSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });

  describe('parseTxfMeta', () => {
    it('should return parsed meta for valid data', () => {
      const meta = parseTxfMeta(validTxfMeta);
      expect(meta.version).toBe(1);
      expect(meta.address).toBe('wallet_address');
    });

    it('should throw for invalid data', () => {
      expect(() => parseTxfMeta({ invalid: true })).toThrow();
    });
  });

  describe('safeParseTxfMeta', () => {
    it('should return meta for valid data', () => {
      const meta = safeParseTxfMeta(validTxfMeta);
      expect(meta).not.toBeNull();
      expect(meta?.version).toBe(1);
    });

    it('should return null for invalid data', () => {
      const meta = safeParseTxfMeta({ invalid: true });
      expect(meta).toBeNull();
    });
  });

  describe('TxfStorageData', () => {
    it('should parse valid storage data with tokens', () => {
      const storageData = {
        _meta: validTxfMeta,
        [`_${'a'.repeat(64)}`]: validTxfToken,
      };
      const result = safeParseTxfStorageData(storageData);
      expect(result).not.toBeNull();
      expect(result?._meta.version).toBe(1);
    });

    it('should parse storage data with optional fields', () => {
      const storageData = {
        _meta: validTxfMeta,
        _nametag: { name: 'test-nametag' },
        _tombstones: [{ tokenId: 'f'.repeat(64), stateHash: 'hash', timestamp: 123 }],
      };
      const result = safeParseTxfStorageData(storageData);
      expect(result).not.toBeNull();
    });
  });

  describe('validateTokenEntry', () => {
    it('should validate correct token entry', () => {
      const result = validateTokenEntry(`_${'a'.repeat(64)}`, validTxfToken);
      expect(result.valid).toBe(true);
      expect(result.token).toBeDefined();
    });

    it('should reject _meta key', () => {
      const result = validateTokenEntry('_meta', validTxfToken);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid token key');
    });

    it('should reject _nametag key', () => {
      const result = validateTokenEntry('_nametag', validTxfToken);
      expect(result.valid).toBe(false);
    });

    it('should reject _tombstones key', () => {
      const result = validateTokenEntry('_tombstones', validTxfToken);
      expect(result.valid).toBe(false);
    });

    it('should reject _outbox key', () => {
      const result = validateTokenEntry('_outbox', validTxfToken);
      expect(result.valid).toBe(false);
    });

    it('should reject key not starting with underscore', () => {
      const result = validateTokenEntry('token123', validTxfToken);
      expect(result.valid).toBe(false);
    });

    it('should reject invalid token value', () => {
      const result = validateTokenEntry('_token123', { invalid: true });
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});
