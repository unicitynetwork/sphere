import { describe, it, expect } from 'vitest';
import {
  buildTombstoneKeySet,
  buildTombstoneMap,
  isTombstoned,
  createTombstone,
  mergeTombstones,
  findNewTombstones,
  removeExpiredTombstones,
  extractTombstonedTokenIds,
  validateTombstones,
  filterTombstonesByTokenIds,
  getTombstonesForToken,
} from '../../../src/components/wallet/sdk/storage/tombstone-utils';
import type { TombstoneEntry } from '../../../src/components/wallet/sdk/types/txf';

describe('tombstone-utils', () => {
  const mockTombstone1: TombstoneEntry = {
    tokenId: '0'.repeat(64),
    stateHash: '0000' + 'a'.repeat(60),
    timestamp: Date.now() - 1000,
  };

  const mockTombstone2: TombstoneEntry = {
    tokenId: '1'.repeat(64),
    stateHash: '0000' + 'b'.repeat(60),
    timestamp: Date.now() - 2000,
  };

  const mockTombstone3: TombstoneEntry = {
    tokenId: '0'.repeat(64), // Same tokenId as tombstone1
    stateHash: '0000' + 'c'.repeat(60), // Different stateHash
    timestamp: Date.now() - 3000,
  };

  describe('buildTombstoneKeySet', () => {
    it('builds empty set for empty array', () => {
      const set = buildTombstoneKeySet([]);
      expect(set.size).toBe(0);
    });

    it('builds set with correct keys', () => {
      const set = buildTombstoneKeySet([mockTombstone1, mockTombstone2]);
      expect(set.size).toBe(2);
      expect(set.has(`${mockTombstone1.tokenId}:${mockTombstone1.stateHash}`)).toBe(true);
      expect(set.has(`${mockTombstone2.tokenId}:${mockTombstone2.stateHash}`)).toBe(true);
    });
  });

  describe('buildTombstoneMap', () => {
    it('groups tombstones by tokenId', () => {
      const map = buildTombstoneMap([mockTombstone1, mockTombstone2, mockTombstone3]);

      expect(map.size).toBe(2); // 2 unique tokenIds
      expect(map.get(mockTombstone1.tokenId)?.length).toBe(2); // 2 entries for first tokenId
      expect(map.get(mockTombstone2.tokenId)?.length).toBe(1);
    });
  });

  describe('isTombstoned', () => {
    it('returns true for tombstoned state', () => {
      const set = buildTombstoneKeySet([mockTombstone1]);
      expect(isTombstoned(mockTombstone1.tokenId, mockTombstone1.stateHash, set)).toBe(true);
    });

    it('returns false for non-tombstoned state', () => {
      const set = buildTombstoneKeySet([mockTombstone1]);
      expect(isTombstoned(mockTombstone2.tokenId, mockTombstone2.stateHash, set)).toBe(false);
    });

    it('returns false for same tokenId but different stateHash', () => {
      const set = buildTombstoneKeySet([mockTombstone1]);
      expect(isTombstoned(mockTombstone1.tokenId, mockTombstone3.stateHash, set)).toBe(false);
    });
  });

  describe('createTombstone', () => {
    it('creates tombstone with provided values', () => {
      const tokenId = '2'.repeat(64);
      const stateHash = '0000' + 'd'.repeat(60);
      const timestamp = 1234567890;

      const tombstone = createTombstone(tokenId, stateHash, timestamp);

      expect(tombstone.tokenId).toBe(tokenId);
      expect(tombstone.stateHash).toBe(stateHash);
      expect(tombstone.timestamp).toBe(timestamp);
    });

    it('uses current timestamp if not provided', () => {
      const before = Date.now();
      const tombstone = createTombstone('3'.repeat(64), '0000' + 'e'.repeat(60));
      const after = Date.now();

      expect(tombstone.timestamp).toBeGreaterThanOrEqual(before);
      expect(tombstone.timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('mergeTombstones', () => {
    it('returns empty array for empty inputs', () => {
      const merged = mergeTombstones([], []);
      expect(merged).toHaveLength(0);
    });

    it('includes all tombstones from both sources', () => {
      const local = [mockTombstone1];
      const remote = [mockTombstone2];

      const merged = mergeTombstones(local, remote);

      expect(merged).toHaveLength(2);
    });

    it('deduplicates by tokenId:stateHash', () => {
      const local = [mockTombstone1];
      const remote = [{ ...mockTombstone1 }]; // Same key

      const merged = mergeTombstones(local, remote);

      expect(merged).toHaveLength(1);
    });

    it('prefers later timestamp on duplicate', () => {
      const older: TombstoneEntry = { ...mockTombstone1, timestamp: 1000 };
      const newer: TombstoneEntry = { ...mockTombstone1, timestamp: 2000 };

      const merged = mergeTombstones([older], [newer]);

      expect(merged).toHaveLength(1);
      expect(merged[0].timestamp).toBe(2000);
    });
  });

  describe('findNewTombstones', () => {
    it('finds tombstones in source but not in target', () => {
      const source = [mockTombstone1, mockTombstone2];
      const target = [mockTombstone1];

      const newOnes = findNewTombstones(source, target);

      expect(newOnes).toHaveLength(1);
      expect(newOnes[0].tokenId).toBe(mockTombstone2.tokenId);
    });

    it('returns empty array if all exist in target', () => {
      const source = [mockTombstone1];
      const target = [mockTombstone1, mockTombstone2];

      const newOnes = findNewTombstones(source, target);

      expect(newOnes).toHaveLength(0);
    });
  });

  describe('removeExpiredTombstones', () => {
    it('removes tombstones older than max age', () => {
      const recent: TombstoneEntry = {
        tokenId: '4'.repeat(64),
        stateHash: '0000' + 'f'.repeat(60),
        timestamp: Date.now() - 1000, // 1 second ago
      };
      const old: TombstoneEntry = {
        tokenId: '5'.repeat(64),
        stateHash: '0000' + 'g'.repeat(60),
        timestamp: Date.now() - 100000000, // ~1157 days ago
      };

      const filtered = removeExpiredTombstones([recent, old], 60 * 60 * 1000); // 1 hour max

      expect(filtered).toHaveLength(1);
      expect(filtered[0].tokenId).toBe(recent.tokenId);
    });

    it('uses 30 days as default max age', () => {
      const recent: TombstoneEntry = {
        tokenId: '6'.repeat(64),
        stateHash: '0000' + 'h'.repeat(60),
        timestamp: Date.now() - 1000,
      };

      const filtered = removeExpiredTombstones([recent]);

      expect(filtered).toHaveLength(1);
    });
  });

  describe('extractTombstonedTokenIds', () => {
    it('extracts unique token IDs', () => {
      const tombstones = [mockTombstone1, mockTombstone2, mockTombstone3];
      const ids = extractTombstonedTokenIds(tombstones);

      expect(ids.size).toBe(2); // mockTombstone1 and mockTombstone3 have same ID
      expect(ids.has(mockTombstone1.tokenId)).toBe(true);
      expect(ids.has(mockTombstone2.tokenId)).toBe(true);
    });
  });

  describe('filterTombstonesByTokenIds', () => {
    it('filters to only specified token IDs', () => {
      const tombstones = [mockTombstone1, mockTombstone2, mockTombstone3];
      const tokenIds = new Set([mockTombstone1.tokenId]);

      const filtered = filterTombstonesByTokenIds(tombstones, tokenIds);

      expect(filtered).toHaveLength(2); // mockTombstone1 and mockTombstone3
      expect(filtered.every(t => t.tokenId === mockTombstone1.tokenId)).toBe(true);
    });
  });

  describe('getTombstonesForToken', () => {
    it('returns all tombstones for a specific token', () => {
      const tombstones = [mockTombstone1, mockTombstone2, mockTombstone3];
      const forToken = getTombstonesForToken(tombstones, mockTombstone1.tokenId);

      expect(forToken).toHaveLength(2);
    });

    it('returns empty array for unknown token', () => {
      const tombstones = [mockTombstone1];
      const forToken = getTombstonesForToken(tombstones, '9'.repeat(64));

      expect(forToken).toHaveLength(0);
    });
  });

  describe('validateTombstones', () => {
    it('returns true for valid tombstones', () => {
      expect(validateTombstones([mockTombstone1, mockTombstone2])).toBe(true);
    });

    it('returns true for empty array', () => {
      expect(validateTombstones([])).toBe(true);
    });

    it('returns false for invalid tokenId', () => {
      const invalid: TombstoneEntry = {
        tokenId: 'not-hex',
        stateHash: '0000' + 'a'.repeat(60),
        timestamp: Date.now(),
      };
      expect(validateTombstones([invalid])).toBe(false);
    });

    it('returns false for invalid stateHash (no 0000 prefix)', () => {
      const invalid: TombstoneEntry = {
        tokenId: '0'.repeat(64),
        stateHash: 'a'.repeat(64), // Missing 0000 prefix
        timestamp: Date.now(),
      };
      expect(validateTombstones([invalid])).toBe(false);
    });

    it('returns false for negative timestamp', () => {
      const invalid: TombstoneEntry = {
        tokenId: '0'.repeat(64),
        stateHash: '0000' + 'a'.repeat(60),
        timestamp: -1,
      };
      expect(validateTombstones([invalid])).toBe(false);
    });
  });
});
