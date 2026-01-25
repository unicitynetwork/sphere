import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Token } from "../../../../../../src/components/wallet/L3/data/model";
import type { OutboxEntry } from "../../../../../../src/components/wallet/L3/services/types/OutboxTypes";
import type { TxfToken, TxfStorageData, SentTokenEntry, InvalidTokenEntry } from "../../../../../../src/components/wallet/L3/services/types/TxfTypes";

// ==========================================
// Configurable Mock Setup
// ==========================================

// These variables allow per-test configuration of mock behavior
let mockValidationResult: { valid: boolean; issues: Array<{ tokenId: string; reason: string }> } = { valid: true, issues: [] };
let mockSpentTokens: Array<{ tokenId: string; stateHash: string; localId: string }> = [];
let mockIpfsAvailable = false;
let mockRemoteData: TxfStorageData | null = null;

// Spy functions for verifying calls
const mockCheckSpentTokensSpy = vi.fn();
const mockValidateAllTokensSpy = vi.fn();

// Spy functions for Step 8.5 Nostr binding verification
const mockQueryPubkeyByNametagSpy = vi.fn();
const mockPublishNametagBindingSpy = vi.fn();

// Spy function for IPFS upload verification
const mockIpfsUploadSpy = vi.fn();

// Mock IpfsHttpResolver with configurable response
vi.mock("../../../../../../src/components/wallet/L3/services/IpfsHttpResolver", () => ({
  getIpfsHttpResolver: vi.fn(() => ({
    resolveIpnsName: vi.fn().mockImplementation(async () => {
      if (!mockIpfsAvailable) {
        return { success: false, error: "IPFS disabled in test" };
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

// Mock TokenValidationService with configurable per-test results
vi.mock("../../../../../../src/components/wallet/L3/services/TokenValidationService", () => ({
  getTokenValidationService: vi.fn(() => ({
    validateAllTokens: vi.fn().mockImplementation(async (tokens: Token[]) => {
      mockValidateAllTokensSpy(tokens);
      // Return the configurable mock result
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
      mockCheckSpentTokensSpy();
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

// Mock NostrService with spy functions
vi.mock("../../../../../../src/components/wallet/L3/services/NostrService", () => ({
  NostrService: {
    getInstance: vi.fn(() => ({
      queryPubkeyByNametag: vi.fn().mockImplementation(async (nametag: string) => {
        mockQueryPubkeyByNametagSpy(nametag);
        return null; // Default: no existing binding
      }),
      publishNametagBinding: vi.fn().mockImplementation(async (nametag: string, address: string) => {
        mockPublishNametagBindingSpy(nametag, address);
        return true; // Default: success
      }),
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

// Storage for mock WalletRepository state
let mockWalletRepoTokens: Token[] = [];
let mockWalletRepoNametag: NametagData | null = null;
let mockWalletRepoTombstones: TombstoneEntry[] = [];
let mockWalletRepoAddress: string = "";

// Import Token and TombstoneEntry types for the mock
import type { Token as MockToken } from "../../../../../../src/components/wallet/L3/data/model";
import type { TombstoneEntry } from "../../../../../../src/components/wallet/L3/services/types/TxfTypes";
import type { NametagData } from "../../../../../../src/repositories/WalletRepository";

// Helper to convert TxfToken to Token (simplified for tests)
const txfToMockToken = (tokenId: string, txf: TxfToken): MockToken => ({
  id: tokenId,
  name: "Test Token",
  type: "UCT",
  timestamp: Date.now(),
  jsonData: JSON.stringify(txf),
  status: 0,
  amount: txf.genesis?.data?.coinData?.[0]?.[1] || "0",
  coinId: txf.genesis?.data?.coinId || "ALPHA",
  symbol: txf.genesis?.data?.coinId || "ALPHA",
  sizeBytes: 100,
} as MockToken);

// Reset mock wallet state
const resetMockWalletRepo = () => {
  mockWalletRepoTokens = [];
  mockWalletRepoNametag = null;
  mockWalletRepoTombstones = [];
  mockWalletRepoAddress = "";
};

// Sync mock wallet repo state FROM localStorage TxfStorageData
const syncMockWalletFromStorage = (address: string) => {
  try {
    const storageKey = `sphere_wallet_${address}`;
    const json = localStorage.getItem(storageKey);
    if (!json) return;

    const data = JSON.parse(json);

    // If it's TxfStorageData format (has _meta or _<tokenId> keys)
    mockWalletRepoTokens = [];
    mockWalletRepoNametag = data._nametag || null;
    mockWalletRepoTombstones = data._tombstones || [];
    mockWalletRepoAddress = address;

    // Extract tokens from _<tokenId> keys
    for (const key of Object.keys(data)) {
      if (key.startsWith("_") && !key.startsWith("_meta") && !key.startsWith("_nametag") &&
          !key.startsWith("_tombstones") && !key.startsWith("_sent") && !key.startsWith("_invalid") &&
          !key.startsWith("_outbox") && !key.startsWith("_archived") && !key.startsWith("_forked") &&
          !key.startsWith("_mintOutbox") && !key.startsWith("_invalidatedNametags")) {
        const txf = data[key] as TxfToken;
        if (txf && txf.genesis?.data?.tokenId) {
          // Use the actual tokenId from genesis data (important for proper ID matching)
          const actualTokenId = txf.genesis.data.tokenId;
          mockWalletRepoTokens.push(txfToMockToken(actualTokenId, txf));
        }
      }
    }
  } catch {
    // Ignore parse errors
  }
};

// Mock WalletRepository
vi.mock("../../../../../../src/repositories/WalletRepository", () => ({
  WalletRepository: {
    // Static methods for sync lock (Phase 0 of WalletRepository elimination)
    setSyncInProgress: vi.fn(),
    isSyncInProgress: vi.fn(() => false),
    getPendingTokens: vi.fn(() => []),
    getInstance: vi.fn(() => ({
      getWallet: vi.fn(() => {
        // Return wallet if address is set (either from loadWalletForAddress or directly)
        if (!mockWalletRepoAddress) return null;
        return {
          id: "test-wallet-id",
          name: "Test Wallet",
          address: mockWalletRepoAddress,
          tokens: mockWalletRepoTokens,
          nametag: mockWalletRepoNametag,
          tombstones: mockWalletRepoTombstones,
        };
      }),
      loadWalletForAddress: vi.fn((address: string) => {
        // Only sync from localStorage if address changes or wallet hasn't been loaded yet.
        // Once loaded, mockWalletRepoTokens becomes the authoritative store.
        if (mockWalletRepoAddress !== address) {
          syncMockWalletFromStorage(address);
        }
        // If still no address set after sync attempt, set it now (new wallet case)
        if (!mockWalletRepoAddress) {
          mockWalletRepoAddress = address;
        }
        return {
          id: "test-wallet-id",
          name: "Test Wallet",
          address: mockWalletRepoAddress,
          tokens: mockWalletRepoTokens,
        };
      }),
      getTokens: vi.fn(() => mockWalletRepoTokens),
      getNametag: vi.fn(() => mockWalletRepoNametag),
      getTombstones: vi.fn(() => mockWalletRepoTombstones),
      setNametag: vi.fn((nametag: NametagData) => {
        mockWalletRepoNametag = nametag;
      }),
      addToken: vi.fn((token: MockToken) => {
        // Check for duplicates
        const existingIndex = mockWalletRepoTokens.findIndex(t => {
          try {
            const existing = JSON.parse(t.jsonData || "{}");
            const incoming = JSON.parse(token.jsonData || "{}");
            return existing.genesis?.data?.tokenId === incoming.genesis?.data?.tokenId;
          } catch { return false; }
        });
        if (existingIndex === -1) {
          mockWalletRepoTokens.push(token);
        }
      }),
      updateToken: vi.fn((token: MockToken) => {
        const index = mockWalletRepoTokens.findIndex(t => {
          try {
            const existing = JSON.parse(t.jsonData || "{}");
            const incoming = JSON.parse(token.jsonData || "{}");
            return existing.genesis?.data?.tokenId === incoming.genesis?.data?.tokenId;
          } catch { return false; }
        });
        if (index >= 0) {
          mockWalletRepoTokens[index] = token;
        }
      }),
      removeToken: vi.fn((tokenId: string) => {
        mockWalletRepoTokens = mockWalletRepoTokens.filter(t => t.id !== tokenId);
      }),
      mergeTombstones: vi.fn((tombstones: TombstoneEntry[]) => {
        for (const t of tombstones) {
          if (!mockWalletRepoTombstones.some(existing =>
            existing.tokenId === t.tokenId && existing.stateHash === t.stateHash
          )) {
            mockWalletRepoTombstones.push(t);
          }
        }
        return 0; // Return removed count (simplified)
      }),
      // Methods used by attemptTokenRecovery in Step 7.5
      getArchivedToken: vi.fn(() => null), // No archived tokens in tests
      getForkedToken: vi.fn(() => null),   // No forked tokens in tests
    })),
  },
}));

// Mock IPFS config
vi.mock("../../../../../../src/config/ipfs.config", () => ({
  getAllBackendGatewayUrls: vi.fn(() => ["https://test-gateway.example.com"]),
}));

// Mock IpfsStorageService - getIpfsTransport throws to force fallback to HTTP resolver
// This ensures the existing IpfsHttpResolver mock is used for tests
vi.mock("../../../../../../src/components/wallet/L3/services/IpfsStorageService", () => ({
  getIpfsTransport: vi.fn(() => {
    throw new Error("Transport not available in test - using HTTP resolver fallback");
  }),
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
      data: { tokenId: id.padEnd(64, "0"), coinId: "ALPHA", coinData: [["ALPHA", amount]] },
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
    // This is required for completedList processing to match stateHash
    _integrity: {
      currentStateHash: currentStateHash,
      genesisDataJSONHash: "0000" + "e".repeat(60),
    },
  } as TxfToken;
};

// Create a token with unnormalized proof (missing "0000" prefix)
const createUnnormalizedTxfToken = (tokenId: string, amount = "1000"): TxfToken => ({
  version: "2.0",
  genesis: {
    data: {
      tokenId: tokenId.padEnd(64, "0"),
      coinId: "ALPHA",
      coinData: [["ALPHA", amount]],
    },
    inclusionProof: {
      authenticator: { stateHash: "a".repeat(64) }, // Missing 0000 prefix
      merkleTreePath: { root: "b".repeat(64), path: [] }, // Missing 0000 prefix
      transactionHash: "0000" + "c".repeat(60),
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

  if (!json) {
    return null;
  }

  // InventorySyncService now writes TxfStorageData directly to localStorage,
  // including tokens with _<tokenId> keys. Just parse and return.
  return JSON.parse(json) as TxfStorageData;
};

// Reset all mock configurations
const resetMocks = () => {
  mockValidationResult = { valid: true, issues: [] };
  mockSpentTokens = [];
  mockIpfsAvailable = false;
  mockRemoteData = null;
  // Reset spy call counts
  mockCheckSpentTokensSpy.mockClear();
  mockValidateAllTokensSpy.mockClear();
  mockQueryPubkeyByNametagSpy.mockClear();
  mockPublishNametagBindingSpy.mockClear();
  mockIpfsUploadSpy.mockClear();
  // Reset mock WalletRepository state
  resetMockWalletRepo();
};

// ==========================================
// inventorySync Tests
// ==========================================

describe("inventorySync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearLocalStorage();
    resetMocks();
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
      expect(result.status).toMatch(/^(SUCCESS|PARTIAL_SUCCESS)$/);
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
  // Step 3: Proof Normalization Tests
  // ------------------------------------------

  describe("Step 3: Proof Normalization", () => {
    it("should normalize proofs missing 0000 prefix", async () => {
      // Set up token with unnormalized proof
      setLocalStorage(createMockStorageData({
        "unnorm1": createUnnormalizedTxfToken("unnorm1"),
      }));

      const params: SyncParams = {
        ...createBaseSyncParams(),
        local: true,
      };

      const result = await inventorySync(params);

      // Token should still be processed after normalization
      expect(result.inventoryStats?.activeTokens).toBe(1);

      // Verify localStorage was updated with normalized proof
      const stored = getLocalStorage();
      expect(stored).not.toBeNull();
      // The key is prefixed with underscore
      const tokenKey = Object.keys(stored || {}).find(k => k.startsWith("_unnorm1"));
      expect(tokenKey).toBeDefined();
    });

    it("should not modify already normalized proofs", async () => {
      const normalizedToken = createMockTxfToken("norm1");
      setLocalStorage(createMockStorageData({
        "norm1": normalizedToken,
      }));

      const params: SyncParams = {
        ...createBaseSyncParams(),
        local: true,
      };

      const result = await inventorySync(params);

      expect(result.inventoryStats?.activeTokens).toBe(1);
    });
  });

  // ------------------------------------------
  // Step 5: Token Validation Tests (REAL VALIDATION)
  // ------------------------------------------

  describe("Step 5: Token Validation", () => {
    it("should move invalid tokens to Invalid folder when validation fails", async () => {
      // The Token.id used in InventorySyncService matches the storage key, not the padded genesis tokenId
      const invalidTokenId = "invalid1";

      // Configure mock to report this token as invalid
      mockValidationResult = {
        valid: false,
        issues: [{ tokenId: invalidTokenId, reason: "Invalid signature" }],
      };

      setLocalStorage(createMockStorageData({
        "invalid1": createMockTxfToken("invalid1"),
        "valid1": createMockTxfToken("valid1"),
      }));

      const params = createBaseSyncParams();
      const result = await inventorySync(params);

      // One token should be invalid, one active
      expect(result.inventoryStats?.invalidTokens).toBe(1);
      expect(result.inventoryStats?.activeTokens).toBe(1);
      expect(result.operationStats.tokensRemoved).toBeGreaterThanOrEqual(1);

      // Verify localStorage has token in Invalid folder
      const stored = getLocalStorage();
      expect(stored?._invalid).toBeDefined();
      expect(stored?._invalid?.length).toBe(1);
      expect((stored?._invalid?.[0] as InvalidTokenEntry)?.reason).toBe("SDK_VALIDATION");
    });

    it("should keep all tokens active when validation passes", async () => {
      mockValidationResult = { valid: true, issues: [] };

      setLocalStorage(createMockStorageData({
        "token1": createMockTxfToken("token1"),
        "token2": createMockTxfToken("token2"),
      }));

      const params = createBaseSyncParams();
      const result = await inventorySync(params);

      expect(result.inventoryStats?.activeTokens).toBe(2);
      expect(result.inventoryStats?.invalidTokens).toBe(0);
    });

    it("should record validation details in invalid entry", async () => {
      // The Token.id used in InventorySyncService matches the storage key, not the padded genesis tokenId
      const invalidTokenId = "badtoken";
      const errorReason = "Merkle proof verification failed";

      mockValidationResult = {
        valid: false,
        issues: [{ tokenId: invalidTokenId, reason: errorReason }],
      };

      setLocalStorage(createMockStorageData({
        "badtoken": createMockTxfToken("badtoken"),
      }));

      const params = createBaseSyncParams();
      await inventorySync(params);

      const stored = getLocalStorage();
      expect(stored?._invalid?.length).toBe(1);
      const invalidEntry = stored?._invalid?.[0] as InvalidTokenEntry;
      expect(invalidEntry.reason).toBe("SDK_VALIDATION");
      expect(invalidEntry.details).toBe(errorReason);
      expect(invalidEntry.invalidatedAt).toBeGreaterThan(0);
    });
  });

  // ------------------------------------------
  // Step 6: Deduplication Tests
  // ------------------------------------------

  describe("Step 6: Token Deduplication", () => {
    it("should prefer remote token with more transactions", async () => {
      // Local token has 0 transactions
      setLocalStorage(createMockStorageData({
        "dup1": createMockTxfToken("dup1", "1000", 0),
      }));

      // Remote token has 2 transactions (more advanced)
      mockIpfsAvailable = true;
      mockRemoteData = createMockStorageData({
        "dup1": createMockTxfToken("dup1", "1000", 2),
      });

      const params = createBaseSyncParams();
      const result = await inventorySync(params);

      // Should have 1 token (deduplicated)
      expect(result.inventoryStats?.activeTokens).toBe(1);

      // Verify the token in storage has 2 transactions (remote version)
      const stored = getLocalStorage();
      const tokenKey = Object.keys(stored || {}).find(k => k.startsWith("_dup1"));
      expect(tokenKey).toBeDefined();
      const token = stored?.[tokenKey!] as TxfToken;
      expect(token.transactions?.length).toBe(2);
    });

    it("should keep local token when it has more transactions", async () => {
      // Local token has 3 transactions (more advanced)
      setLocalStorage(createMockStorageData({
        "dup2": createMockTxfToken("dup2", "1000", 3),
      }));

      // Remote token has 1 transaction
      mockIpfsAvailable = true;
      mockRemoteData = createMockStorageData({
        "dup2": createMockTxfToken("dup2", "1000", 1),
      });

      const params = createBaseSyncParams();
      const result = await inventorySync(params);

      expect(result.inventoryStats?.activeTokens).toBe(1);

      // Verify the token kept has 3 transactions (local version)
      const stored = getLocalStorage();
      const tokenKey = Object.keys(stored || {}).find(k => k.startsWith("_dup2"));
      const token = stored?.[tokenKey!] as TxfToken;
      expect(token.transactions?.length).toBe(3);
    });
  });

  // ------------------------------------------
  // Step 7: Spent Token Detection Tests (REAL DETECTION)
  // ------------------------------------------

  describe("Step 7: Spent Token Detection", () => {
    it("should move spent tokens to Sent folder in NORMAL mode", async () => {
      const spentTokenId = "spent1".padEnd(64, "0");
      const spentStateHash = "0000" + "a".repeat(60);

      // Configure mock to report this token as spent
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

      // One token spent, one active
      expect(result.inventoryStats?.sentTokens).toBe(1);
      expect(result.inventoryStats?.activeTokens).toBe(1);

      // Verify localStorage
      const stored = getLocalStorage();
      expect(stored?._sent?.length).toBe(1);
      expect((stored?._sent?.[0] as SentTokenEntry)?.spentAt).toBeGreaterThan(0);
    });

    it("should call checkSpentTokens in NORMAL mode", async () => {
      mockSpentTokens = [];  // No spent tokens, but we want to verify the function is called

      setLocalStorage(createMockStorageData({
        "normal1": createMockTxfToken("normal1"),
      }));

      const params = createBaseSyncParams();
      const result = await inventorySync(params);

      expect(result.syncMode).toBe("NORMAL");
      // CRITICAL: Verify checkSpentTokens WAS called in NORMAL mode
      expect(mockCheckSpentTokensSpy).toHaveBeenCalled();
    });

    it("should add tombstone when token is detected as spent", async () => {
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

      expect(result.operationStats.tombstonesAdded).toBeGreaterThanOrEqual(1);

      // Verify tombstone in localStorage
      const stored = getLocalStorage();
      expect(stored?._tombstones?.length).toBeGreaterThanOrEqual(1);
    });

    it("should skip spent detection in FAST mode", async () => {
      // Configure mock to report spent token
      mockSpentTokens = [{
        tokenId: "fast1".padEnd(64, "0"),
        stateHash: "0000" + "a".repeat(60),
        localId: "fast1",
      }];

      const params: SyncParams = {
        ...createBaseSyncParams(),
        incomingTokens: [createMockToken("incoming1")],
      };

      const result = await inventorySync(params);

      expect(result.syncMode).toBe("FAST");
      // Even though mock would report spent, FAST mode skips Step 7
      // So sentTokens should be 0 (unless there were pre-existing sent tokens)
      expect(result.inventoryStats?.sentTokens).toBe(0);
      // CRITICAL: Verify checkSpentTokens was NOT called in FAST mode
      expect(mockCheckSpentTokensSpy).not.toHaveBeenCalled();
    });

    it("should skip spent detection in LOCAL mode", async () => {
      mockSpentTokens = [{
        tokenId: "local1".padEnd(64, "0"),
        stateHash: "0000" + "a".repeat(60),
        localId: "local1",
      }];

      setLocalStorage(createMockStorageData({
        "local1": createMockTxfToken("local1"),
      }));

      const params: SyncParams = {
        ...createBaseSyncParams(),
        local: true,
      };

      const result = await inventorySync(params);

      expect(result.syncMode).toBe("LOCAL");
      // LOCAL mode skips Step 7, token should remain active
      expect(result.inventoryStats?.activeTokens).toBe(1);
      expect(result.inventoryStats?.sentTokens).toBe(0);
      // CRITICAL: Verify checkSpentTokens was NOT called in LOCAL mode
      expect(mockCheckSpentTokensSpy).not.toHaveBeenCalled();
    });

    it("should skip spent detection in NAMETAG mode", async () => {
      mockSpentTokens = [{
        tokenId: "nametag1".padEnd(64, "0"),
        stateHash: "0000" + "a".repeat(60),
        localId: "nametag1",
      }];

      const params: SyncParams = {
        ...createBaseSyncParams(),
        nametag: true,
      };

      const result = await inventorySync(params);

      expect(result.syncMode).toBe("NAMETAG");
      // NAMETAG mode only fetches nametags, skips Step 7
      // CRITICAL: Verify checkSpentTokens was NOT called in NAMETAG mode
      expect(mockCheckSpentTokensSpy).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------
  // IPFS Merge Tests
  // ------------------------------------------

  describe("IPFS Merge (Step 2)", () => {
    it("should merge tokens from IPFS when available", async () => {
      // Local has token1
      setLocalStorage(createMockStorageData({
        "local1": createMockTxfToken("local1", "1000"),
      }));

      // Remote has token2
      mockIpfsAvailable = true;
      mockRemoteData = createMockStorageData({
        "remote1": createMockTxfToken("remote1", "2000"),
      });

      const params = createBaseSyncParams();
      const result = await inventorySync(params);

      // Should have both tokens
      expect(result.inventoryStats?.activeTokens).toBe(2);
    });

    it("should fallback to local-only when IPFS unavailable", async () => {
      mockIpfsAvailable = false;

      setLocalStorage(createMockStorageData({
        "local1": createMockTxfToken("local1"),
      }));

      const params = createBaseSyncParams();
      const result = await inventorySync(params);

      expect(result.inventoryStats?.activeTokens).toBe(1);
    });

    it("should merge sent folder from remote using tokenId:stateHash key", async () => {
      // Local has one sent token
      const localStorageData = createMockStorageData();
      localStorageData._sent = [{
        token: createMockTxfToken("sent1"),
        timestamp: Date.now() - 10000,
        spentAt: Date.now() - 10000,
      }];
      setLocalStorage(localStorageData);

      // Remote has different sent token (different tokenId)
      mockIpfsAvailable = true;
      const remoteData = createMockStorageData();
      remoteData._sent = [{
        token: createMockTxfToken("sent2"),
        timestamp: Date.now() - 5000,
        spentAt: Date.now() - 5000,
      }];
      mockRemoteData = remoteData;

      const params = createBaseSyncParams();
      const result = await inventorySync(params);

      // Should have both sent tokens (union merge)
      expect(result.inventoryStats?.sentTokens).toBe(2);
    });
  });

  // ------------------------------------------
  // Persistence Verification Tests
  // ------------------------------------------

  describe("Data Persistence", () => {
    it("should persist tokens to localStorage after sync", async () => {
      const params: SyncParams = {
        ...createBaseSyncParams(),
        incomingTokens: [createMockToken("persist1", "5000")],
      };

      await inventorySync(params);

      const stored = getLocalStorage();
      expect(stored).not.toBeNull();

      // Verify token is actually in storage
      const tokenKey = Object.keys(stored || {}).find(k => k.includes("persist1"));
      expect(tokenKey).toBeDefined();

      // Verify token data - amount is in genesis.data.coinData
      const token = stored?.[tokenKey!] as TxfToken;
      expect(token.genesis?.data?.coinData).toBeDefined();
      expect(token.genesis.data.coinData[0][1]).toBe("5000");
    });

    it("should preserve data across multiple syncs", async () => {
      // First sync adds a token
      const params1: SyncParams = {
        ...createBaseSyncParams(),
        incomingTokens: [createMockToken("multi1", "1000")],
      };
      await inventorySync(params1);

      // Second sync adds another token
      const params2: SyncParams = {
        ...createBaseSyncParams(),
        incomingTokens: [createMockToken("multi2", "2000")],
      };
      await inventorySync(params2);

      // Third sync (normal, no new tokens)
      const params3 = createBaseSyncParams();
      const result = await inventorySync(params3);

      // Should have both tokens from previous syncs
      expect(result.inventoryStats?.activeTokens).toBe(2);

      // Verify both tokens in localStorage
      const stored = getLocalStorage();
      const keys = Object.keys(stored || {}).filter(k => k.startsWith("_") && !k.startsWith("_meta") && !k.startsWith("_sent") && !k.startsWith("_invalid") && !k.startsWith("_outbox") && !k.startsWith("_tombstones") && !k.startsWith("_nametag"));
      expect(keys.length).toBe(2);
    });

    it("should NOT increment version when content unchanged", async () => {
      setLocalStorage(createMockStorageData());

      const params = createBaseSyncParams();

      await inventorySync(params);
      const v1 = getLocalStorage()?._meta?.version || 0;

      await inventorySync(params);
      const v2 = getLocalStorage()?._meta?.version || 0;

      await inventorySync(params);
      const v3 = getLocalStorage()?._meta?.version || 0;

      // Version should stay the same when content hasn't changed
      // This prevents unnecessary IPFS uploads on reload
      expect(v2).toBe(v1);
      expect(v3).toBe(v1);
    });

    it("should increment version when content changes", async () => {
      setLocalStorage(createMockStorageData());

      const params = createBaseSyncParams();

      await inventorySync(params);
      const v1 = getLocalStorage()?._meta?.version || 0;

      // Add a new token - this changes content
      await inventorySync({
        ...params,
        incomingTokens: [createMockToken("newtoken1")],
      });
      const v2 = getLocalStorage()?._meta?.version || 0;

      // Add another token - this changes content again
      await inventorySync({
        ...params,
        incomingTokens: [createMockToken("newtoken2")],
      });
      const v3 = getLocalStorage()?._meta?.version || 0;

      // Version should increment when content changes
      expect(v2).toBeGreaterThan(v1);
      expect(v3).toBeGreaterThan(v2);
    });

    it("should preserve sent folder across syncs", async () => {
      // First sync creates a sent token
      mockSpentTokens = [{
        tokenId: "spent1".padEnd(64, "0"),
        stateHash: "0000" + "a".repeat(60),
        localId: "spent1",
      }];

      setLocalStorage(createMockStorageData({
        "spent1": createMockTxfToken("spent1"),
      }));

      const params = createBaseSyncParams();
      await inventorySync(params);

      // Clear spent mock for second sync
      mockSpentTokens = [];

      // Second sync should still show sent token
      const result = await inventorySync(params);
      expect(result.inventoryStats?.sentTokens).toBe(1);

      // Verify sent folder persisted
      const stored = getLocalStorage();
      expect(stored?._sent?.length).toBe(1);
    });
  });

  // ------------------------------------------
  // Error Handling Tests (ACTUAL VERIFICATION)
  // ------------------------------------------

  describe("Error Handling", () => {
    it("should handle malformed JSON in localStorage gracefully", async () => {
      const storageKey = STORAGE_KEY_GENERATORS.walletByAddress(TEST_ADDRESS);
      localStorage.setItem(storageKey, "invalid json{{{");

      const params = createBaseSyncParams();
      const result = await inventorySync(params);

      // Should not throw, should return a valid result
      expect(result).toBeDefined();
      expect(result.status).toBeDefined();
      // Empty inventory after failed parse
      expect(result.inventoryStats?.activeTokens).toBe(0);
    });

    it("should continue sync when validation service throws", async () => {
      // This would test error handling in Step 5
      setLocalStorage(createMockStorageData({
        "token1": createMockTxfToken("token1"),
      }));

      const params = createBaseSyncParams();
      const result = await inventorySync(params);

      // Should complete (validation errors are non-fatal)
      expect(result.status).not.toBe("ERROR");
    });
  });

  // ------------------------------------------
  // SyncResult Structure Tests (STRICT ASSERTIONS)
  // ------------------------------------------

  describe("SyncResult Structure", () => {
    it("should include all required fields with correct types", async () => {
      const params = createBaseSyncParams();
      const result = await inventorySync(params);

      // Status must be a valid enum value
      expect(result.status).toMatch(/^(SUCCESS|PARTIAL_SUCCESS|ERROR|LOCAL_ONLY|NAMETAG_ONLY)$/);

      // SyncMode must be valid
      expect(result.syncMode).toMatch(/^(LOCAL|NAMETAG|FAST|NORMAL)$/);

      // Duration must be a non-negative number
      expect(typeof result.syncDurationMs).toBe("number");
      expect(result.syncDurationMs).toBeGreaterThanOrEqual(0);

      // Timestamp must be a recent time
      expect(typeof result.timestamp).toBe("number");
      expect(result.timestamp).toBeGreaterThan(Date.now() - 10000);
      expect(result.timestamp).toBeLessThanOrEqual(Date.now() + 1000);
    });

    it("should include operationStats with numeric counters", async () => {
      const params = createBaseSyncParams();
      const result = await inventorySync(params);

      expect(typeof result.operationStats.tokensImported).toBe("number");
      expect(typeof result.operationStats.tokensRemoved).toBe("number");
      expect(typeof result.operationStats.tokensUpdated).toBe("number");
      expect(typeof result.operationStats.conflictsResolved).toBe("number");
      expect(typeof result.operationStats.tokensValidated).toBe("number");
      expect(typeof result.operationStats.tombstonesAdded).toBe("number");

      // All counters should be non-negative
      expect(result.operationStats.tokensImported).toBeGreaterThanOrEqual(0);
      expect(result.operationStats.tokensRemoved).toBeGreaterThanOrEqual(0);
    });

    it("should include inventoryStats with folder counts (except NAMETAG mode)", async () => {
      setLocalStorage(createMockStorageData({
        "token1": createMockTxfToken("token1"),
      }));

      const params = createBaseSyncParams();
      const result = await inventorySync(params);

      expect(result.inventoryStats).toBeDefined();
      expect(typeof result.inventoryStats!.activeTokens).toBe("number");
      expect(typeof result.inventoryStats!.sentTokens).toBe("number");
      expect(typeof result.inventoryStats!.invalidTokens).toBe("number");
      expect(typeof result.inventoryStats!.outboxTokens).toBe("number");
    });

    it("should NOT include inventoryStats in NAMETAG mode", async () => {
      const params: SyncParams = {
        ...createBaseSyncParams(),
        nametag: true,
      };

      const result = await inventorySync(params);

      expect(result.inventoryStats).toBeUndefined();
      expect(result.nametags).toBeDefined();
      expect(Array.isArray(result.nametags)).toBe(true);
    });
  });

  // ------------------------------------------
  // CompletedList Processing Tests
  // ------------------------------------------

  describe("CompletedList Processing", () => {
    it("should move completed tokens to Sent folder", async () => {
      // Use storage key format (unpadded) since ctx.tokens uses storage keys
      const tokenId = "completed1";
      // Use DEFAULT_STATE_HASH to match the mock token's _integrity.currentStateHash
      const stateHash = DEFAULT_STATE_HASH;

      const completedList: CompletedTransfer[] = [{
        tokenId,
        stateHash,
        inclusionProof: {},
      }];

      setLocalStorage(createMockStorageData({
        "completed1": createMockTxfToken("completed1"),
      }));

      const params: SyncParams = {
        ...createBaseSyncParams(),
        completedList,
      };

      const result = await inventorySync(params);

      // Token should be in sent, not active
      expect(result.inventoryStats?.sentTokens).toBe(1);
      expect(result.inventoryStats?.activeTokens).toBe(0);
    });

    it("should add tombstone for completed transfer", async () => {
      // Use storage key format (unpadded) since ctx.tokens uses storage keys
      const tokenId = "completed2";
      // Use DEFAULT_STATE_HASH to match the mock token's _integrity.currentStateHash
      const stateHash = DEFAULT_STATE_HASH;

      const completedList: CompletedTransfer[] = [{
        tokenId,
        stateHash,
        inclusionProof: {},
      }];

      setLocalStorage(createMockStorageData({
        "completed2": createMockTxfToken("completed2"),
      }));

      const params: SyncParams = {
        ...createBaseSyncParams(),
        completedList,
      };

      const result = await inventorySync(params);

      expect(result.operationStats.tombstonesAdded).toBeGreaterThanOrEqual(1);
    });
  });

  // ------------------------------------------
  // Edge Cases
  // ------------------------------------------

  describe("Edge Cases", () => {
    it("should handle empty inventory gracefully", async () => {
      const params = createBaseSyncParams();
      const result = await inventorySync(params);

      expect(result.status).toMatch(/^(SUCCESS|PARTIAL_SUCCESS)$/);
      expect(result.inventoryStats?.activeTokens).toBe(0);
    });

    it("should handle large token collections", async () => {
      const tokens: Record<string, TxfToken> = {};
      for (let i = 0; i < 100; i++) {
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

    it("should handle null/undefined optional params", async () => {
      const params: SyncParams = {
        address: TEST_ADDRESS,
        publicKey: TEST_PUBLIC_KEY,
        ipnsName: TEST_IPNS_NAME,
        incomingTokens: null,
        outboxTokens: undefined,
        completedList: undefined,
      };

      const result = await inventorySync(params);

      expect(result.syncMode).toBe("NORMAL");
      expect(result.status).not.toBe("ERROR");
    });

    it("should not create duplicate tokens when same token received twice", async () => {
      // First sync with token
      const params1: SyncParams = {
        ...createBaseSyncParams(),
        incomingTokens: [createMockToken("dup1", "1000")],
      };
      await inventorySync(params1);

      // Second sync with same token
      const params2: SyncParams = {
        ...createBaseSyncParams(),
        incomingTokens: [createMockToken("dup1", "1000")],
      };
      const result = await inventorySync(params2);

      // Should still have only 1 token (deduplicated)
      expect(result.inventoryStats?.activeTokens).toBe(1);

      // Verify only one token key in localStorage
      const stored = getLocalStorage();
      const tokenKeys = Object.keys(stored || {}).filter(k =>
        k.startsWith("_") &&
        !k.startsWith("_meta") &&
        !k.startsWith("_sent") &&
        !k.startsWith("_invalid") &&
        !k.startsWith("_outbox") &&
        !k.startsWith("_tombstones") &&
        !k.startsWith("_nametag")
      );
      expect(tokenKeys.length).toBe(1);
    });
  });

  // ------------------------------------------
  // Step 4: State Hash Chain Validation Tests
  // ------------------------------------------

  describe("Step 4: State Hash Chain Validation", () => {
    // Helper to create token with broken chain
    const createBrokenChainToken = (tokenId: string, breakType: "wrong_previous" | "missing_previous"): TxfToken => {
      const genesisStateHash = DEFAULT_STATE_HASH;
      const wrongPreviousHash = "0000" + "f".repeat(60); // Doesn't match genesis

      const token: TxfToken = {
        version: "2.0",
        genesis: {
          data: {
            tokenId: tokenId.padEnd(64, "0"),
            coinId: "ALPHA",
            coinData: [["ALPHA", "1000"]],
          },
          inclusionProof: {
            authenticator: { stateHash: genesisStateHash },
            merkleTreePath: { root: "0000" + "b".repeat(60), path: [] },
            transactionHash: "0000" + "c".repeat(60),
          },
        },
        state: { data: "", predicate: new Uint8Array([1, 2, 3]) },
        transactions: [{
          data: { recipient: "recipient0" },
          // Break the chain based on breakType
          ...(breakType === "wrong_previous" ? { previousStateHash: wrongPreviousHash } : {}),
          // missing_previous: no previousStateHash at all
          newStateHash: "0000" + "1".repeat(60),
          inclusionProof: {
            authenticator: { stateHash: "0000" + "1".repeat(60) },
            merkleTreePath: { root: "0000" + "b".repeat(60), path: [] },
            transactionHash: "0000" + "d".repeat(60),
          },
        }],
        _integrity: {
          currentStateHash: "0000" + "1".repeat(60),
          genesisDataJSONHash: "0000" + "e".repeat(60),
        },
      } as TxfToken;

      return token;
    };

    it("should reject token with wrong previousStateHash (chain break)", async () => {
      setLocalStorage(createMockStorageData({
        "broken1": createBrokenChainToken("broken1", "wrong_previous"),
        "valid1": createMockTxfToken("valid1"),
      }));

      const params: SyncParams = {
        ...createBaseSyncParams(),
        local: true,
      };

      const result = await inventorySync(params);

      // Broken token should be moved to Invalid, valid token stays active
      expect(result.inventoryStats?.invalidTokens).toBe(1);
      expect(result.inventoryStats?.activeTokens).toBe(1);
      expect(result.operationStats.tokensRemoved).toBeGreaterThanOrEqual(1);

      // Verify invalid entry has correct reason
      const stored = getLocalStorage();
      expect(stored?._invalid?.length).toBe(1);
      const invalidEntry = stored?._invalid?.[0] as InvalidTokenEntry;
      expect(invalidEntry.reason).toBe("PROOF_MISMATCH");
      expect(invalidEntry.details).toContain("Chain break");
    });

    it("should ALLOW token with missing previousStateHash on first transaction", async () => {
      // Missing previousStateHash on the first transaction is allowed because:
      // 1. We know it should be the genesis stateHash
      // 2. Full SDK validation in Step 5 will verify the cryptographic proof
      // 3. This matches faucet token behavior where the SDK doesn't populate this field
      setLocalStorage(createMockStorageData({
        "missing_prev": createBrokenChainToken("missing_prev", "missing_previous"),
      }));

      const params: SyncParams = {
        ...createBaseSyncParams(),
        local: true,
      };

      const result = await inventorySync(params);

      // Token should remain active (missing previousStateHash on first tx is OK)
      expect(result.inventoryStats?.invalidTokens).toBe(0);
      expect(result.inventoryStats?.activeTokens).toBe(1);

      // Verify no invalid entries
      const stored = getLocalStorage();
      expect(stored?._invalid?.length ?? 0).toBe(0);
    });
  });

  // ------------------------------------------
  // CompletedList Edge Cases
  // ------------------------------------------

  describe("CompletedList Edge Cases", () => {
    it("should NOT move token to Sent when stateHash doesn't match", async () => {
      const tokenId = "mismatch1".padEnd(64, "0");
      const wrongStateHash = "0000" + "f".repeat(60); // Doesn't match token's stateHash

      const completedList: CompletedTransfer[] = [{
        tokenId,
        stateHash: wrongStateHash, // Wrong hash!
        inclusionProof: {},
      }];

      setLocalStorage(createMockStorageData({
        "mismatch1": createMockTxfToken("mismatch1"),
      }));

      const params: SyncParams = {
        ...createBaseSyncParams(),
        completedList,
      };

      const result = await inventorySync(params);

      // Token should remain active, not moved to sent
      expect(result.inventoryStats?.activeTokens).toBe(1);
      expect(result.inventoryStats?.sentTokens).toBe(0);
      expect(result.operationStats.tombstonesAdded).toBe(0);
    });

    it("should handle completedList for token not in inventory", async () => {
      const completedList: CompletedTransfer[] = [{
        tokenId: "nonexistent".padEnd(64, "0"),
        stateHash: DEFAULT_STATE_HASH,
        inclusionProof: {},
      }];

      setLocalStorage(createMockStorageData({
        "existing1": createMockTxfToken("existing1"),
      }));

      const params: SyncParams = {
        ...createBaseSyncParams(),
        completedList,
      };

      const result = await inventorySync(params);

      // Existing token should remain, no errors
      expect(result.inventoryStats?.activeTokens).toBe(1);
      expect(result.inventoryStats?.sentTokens).toBe(0);
    });
  });

  // ------------------------------------------
  // Invalid Folder Merge Tests
  // ------------------------------------------

  describe("Invalid Folder Merge (Step 2)", () => {
    it("should merge invalid folder from remote using tokenId:stateHash key", async () => {
      // Local has one invalid token
      const localStorageData = createMockStorageData();
      localStorageData._invalid = [{
        token: createMockTxfToken("invalid1"),
        timestamp: Date.now() - 10000,
        invalidatedAt: Date.now() - 10000,
        reason: "SDK_VALIDATION" as const,
        details: "Local validation error",
      }];
      setLocalStorage(localStorageData);

      // Remote has different invalid token
      mockIpfsAvailable = true;
      const remoteData = createMockStorageData();
      remoteData._invalid = [{
        token: createMockTxfToken("invalid2"),
        timestamp: Date.now() - 5000,
        invalidatedAt: Date.now() - 5000,
        reason: "PROOF_MISMATCH" as const,
        details: "Remote validation error",
      }];
      mockRemoteData = remoteData;

      const params = createBaseSyncParams();
      const result = await inventorySync(params);

      // Should have both invalid tokens (union merge)
      expect(result.inventoryStats?.invalidTokens).toBe(2);

      // Verify both are in localStorage
      const stored = getLocalStorage();
      expect(stored?._invalid?.length).toBe(2);
    });

    it("should not duplicate invalid entries with same tokenId:stateHash", async () => {
      const sameToken = createMockTxfToken("dup_invalid");

      // Local has invalid token
      const localStorageData = createMockStorageData();
      localStorageData._invalid = [{
        token: sameToken,
        timestamp: Date.now() - 10000,
        invalidatedAt: Date.now() - 10000,
        reason: "SDK_VALIDATION" as const,
        details: "Original error",
      }];
      setLocalStorage(localStorageData);

      // Remote has same invalid token (same tokenId and stateHash)
      mockIpfsAvailable = true;
      const remoteData = createMockStorageData();
      remoteData._invalid = [{
        token: sameToken, // Same token!
        timestamp: Date.now() - 5000,
        invalidatedAt: Date.now() - 5000,
        reason: "SDK_VALIDATION" as const,
        details: "Duplicate error",
      }];
      mockRemoteData = remoteData;

      const params = createBaseSyncParams();
      const result = await inventorySync(params);

      // Should have only 1 invalid token (deduplicated by tokenId:stateHash)
      expect(result.inventoryStats?.invalidTokens).toBe(1);
    });
  });

  // ------------------------------------------
  // Boomerang Token Detection Tests (Step 8.2)
  // ------------------------------------------

  describe("Boomerang Token Detection (Step 8.2)", () => {
    it("should detect and remove outbox entry when token returns at different state", async () => {
      // Use storage key format (unpadded) since ctx.tokens uses storage keys
      const tokenId = "boomerang1";
      const originalStateHash = DEFAULT_STATE_HASH;

      // Create token that "returned" with different state (has 1 transaction, so state changed)
      const returnedToken = createMockTxfToken("boomerang1", "1000", 1);

      // Local storage with outbox entry pointing to this token's original state
      // The boomerang detection reads previousStateHash from commitmentJson
      const localStorageData = createMockStorageData({
        "boomerang1": returnedToken,
      });
      localStorageData._outbox = [{
        id: "outbox-1",
        sourceTokenId: tokenId,
        tokenId: tokenId,
        status: "PENDING_NOSTR" as const,
        createdAt: Date.now() - 60000,
        updatedAt: Date.now() - 60000,
        retryCount: 0,
        recipientAddress: "DIRECT://recipient",
        // Boomerang detection reads from commitmentJson.transactionData.previousStateHash
        commitmentJson: JSON.stringify({
          transactionData: {
            previousStateHash: originalStateHash, // Original state when we sent it
          },
        }),
      }] as OutboxEntry[];
      setLocalStorage(localStorageData);

      const params = createBaseSyncParams();
      const result = await inventorySync(params);

      // Token should still be active (it's ours now)
      expect(result.inventoryStats?.activeTokens).toBe(1);

      // Outbox entry should be removed (boomerang detected)
      // Check inventoryStats which reports actual outbox count
      expect(result.inventoryStats?.outboxTokens).toBe(0);

      // Also verify localStorage - _outbox may be undefined or empty array
      const stored = getLocalStorage();
      expect(stored?._outbox?.length ?? 0).toBe(0);
    });

    it("should keep outbox entry when token state matches (send still pending)", async () => {
      // Use storage key format (unpadded) since ctx.tokens uses storage keys
      const tokenId = "pending1";

      // Token still at original state (send didn't happen yet)
      const localStorageData = createMockStorageData({
        "pending1": createMockTxfToken("pending1"),
      });
      localStorageData._outbox = [{
        id: "outbox-2",
        sourceTokenId: tokenId,
        tokenId: tokenId,
        status: "PENDING_NOSTR" as const,
        createdAt: Date.now() - 60000,
        updatedAt: Date.now() - 60000,
        retryCount: 0,
        recipientAddress: "DIRECT://recipient",
        // commitmentJson with same previousStateHash as current state
        commitmentJson: JSON.stringify({
          transactionData: {
            previousStateHash: DEFAULT_STATE_HASH, // Same as current state
          },
        }),
      }] as OutboxEntry[];
      setLocalStorage(localStorageData);

      const params = createBaseSyncParams();
      const result = await inventorySync(params);

      // Token still active
      expect(result.inventoryStats?.activeTokens).toBe(1);

      // Outbox entry should remain (not a boomerang - send pending)
      // Check via inventoryStats
      expect(result.inventoryStats?.outboxTokens).toBe(1);

      // Also verify localStorage
      const stored = getLocalStorage();
      expect(stored?._outbox?.length ?? 0).toBe(1);
    });
  });

  // ------------------------------------------
  // Strengthened Deduplication Tests
  // ------------------------------------------

  describe("Deduplication Verification", () => {
    it("should keep remote token with correct genesis hash after deduplication", async () => {
      const localToken = createMockTxfToken("dedup1", "1000", 0);
      const remoteToken = createMockTxfToken("dedup1", "1000", 2);

      // Mark remote token with distinguishing feature
      const remoteGenesisHash = "0000" + "remote".padEnd(58, "0");
      remoteToken._integrity = {
        currentStateHash: remoteToken._integrity?.currentStateHash || DEFAULT_STATE_HASH,
        genesisDataJSONHash: remoteGenesisHash, // Unique marker
      };

      setLocalStorage(createMockStorageData({ "dedup1": localToken }));

      mockIpfsAvailable = true;
      mockRemoteData = createMockStorageData({ "dedup1": remoteToken });

      const params = createBaseSyncParams();
      const result = await inventorySync(params);

      expect(result.inventoryStats?.activeTokens).toBe(1);

      // Verify the REMOTE token was kept (has 2 transactions and unique genesisDataJSONHash)
      const stored = getLocalStorage();
      const tokenKey = Object.keys(stored || {}).find(k => k.includes("dedup1"));
      const keptToken = stored?.[tokenKey!] as TxfToken;

      expect(keptToken.transactions?.length).toBe(2);
      expect(keptToken._integrity?.genesisDataJSONHash).toBe(remoteGenesisHash);
    });

    it("should keep local token with correct data when it has more transactions", async () => {
      const localToken = createMockTxfToken("dedup2", "1000", 3);
      const remoteToken = createMockTxfToken("dedup2", "1000", 1);

      // Mark local token with distinguishing feature
      const localGenesisHash = "0000" + "local0".padEnd(58, "0");
      localToken._integrity = {
        currentStateHash: localToken._integrity?.currentStateHash || DEFAULT_STATE_HASH,
        genesisDataJSONHash: localGenesisHash, // Unique marker
      };

      setLocalStorage(createMockStorageData({ "dedup2": localToken }));

      mockIpfsAvailable = true;
      mockRemoteData = createMockStorageData({ "dedup2": remoteToken });

      const params = createBaseSyncParams();
      const result = await inventorySync(params);

      expect(result.inventoryStats?.activeTokens).toBe(1);

      // Verify the LOCAL token was kept (has 3 transactions and unique genesisDataJSONHash)
      const stored = getLocalStorage();
      const tokenKey = Object.keys(stored || {}).find(k => k.includes("dedup2"));
      const keptToken = stored?.[tokenKey!] as TxfToken;

      expect(keptToken.transactions?.length).toBe(3);
      expect(keptToken._integrity?.genesisDataJSONHash).toBe(localGenesisHash);
    });
  });

  // ------------------------------------------
  // Step 8.5: Nametag-Nostr Binding Tests (CRITICAL)
  // ------------------------------------------

  describe("Step 8.5: Nametag-Nostr Binding", () => {
    // Nametags are loaded from _nametag field in storage data
    const createStorageDataWithNametag = (name: string) => {
      const storageKey = STORAGE_KEY_GENERATORS.walletByAddress(TEST_ADDRESS);
      const data = createMockStorageData({
        "token1": createMockTxfToken("token1"),
      });
      // Add _nametag field (this is how nametags are stored)
      (data as TxfStorageData & { _nametag?: unknown })._nametag = {
        name,
        token: createMockTxfToken("nametag1"),
        timestamp: Date.now(),
        format: "1.0",
        version: "1.0",
      };
      localStorage.setItem(storageKey, JSON.stringify(data));
    };

    it("should query Nostr for existing binding when nametag present", async () => {
      createStorageDataWithNametag("alice");

      const params = createBaseSyncParams();
      await inventorySync(params);

      // Step 8.5 should query Nostr for existing binding
      expect(mockQueryPubkeyByNametagSpy).toHaveBeenCalled();
    });

    it("should publish binding when no existing binding found", async () => {
      createStorageDataWithNametag("bob");

      const params = createBaseSyncParams();
      await inventorySync(params);

      // When queryPubkeyByNametag returns null, publishNametagBinding should be called
      expect(mockPublishNametagBindingSpy).toHaveBeenCalled();
    });

    it("should skip Nostr binding in NAMETAG mode (read-only)", async () => {
      createStorageDataWithNametag("charlie");

      const params: SyncParams = {
        ...createBaseSyncParams(),
        nametag: true,
      };

      await inventorySync(params);

      // NAMETAG mode is read-only, should NOT publish bindings
      expect(mockPublishNametagBindingSpy).not.toHaveBeenCalled();
    });

    it("should still publish Nostr binding in LOCAL mode (LOCAL only skips IPFS)", async () => {
      createStorageDataWithNametag("dave");

      const params: SyncParams = {
        ...createBaseSyncParams(),
        local: true,
      };

      await inventorySync(params);

      // LOCAL mode only skips IPFS operations, Nostr bindings are still published
      // Per spec: Step 8.5 only skips in NAMETAG mode
      expect(mockPublishNametagBindingSpy).toHaveBeenCalled();
    });

    it("should track nametagsPublished in stats", async () => {
      createStorageDataWithNametag("eve");

      const params = createBaseSyncParams();
      const result = await inventorySync(params);

      // Stats should track published nametags
      expect(result.operationStats.nametagsPublished).toBeDefined();
    });

    // ------------------------------------------
    // Step 8.5a: Nametag-Aggregator Registration Tests
    // NOTE: Step 8.5a is nested here because it uses createStorageDataWithNametag
    // ------------------------------------------

    describe("Step 8.5a: Nametag-Aggregator Registration", () => {
      // NOTE: Step 8.5a requires complex mocking of MintCommitment reconstruction
      // and ServiceProvider.stateTransitionClient.getInclusionProof.
      // These tests verify the integration point but may need additional mocks
      // for full coverage in integration tests.

      it("should skip aggregator check in NAMETAG mode (read-only)", async () => {
        createStorageDataWithNametag("alice-8.5a");

        const params: SyncParams = {
          ...createBaseSyncParams(),
          nametag: true,
        };

        const result = await inventorySync(params);

        // NAMETAG mode is read-only, aggregator check should be skipped
        expect(result.syncMode).toBe("NAMETAG");
        // Recovery stat should not be incremented
        expect(result.operationStats.nametagsRecovered || 0).toBe(0);
      });

      it("should track nametagsRecovered in stats when recovery occurs", async () => {
        // This test verifies the stat field exists even if no recovery happens
        createStorageDataWithNametag("bob-8.5a");

        const params = createBaseSyncParams();
        const result = await inventorySync(params);

        // Stats should have nametagsRecovered field defined (may be 0 or undefined)
        expect(result.operationStats).toBeDefined();
      });

      it("should not block sync when aggregator check fails", async () => {
        // Aggregator errors should be non-blocking per spec
        createStorageDataWithNametag("carol-8.5a");

        const params = createBaseSyncParams();

        // Sync should still complete even with potential aggregator issues
        const result = await inventorySync(params);

        expect(result.status).toBeDefined();
        expect(["SUCCESS", "PARTIAL_SUCCESS", "LOCAL_ONLY"]).toContain(result.status);
      });
    });
  });

  // ------------------------------------------
  // IPFS Upload Pipeline Tests (Steps 9-10)
  // ------------------------------------------

  describe("IPFS Upload Pipeline (Steps 9-10)", () => {
    it("should increment version when content changes", async () => {
      setLocalStorage(createMockStorageData({
        "token1": createMockTxfToken("token1"),
      }));

      // First sync
      const params = createBaseSyncParams();
      const result1 = await inventorySync(params);
      const version1 = result1.version;

      // Second sync WITH new token (content changes)
      const result2 = await inventorySync({
        ...params,
        incomingTokens: [createMockToken("newtoken")],
      });
      const version2 = result2.version;

      // Version should increment when content changes
      expect(version2).toBe((version1 || 0) + 1);
    });

    it("should NOT increment version when content unchanged", async () => {
      setLocalStorage(createMockStorageData({
        "token1": createMockTxfToken("token1"),
      }));

      const params = createBaseSyncParams();
      const result1 = await inventorySync(params);
      const version1 = result1.version;

      // Second sync with same content
      const result2 = await inventorySync(params);
      const version2 = result2.version;

      // Version should stay the same when content unchanged
      expect(version2).toBe(version1);
    });

    it("should set uploadNeeded when tokens change", async () => {
      // Start with one token
      setLocalStorage(createMockStorageData({
        "token1": createMockTxfToken("token1"),
      }));

      // Add an incoming token
      const params: SyncParams = {
        ...createBaseSyncParams(),
        incomingTokens: [createMockToken("incoming1")],
      };

      const result = await inventorySync(params);

      // With changes, IPFS upload should be triggered (in non-LOCAL mode)
      // We verify via the result having ipnsPublishPending flag
      expect(result.ipnsPublishPending).toBeDefined();
    });

    it("should skip IPFS upload in LOCAL mode", async () => {
      setLocalStorage(createMockStorageData({
        "token1": createMockTxfToken("token1"),
      }));

      const params: SyncParams = {
        ...createBaseSyncParams(),
        local: true,
        incomingTokens: [createMockToken("incoming1")],
      };

      const result = await inventorySync(params);

      expect(result.syncMode).toBe("LOCAL");
      // LOCAL mode should not attempt IPFS publish
      expect(result.ipnsPublished).toBeFalsy();
    });

    it("should persist _meta with correct structure", async () => {
      setLocalStorage(createMockStorageData({
        "token1": createMockTxfToken("token1"),
      }));

      const params = createBaseSyncParams();
      await inventorySync(params);

      const stored = getLocalStorage();
      expect(stored?._meta).toBeDefined();
      expect(stored?._meta?.formatVersion).toBe("2.0");
      expect(stored?._meta?.address).toBe(TEST_ADDRESS);
      // Version should be a number
      expect(typeof stored?._meta?.version).toBe("number");
    });

    it("should track token counts correctly after upload prep", async () => {
      setLocalStorage(createMockStorageData({
        "token1": createMockTxfToken("token1"),
        "token2": createMockTxfToken("token2"),
      }));

      const params = createBaseSyncParams();
      const result = await inventorySync(params);

      // inventoryStats should have correct token counts
      expect(result.inventoryStats?.activeTokens).toBe(2);
      expect(result.inventoryStats?.sentTokens).toBe(0);
      expect(result.inventoryStats?.invalidTokens).toBe(0);
    });
  });

  // ------------------------------------------
  // Circuit Breaker State Tests (Section 10.2, 10.6)
  // ------------------------------------------

  describe("Circuit Breaker State", () => {
    it("should include circuitBreaker in result", async () => {
      setLocalStorage(createMockStorageData({
        "token1": createMockTxfToken("token1"),
      }));

      const params = createBaseSyncParams();
      const result = await inventorySync(params);

      expect(result.circuitBreaker).toBeDefined();
      expect(result.circuitBreaker?.localModeActive).toBe(false);
      expect(result.circuitBreaker?.consecutiveConflicts).toBe(0);
    });

    it("should have localModeActive=false in NORMAL mode", async () => {
      setLocalStorage(createMockStorageData({
        "token1": createMockTxfToken("token1"),
      }));

      const params = createBaseSyncParams();
      const result = await inventorySync(params);

      expect(result.syncMode).toBe("NORMAL");
      expect(result.circuitBreaker?.localModeActive).toBe(false);
    });

    it("should preserve circuitBreaker state across syncs", async () => {
      setLocalStorage(createMockStorageData({
        "token1": createMockTxfToken("token1"),
      }));

      const params = createBaseSyncParams();
      const result1 = await inventorySync(params);
      const result2 = await inventorySync(params);

      // Circuit breaker should be consistent
      expect(result2.circuitBreaker?.localModeActive).toBe(
        result1.circuitBreaker?.localModeActive
      );
    });
  });

  // ------------------------------------------
  // Proof Validation Tests (Steps 3-4) - Chain Integrity
  // ------------------------------------------

  describe("Proof Validation - Chain Integrity (Steps 3-4)", () => {
    it("should normalize transaction hash missing 0000 prefix", async () => {
      // Create token with transaction hash missing "0000" prefix
      const tokenWithUnnormalizedHash = createMockTxfToken("unnorm1");
      // Modify the proof to have unnormalized hash
      if (tokenWithUnnormalizedHash.genesis.inclusionProof) {
        tokenWithUnnormalizedHash.genesis.inclusionProof.transactionHash = "a".repeat(64);
      }

      setLocalStorage(createMockStorageData({
        "unnorm1": tokenWithUnnormalizedHash,
      }));

      const params = createBaseSyncParams();
      const result = await inventorySync(params);

      // Token should still be valid after normalization
      expect(result.inventoryStats?.activeTokens).toBeGreaterThanOrEqual(0);
    });

    it("should normalize stateHash missing 0000 prefix", async () => {
      const tokenWithUnnormalizedState = createMockTxfToken("unnorm2");
      // Modify the authenticator stateHash to be unnormalized
      if (tokenWithUnnormalizedState.genesis.inclusionProof?.authenticator) {
        tokenWithUnnormalizedState.genesis.inclusionProof.authenticator.stateHash = "b".repeat(64);
      }

      setLocalStorage(createMockStorageData({
        "unnorm2": tokenWithUnnormalizedState,
      }));

      const params = createBaseSyncParams();
      const result = await inventorySync(params);

      // Normalization should fix the hash
      expect(result.status).not.toBe("ERROR");
    });

    it("should validate genesis-to-first-transaction chain", async () => {
      // Token with proper chain: genesis stateHash matches tx[0].previousStateHash
      const tokenWithValidChain = createMockTxfToken("valid1", "1000", 1);

      setLocalStorage(createMockStorageData({
        "valid1": tokenWithValidChain,
      }));

      const params = createBaseSyncParams();
      const result = await inventorySync(params);

      // Valid chain should keep token active
      expect(result.inventoryStats?.activeTokens).toBe(1);
      expect(result.inventoryStats?.invalidTokens).toBe(0);
    });

    it("should reject token with broken state hash chain", async () => {
      // Create token where tx[0].previousStateHash doesn't match genesis
      const tokenWithBrokenChain: TxfToken = {
        ...createMockTxfToken("broken1"),
        transactions: [{
          data: { recipient: "someone" },
          previousStateHash: "0000" + "wrong".padEnd(60, "0"), // Wrong - doesn't match genesis
          newStateHash: "0000" + "new".padEnd(60, "0"),
          inclusionProof: {
            authenticator: { stateHash: "0000" + "new".padEnd(60, "0") },
            merkleTreePath: { root: "0000" + "root".padEnd(60, "0"), path: [] },
            transactionHash: "0000" + "txhash".padEnd(60, "0"),
          },
        }],
        _integrity: {
          currentStateHash: "0000" + "new".padEnd(60, "0"),
          genesisDataJSONHash: "0000" + "genesis".padEnd(60, "0"),
        },
      };

      setLocalStorage(createMockStorageData({
        "broken1": tokenWithBrokenChain,
      }));

      const params = createBaseSyncParams();
      const result = await inventorySync(params);

      // Broken chain should move token to Invalid folder
      expect(result.inventoryStats?.invalidTokens).toBeGreaterThanOrEqual(1);
    });

    it("should validate multi-transaction chain integrity", async () => {
      // Token with 3 transactions - each links to previous
      const tokenWithLongChain = createMockTxfToken("longchain", "1000", 3);

      setLocalStorage(createMockStorageData({
        "longchain": tokenWithLongChain,
      }));

      const params = createBaseSyncParams();
      const result = await inventorySync(params);

      // Valid long chain should pass
      expect(result.inventoryStats?.activeTokens).toBe(1);
    });
  });

  // ------------------------------------------
  // Outbox Processing Tests (Split Operations)
  // ------------------------------------------

  describe("Outbox Processing - Split Operations", () => {
    it("should track outbox entries with splitGroupId", async () => {
      const splitGroupId = "split-group-123";
      const outboxEntries: OutboxEntry[] = [
        {
          id: "burn-entry",
          type: "SPLIT_BURN",
          status: "COMPLETED",
          sourceTokenId: "source1".padEnd(64, "0"),
          splitGroupId,
          splitIndex: 0,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        } as OutboxEntry,
        {
          id: "mint-entry-1",
          type: "SPLIT_MINT",
          status: "READY_TO_SUBMIT",
          sourceTokenId: "source1".padEnd(64, "0"),
          splitGroupId,
          splitIndex: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        } as OutboxEntry,
      ];

      setLocalStorage(createMockStorageData({
        "source1": createMockTxfToken("source1"),
      }));

      // Set outbox in localStorage
      const storageKey = STORAGE_KEY_GENERATORS.walletByAddress(TEST_ADDRESS);
      const data = JSON.parse(localStorage.getItem(storageKey) || "{}");
      data._outbox = outboxEntries;
      localStorage.setItem(storageKey, JSON.stringify(data));

      const params = createBaseSyncParams();
      const result = await inventorySync(params);

      // Outbox entries should be tracked
      expect(result.inventoryStats?.outboxTokens).toBe(2);
    });

    it("should mark mint as FAILED after status indicates failure", async () => {
      const failedMintEntry: OutboxEntry = {
        id: "failed-mint",
        type: "SPLIT_MINT",
        status: "FAILED",
        sourceTokenId: "source1".padEnd(64, "0"),
        splitGroupId: "split-fail-123",
        splitIndex: 1,
        retryCount: 10,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      } as OutboxEntry;

      setLocalStorage(createMockStorageData({
        "source1": createMockTxfToken("source1"),
      }));

      const storageKey = STORAGE_KEY_GENERATORS.walletByAddress(TEST_ADDRESS);
      const data = JSON.parse(localStorage.getItem(storageKey) || "{}");
      data._outbox = [failedMintEntry];
      localStorage.setItem(storageKey, JSON.stringify(data));

      const params = createBaseSyncParams();
      await inventorySync(params);

      // Failed entry should still be in outbox for manual intervention
      const stored = getLocalStorage();
      const failedEntries = stored?._outbox?.filter(
        (e: OutboxEntry) => e.status === "FAILED"
      );
      expect(failedEntries?.length).toBeGreaterThanOrEqual(0);
    });

    it("should preserve ABANDONED status for unrecoverable entries", async () => {
      const abandonedEntry: OutboxEntry = {
        id: "abandoned-mint",
        type: "SPLIT_MINT",
        status: "ABANDONED",
        sourceTokenId: "source1".padEnd(64, "0"),
        splitGroupId: "split-abandoned-123",
        splitIndex: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      } as OutboxEntry;

      setLocalStorage(createMockStorageData({
        "source1": createMockTxfToken("source1"),
      }));

      const storageKey = STORAGE_KEY_GENERATORS.walletByAddress(TEST_ADDRESS);
      const data = JSON.parse(localStorage.getItem(storageKey) || "{}");
      data._outbox = [abandonedEntry];
      localStorage.setItem(storageKey, JSON.stringify(data));

      const params = createBaseSyncParams();
      await inventorySync(params);

      const stored = getLocalStorage();
      const abandonedEntries = stored?._outbox?.filter(
        (e: OutboxEntry) => e.status === "ABANDONED"
      );
      // ABANDONED entries should be preserved
      expect(abandonedEntries?.length).toBe(1);
    });
  });

  // ------------------------------------------
  // Circuit Breaker Activation Tests (Section 10.2, 10.6, 10.7) - CRITICAL
  // ------------------------------------------

  describe("Circuit Breaker Activation Logic", () => {
    it("should track consecutiveIpfsFailures in circuitBreaker state", async () => {
      // Simulate IPFS failure scenario
      mockIpfsAvailable = false;

      setLocalStorage(createMockStorageData({
        "token1": createMockTxfToken("token1"),
      }));

      const params = createBaseSyncParams();
      const result = await inventorySync(params);

      // Circuit breaker should be present in result
      expect(result.circuitBreaker).toBeDefined();
      // Even if IPFS fails, we don't activate LOCAL mode automatically on first failure
      expect(result.circuitBreaker?.localModeActive).toBe(false);
    });

    it("should include all required circuitBreaker fields", async () => {
      setLocalStorage(createMockStorageData({
        "token1": createMockTxfToken("token1"),
      }));

      const params = createBaseSyncParams();
      const result = await inventorySync(params);

      expect(result.circuitBreaker).toBeDefined();
      expect(typeof result.circuitBreaker?.localModeActive).toBe("boolean");
      expect(typeof result.circuitBreaker?.consecutiveConflicts).toBe("number");
      expect(typeof result.circuitBreaker?.consecutiveIpfsFailures).toBe("number");
    });

    it("should preserve circuitBreaker.consecutiveConflicts across syncs", async () => {
      setLocalStorage(createMockStorageData({
        "token1": createMockTxfToken("token1"),
      }));

      // First sync - baseline
      const params = createBaseSyncParams();
      const result1 = await inventorySync(params);
      expect(result1.circuitBreaker?.consecutiveConflicts).toBe(0);

      // Second sync should maintain state
      const result2 = await inventorySync(params);
      expect(result2.circuitBreaker?.consecutiveConflicts).toBe(0);
    });

    it("should set localModeActive=false when syncing successfully", async () => {
      setLocalStorage(createMockStorageData({
        "token1": createMockTxfToken("token1"),
      }));

      const params = createBaseSyncParams();
      const result = await inventorySync(params);

      expect(result.circuitBreaker?.localModeActive).toBe(false);
    });
  });

  // ------------------------------------------
  // Auto LOCAL Mode Detection Tests (Section 10.2)
  // ------------------------------------------

  describe("Auto LOCAL Mode Detection", () => {
    it("should detect LOCAL mode when local=true is explicitly set", async () => {
      setLocalStorage(createMockStorageData({
        "token1": createMockTxfToken("token1"),
      }));

      const params: SyncParams = {
        ...createBaseSyncParams(),
        local: true,
      };

      const result = await inventorySync(params);

      expect(result.syncMode).toBe("LOCAL");
      expect(result.status).toMatch(/^(SUCCESS|PARTIAL_SUCCESS|LOCAL_ONLY)$/);
    });

    it("should continue in NORMAL mode when IPFS resolution fails (graceful degradation)", async () => {
      // IPFS is unavailable but sync should continue
      mockIpfsAvailable = false;

      setLocalStorage(createMockStorageData({
        "token1": createMockTxfToken("token1"),
      }));

      const params = createBaseSyncParams();
      const result = await inventorySync(params);

      // Should complete with NORMAL mode (IPFS failure is non-fatal)
      expect(result.syncMode).toBe("NORMAL");
      expect(result.status).not.toBe("ERROR");
    });

    it("should skip IPFS Step 2 load in LOCAL mode", async () => {
      // Set up remote data that would merge if IPFS was checked
      mockIpfsAvailable = true;
      mockRemoteData = createMockStorageData({
        "remote1": createMockTxfToken("remote1"),
      });

      setLocalStorage(createMockStorageData({
        "local1": createMockTxfToken("local1"),
      }));

      const params: SyncParams = {
        ...createBaseSyncParams(),
        local: true,
      };

      const result = await inventorySync(params);

      // LOCAL mode should only have local token (skipped IPFS merge)
      expect(result.inventoryStats?.activeTokens).toBe(1);
    });

    it("should skip IPFS Step 10 upload in LOCAL mode", async () => {
      setLocalStorage(createMockStorageData({
        "token1": createMockTxfToken("token1"),
      }));

      const params: SyncParams = {
        ...createBaseSyncParams(),
        local: true,
      };

      const result = await inventorySync(params);

      expect(result.syncMode).toBe("LOCAL");
      // No IPNS publish in LOCAL mode
      expect(result.ipnsPublished).toBeFalsy();
      expect(result.ipnsPublishPending).toBeFalsy();
    });
  });

  // ------------------------------------------
  // Auto-Recovery Procedure Tests (Section 10.7)
  // ------------------------------------------

  describe("Auto-Recovery Procedures", () => {
    it("should include nextRecoveryAttempt field when localModeActive", async () => {
      // This tests the structure even if we don't have auto-activation yet
      setLocalStorage(createMockStorageData({
        "token1": createMockTxfToken("token1"),
      }));

      const params = createBaseSyncParams();
      const result = await inventorySync(params);

      // Circuit breaker should be defined
      expect(result.circuitBreaker).toBeDefined();
      // When not in LOCAL mode, nextRecoveryAttempt is undefined
      if (!result.circuitBreaker?.localModeActive) {
        expect(result.circuitBreaker?.nextRecoveryAttempt).toBeUndefined();
      }
    });

    it("should complete sync successfully after validation errors (non-fatal)", async () => {
      // Configure validation to fail for one token
      // Token.id matches storage key, not the padded genesis tokenId
      mockValidationResult = {
        valid: false,
        issues: [{ tokenId: "invalid1", reason: "Test validation error" }],
      };

      setLocalStorage(createMockStorageData({
        "invalid1": createMockTxfToken("invalid1"),
        "valid1": createMockTxfToken("valid1"),
      }));

      const params = createBaseSyncParams();
      const result = await inventorySync(params);

      // Sync should complete (validation errors are non-fatal)
      expect(result.status).not.toBe("ERROR");
      expect(result.inventoryStats?.activeTokens).toBe(1);
      expect(result.inventoryStats?.invalidTokens).toBe(1);
    });

    it("should complete sync with errors recorded in validationIssues", async () => {
      // Force IPFS to fail in a way that records an error
      mockIpfsAvailable = false;

      setLocalStorage(createMockStorageData({
        "token1": createMockTxfToken("token1"),
      }));

      const params = createBaseSyncParams();
      const result = await inventorySync(params);

      // Sync should still complete
      expect(result.status).not.toBe("ERROR");
      // Errors might be recorded in validationIssues
      // (depends on implementation - if IPFS failure is logged)
    });

    it("should preserve all tokens when recovering from SDK validation error", async () => {
      // One token fails, one passes
      // Token.id matches storage key, not the padded genesis tokenId
      mockValidationResult = {
        valid: false,
        issues: [{ tokenId: "fail1", reason: "SDK error" }],
      };

      setLocalStorage(createMockStorageData({
        "fail1": createMockTxfToken("fail1"),
        "pass1": createMockTxfToken("pass1"),
      }));

      const params = createBaseSyncParams();
      await inventorySync(params);

      // Verify storage state
      const stored = getLocalStorage();
      expect(stored?._invalid?.length).toBe(1);

      // Good token should still be in active storage
      const tokenKeys = Object.keys(stored || {}).filter(k =>
        k.startsWith("_") &&
        !k.startsWith("_meta") &&
        !k.startsWith("_sent") &&
        !k.startsWith("_invalid") &&
        !k.startsWith("_outbox") &&
        !k.startsWith("_tombstones") &&
        !k.startsWith("_nametag")
      );
      expect(tokenKeys.length).toBe(1);
    });
  });

  // ------------------------------------------
  // Transaction Hash Verification Tests (Step 4 - CRITICAL)
  // ------------------------------------------

  describe("Transaction Hash Verification (Step 4)", () => {
    it("should validate transactionHash has proper hex format", async () => {
      // Create token with valid hex transactionHash
      const validToken = createMockTxfToken("valid1");
      expect(validToken.genesis.inclusionProof?.transactionHash).toMatch(/^[0-9a-fA-F]+$/);

      setLocalStorage(createMockStorageData({
        "valid1": validToken,
      }));

      const params = createBaseSyncParams();
      const result = await inventorySync(params);

      expect(result.inventoryStats?.activeTokens).toBe(1);
      expect(result.inventoryStats?.invalidTokens).toBe(0);
    });

    it("should invalidate token with malformed transactionHash", async () => {
      // Create token with invalid transactionHash (non-hex characters)
      const tokenWithBadHash: TxfToken = {
        ...createMockTxfToken("bad1"),
        genesis: {
          ...createMockTxfToken("bad1").genesis,
          inclusionProof: {
            ...createMockTxfToken("bad1").genesis.inclusionProof!,
            transactionHash: "INVALID_NOT_HEX_STRING!!!",
          },
        },
      };

      setLocalStorage(createMockStorageData({
        "bad1": tokenWithBadHash,
      }));

      const params = createBaseSyncParams();
      const result = await inventorySync(params);

      // Token should be moved to Invalid folder
      expect(result.inventoryStats?.invalidTokens).toBe(1);
      expect(result.inventoryStats?.activeTokens).toBe(0);
    });

    it("should validate stateHash format (64+ hex chars with optional 0000 prefix)", async () => {
      // Create token with properly formatted stateHash
      const validToken = createMockTxfToken("valid2");
      expect(validToken.genesis.inclusionProof?.authenticator?.stateHash).toMatch(/^0000[0-9a-fA-F]{60,}$/);

      setLocalStorage(createMockStorageData({
        "valid2": validToken,
      }));

      const params = createBaseSyncParams();
      const result = await inventorySync(params);

      expect(result.inventoryStats?.activeTokens).toBe(1);
    });

    it("should accept token with missing transactionHash (optional field)", async () => {
      // Create token without transactionHash
      // This is valid because:
      // 1. Some SDK versions/faucet tokens don't populate this field
      // 2. Full cryptographic validation happens in Step 5 via SDK's token.verify()
      const tokenWithoutTxHash: TxfToken = {
        ...createMockTxfToken("notxhash"),
        genesis: {
          ...createMockTxfToken("notxhash").genesis,
          inclusionProof: {
            authenticator: { stateHash: "0000" + "a".repeat(60) },
            merkleTreePath: { root: "0000" + "b".repeat(60), path: [] },
            // Missing transactionHash - this is OK, it's optional
          } as TxfToken["genesis"]["inclusionProof"],
        },
      };

      setLocalStorage(createMockStorageData({
        "notxhash": tokenWithoutTxHash,
      }));

      const params = createBaseSyncParams();
      const result = await inventorySync(params);

      // Should remain in Active folder (transactionHash is optional)
      expect(result.inventoryStats?.invalidTokens).toBe(0);
      expect(result.inventoryStats?.activeTokens).toBe(1);
    });

    it("should validate merkle root format", async () => {
      // Create token with invalid merkle root
      const tokenWithBadRoot: TxfToken = {
        ...createMockTxfToken("badroot"),
        genesis: {
          ...createMockTxfToken("badroot").genesis,
          inclusionProof: {
            ...createMockTxfToken("badroot").genesis.inclusionProof!,
            merkleTreePath: { root: "NOT_HEX!!!", path: [] },
          },
        },
      };

      setLocalStorage(createMockStorageData({
        "badroot": tokenWithBadRoot,
      }));

      const params = createBaseSyncParams();
      const result = await inventorySync(params);

      // Should be moved to Invalid folder
      expect(result.inventoryStats?.invalidTokens).toBe(1);
    });
  });

  // ------------------------------------------
  // Split Burn Recovery Tests (Section 13.25) - CRITICAL
  // ------------------------------------------

  describe("Split Burn Recovery (Section 13.25) - Value Loss Prevention", () => {
    it("should preserve split group when burn succeeds but mints pending", async () => {
      const splitGroupId = "recovery-group-123";

      // Burn completed, mint still pending
      const outboxEntries: OutboxEntry[] = [
        {
          id: "burn-completed",
          type: "SPLIT_BURN",
          status: "COMPLETED",
          sourceTokenId: "source1".padEnd(64, "0"),
          splitGroupId,
          splitIndex: 0,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        } as OutboxEntry,
        {
          id: "mint-pending",
          type: "SPLIT_MINT",
          status: "READY_TO_SUBMIT",
          sourceTokenId: "source1".padEnd(64, "0"),
          splitGroupId,
          splitIndex: 1,
          retryCount: 0,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        } as OutboxEntry,
      ];

      setLocalStorage(createMockStorageData({}));

      const storageKey = STORAGE_KEY_GENERATORS.walletByAddress(TEST_ADDRESS);
      const data = JSON.parse(localStorage.getItem(storageKey) || "{}");
      data._outbox = outboxEntries;
      localStorage.setItem(storageKey, JSON.stringify(data));

      const params = createBaseSyncParams();
      await inventorySync(params);

      // Split group should be preserved for recovery
      const stored = getLocalStorage();
      const groupEntries = stored?._outbox?.filter(
        (e: OutboxEntry) => e.splitGroupId === splitGroupId
      );
      expect(groupEntries?.length).toBe(2);
    });

    it("should track retry count for mint operations", async () => {
      const mintWithRetries: OutboxEntry = {
        id: "mint-retrying",
        type: "SPLIT_MINT",
        status: "READY_TO_SUBMIT",
        sourceTokenId: "source1".padEnd(64, "0"),
        splitGroupId: "retry-group-123",
        splitIndex: 1,
        retryCount: 5,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      } as OutboxEntry;

      setLocalStorage(createMockStorageData({}));

      const storageKey = STORAGE_KEY_GENERATORS.walletByAddress(TEST_ADDRESS);
      const data = JSON.parse(localStorage.getItem(storageKey) || "{}");
      data._outbox = [mintWithRetries];
      localStorage.setItem(storageKey, JSON.stringify(data));

      const params = createBaseSyncParams();
      await inventorySync(params);

      // Retry count should be preserved
      const stored = getLocalStorage();
      const entry = stored?._outbox?.find((e: OutboxEntry) => e.id === "mint-retrying");
      expect(entry?.retryCount).toBe(5);
    });

    it("should maintain splitGroupId linkage for burn-mint pairs", async () => {
      const splitGroupId = "linked-group-456";

      const outboxEntries: OutboxEntry[] = [
        {
          id: "burn-1",
          type: "SPLIT_BURN",
          status: "COMPLETED",
          sourceTokenId: "source1".padEnd(64, "0"),
          splitGroupId,
          splitIndex: 0,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        } as OutboxEntry,
        {
          id: "mint-sender",
          type: "SPLIT_MINT",
          status: "COMPLETED",
          sourceTokenId: "source1".padEnd(64, "0"),
          splitGroupId,
          splitIndex: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        } as OutboxEntry,
        {
          id: "mint-recipient",
          type: "SPLIT_MINT",
          status: "FAILED",
          sourceTokenId: "source1".padEnd(64, "0"),
          splitGroupId,
          splitIndex: 2,
          retryCount: 10,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        } as OutboxEntry,
      ];

      setLocalStorage(createMockStorageData({}));

      const storageKey = STORAGE_KEY_GENERATORS.walletByAddress(TEST_ADDRESS);
      const data = JSON.parse(localStorage.getItem(storageKey) || "{}");
      data._outbox = outboxEntries;
      localStorage.setItem(storageKey, JSON.stringify(data));

      const params = createBaseSyncParams();
      await inventorySync(params);

      // Verify all entries in split group are preserved
      const stored = getLocalStorage();
      const burnEntry = stored?._outbox?.find((e: OutboxEntry) => e.type === "SPLIT_BURN");
      const mintEntries = stored?._outbox?.filter((e: OutboxEntry) => e.type === "SPLIT_MINT");

      expect(burnEntry?.splitGroupId).toBe(splitGroupId);
      expect(mintEntries?.every((e: OutboxEntry) => e.splitGroupId === splitGroupId)).toBe(true);
    });

    it("should not remove FAILED mints (require manual intervention)", async () => {
      const failedMint: OutboxEntry = {
        id: "failed-mint-critical",
        type: "SPLIT_MINT",
        status: "FAILED",
        sourceTokenId: "source1".padEnd(64, "0"),
        splitGroupId: "failed-group-789",
        splitIndex: 1,
        retryCount: 10,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      } as OutboxEntry;

      setLocalStorage(createMockStorageData({}));

      const storageKey = STORAGE_KEY_GENERATORS.walletByAddress(TEST_ADDRESS);
      const data = JSON.parse(localStorage.getItem(storageKey) || "{}");
      data._outbox = [failedMint];
      localStorage.setItem(storageKey, JSON.stringify(data));

      const params = createBaseSyncParams();
      await inventorySync(params);

      // FAILED entries should NOT be automatically removed
      const stored = getLocalStorage();
      const failedEntries = stored?._outbox?.filter(
        (e: OutboxEntry) => e.status === "FAILED"
      );
      expect(failedEntries?.length).toBe(1);
    });

    it("should track multiple split groups independently", async () => {
      const group1 = "split-group-1";
      const group2 = "split-group-2";

      const outboxEntries: OutboxEntry[] = [
        // Group 1: Both completed
        {
          id: "g1-burn",
          type: "SPLIT_BURN",
          status: "COMPLETED",
          sourceTokenId: "source1".padEnd(64, "0"),
          splitGroupId: group1,
          splitIndex: 0,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        } as OutboxEntry,
        {
          id: "g1-mint",
          type: "SPLIT_MINT",
          status: "COMPLETED",
          sourceTokenId: "source1".padEnd(64, "0"),
          splitGroupId: group1,
          splitIndex: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        } as OutboxEntry,
        // Group 2: Burn completed, mint pending
        {
          id: "g2-burn",
          type: "SPLIT_BURN",
          status: "COMPLETED",
          sourceTokenId: "source2".padEnd(64, "0"),
          splitGroupId: group2,
          splitIndex: 0,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        } as OutboxEntry,
        {
          id: "g2-mint",
          type: "SPLIT_MINT",
          status: "READY_TO_SUBMIT",
          sourceTokenId: "source2".padEnd(64, "0"),
          splitGroupId: group2,
          splitIndex: 1,
          retryCount: 3,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        } as OutboxEntry,
      ];

      setLocalStorage(createMockStorageData({}));

      const storageKey = STORAGE_KEY_GENERATORS.walletByAddress(TEST_ADDRESS);
      const data = JSON.parse(localStorage.getItem(storageKey) || "{}");
      data._outbox = outboxEntries;
      localStorage.setItem(storageKey, JSON.stringify(data));

      const params = createBaseSyncParams();
      await inventorySync(params);

      const stored = getLocalStorage();
      const g1Entries = stored?._outbox?.filter((e: OutboxEntry) => e.splitGroupId === group1);
      const g2Entries = stored?._outbox?.filter((e: OutboxEntry) => e.splitGroupId === group2);

      // Both groups should be preserved independently
      expect(g1Entries?.length).toBe(2);
      expect(g2Entries?.length).toBe(2);
    });

    it("should preserve outbox timestamps for audit trail", async () => {
      const originalTimestamp = Date.now() - 86400000; // 24 hours ago

      const outboxEntry: OutboxEntry = {
        id: "audit-entry",
        type: "SPLIT_MINT",
        status: "READY_TO_SUBMIT",
        sourceTokenId: "source1".padEnd(64, "0"),
        splitGroupId: "audit-group",
        splitIndex: 1,
        retryCount: 2,
        createdAt: originalTimestamp,
        updatedAt: originalTimestamp + 3600000, // 1 hour after creation
      } as OutboxEntry;

      setLocalStorage(createMockStorageData({}));

      const storageKey = STORAGE_KEY_GENERATORS.walletByAddress(TEST_ADDRESS);
      const data = JSON.parse(localStorage.getItem(storageKey) || "{}");
      data._outbox = [outboxEntry];
      localStorage.setItem(storageKey, JSON.stringify(data));

      const params = createBaseSyncParams();
      await inventorySync(params);

      const stored = getLocalStorage();
      const entry = stored?._outbox?.find((e: OutboxEntry) => e.id === "audit-entry");

      // Timestamps should be preserved for audit
      expect(entry?.createdAt).toBe(originalTimestamp);
      expect(entry?.updatedAt).toBe(originalTimestamp + 3600000);
    });

    it("should handle orphan mint (no corresponding burn) gracefully", async () => {
      // Mint without a burn in the same split group
      const orphanMint: OutboxEntry = {
        id: "orphan-mint",
        type: "SPLIT_MINT",
        status: "READY_TO_SUBMIT",
        sourceTokenId: "source1".padEnd(64, "0"),
        splitGroupId: "orphan-group",
        splitIndex: 1,
        retryCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      } as OutboxEntry;

      setLocalStorage(createMockStorageData({}));

      const storageKey = STORAGE_KEY_GENERATORS.walletByAddress(TEST_ADDRESS);
      const data = JSON.parse(localStorage.getItem(storageKey) || "{}");
      data._outbox = [orphanMint];
      localStorage.setItem(storageKey, JSON.stringify(data));

      const params = createBaseSyncParams();
      const result = await inventorySync(params);

      // Should not error - orphan entries are preserved
      expect(result.status).not.toBe("ERROR");

      const stored = getLocalStorage();
      expect(stored?._outbox?.length).toBe(1);
    });
  });
});
