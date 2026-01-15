/**
 * Tests for TXF Serializer
 *
 * Tests TXF token key utilities and storage data building.
 */

import { describe, it, expect } from 'vitest';
import {
  isTokenKey,
  isArchivedKey,
  isForkedKey,
  tokenIdFromKey,
  tokenIdFromArchivedKey,
  parseForkedKey,
  keyFromTokenId,
  archivedKeyFromTokenId,
  forkedKeyFromTokenIdAndState,
  buildTxfStorageData,
} from '../../../src/components/wallet/sdk/serialization/txf-serializer';
import type { TxfToken } from '../../../src/components/wallet/sdk/types/txf';

// Sample token ID (64 hex chars)
const SAMPLE_TOKEN_ID = 'a'.repeat(64);
const SAMPLE_STATE_HASH = 'state_hash_123';

// Helper to create minimal TXF token
const createMinimalToken = (tokenId: string): TxfToken => ({
  version: '2.0',
  genesis: {
    data: {
      tokenId,
      tokenType: 'b'.repeat(64),
      coinData: [],
      tokenData: '',
      salt: 'c'.repeat(64),
      recipient: '',
      recipientDataHash: null,
      reason: null,
    },
    inclusionProof: {
      authenticator: {
        algorithm: 'secp256k1',
        publicKey: '',
        signature: '',
        stateHash: 'genesis_state',
      },
      merkleTreePath: { root: '', steps: [] },
      transactionHash: '',
      unicityCertificate: '',
    },
  },
  state: {
    data: '',
    predicate: '',
    stateHash: 'current_state',
  },
  transactions: [],
  nametags: [],
  _integrity: { genesisDataJSONHash: '' },
});

