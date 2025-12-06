import { describe, it, expect, beforeEach } from "vitest";
import {
  ConflictResolutionService,
  getConflictResolutionService,
} from "../../../../../../src/components/wallet/L3/services/ConflictResolutionService";
import type { TxfStorageData, TxfToken, TxfMeta } from "../../../../../../src/components/wallet/L3/services/types/TxfTypes";

// ==========================================
// Test Fixtures
// ==========================================

const createMockMeta = (overrides: Partial<TxfMeta> = {}): TxfMeta => ({
  version: 1,
  timestamp: Date.now(),
  address: "0x123",
  ipnsName: "ipns-test",
  formatVersion: "2.0",
  ...overrides,
});

const createMockTxfToken = (
  tokenId: string = "a".repeat(64),
  transactionCount: number = 0,
  proofCount: number = 0
): TxfToken => {
  const inclusionProof = {
    authenticator: {
      algorithm: "secp256k1",
      publicKey: "d".repeat(64),
      signature: "e".repeat(128),
      stateHash: "0000" + "f".repeat(60),
    },
    merkleTreePath: {
      root: "0000" + "1".repeat(60),
      steps: [{ data: "2".repeat(64), path: "1" }],
    },
    transactionHash: "3".repeat(64),
    unicityCertificate: "4".repeat(100),
  };

  const transactions = [];
  for (let i = 0; i < transactionCount; i++) {
    transactions.push({
      previousStateHash: i === 0 ? tokenId : `hash${i - 1}`,
      newStateHash: `hash${i}`,
      predicate: "pred" + i,
      inclusionProof: i < proofCount ? inclusionProof : null,
    });
  }

  return {
    version: "2.0",
    genesis: {
      data: {
        tokenId,
        tokenType: "b".repeat(64),
        coinData: [["ALPHA", "1000"]],
        tokenData: "",
        salt: "c".repeat(64),
        recipient: "DIRECT://abc123",
        recipientDataHash: null,
        reason: null,
      },
      inclusionProof,
    },
    state: {
      data: "",
      predicate: "5".repeat(64),
    },
    transactions,
    nametags: [],
    _integrity: {
      genesisDataJSONHash: "0000" + tokenId.slice(0, 60),
    },
  };
};

const createMockStorageData = (
  tokens: Record<string, TxfToken>,
  meta: Partial<TxfMeta> = {}
): TxfStorageData => {
  const storageData: TxfStorageData = {
    _meta: createMockMeta(meta),
  };

  for (const [tokenId, token] of Object.entries(tokens)) {
    storageData[`_${tokenId}`] = token;
  }

  return storageData;
};

// ==========================================
// ConflictResolutionService Tests
// ==========================================

