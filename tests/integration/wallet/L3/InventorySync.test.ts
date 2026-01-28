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
import type { TxfToken, TxfStorageData, SentTokenEntry, InvalidTokenEntry } from "../../../../src/components/wallet/L3/services/types/TxfTypes";
import type { OutboxEntry } from "../../../../src/components/wallet/L3/services/types/OutboxTypes";

// ==========================================
// Configurable Mock Setup
// ==========================================

// These variables allow per-test configuration of mock behavior
let mockValidationResult: { valid: boolean; issues: Array<{ tokenId: string; reason: string }> } = { valid: true, issues: [] };
let mockSpentTokens: Array<{ tokenId: string; stateHash: string; localId: string }> = [];
let mockIpfsAvailable = true;
let mockRemoteData: TxfStorageData | null = null;

// Mock IpfsHttpResolver with configurable response
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
    isWebSocketConnected: vi.fn().mockReturnValue(false),
  })),
  computeCidFromContent: vi.fn().mockResolvedValue("QmTestCid123"),
}));

// Mock TokenValidationService with configurable per-test results
vi.mock("../../../../src/components/wallet/L3/services/TokenValidationService", () => ({
  getTokenValidationService: vi.fn(() => ({
    validateAllTokens: vi.fn().mockImplementation(async (tokens: Token[]) => {
      return {
        valid: mockValidationResult.valid,
        validTokens: mockValidationResult.valid ? tokens : tokens.filter(t =>
          !mockValidationResult.issues.some(i => t.id === i.tokenId || t.id.includes(i.tokenId))
        ),
        issues: mockValidationResult.issues.map(i => ({
          tokenId: i.tokenId,
          reason: i.reason,
        })),
      };
    }),
    checkSpentTokens: vi.fn().mockImplementation(async () => {
      return {
        spentTokens: mockSpentTokens,
        errors: [],
      };
    }),
    // Mock for Step 7.5: isTokenStateSpent
    // Returns true if tokenId+stateHash is in mockSpentTokens
    isTokenStateSpent: vi.fn().mockImplementation(async (tokenId: string, stateHash: string) => {
      return mockSpentTokens.some(s => s.tokenId === tokenId && s.stateHash === stateHash);
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

// Mock IpfsStorageService - getIpfsTransport throws to force fallback to HTTP resolver
// This ensures the existing IpfsHttpResolver mock is used for tests
vi.mock("../../../../src/components/wallet/L3/services/IpfsStorageService", () => ({
  getIpfsTransport: vi.fn(() => {
    throw new Error("Transport not available in test - using HTTP resolver fallback");
  }),
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
import { resetInventoryStorage } from "../../../../src/components/wallet/L3/services/storage/InventoryStorageAdapter";

// ==========================================
// Test Fixtures
// ==========================================

const TEST_ADDRESS = "0x" + "a".repeat(40);
const TEST_PUBLIC_KEY = "0".repeat(64);
const TEST_IPNS_NAME = "k51test123";

// Default stateHash used for genesis-only tokens
const DEFAULT_STATE_HASH = "0000" + "a".repeat(60);

const createMockTxfToken = (tokenId: string, amount = "1000", txCount = 0): TxfToken => {
  const transactions = [];

  // Build proper state hash chain for transactions
  // First tx links to genesis, subsequent txs link to previous
  let prevStateHash = DEFAULT_STATE_HASH; // Genesis stateHash

  for (let i = 0; i < txCount; i++) {
    const newStateHash = "0000" + (i + 1).toString().padStart(4, "0").padEnd(60, "0");
    transactions.push({
      data: { recipient: "recipient" + i },
      previousStateHash: prevStateHash,
      newStateHash: newStateHash,
      inclusionProof: {
        authenticator: { stateHash: newStateHash },
        merkleTreePath: { root: "0000" + "b".repeat(60), path: [] },
        transactionHash: "0000" + "d".repeat(60),
      },
    });
    prevStateHash = newStateHash;
  }

  // Current stateHash is the last tx's newStateHash, or genesis if no txs
  const currentStateHash = txCount > 0 ? prevStateHash : DEFAULT_STATE_HASH;

  return {
    version: "2.0",
    genesis: {
      data: {
        tokenId: tokenId.padEnd(64, "0"),
        coinId: "ALPHA",
        coinData: [["ALPHA", amount]],
      },
      inclusionProof: {
        authenticator: { stateHash: DEFAULT_STATE_HASH },
        merkleTreePath: { root: "0000" + "b".repeat(60), path: [] },
        transactionHash: "0000" + "c".repeat(60),
      },
    },
    state: { data: "", predicate: new Uint8Array([1, 2, 3]) },
    transactions,
    // Add _integrity with currentStateHash
    _integrity: {
      currentStateHash: currentStateHash,
      genesisDataJSONHash: "0000" + "e".repeat(60),
    },
  } as TxfToken;
};

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
  _meta: {
    version: 1,
    address: TEST_ADDRESS,
    ipnsName: TEST_IPNS_NAME,
    formatVersion: '2.0',
  },
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

const resetMocks = () => {
  mockValidationResult = { valid: true, issues: [] };
  mockSpentTokens = [];
  mockIpfsAvailable = true;
  mockRemoteData = null;
};

// Count token keys in storage (excluding special folders)
const countTokensInStorage = (storage: TxfStorageData | null): number => {
  if (!storage) return 0;
  return Object.keys(storage).filter(k =>
    k.startsWith("_") &&
    !k.startsWith("_meta") &&
    !k.startsWith("_sent") &&
    !k.startsWith("_invalid") &&
    !k.startsWith("_outbox") &&
    !k.startsWith("_tombstones") &&
    !k.startsWith("_nametag")
  ).length;
};

// ==========================================
// Integration Tests
// ==========================================

describe("Token Inventory Sync Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetInventoryStorage();  // Reset storage adapter singleton before each test
    clearLocalStorage();
    resetMocks();
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

      expect(result.status).toMatch(/^(SUCCESS|PARTIAL_SUCCESS)$/);
      expect(result.inventoryStats?.activeTokens).toBe(0);
      expect(result.inventoryStats?.sentTokens).toBe(0);
      expect(result.inventoryStats?.invalidTokens).toBe(0);

      // Verify localStorage was created with empty inventory
      const stored = getLocalStorage();
      expect(stored).not.toBeNull();
      expect(stored?._meta).toBeDefined();
      expect(countTokensInStorage(stored)).toBe(0);
    });

    it("should import tokens from remote when local is empty", async () => {
      // Set up remote data with one token
      mockIpfsAvailable = true;
      mockRemoteData = createMockStorageData({
        "abc123": createMockTxfToken("abc123", "5000"),
      });

      const params = createBaseSyncParams();

      const result = await inventorySync(params);

      expect(result.status).toMatch(/^(SUCCESS|PARTIAL_SUCCESS)$/);
      expect(result.inventoryStats?.activeTokens).toBe(1);

      // VERIFY: Token was actually written to localStorage
      const stored = getLocalStorage();
      expect(stored).not.toBeNull();
      const tokenKey = Object.keys(stored || {}).find(k => k.includes("abc123"));
      expect(tokenKey).toBeDefined();

      // VERIFY: Token data matches remote
      const token = stored?.[tokenKey!] as TxfToken;
      expect(token.genesis?.data?.coinData[0][1]).toBe("5000");
      expect(token.genesis?.data?.tokenId).toBe("abc123".padEnd(64, "0"));
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

      // Should succeed with local data only
      expect(result.status).toMatch(/^(SUCCESS|PARTIAL_SUCCESS)$/);
      expect(result.inventoryStats?.activeTokens).toBe(2);

      // VERIFY: Both tokens preserved in localStorage
      const stored = getLocalStorage();
      expect(countTokensInStorage(stored)).toBe(2);
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

      expect(result.status).toMatch(/^(SUCCESS|PARTIAL_SUCCESS)$/);
      expect(result.syncMode).toBe("LOCAL");
      expect(result.inventoryStats?.activeTokens).toBe(1);

      // VERIFY: Token still in localStorage
      const stored = getLocalStorage();
      expect(countTokensInStorage(stored)).toBe(1);
    });

    it("should set ipnsPublished=false when IPFS upload fails", async () => {
      mockIpfsAvailable = false;

      setLocalStorage(createMockStorageData({
        "token1": createMockTxfToken("token1"),
      }));

      const params = createBaseSyncParams();

      const result = await inventorySync(params);

      expect(result.ipnsPublished).toBe(false);
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
      expect(result.inventoryStats?.activeTokens).toBe(2);

      // VERIFY: Tokens actually in localStorage
      const stored = getLocalStorage();
      expect(countTokensInStorage(stored)).toBe(2);
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

      // VERIFY: Both tokens in localStorage
      const stored = getLocalStorage();
      expect(countTokensInStorage(stored)).toBe(2);

      // VERIFY: Both token IDs present
      const keys = Object.keys(stored || {});
      expect(keys.some(k => k.includes("existing1"))).toBe(true);
      expect(keys.some(k => k.includes("incoming1"))).toBe(true);
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
      expect(result.syncMode).toBe("FAST");
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
        timestamp: Date.now() - 10000,
        spentAt: Date.now() - 10000,
      }];
      setLocalStorage(storageData);

      const params = createBaseSyncParams();

      const result = await inventorySync(params);

      expect(result.inventoryStats?.sentTokens).toBe(1);
      expect(result.inventoryStats?.activeTokens).toBe(1);

      // VERIFY: Sent token preserved in localStorage
      const stored = getLocalStorage();
      expect(stored?._sent?.length).toBe(1);
      expect((stored?._sent?.[0] as SentTokenEntry)?.token?.genesis?.data?.tokenId).toContain("sent1");
    });

    it("should preserve sent token metadata (timestamp, spentAt)", async () => {
      const originalTimestamp = Date.now() - 10000;
      const originalSpentAt = Date.now() - 9000;

      const storageData = createMockStorageData();
      storageData._sent = [{
        token: createMockTxfToken("sent1"),
        timestamp: originalTimestamp,
        spentAt: originalSpentAt,
      }];
      setLocalStorage(storageData);

      const params = createBaseSyncParams();

      // First sync
      await inventorySync(params);

      // Second sync - should preserve metadata
      await inventorySync(params);

      const stored = getLocalStorage();
      const sentEntry = stored?._sent?.[0] as SentTokenEntry;
      expect(sentEntry.timestamp).toBe(originalTimestamp);
      expect(sentEntry.spentAt).toBe(originalSpentAt);
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

      // VERIFY: Invalid token preserved in localStorage
      const stored = getLocalStorage();
      expect(stored?._invalid?.length).toBe(1);
      expect((stored?._invalid?.[0] as InvalidTokenEntry)?.reason).toBe("SDK_VALIDATION");
    });

    it("should move newly invalid tokens to Invalid folder", async () => {
      // Use unpadded tokenId to match storage key format
      // ctx.tokens uses tokenIdFromKey(key) which strips underscore but keeps unpadded ID
      const invalidTokenId = "willbeinvalid";

      // Configure mock to report this token as invalid
      mockValidationResult = {
        valid: false,
        issues: [{ tokenId: invalidTokenId, reason: "Signature verification failed" }],
      };

      setLocalStorage(createMockStorageData({
        "willbeinvalid": createMockTxfToken("willbeinvalid"),
        "stillvalid": createMockTxfToken("stillvalid"),
      }));

      const params = createBaseSyncParams();

      const result = await inventorySync(params);

      // One valid, one invalid
      expect(result.inventoryStats?.activeTokens).toBe(1);
      expect(result.inventoryStats?.invalidTokens).toBe(1);

      // VERIFY: Invalid folder has the correct token with details
      const stored = getLocalStorage();
      expect(stored?._invalid?.length).toBe(1);
      const invalidEntry = stored?._invalid?.[0] as InvalidTokenEntry;
      expect(invalidEntry.reason).toBe("SDK_VALIDATION");
      expect(invalidEntry.details).toBe("Signature verification failed");
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
      expect(fastResult.inventoryStats?.activeTokens).toBe(1);

      // Then NORMAL sync
      const normalParams = createBaseSyncParams();
      const normalResult = await inventorySync(normalParams);

      expect(normalResult.syncMode).toBe("NORMAL");
      expect(normalResult.inventoryStats?.activeTokens).toBe(1);

      // VERIFY: Token persisted across mode change
      const stored = getLocalStorage();
      expect(countTokensInStorage(stored)).toBe(1);
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

      // VERIFY: Data consistent
      const stored = getLocalStorage();
      expect(countTokensInStorage(stored)).toBe(1);
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

      // VERIFY: All 3 tokens in storage
      const stored = getLocalStorage();
      expect(countTokensInStorage(stored)).toBe(3);
    });

    it("should track sync duration accurately", async () => {
      const params = createBaseSyncParams();
      const startTime = Date.now();

      const result = await inventorySync(params);

      const endTime = Date.now();

      expect(typeof result.syncDurationMs).toBe("number");
      expect(result.syncDurationMs).toBeGreaterThanOrEqual(0);
      expect(result.syncDurationMs).toBeLessThanOrEqual(endTime - startTime + 100);

      expect(typeof result.timestamp).toBe("number");
      expect(result.timestamp).toBeGreaterThanOrEqual(startTime);
      expect(result.timestamp).toBeLessThanOrEqual(endTime + 100);
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
      expect(typeof stored?._meta?.version).toBe("number");

      // VERIFY: Token with correct amount - amount is in genesis.data.coinData
      const tokenKey = Object.keys(stored || {}).find(k => k.includes("persist1"));
      expect(tokenKey).toBeDefined();
      const token = stored?.[tokenKey!] as TxfToken;
      expect(token.genesis?.data?.coinData[0][1]).toBe("5000");
    });

    it("should NOT increment version when content unchanged", async () => {
      setLocalStorage(createMockStorageData());
      const initialVersion = getLocalStorage()?._meta?.version || 0;

      const params = createBaseSyncParams();

      // First sync - version stays same (content matches existing localStorage)
      await inventorySync(params);
      const v1 = getLocalStorage()?._meta?.version || 0;
      expect(v1).toBe(initialVersion);

      // Subsequent syncs - version still unchanged (no content changes)
      await inventorySync(params);
      const v2 = getLocalStorage()?._meta?.version || 0;
      expect(v2).toBe(v1);

      await inventorySync(params);
      const v3 = getLocalStorage()?._meta?.version || 0;
      expect(v3).toBe(v2);
    });

    it("should increment version when content changes", async () => {
      setLocalStorage(createMockStorageData());
      const initialVersion = getLocalStorage()?._meta?.version || 0;

      const params = createBaseSyncParams();

      // Add token - version should increment
      await inventorySync({
        ...params,
        incomingTokens: [createMockToken("token1")],
      });
      const v1 = getLocalStorage()?._meta?.version || 0;
      expect(v1).toBe(initialVersion + 1);

      // Add another token - version should increment again
      await inventorySync({
        ...params,
        incomingTokens: [createMockToken("token2")],
      });
      const v2 = getLocalStorage()?._meta?.version || 0;
      expect(v2).toBe(v1 + 1);
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
      expect(Array.isArray(result.nametags)).toBe(true);
      expect(result.inventoryStats).toBeUndefined();
    });

    it("should skip validation in NAMETAG mode", async () => {
      // Even with invalid tokens configured, NAMETAG mode should skip validation
      mockValidationResult = {
        valid: false,
        issues: [{ tokenId: "some-token", reason: "Should be skipped" }],
      };

      setLocalStorage(createMockStorageData({
        "token1": createMockTxfToken("token1"),
      }));

      const params: SyncParams = {
        ...createBaseSyncParams(),
        nametag: true,
      };

      const result = await inventorySync(params);

      // Should succeed (NAMETAG mode doesn't run validation)
      expect(result.status).toBe("NAMETAG_ONLY");
      expect(result.inventoryStats).toBeUndefined();
    });
  });

  // ------------------------------------------
  // Spent Detection in NORMAL mode
  // ------------------------------------------
  describe("Spent Detection (NORMAL mode)", () => {
    it("should move spent tokens to Sent folder", async () => {
      const spentTokenId = "spent1".padEnd(64, "0");
      const spentStateHash = "0000" + "a".repeat(60);

      mockSpentTokens = [{
        tokenId: spentTokenId,
        stateHash: spentStateHash,
        localId: "spent1",
      }];

      setLocalStorage(createMockStorageData({
        "spent1": createMockTxfToken("spent1"),
        "active1": createMockTxfToken("active1"),
      }));

      const params = createBaseSyncParams();
      const result = await inventorySync(params);

      expect(result.inventoryStats?.sentTokens).toBe(1);
      expect(result.inventoryStats?.activeTokens).toBe(1);

      // VERIFY: Correct tokens in correct folders
      const stored = getLocalStorage();
      expect(stored?._sent?.length).toBe(1);
      expect(countTokensInStorage(stored)).toBe(1); // Only active token

      // VERIFY: Sent token has correct tokenId
      const sentEntry = stored?._sent?.[0] as SentTokenEntry;
      expect(sentEntry.token?.genesis?.data?.tokenId).toBe(spentTokenId);
    });

    it("should add to Sent folder for spent token", async () => {
      const spentTokenId = "tomb1".padEnd(64, "0");
      const spentStateHash = "0000" + "a".repeat(60);

      mockSpentTokens = [{
        tokenId: spentTokenId,
        stateHash: spentStateHash,
        localId: "tomb1",
      }];

      setLocalStorage(createMockStorageData({
        "tomb1": createMockTxfToken("tomb1"),
      }));

      const params = createBaseSyncParams();
      const result = await inventorySync(params);

      // Token should be moved to Sent folder (tombstones deprecated)
      expect(result.inventoryStats?.sentTokens).toBeGreaterThanOrEqual(1);

      // VERIFY: Token in Sent folder in localStorage
      const stored = getLocalStorage();
      expect(stored?._sent?.length).toBeGreaterThanOrEqual(1);

      // VERIFY: Sent entry has correct tokenId
      const sentEntry = stored?._sent?.find(s =>
        s.token?.genesis?.data?.tokenId === spentTokenId || s.token?.genesis?.data?.tokenId?.includes("tomb1")
      );
      expect(sentEntry).toBeDefined();
    });
  });
});

// ==========================================
// Concurrent Sync Scenarios
// ==========================================

describe("Concurrent Sync Behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetInventoryStorage();  // Reset storage adapter singleton before each test
    clearLocalStorage();
    resetMocks();
  });

  it("should handle sequential syncs without data loss", async () => {
    const params = createBaseSyncParams();

    // Run 5 syncs sequentially (not truly concurrent due to JS single-thread)
    const results: Awaited<ReturnType<typeof inventorySync>>[] = [];
    for (let i = 0; i < 5; i++) {
      results.push(await inventorySync(params));
    }

    // All should complete successfully
    expect(results.every(r => r.status === "SUCCESS" || r.status === "PARTIAL_SUCCESS")).toBe(true);

    // VERIFY: Version is maintained (doesn't increment when content unchanged)
    const stored = getLocalStorage();
    // With no content changes, version should stay the same after initial sync
    // This is correct behavior - prevents unnecessary IPFS uploads on reload
    expect(stored?._meta?.version).toBeGreaterThanOrEqual(1);
  });

  it("should maintain data integrity across multiple syncs", async () => {
    // Start with existing token
    setLocalStorage(createMockStorageData({
      "existing": createMockTxfToken("existing", "1000"),
    }));

    const params = createBaseSyncParams();

    // Run multiple syncs
    await inventorySync(params);
    await inventorySync(params);
    await inventorySync(params);

    const stored = getLocalStorage();
    expect(stored).not.toBeNull();

    // VERIFY: Existing token not lost
    const tokenKey = Object.keys(stored || {}).find(k => k.includes("existing"));
    expect(tokenKey).toBeDefined();

    // VERIFY: Token amount preserved - amount is in genesis.data.coinData
    const token = stored?.[tokenKey!] as TxfToken;
    expect(token.genesis?.data?.coinData[0][1]).toBe("1000");

    // VERIFY: No duplicate tokens
    expect(countTokensInStorage(stored)).toBe(1);
  });

  it("should correctly merge data added between syncs", async () => {
    const params = createBaseSyncParams();

    // First sync - empty
    await inventorySync(params);

    // Add token via incoming
    const params2: SyncParams = {
      ...createBaseSyncParams(),
      incomingTokens: [createMockToken("added1", "2000")],
    };
    await inventorySync(params2);

    // Third sync (normal) should still have the token
    const result = await inventorySync(params);

    expect(result.inventoryStats?.activeTokens).toBe(1);

    // VERIFY: Token persisted
    const stored = getLocalStorage();
    const tokenKey = Object.keys(stored || {}).find(k => k.includes("added1"));
    expect(tokenKey).toBeDefined();
  });
});