describe('TXF Serializer', () => {
  describe('Key Utilities', () => {
    describe('keyFromTokenId', () => {
      it('should create key with underscore prefix', () => {
        const key = keyFromTokenId(SAMPLE_TOKEN_ID);
        expect(key).toBe(`_${SAMPLE_TOKEN_ID}`);
      });
    });

    describe('archivedKeyFromTokenId', () => {
      it('should create archived key with prefix', () => {
        const key = archivedKeyFromTokenId(SAMPLE_TOKEN_ID);
        expect(key).toBe(`_archived_${SAMPLE_TOKEN_ID}`);
      });
    });

    describe('forkedKeyFromTokenIdAndState', () => {
      it('should create forked key with tokenId and stateHash', () => {
        const key = forkedKeyFromTokenIdAndState(SAMPLE_TOKEN_ID, SAMPLE_STATE_HASH);
        expect(key).toBe(`_forked_${SAMPLE_TOKEN_ID}_${SAMPLE_STATE_HASH}`);
      });
    });

    describe('isTokenKey', () => {
      it('should return true for valid token key', () => {
        expect(isTokenKey(`_${SAMPLE_TOKEN_ID}`)).toBe(true);
      });

      it('should return false for _meta key', () => {
        expect(isTokenKey('_meta')).toBe(false);
      });

      it('should return false for _nametag key', () => {
        expect(isTokenKey('_nametag')).toBe(false);
      });

      it('should return false for _tombstones key', () => {
        expect(isTokenKey('_tombstones')).toBe(false);
      });

      it('should return false for _outbox key', () => {
        expect(isTokenKey('_outbox')).toBe(false);
      });

      it('should return false for _integrity key', () => {
        expect(isTokenKey('_integrity')).toBe(false);
      });

      it('should return false for archived key', () => {
        expect(isTokenKey(`_archived_${SAMPLE_TOKEN_ID}`)).toBe(false);
      });

      it('should return false for forked key', () => {
        expect(isTokenKey(`_forked_${SAMPLE_TOKEN_ID}_hash`)).toBe(false);
      });

      it('should return false for key without underscore prefix', () => {
        expect(isTokenKey('token123')).toBe(false);
      });
    });

    describe('isArchivedKey', () => {
      it('should return true for valid archived key', () => {
        expect(isArchivedKey(`_archived_${SAMPLE_TOKEN_ID}`)).toBe(true);
      });

      it('should return false for regular token key', () => {
        expect(isArchivedKey(`_${SAMPLE_TOKEN_ID}`)).toBe(false);
      });

      it('should return false for forked key', () => {
        expect(isArchivedKey(`_forked_${SAMPLE_TOKEN_ID}_hash`)).toBe(false);
      });
    });

    describe('isForkedKey', () => {
      it('should return true for valid forked key', () => {
        expect(isForkedKey(`_forked_${SAMPLE_TOKEN_ID}_${SAMPLE_STATE_HASH}`)).toBe(true);
      });

      it('should return false for regular token key', () => {
        expect(isForkedKey(`_${SAMPLE_TOKEN_ID}`)).toBe(false);
      });

      it('should return false for archived key', () => {
        expect(isForkedKey(`_archived_${SAMPLE_TOKEN_ID}`)).toBe(false);
      });
    });

    describe('tokenIdFromKey', () => {
      it('should extract tokenId from key', () => {
        const tokenId = tokenIdFromKey(`_${SAMPLE_TOKEN_ID}`);
        expect(tokenId).toBe(SAMPLE_TOKEN_ID);
      });
    });

    describe('tokenIdFromArchivedKey', () => {
      it('should extract tokenId from archived key', () => {
        const tokenId = tokenIdFromArchivedKey(`_archived_${SAMPLE_TOKEN_ID}`);
        expect(tokenId).toBe(SAMPLE_TOKEN_ID);
      });
    });

    describe('parseForkedKey', () => {
      it('should parse forked key into tokenId and stateHash', () => {
        const key = `_forked_${SAMPLE_TOKEN_ID}_${SAMPLE_STATE_HASH}`;
        const result = parseForkedKey(key);
        expect(result).toEqual({
          tokenId: SAMPLE_TOKEN_ID,
          stateHash: SAMPLE_STATE_HASH,
        });
      });

      it('should return null for invalid forked key', () => {
        expect(parseForkedKey('_not_forked_key')).toBeNull();
        expect(parseForkedKey(`_forked_${SAMPLE_TOKEN_ID}`)).toBeNull(); // missing stateHash
      });
    });
  });

  describe('buildTxfStorageData', () => {
    it('should build storage data with meta', () => {
      const result = buildTxfStorageData({
        meta: {
          version: 1,
          address: 'wallet_address',
          ipnsName: 'ipns_name',
        },
        tokens: [],
      });

      expect(result._meta).toBeDefined();
      expect(result._meta.version).toBe(1);
      expect(result._meta.address).toBe('wallet_address');
      expect(result._meta.formatVersion).toBe('2.0');
    });

    it('should add tokens with correct keys', () => {
      const token1 = createMinimalToken('a'.repeat(64));
      const token2 = createMinimalToken('b'.repeat(64));

      const result = buildTxfStorageData({
        meta: { version: 1, address: '', ipnsName: '' },
        tokens: [token1, token2],
      });

      expect(result[`_${'a'.repeat(64)}`]).toBe(token1);
      expect(result[`_${'b'.repeat(64)}`]).toBe(token2);
    });

    it('should add nametag if provided', () => {
      const result = buildTxfStorageData({
        meta: { version: 1, address: '', ipnsName: '' },
        tokens: [],
        nametag: { name: 'test-nametag' },
      });

      expect(result._nametag).toEqual({ name: 'test-nametag' });
    });

    it('should add tombstones if provided', () => {
      const tombstones = [
        { tokenId: 'x'.repeat(64), stateHash: 'hash1', timestamp: 123 },
        { tokenId: 'y'.repeat(64), stateHash: 'hash2', timestamp: 456 },
      ];

      const result = buildTxfStorageData({
        meta: { version: 1, address: '', ipnsName: '' },
        tokens: [],
        tombstones,
      });

      expect(result._tombstones).toHaveLength(2);
      expect(result._tombstones?.[0].tokenId).toBe('x'.repeat(64));
    });

    it('should not add empty tombstones array', () => {
      const result = buildTxfStorageData({
        meta: { version: 1, address: '', ipnsName: '' },
        tokens: [],
        tombstones: [],
      });

      expect(result._tombstones).toBeUndefined();
    });

    it('should add archived tokens with correct keys', () => {
      const archivedToken = createMinimalToken('archived_token_id'.padEnd(64, '0'));
      const archivedTokens = new Map([['archived_token_id'.padEnd(64, '0'), archivedToken]]);

      const result = buildTxfStorageData({
        meta: { version: 1, address: '', ipnsName: '' },
        tokens: [],
        archivedTokens,
      });

      expect(result[`_archived_${'archived_token_id'.padEnd(64, '0')}`]).toBe(archivedToken);
    });

    it('should add outbox entries if provided', () => {
      const outboxEntries = [
        {
          id: 'outbox-1',
          status: 'PENDING_IPFS_SYNC' as const,
          sourceTokenId: 'src'.repeat(16),
          salt: 'salt123',
          commitmentJson: '{}',
          createdAt: 100,
          updatedAt: 100,
        },
      ];

      const result = buildTxfStorageData({
        meta: { version: 1, address: '', ipnsName: '' },
        tokens: [],
        outboxEntries,
      });

      expect(result._outbox).toHaveLength(1);
      expect(result._outbox?.[0].id).toBe('outbox-1');
    });
  });
});
