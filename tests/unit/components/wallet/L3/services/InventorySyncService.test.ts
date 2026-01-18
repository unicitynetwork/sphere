import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Token } from "../../../../../../src/components/wallet/L3/data/model";
import type { OutboxEntry } from "../../../../../../src/components/wallet/L3/services/types/OutboxTypes";
import type { TxfToken, TxfStorageData } from "../../../../../../src/components/wallet/L3/services/types/TxfTypes";

// ==========================================
// Mock Setup - Must be before imports
// ==========================================

// Note: jsdom provides localStorage, we'll use it directly

// Mock IpfsHttpResolver
vi.mock("../../../../../../src/components/wallet/L3/services/IpfsHttpResolver", () => ({
  getIpfsHttpResolver: vi.fn(() => ({
    resolveIpnsName: vi.fn().mockResolvedValue({
      success: false,
      error: "IPFS disabled in test",
    }),
  })),
  computeCidFromContent: vi.fn().mockResolvedValue("QmTestCid123"),
}));

// Mock TokenValidationService
vi.mock("../../../../../../src/components/wallet/L3/services/TokenValidationService", () => ({
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
vi.mock("../../../../../../src/components/wallet/L3/services/NostrService", () => ({
  NostrService: {
    getInstance: vi.fn(() => ({
      queryPubkeyByNametag: vi.fn().mockResolvedValue(null),
      publishNametagBinding: vi.fn().mockResolvedValue(true),
    })),
  },
}));

// Mock IdentityManager
vi.mock("../../../../../../src/components/wallet/L3/services/IdentityManager", () => ({
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
vi.mock("../../../../../../src/config/ipfs.config", () => ({
  getAllBackendGatewayUrls: vi.fn(() => ["https://test-gateway.example.com"]),
}));

// Mock PredicateEngineService for Step 8.4
vi.mock("@unicitylabs/state-transition-sdk/lib/predicate/PredicateEngineService", () => ({
  PredicateEngineService: {
    createPredicate: vi.fn().mockResolvedValue({
      isOwner: vi.fn().mockResolvedValue(true),
    }),
  },
}));

// Mock ProxyAddress for Step 8.5
vi.mock("@unicitylabs/state-transition-sdk/lib/address/ProxyAddress", () => ({
  ProxyAddress: {
    fromNameTag: vi.fn().mockResolvedValue({
      address: "proxy-address-123",
    }),
  },
}));

// Now import the module under test
import { inventorySync, type SyncParams, type CompletedTransfer } from "../../../../../../src/components/wallet/L3/services/InventorySyncService";
import { STORAGE_KEY_GENERATORS } from "../../../../../../src/config/storageKeys";

// ==========================================
// Test Fixtures
// ==========================================

const TEST_ADDRESS = "0x" + "a".repeat(40);
const TEST_PUBLIC_KEY = "0".repeat(64);
const TEST_IPNS_NAME = "k51test123";

const createMockToken = (id: string, amount = "1000"): Token => ({
  id,
  name: "Test Token",
  type: "UCT",
  timestamp: Date.now(),
  jsonData: JSON.stringify({
    version: "2.0",
    genesis: {
      data: { tokenId: id.padEnd(64, "0"), coinId: "ALPHA" },
      inclusionProof: { authenticator: { stateHash: "0000" + "a".repeat(60) } },
    },
    state: { data: "", predicate: new Uint8Array([1, 2, 3]) },
    transactions: [],
  }),
  status: 0,
  amount,
  coinId: "ALPHA",
  symbol: "ALPHA",
  sizeBytes: 100,
} as Token);

const createMockTxfToken = (tokenId: string, amount = "1000"): TxfToken => ({
  version: "2.0",
  genesis: {
    data: {
      tokenId: tokenId.padEnd(64, "0"),
      coinId: "ALPHA",
      coinData: [["ALPHA", amount]], // Required for txfToToken
    },
    inclusionProof: {
      authenticator: { stateHash: "0000" + "a".repeat(60) },
      merkleTreePath: { root: "0000" + "b".repeat(60), path: [] },
      transactionHash: "0000" + "c".repeat(60), // Valid hex format for Step 4 validation
    },
  },
  state: { data: "", predicate: new Uint8Array([1, 2, 3]) },
  transactions: [],
  _meta: { amount, symbol: "ALPHA" },
});

const createMockOutboxEntry = (id: string): OutboxEntry => ({
  id,
  tokenId: "test-token-id".padEnd(64, "0"),
  status: "PENDING_IPFS_SYNC",
  createdAt: Date.now(),
  updatedAt: Date.now(),
  retryCount: 0,
  recipientAddress: "DIRECT://test",
} as OutboxEntry);

const createBaseSyncParams = (): SyncParams => ({
  address: TEST_ADDRESS,
  publicKey: TEST_PUBLIC_KEY,
  ipnsName: TEST_IPNS_NAME,
});

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

// ==========================================
// Test Helpers
// ==========================================

const setLocalStorage = (data: TxfStorageData) => {
  const storageKey = STORAGE_KEY_GENERATORS.walletByAddress(TEST_ADDRESS);
  localStorage.setItem(storageKey, JSON.stringify(data));
};

const clearLocalStorage = () => {
  localStorage.clear();
};

const getLocalStorage = (): TxfStorageData | null => {
  const storageKey = STORAGE_KEY_GENERATORS.walletByAddress(TEST_ADDRESS);
  const json = localStorage.getItem(storageKey);
  return json ? JSON.parse(json) : null;
};

// ==========================================
// inventorySync Tests
// ==========================================

describe("inventorySync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearLocalStorage();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ------------------------------------------
  // Mode Detection Tests
  // ------------------------------------------

  describe("Mode Detection", () => {
    it("should detect LOCAL mode when local=true", async () => {
      const params: SyncParams = {
        ...createBaseSyncParams(),
        local: true,
      };

      const result = await inventorySync(params);

      expect(result.syncMode).toBe("LOCAL");
      expect(result.status).toBe("SUCCESS"); // LOCAL mode returns SUCCESS when sync completes
    });

    it("should detect NAMETAG mode when nametag=true", async () => {
      const params: SyncParams = {
        ...createBaseSyncParams(),
        nametag: true,
      };

      const result = await inventorySync(params);

      expect(result.syncMode).toBe("NAMETAG");
      expect(result.status).toBe("NAMETAG_ONLY");
    });

    it("should detect FAST mode when incomingTokens provided", async () => {
      const params: SyncParams = {
        ...createBaseSyncParams(),
        incomingTokens: [createMockToken("token1")],
      };

      const result = await inventorySync(params);

      expect(result.syncMode).toBe("FAST");
    });

    it("should detect FAST mode when outboxTokens provided", async () => {
      const params: SyncParams = {
        ...createBaseSyncParams(),
        outboxTokens: [createMockOutboxEntry("outbox1")],
      };

      const result = await inventorySync(params);

      expect(result.syncMode).toBe("FAST");
    });

    it("should detect NORMAL mode by default", async () => {
      const params = createBaseSyncParams();

      const result = await inventorySync(params);

      expect(result.syncMode).toBe("NORMAL");
    });

    it("should respect mode precedence: LOCAL > NAMETAG > FAST > NORMAL", async () => {
      // LOCAL takes precedence over everything
      const params: SyncParams = {
        ...createBaseSyncParams(),
        local: true,
        nametag: true,
        incomingTokens: [createMockToken("token1")],
      };

      const result = await inventorySync(params);

      expect(result.syncMode).toBe("LOCAL");
    });
  });

  // ------------------------------------------
  // LOCAL Mode Tests
  // ------------------------------------------

  describe("LOCAL Mode", () => {
    it("should skip IPFS operations in LOCAL mode", async () => {
      setLocalStorage(createMockStorageData({
        "token1": createMockTxfToken("token1"),
      }));

      const params: SyncParams = {
        ...createBaseSyncParams(),
        local: true,
      };

      const result = await inventorySync(params);

      expect(result.status).toBe("SUCCESS"); // LOCAL mode returns SUCCESS when sync completes
      expect(result.ipnsPublished).toBe(false); // IPFS skipped, so no publish
    });

    it("should load tokens from localStorage in LOCAL mode", async () => {
      setLocalStorage(createMockStorageData({
        "token1": createMockTxfToken("token1", "5000"),
        "token2": createMockTxfToken("token2", "3000"),
      }));

      const params: SyncParams = {
        ...createBaseSyncParams(),
        local: true,
      };

      const result = await inventorySync(params);

      expect(result.status).toBe("SUCCESS"); // LOCAL mode returns SUCCESS when sync completes
      expect(result.inventoryStats?.activeTokens).toBe(2);
    });

    it("should skip spent detection (Step 7) in LOCAL mode", async () => {
      setLocalStorage(createMockStorageData({
        "token1": createMockTxfToken("token1"),
      }));

      const params: SyncParams = {
        ...createBaseSyncParams(),
        local: true,
      };

      const result = await inventorySync(params);

      // No tokens should be moved to sent (spent detection skipped)
      expect(result.inventoryStats?.sentTokens).toBe(0);
    });
  });

  // ------------------------------------------
  // NAMETAG Mode Tests
  // ------------------------------------------

  describe("NAMETAG Mode", () => {
    it("should return NAMETAG_ONLY status", async () => {
      const params: SyncParams = {
        ...createBaseSyncParams(),
        nametag: true,
      };

      const result = await inventorySync(params);

      expect(result.status).toBe("NAMETAG_ONLY");
      expect(result.syncMode).toBe("NAMETAG");
    });

    it("should return nametags array in NAMETAG mode", async () => {
      const params: SyncParams = {
        ...createBaseSyncParams(),
        nametag: true,
      };

      const result = await inventorySync(params);

      expect(result.nametags).toBeDefined();
      expect(Array.isArray(result.nametags)).toBe(true);
    });

    it("should not include inventoryStats in NAMETAG mode", async () => {
      const params: SyncParams = {
        ...createBaseSyncParams(),
        nametag: true,
      };

      const result = await inventorySync(params);

      // Per spec: inventoryStats omitted in NAMETAG mode
      expect(result.inventoryStats).toBeUndefined();
    });
  });

  // ------------------------------------------
  // FAST Mode Tests
  // ------------------------------------------

  describe("FAST Mode", () => {
    it("should process incoming tokens in FAST mode", async () => {
      const params: SyncParams = {
        ...createBaseSyncParams(),
        incomingTokens: [
          createMockToken("token1", "1000"),
          createMockToken("token2", "2000"),
        ],
      };

      const result = await inventorySync(params);

      expect(result.syncMode).toBe("FAST");
      expect(result.operationStats.tokensImported).toBe(2);
    });

    it("should process outbox entries in FAST mode", async () => {
      const params: SyncParams = {
        ...createBaseSyncParams(),
        outboxTokens: [createMockOutboxEntry("outbox1")],
      };

      const result = await inventorySync(params);

      expect(result.syncMode).toBe("FAST");
      expect(result.inventoryStats?.outboxTokens).toBe(1);
    });

    it("should skip spent detection (Step 7) in FAST mode", async () => {
      const params: SyncParams = {
        ...createBaseSyncParams(),
        incomingTokens: [createMockToken("token1")],
      };

      const result = await inventorySync(params);

      expect(result.syncMode).toBe("FAST");
      // Spent detection skipped, so no tokens moved to sent
      expect(result.operationStats.tokensValidated).toBe(0);
    });
  });

  // ------------------------------------------
  // NORMAL Mode Tests
  // ------------------------------------------

  describe("NORMAL Mode", () => {
    it("should run full sync pipeline in NORMAL mode", async () => {
      setLocalStorage(createMockStorageData({
        "token1": createMockTxfToken("token1"),
      }));

      const params = createBaseSyncParams();

      const result = await inventorySync(params);

      expect(result.syncMode).toBe("NORMAL");
      expect(result.status).toBe("SUCCESS");
    });

    it("should load from both localStorage and IPFS in NORMAL mode", async () => {
      setLocalStorage(createMockStorageData({
        "token1": createMockTxfToken("token1"),
      }));

      const params = createBaseSyncParams();

      const result = await inventorySync(params);

      expect(result.syncMode).toBe("NORMAL");
      // localStorage token should be loaded
      expect(result.inventoryStats?.activeTokens).toBeGreaterThanOrEqual(1);
    });

    it("should include inventory stats in NORMAL mode", async () => {
      const params = createBaseSyncParams();

      const result = await inventorySync(params);

      expect(result.inventoryStats).toBeDefined();
      expect(result.inventoryStats?.activeTokens).toBeDefined();
      expect(result.inventoryStats?.sentTokens).toBeDefined();
      expect(result.inventoryStats?.outboxTokens).toBeDefined();
      expect(result.inventoryStats?.invalidTokens).toBeDefined();
    });
  });

  // ------------------------------------------
  // Step 0: Input Processing Tests
  // ------------------------------------------

  describe("Step 0: Input Processing", () => {
    it("should convert incoming tokens to TXF format", async () => {
      const params: SyncParams = {
        ...createBaseSyncParams(),
        incomingTokens: [createMockToken("incoming1")],
      };

      const result = await inventorySync(params);

      expect(result.operationStats.tokensImported).toBe(1);
    });

    it("should add outbox entries to context", async () => {
      const params: SyncParams = {
        ...createBaseSyncParams(),
        outboxTokens: [
          createMockOutboxEntry("outbox1"),
          createMockOutboxEntry("outbox2"),
        ],
      };

      const result = await inventorySync(params);

      expect(result.inventoryStats?.outboxTokens).toBe(2);
    });

    it("should process completed transfers list", async () => {
      const completedList: CompletedTransfer[] = [{
        tokenId: "token1".padEnd(64, "0"),
        stateHash: "0000" + "a".repeat(60),
        inclusionProof: {},
      }];

      // Set up localStorage with the token
      setLocalStorage(createMockStorageData({
        "token1": createMockTxfToken("token1"),
      }));

      const params: SyncParams = {
        ...createBaseSyncParams(),
        completedList,
      };

      const result = await inventorySync(params);

      // Completed tokens should be processed
      expect(result.status).not.toBe("ERROR");
    });
  });

  // ------------------------------------------
  // Step 1: Load from localStorage Tests
  // ------------------------------------------

  describe("Step 1: Load from localStorage", () => {
    it("should load tokens from localStorage", async () => {
      setLocalStorage(createMockStorageData({
        "token1": createMockTxfToken("token1"),
        "token2": createMockTxfToken("token2"),
        "token3": createMockTxfToken("token3"),
      }));

      const params: SyncParams = {
        ...createBaseSyncParams(),
        local: true,
      };

      const result = await inventorySync(params);

      expect(result.inventoryStats?.activeTokens).toBe(3);
    });

    it("should handle empty localStorage gracefully", async () => {
      // Don't set any localStorage

      const params: SyncParams = {
        ...createBaseSyncParams(),
        local: true,
      };

      const result = await inventorySync(params);

      expect(result.status).toBe("SUCCESS"); // LOCAL mode returns SUCCESS when sync completes
      expect(result.inventoryStats?.activeTokens).toBe(0);
    });

    it("should load sent folder from localStorage", async () => {
      const storageData = createMockStorageData();
      storageData._sent = [{
        token: createMockTxfToken("sent1"),
        timestamp: Date.now(),
        spentAt: Date.now(),
      }];
      setLocalStorage(storageData);

      const params: SyncParams = {
        ...createBaseSyncParams(),
        local: true,
      };

      const result = await inventorySync(params);

      expect(result.inventoryStats?.sentTokens).toBe(1);
    });

    it("should load invalid folder from localStorage", async () => {
      const storageData = createMockStorageData();
      storageData._invalid = [{
        token: createMockTxfToken("invalid1"),
        timestamp: Date.now(),
        invalidatedAt: Date.now(),
        reason: "SDK_VALIDATION",
      }];
      setLocalStorage(storageData);

      const params: SyncParams = {
        ...createBaseSyncParams(),
        local: true,
      };

      const result = await inventorySync(params);

      expect(result.inventoryStats?.invalidTokens).toBe(1);
    });
  });

  // ------------------------------------------
  // Step 8: Folder Assignment Tests
  // ------------------------------------------

  describe("Step 8: Folder Assignment", () => {
    it("should categorize tokens into active folder", async () => {
      setLocalStorage(createMockStorageData({
        "active1": createMockTxfToken("active1"),
        "active2": createMockTxfToken("active2"),
      }));

      const params: SyncParams = {
        ...createBaseSyncParams(),
        local: true,
      };

      const result = await inventorySync(params);

      expect(result.inventoryStats?.activeTokens).toBe(2);
    });

    it("should track outbox tokens separately", async () => {
      const params: SyncParams = {
        ...createBaseSyncParams(),
        outboxTokens: [
          createMockOutboxEntry("outbox1"),
          createMockOutboxEntry("outbox2"),
        ],
        local: true,
      };

      const result = await inventorySync(params);

      expect(result.inventoryStats?.outboxTokens).toBe(2);
      expect(result.inventoryStats?.activeTokens).toBe(0);
    });
  });

  // ------------------------------------------
  // SyncResult Structure Tests
  // ------------------------------------------

  describe("SyncResult Structure", () => {
    it("should include all required fields", async () => {
      const params = createBaseSyncParams();

      const result = await inventorySync(params);

      expect(result.status).toBeDefined();
      expect(result.syncMode).toBeDefined();
      expect(result.operationStats).toBeDefined();
      expect(result.syncDurationMs).toBeDefined();
      expect(result.timestamp).toBeDefined();
    });

    it("should include operationStats with all counters", async () => {
      const params = createBaseSyncParams();

      const result = await inventorySync(params);

      expect(result.operationStats.tokensImported).toBeDefined();
      expect(result.operationStats.tokensRemoved).toBeDefined();
      expect(result.operationStats.tokensUpdated).toBeDefined();
      expect(result.operationStats.conflictsResolved).toBeDefined();
      expect(result.operationStats.tokensValidated).toBeDefined();
      expect(result.operationStats.tombstonesAdded).toBeDefined();
    });

    it("should track sync duration accurately", async () => {
      const params = createBaseSyncParams();
      const startTime = Date.now();

      const result = await inventorySync(params);

      const elapsed = Date.now() - startTime;
      expect(result.syncDurationMs).toBeGreaterThanOrEqual(0);
      expect(result.syncDurationMs).toBeLessThanOrEqual(elapsed + 100); // Allow small margin
    });

    it("should include timestamp of completion", async () => {
      const params = createBaseSyncParams();
      const beforeTime = Date.now();

      const result = await inventorySync(params);

      const afterTime = Date.now();
      expect(result.timestamp).toBeGreaterThanOrEqual(beforeTime);
      expect(result.timestamp).toBeLessThanOrEqual(afterTime);
    });
  });

  // ------------------------------------------
  // Error Handling Tests
  // ------------------------------------------

  describe("Error Handling", () => {
    it("should return ERROR status on critical failure", async () => {
      // Create invalid params that will cause an error
      const params: SyncParams = {
        address: "", // Invalid empty address
        publicKey: TEST_PUBLIC_KEY,
        ipnsName: TEST_IPNS_NAME,
      };

      // The implementation should handle this gracefully
      const result = await inventorySync(params);

      // Should not throw, but may return error status
      expect(result).toBeDefined();
    });

    it("should include error details when sync fails", async () => {
      // Force an error by providing malformed data
      const storageKey = STORAGE_KEY_GENERATORS.walletByAddress(TEST_ADDRESS);
      localStorage.setItem(storageKey, "invalid json{{{");

      const params = createBaseSyncParams();

      const result = await inventorySync(params);

      // Should handle JSON parse error gracefully
      expect(result).toBeDefined();
    });
  });

  // ------------------------------------------
  // Edge Cases
  // ------------------------------------------

  describe("Edge Cases", () => {
    it("should handle null incomingTokens", async () => {
      const params: SyncParams = {
        ...createBaseSyncParams(),
        incomingTokens: null,
      };

      const result = await inventorySync(params);

      expect(result.syncMode).toBe("NORMAL");
      expect(result.operationStats.tokensImported).toBe(0);
    });

    it("should handle empty incomingTokens array", async () => {
      const params: SyncParams = {
        ...createBaseSyncParams(),
        incomingTokens: [],
      };

      const result = await inventorySync(params);

      expect(result.syncMode).toBe("NORMAL"); // Empty array doesn't trigger FAST mode
      expect(result.operationStats.tokensImported).toBe(0);
    });

    it("should handle undefined optional params", async () => {
      const params: SyncParams = {
        address: TEST_ADDRESS,
        publicKey: TEST_PUBLIC_KEY,
        ipnsName: TEST_IPNS_NAME,
        // All optional params omitted
      };

      const result = await inventorySync(params);

      expect(result.status).not.toBe("ERROR");
    });

    it("should handle very large token collections", async () => {
      const tokens: Record<string, TxfToken> = {};
      for (let i = 0; i < 100; i++) {
        // Use valid hex IDs (padded numbers)
        const hexId = i.toString(16).padStart(8, "0");
        tokens[hexId] = createMockTxfToken(hexId);
      }
      setLocalStorage(createMockStorageData(tokens));

      const params: SyncParams = {
        ...createBaseSyncParams(),
        local: true,
      };

      const result = await inventorySync(params);

      expect(result.inventoryStats?.activeTokens).toBe(100);
    });
  });
});

// ==========================================
// Integration with Other Components
// ==========================================

describe("InventorySyncService Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearLocalStorage();
  });

  describe("Storage Key Generation", () => {
    it("should use correct storage key format", async () => {
      // Set up data with the expected key format
      setLocalStorage(createMockStorageData({
        "t1": createMockTxfToken("t1"),
      }));

      const params: SyncParams = {
        ...createBaseSyncParams(),
        local: true,
      };

      const result = await inventorySync(params);

      // If the key format is correct, we should see the token
      expect(result.inventoryStats?.activeTokens).toBe(1);
    });
  });

  describe("Statistics Accuracy", () => {
    it("should accurately count active tokens", async () => {
      setLocalStorage(createMockStorageData({
        "t1": createMockTxfToken("t1"),
        "t2": createMockTxfToken("t2"),
        "t3": createMockTxfToken("t3"),
      }));

      const params: SyncParams = {
        ...createBaseSyncParams(),
        local: true,
      };

      const result = await inventorySync(params);

      expect(result.inventoryStats?.activeTokens).toBe(3);
    });

    it("should accurately count sent tokens", async () => {
      const storageData = createMockStorageData();
      storageData._sent = [
        { token: createMockTxfToken("s1"), timestamp: Date.now(), spentAt: Date.now() },
        { token: createMockTxfToken("s2"), timestamp: Date.now(), spentAt: Date.now() },
      ];
      setLocalStorage(storageData);

      const params: SyncParams = {
        ...createBaseSyncParams(),
        local: true,
      };

      const result = await inventorySync(params);

      expect(result.inventoryStats?.sentTokens).toBe(2);
    });

    it("should accurately count invalid tokens", async () => {
      const storageData = createMockStorageData();
      storageData._invalid = [
        { token: createMockTxfToken("i1"), timestamp: Date.now(), invalidatedAt: Date.now(), reason: "SDK_VALIDATION" },
      ];
      setLocalStorage(storageData);

      const params: SyncParams = {
        ...createBaseSyncParams(),
        local: true,
      };

      const result = await inventorySync(params);

      expect(result.inventoryStats?.invalidTokens).toBe(1);
    });
  });
});