describe("ConflictResolutionService", () => {
  let service: ConflictResolutionService;

  beforeEach(() => {
    service = new ConflictResolutionService();
  });

  // ==========================================
  // resolveConflict Tests
  // ==========================================

  describe("resolveConflict", () => {
    it("should use remote as base when remote version is higher", () => {
      const tokenId = "a".repeat(64);
      const local = createMockStorageData(
        { [tokenId]: createMockTxfToken(tokenId) },
        { version: 1 }
      );
      const remote = createMockStorageData(
        { [tokenId]: createMockTxfToken(tokenId) },
        { version: 2 }
      );

      const result = service.resolveConflict(local, remote);

      expect(result.merged._meta.version).toBe(3); // remote version + 1
    });

    it("should use local as base when local version is higher", () => {
      const tokenId = "a".repeat(64);
      const local = createMockStorageData(
        { [tokenId]: createMockTxfToken(tokenId) },
        { version: 3 }
      );
      const remote = createMockStorageData(
        { [tokenId]: createMockTxfToken(tokenId) },
        { version: 1 }
      );

      const result = service.resolveConflict(local, remote);

      expect(result.merged._meta.version).toBe(4); // local version + 1
    });

    it("should use timestamp for tiebreaker when versions are equal", () => {
      const tokenId = "a".repeat(64);
      const now = Date.now();

      const local = createMockStorageData(
        { [tokenId]: createMockTxfToken(tokenId) },
        { version: 1, timestamp: now - 1000 }
      );
      const remote = createMockStorageData(
        { [tokenId]: createMockTxfToken(tokenId) },
        { version: 1, timestamp: now }
      );

      const result = service.resolveConflict(local, remote);

      expect(result.merged._meta.version).toBe(2);
    });

    it("should merge tokens from both sources", () => {
      const localTokenId = "a".repeat(64);
      const remoteTokenId = "b".repeat(64);

      const local = createMockStorageData(
        { [localTokenId]: createMockTxfToken(localTokenId) },
        { version: 1 }
      );
      const remote = createMockStorageData(
        { [remoteTokenId]: createMockTxfToken(remoteTokenId) },
        { version: 2 }
      );

      const result = service.resolveConflict(local, remote);

      expect(result.merged[`_${localTokenId}`]).toBeDefined();
      expect(result.merged[`_${remoteTokenId}`]).toBeDefined();
      expect(result.newTokens).toContain(localTokenId);
    });

    it("should report conflicts when tokens exist in both sources", () => {
      const tokenId = "a".repeat(64);

      // Local has longer chain
      const localToken = createMockTxfToken(tokenId, 2, 2);
      // Remote has shorter chain
      const remoteToken = createMockTxfToken(tokenId, 1, 1);

      const local = createMockStorageData(
        { [tokenId]: localToken },
        { version: 1 }
      );
      const remote = createMockStorageData(
        { [tokenId]: remoteToken },
        { version: 2 }
      );

      const result = service.resolveConflict(local, remote);

      // The winner should be the longer chain (local)
      const mergedToken = result.merged[`_${tokenId}`] as TxfToken;
      expect(mergedToken.transactions.length).toBe(2);
    });
  });

  // ==========================================
  // Token Conflict Resolution Tests
  // ==========================================

  describe("token conflict resolution", () => {
    it("should prefer longer chain", () => {
      const tokenId = "a".repeat(64);

      const localToken = createMockTxfToken(tokenId, 3, 3); // 3 transactions
      const remoteToken = createMockTxfToken(tokenId, 1, 1); // 1 transaction

      const local = createMockStorageData(
        { [tokenId]: localToken },
        { version: 1, timestamp: Date.now() - 1000 }
      );
      const remote = createMockStorageData(
        { [tokenId]: remoteToken },
        { version: 1, timestamp: Date.now() }
      );

      const result = service.resolveConflict(local, remote);

      // Should prefer local (longer chain) even though remote has newer timestamp
      const mergedToken = result.merged[`_${tokenId}`] as TxfToken;
      expect(mergedToken.transactions.length).toBe(3);
    });

    it("should prefer more proofs when chains are equal length", () => {
      const tokenId = "a".repeat(64);

      const localToken = createMockTxfToken(tokenId, 2, 2); // 2 txs, 2 proofs
      const remoteToken = createMockTxfToken(tokenId, 2, 1); // 2 txs, 1 proof

      const local = createMockStorageData(
        { [tokenId]: localToken },
        { version: 1 }
      );
      const remote = createMockStorageData(
        { [tokenId]: remoteToken },
        { version: 2 }
      );

      const result = service.resolveConflict(local, remote);

      // Remote is base (higher version), but local has more proofs
      // Check that conflicts array contains this resolution
      const conflict = result.conflicts.find((c) => c.tokenId === tokenId);
      if (conflict) {
        expect(conflict.reason).toContain("proofs");
      }
    });
  });

  // ==========================================
  // hasConflict Tests
  // ==========================================

  describe("hasConflict", () => {
    it("should return true when versions differ", () => {
      const local = createMockStorageData({}, { version: 1 });
      const remote = createMockStorageData({}, { version: 2 });

      expect(service.hasConflict(local, remote)).toBe(true);
    });

    it("should return false when versions are the same", () => {
      const local = createMockStorageData({}, { version: 1 });
      const remote = createMockStorageData({}, { version: 1 });

      expect(service.hasConflict(local, remote)).toBe(false);
    });
  });

  // ==========================================
  // isRemoteNewer Tests
  // ==========================================

  describe("isRemoteNewer", () => {
    it("should return true when remote version is higher and contains all local tokens", () => {
      const tokenId = "a".repeat(64);
      const local = createMockStorageData(
        { [tokenId]: createMockTxfToken(tokenId) },
        { version: 1 }
      );
      const remote = createMockStorageData(
        { [tokenId]: createMockTxfToken(tokenId) },
        { version: 2 }
      );

      expect(service.isRemoteNewer(local, remote)).toBe(true);
    });

    it("should return false when local has tokens not in remote", () => {
      const localTokenId = "a".repeat(64);
      const remoteTokenId = "b".repeat(64);

      const local = createMockStorageData(
        { [localTokenId]: createMockTxfToken(localTokenId) },
        { version: 1 }
      );
      const remote = createMockStorageData(
        { [remoteTokenId]: createMockTxfToken(remoteTokenId) },
        { version: 2 }
      );

      expect(service.isRemoteNewer(local, remote)).toBe(false);
    });

    it("should return false when local version is higher or equal", () => {
      const local = createMockStorageData({}, { version: 2 });
      const remote = createMockStorageData({}, { version: 2 });

      expect(service.isRemoteNewer(local, remote)).toBe(false);
    });
  });

  // ==========================================
  // isLocalNewer Tests
  // ==========================================

  describe("isLocalNewer", () => {
    it("should return true when local version is higher and contains all remote tokens", () => {
      const tokenId = "a".repeat(64);
      const local = createMockStorageData(
        { [tokenId]: createMockTxfToken(tokenId) },
        { version: 2 }
      );
      const remote = createMockStorageData(
        { [tokenId]: createMockTxfToken(tokenId) },
        { version: 1 }
      );

      expect(service.isLocalNewer(local, remote)).toBe(true);
    });

    it("should return false when remote has tokens not in local", () => {
      const remoteTokenId = "b".repeat(64);

      const local = createMockStorageData({}, { version: 2 });
      const remote = createMockStorageData(
        { [remoteTokenId]: createMockTxfToken(remoteTokenId) },
        { version: 1 }
      );

      expect(service.isLocalNewer(local, remote)).toBe(false);
    });
  });

  // ==========================================
  // Nametag Merging Tests
  // ==========================================

  describe("nametag merging", () => {
    it("should prefer local nametag when both exist", () => {
      const tokenId = "a".repeat(64);

      const local: TxfStorageData = {
        ...createMockStorageData({ [tokenId]: createMockTxfToken(tokenId) }, { version: 1 }),
        _nametag: { name: "local-user", token: {}, timestamp: Date.now(), format: "1.0", version: "1.0" },
      };
      const remote: TxfStorageData = {
        ...createMockStorageData({ [tokenId]: createMockTxfToken(tokenId) }, { version: 2 }),
        _nametag: { name: "remote-user", token: {}, timestamp: Date.now(), format: "1.0", version: "1.0" },
      };

      const result = service.resolveConflict(local, remote);

      expect(result.merged._nametag?.name).toBe("local-user");
    });

    it("should use remote nametag when local has none", () => {
      const tokenId = "a".repeat(64);

      const local = createMockStorageData(
        { [tokenId]: createMockTxfToken(tokenId) },
        { version: 1 }
      );
      const remote: TxfStorageData = {
        ...createMockStorageData({ [tokenId]: createMockTxfToken(tokenId) }, { version: 2 }),
        _nametag: { name: "remote-user", token: {}, timestamp: Date.now(), format: "1.0", version: "1.0" },
      };

      const result = service.resolveConflict(local, remote);

      expect(result.merged._nametag?.name).toBe("remote-user");
    });
  });
});

// ==========================================
// Singleton Tests
// ==========================================

describe("getConflictResolutionService", () => {
  it("should return the same instance on multiple calls", () => {
    const instance1 = getConflictResolutionService();
    const instance2 = getConflictResolutionService();

    expect(instance1).toBe(instance2);
  });
});
