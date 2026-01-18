/**
 * Integration Tests for Token Inventory Sync
 *
 * These tests verify end-to-end sync scenarios across multiple modes
 * and components, as specified in TOKEN_INVENTORY_SPEC.md.
 *
 * Spec Reference: /docs/TOKEN_INVENTORY_SPEC.md
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Token } from "../../../../src/components/wallet/L3/data/model";
import type { TxfToken, TxfStorageData } from "../../../../src/components/wallet/L3/services/types/TxfTypes";
import type { OutboxEntry } from "../../../../src/components/wallet/L3/services/types/OutboxTypes";

// ==========================================
// Mock Setup
// ==========================================

// Mock IpfsHttpResolver - simulate IPFS availability
let mockIpfsAvailable = true;
let mockRemoteData: TxfStorageData | null = null;

vi.mock("../../../../src/components/wallet/L3/services/IpfsHttpResolver", () => ({
  getIpfsHttpResolver: vi.fn(() => ({
    resolveIpnsName: vi.fn().mockImplementation(async () => {
      if (!mockIpfsAvailable) {
        return { success: false, error: "IPFS unavailable" };
      }
      if (!mockRemoteData) {
        return { success: false, error: "No remote data" };
      }
      return {
        success: true,
        cid: "QmTestCid",
        content: mockRemoteData,
      };
    }),
  })),
  computeCidFromContent: vi.fn().mockResolvedValue("QmTestCid123"),
}));

// Mock TokenValidationService
vi.mock("../../../../src/components/wallet/L3/services/TokenValidationService", () => ({
  getTokenValidationService: vi.fn(() => ({
    validateAllTokens: vi.fn().mockResolvedValue({
      valid: true,
      issues: [],
    }),
    checkSpentTokens: vi.fn().mockResolvedValue({
      spentTokens: [],
      errors: [],
    }),
  })),
}));

// Mock NostrService
vi.mock("../../../../src/components/wallet/L3/services/NostrService", () => ({
  NostrService: {
    getInstance: vi.fn(() => ({
      queryPubkeyByNametag: vi.fn().mockResolvedValue(null),
      publishNametagBinding: vi.fn().mockResolvedValue(true),
    })),
  },
}));

// Mock IdentityManager
vi.mock("../../../../src/components/wallet/L3/services/IdentityManager", () => ({
  IdentityManager: {
    getInstance: vi.fn(() => ({
      getCurrentIdentity: vi.fn().mockResolvedValue({
        address: "test-address",
        publicKey: "0".repeat(64),
        ipnsName: "test-ipns-name",
      }),
    })),
  },
}));

// Mock IPFS config
vi.mock("../../../../src/config/ipfs.config", () => ({
  getAllBackendGatewayUrls: vi.fn(() => ["https://test-gateway.example.com"]),
}));

// Mock PredicateEngineService
vi.mock("@unicitylabs/state-transition-sdk/lib/predicate/PredicateEngineService", () => ({
  PredicateEngineService: {
    createPredicate: vi.fn().mockResolvedValue({
      isOwner: vi.fn().mockResolvedValue(true),
    }),
  },
}));

// Mock ProxyAddress
vi.mock("@unicitylabs/state-transition-sdk/lib/address/ProxyAddress", () => ({
  ProxyAddress: {
    fromNameTag: vi.fn().mockResolvedValue({
      address: "proxy-address-123",
    }),
  },
}));

// Import after mocks
import { inventorySync, type SyncParams } from "../../../../src/components/wallet/L3/services/InventorySyncService";
import { STORAGE_KEY_GENERATORS } from "../../../../src/config/storageKeys";

// ==========================================
// Test Fixtures
// ==========================================

const TEST_ADDRESS = "0x" + "a".repeat(40);
const TEST_PUBLIC_KEY = "0".repeat(64);
const TEST_IPNS_NAME = "k51test123";

const createMockTxfToken = (tokenId: string, amount = "1000"): TxfToken => ({
  version: "2.0",
  genesis: {
    data: {
      tokenId: tokenId.padEnd(64, "0"),
      coinId: "ALPHA",
      coinData: [["ALPHA", amount]],
    },
    inclusionProof: {
      authenticator: { stateHash: "0000" + "a".repeat(60) },
      merkleTreePath: { root: "0000" + "b".repeat(60), path: [] },
      transactionHash: "0000" + "c".repeat(60),
    },
  },
  state: { data: "", predicate: new Uint8Array([1, 2, 3]) },
  transactions: [],
  _meta: { amount, symbol: "ALPHA" },
});

const createMockToken = (id: string, amount = "1000"): Token => ({
  id,
  name: "Test Token",
  type: "UCT",
  timestamp: Date.now(),
  jsonData: JSON.stringify({
    version: "2.0",
    genesis: {
      data: {
        tokenId: id.padEnd(64, "0"),
        coinId: "ALPHA",
        coinData: [["ALPHA", amount]],
      },
      inclusionProof: {
        authenticator: { stateHash: "0000" + "a".repeat(60) },
        merkleTreePath: { root: "0000" + "b".repeat(60), path: [] },
        transactionHash: "0000" + "c".repeat(60),
      },
    },
    state: { data: "", predicate: [1, 2, 3] },
    transactions: [],
  }),
  status: 0,
  amount,
  coinId: "ALPHA",
  symbol: "ALPHA",
  sizeBytes: 100,
} as Token);

const createMockStorageData = (tokens: Record<string, TxfToken> = {}): TxfStorageData => ({
  _meta: { version: 1, lastSync: Date.now() },
  _sent: [],
  _invalid: [],
  _outbox: [],
  _tombstones: [],
  _nametag: null,
  ...Object.fromEntries(
    Object.entries(tokens).map(([tokenId, token]) => [`_${tokenId}`, token])
  ),
});

const createBaseSyncParams = (): SyncParams => ({
  address: TEST_ADDRESS,
  publicKey: TEST_PUBLIC_KEY,
  ipnsName: TEST_IPNS_NAME,
});

// ==========================================
// Test Helpers
// ==========================================

const setLocalStorage = (data: TxfStorageData) => {
  const storageKey = STORAGE_KEY_GENERATORS.walletByAddress(TEST_ADDRESS);
  localStorage.setItem(storageKey, JSON.stringify(data));
};

const getLocalStorage = (): TxfStorageData | null => {
  const storageKey = STORAGE_KEY_GENERATORS.walletByAddress(TEST_ADDRESS);
  const json = localStorage.getItem(storageKey);
  return json ? JSON.parse(json) : null;
};

const clearLocalStorage = () => {
  localStorage.clear();
};

// ==========================================
// Integration Tests
// ==========================================

describe("Token Inventory Sync Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearLocalStorage();
    mockIpfsAvailable = true;
    mockRemoteData = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ------------------------------------------
  // Edge Case 13.1: Empty Inventory Sync
  // ------------------------------------------
  describe("Edge Case 13.1: Empty Inventory Sync", () => {
    it("should handle empty local and remote inventory", async () => {
      const params = createBaseSyncParams();

      const result = await inventorySync(params);

      expect(result.status).toBe("SUCCESS");
      expect(result.inventoryStats?.activeTokens).toBe(0);
      expect(result.inventoryStats?.sentTokens).toBe(0);
    });

    it("should import tokens from remote when local is empty", async () => {
      // Set up remote data
      mockRemoteData = createMockStorageData({
        "abc123": createMockTxfToken("abc123", "5000"),
      });

      const params = createBaseSyncParams();

      const result = await inventorySync(params);

      // Can be SUCCESS or PARTIAL_SUCCESS (IPNS publish pending)
      expect(["SUCCESS", "PARTIAL_SUCCESS"]).toContain(result.status);
      expect(result.inventoryStats?.activeTokens).toBe(1);
    });
  });

  // ------------------------------------------
  // Edge Case 13.2: IPFS Unavailable
  // ------------------------------------------
  describe("Edge Case 13.2: IPFS Unavailable", () => {
    it("should fall back to local data when IPFS unavailable", async () => {
      mockIpfsAvailable = false;

      setLocalStorage(createMockStorageData({
        "local1": createMockTxfToken("local1", "1000"),
        "local2": createMockTxfToken("local2", "2000"),
      }));

      const params = createBaseSyncParams();

      const result = await inventorySync(params);

      expect(result.status).toBe("SUCCESS");
      expect(result.inventoryStats?.activeTokens).toBe(2);
    });

    it("should succeed with local=true when IPFS unavailable", async () => {
      mockIpfsAvailable = false;

      setLocalStorage(createMockStorageData({
        "token1": createMockTxfToken("token1"),
      }));

      const params: SyncParams = {
        ...createBaseSyncParams(),
        local: true,
      };

      const result = await inventorySync(params);

      expect(result.status).toBe("SUCCESS");
      expect(result.syncMode).toBe("LOCAL");
    });
  });

  // ------------------------------------------
  // Edge Case 13.3: Incoming Token Processing
  // ------------------------------------------
  describe("Edge Case 13.3: Incoming Token Processing", () => {
    it("should process incoming tokens in FAST mode", async () => {
      const incomingTokens = [
        createMockToken("incoming1", "1000"),
        createMockToken("incoming2", "2000"),
      ];

      const params: SyncParams = {
        ...createBaseSyncParams(),
        incomingTokens,
      };

      const result = await inventorySync(params);

      expect(result.syncMode).toBe("FAST");
      expect(result.operationStats.tokensImported).toBe(2);
    });

    it("should merge incoming tokens with existing inventory", async () => {
      setLocalStorage(createMockStorageData({
        "existing1": createMockTxfToken("existing1", "500"),
      }));

      const incomingTokens = [
        createMockToken("incoming1", "1000"),
      ];

      const params: SyncParams = {
        ...createBaseSyncParams(),
        incomingTokens,
      };

      const result = await inventorySync(params);

      expect(result.inventoryStats?.activeTokens).toBe(2);
    });
  });

  // ------------------------------------------
  // Edge Case 13.4: Outbox Processing
  // ------------------------------------------
  describe("Edge Case 13.4: Outbox Processing", () => {
    it("should process outbox entries", async () => {
      const outboxTokens: OutboxEntry[] = [{
        id: "outbox1",
        tokenId: "token1".padEnd(64, "0"),
        status: "PENDING_IPFS_SYNC",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        retryCount: 0,
        recipientAddress: "DIRECT://test",
      }];

      const params: SyncParams = {
        ...createBaseSyncParams(),
        outboxTokens,
      };

      const result = await inventorySync(params);

      expect(result.inventoryStats?.outboxTokens).toBe(1);
    });
  });

  // ------------------------------------------
  // Edge Case 13.5: Sent Token Tracking
  // ------------------------------------------
  describe("Edge Case 13.5: Sent Token Tracking", () => {
    it("should preserve sent tokens across sync", async () => {
      const storageData = createMockStorageData({
        "active1": createMockTxfToken("active1"),
      });
      storageData._sent = [{
        token: createMockTxfToken("sent1"),
        timestamp: Date.now(),
        spentAt: Date.now(),
      }];
      setLocalStorage(storageData);

      const params = createBaseSyncParams();

      const result = await inventorySync(params);

      expect(result.inventoryStats?.sentTokens).toBe(1);
      expect(result.inventoryStats?.activeTokens).toBe(1);
    });
  });

  // ------------------------------------------
  // Edge Case 13.6: Invalid Token Handling
  // ------------------------------------------
  describe("Edge Case 13.6: Invalid Token Handling", () => {
    it("should preserve invalid tokens in Invalid folder", async () => {
      const storageData = createMockStorageData();
      storageData._invalid = [{
        token: createMockTxfToken("invalid1"),
        timestamp: Date.now(),
        invalidatedAt: Date.now(),
        reason: "SDK_VALIDATION",
      }];
      setLocalStorage(storageData);

      const params = createBaseSyncParams();

      const result = await inventorySync(params);

      expect(result.inventoryStats?.invalidTokens).toBe(1);
    });
  });

  // ------------------------------------------
  // Cross-Mode Scenarios
  // ------------------------------------------
  describe("Cross-Mode Scenarios", () => {
    it("should transition from FAST to NORMAL mode cleanly", async () => {
      // First FAST sync with incoming tokens
      const fastParams: SyncParams = {
        ...createBaseSyncParams(),
        incomingTokens: [createMockToken("fast1")],
      };

      const fastResult = await inventorySync(fastParams);
      expect(fastResult.syncMode).toBe("FAST");

      // Then NORMAL sync
      const normalParams = createBaseSyncParams();
      const normalResult = await inventorySync(normalParams);

      expect(normalResult.syncMode).toBe("NORMAL");
      expect(normalResult.inventoryStats?.activeTokens).toBe(1);
    });

    it("should handle sequential LOCAL mode syncs", async () => {
      setLocalStorage(createMockStorageData({
        "token1": createMockTxfToken("token1"),
      }));

      const params: SyncParams = {
        ...createBaseSyncParams(),
        local: true,
      };

      // First sync
      const result1 = await inventorySync(params);
      expect(result1.inventoryStats?.activeTokens).toBe(1);

      // Second sync (should see same data)
      const result2 = await inventorySync(params);
      expect(result2.inventoryStats?.activeTokens).toBe(1);
    });
  });

  // ------------------------------------------
  // Statistics Accuracy
  // ------------------------------------------
  describe("Statistics Accuracy", () => {
    it("should provide accurate operation stats", async () => {
      const incomingTokens = [
        createMockToken("new1"),
        createMockToken("new2"),
        createMockToken("new3"),
      ];

      const params: SyncParams = {
        ...createBaseSyncParams(),
        incomingTokens,
      };

      const result = await inventorySync(params);

      expect(result.operationStats.tokensImported).toBe(3);
      expect(result.operationStats.tokensRemoved).toBe(0);
    });

    it("should track sync duration", async () => {
      const params = createBaseSyncParams();

      const result = await inventorySync(params);

      expect(result.syncDurationMs).toBeGreaterThanOrEqual(0);
      expect(result.timestamp).toBeGreaterThan(0);
    });
  });

  // ------------------------------------------
  // Data Persistence
  // ------------------------------------------
  describe("Data Persistence", () => {
    it("should persist changes to localStorage", async () => {
      const params: SyncParams = {
        ...createBaseSyncParams(),
        incomingTokens: [createMockToken("persist1", "5000")],
      };

      await inventorySync(params);

      const stored = getLocalStorage();
      expect(stored).not.toBeNull();
      expect(stored?._meta).toBeDefined();
    });

    it("should increment version on each sync", async () => {
      setLocalStorage(createMockStorageData());

      const params = createBaseSyncParams();

      await inventorySync(params);
      const stored1 = getLocalStorage();
      const version1 = stored1?._meta?.version || 0;

      await inventorySync(params);
      const stored2 = getLocalStorage();
      const version2 = stored2?._meta?.version || 0;

      expect(version2).toBeGreaterThan(version1);
    });
  });

  // ------------------------------------------
  // NAMETAG Mode
  // ------------------------------------------
  describe("NAMETAG Mode", () => {
    it("should return lightweight result in NAMETAG mode", async () => {
      const params: SyncParams = {
        ...createBaseSyncParams(),
        nametag: true,
      };

      const result = await inventorySync(params);

      expect(result.status).toBe("NAMETAG_ONLY");
      expect(result.syncMode).toBe("NAMETAG");
      expect(result.nametags).toBeDefined();
      expect(result.inventoryStats).toBeUndefined();
    });
  });
});

// ==========================================
// Concurrent Sync Scenarios
// ==========================================

describe("Concurrent Sync Behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearLocalStorage();
    mockIpfsAvailable = true;
    mockRemoteData = null;
  });

  it("should handle rapid sequential syncs", async () => {
    const params = createBaseSyncParams();

    // Run 5 syncs rapidly
    const results = await Promise.all([
      inventorySync(params),
      inventorySync(params),
      inventorySync(params),
      inventorySync(params),
      inventorySync(params),
    ]);

    // All should complete successfully
    expect(results.every(r => r.status === "SUCCESS")).toBe(true);
  });

  it("should maintain data integrity under concurrent access", async () => {
    setLocalStorage(createMockStorageData({
      "existing": createMockTxfToken("existing"),
    }));

    const params = createBaseSyncParams();

    // Run concurrent syncs
    await Promise.all([
      inventorySync(params),
      inventorySync(params),
    ]);

    const stored = getLocalStorage();
    expect(stored).not.toBeNull();
  });
});
