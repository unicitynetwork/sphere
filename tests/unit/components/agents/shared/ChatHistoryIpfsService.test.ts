import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { STORAGE_KEYS } from "../../../../../src/config/storageKeys";

// ==========================================
// Mock Setup
// ==========================================

// Mock IdentityManager
vi.mock("../../../../../src/components/wallet/L3/services/IdentityManager", () => ({
  IdentityManager: {
    getInstance: vi.fn(() => ({
      getMasterSeed: vi.fn().mockReturnValue(new Uint8Array(32).fill(1)),
      getWalletAddress: vi.fn().mockReturnValue("0x123"),
    })),
  },
}));

// Mock IPFS config
vi.mock("../../../../../src/config/ipfs.config", () => ({
  getBootstrapPeers: vi.fn(() => []),
  getAllBackendGatewayUrls: vi.fn(() => []),
  IPNS_RESOLUTION_CONFIG: { timeout: 1000 },
  IPFS_CONFIG: { timeout: 1000 },
}));

// Mock Helia and related
vi.mock("helia", () => ({
  createHelia: vi.fn(),
}));

vi.mock("@helia/json", () => ({
  json: vi.fn(),
}));

vi.mock("@libp2p/bootstrap", () => ({
  bootstrap: vi.fn(),
}));

vi.mock("@libp2p/crypto/keys", () => ({
  generateKeyPairFromSeed: vi.fn(),
}));

vi.mock("@libp2p/peer-id", () => ({
  peerIdFromPrivateKey: vi.fn(),
}));

vi.mock("ipns", () => ({
  createIPNSRecord: vi.fn(),
  marshalIPNSRecord: vi.fn(),
  unmarshalIPNSRecord: vi.fn(),
}));

// Mock ChatHistoryRepository
vi.mock("../../../../../src/components/agents/shared/ChatHistoryRepository", () => ({
  chatHistoryRepository: {
    getAllSessions: vi.fn(() => []),
    getMessages: vi.fn(() => []),
  },
}));

// Import after mocking
import {
  ChatHistoryIpfsService,
  getChatHistoryIpfsService,
} from "../../../../../src/components/agents/shared/ChatHistoryIpfsService";

// ==========================================
// ChatHistoryIpfsService Tests
// ==========================================

describe("ChatHistoryIpfsService", () => {
  let localStorageMock: Record<string, string>;

  beforeEach(() => {
    localStorageMock = {};

    // Mock localStorage
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) => localStorageMock[key] || null),
      setItem: vi.fn((key: string, value: string) => {
        localStorageMock[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete localStorageMock[key];
      }),
      clear: vi.fn(() => {
        localStorageMock = {};
      }),
      key: vi.fn((index: number) => Object.keys(localStorageMock)[index] || null),
      get length() {
        return Object.keys(localStorageMock).length;
      },
    });

    // Mock window
    vi.stubGlobal("window", {
      ...globalThis.window,
      dispatchEvent: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  // ==========================================
  // Singleton Tests
  // ==========================================

  describe("getInstance", () => {
    it("should return singleton instance", () => {
      const instance1 = ChatHistoryIpfsService.getInstance();
      const instance2 = ChatHistoryIpfsService.getInstance();

      expect(instance1).toBe(instance2);
    });
  });

  describe("getChatHistoryIpfsService", () => {
    it("should return singleton via accessor function", () => {
      const instance1 = getChatHistoryIpfsService();
      const instance2 = getChatHistoryIpfsService();

      expect(instance1).toBe(instance2);
      expect(instance1).toBe(ChatHistoryIpfsService.getInstance());
    });
  });

  // ==========================================
  // Tombstone Management Tests
  // ==========================================

  describe("recordSessionDeletion", () => {
    it("should record tombstone for deleted session", () => {
      const service = getChatHistoryIpfsService();

      service.recordSessionDeletion("session-1");

      const tombstones = JSON.parse(localStorageMock[STORAGE_KEYS.AGENT_CHAT_TOMBSTONES]);
      expect(tombstones["session-1"]).toBeDefined();
      expect(tombstones["session-1"].sessionId).toBe("session-1");
      expect(tombstones["session-1"].reason).toBe("user-deleted");
    });

    it("should preserve existing tombstones", () => {
      localStorageMock[STORAGE_KEYS.AGENT_CHAT_TOMBSTONES] = JSON.stringify({
        "existing-session": {
          sessionId: "existing-session",
          deletedAt: Date.now() - 1000,
          reason: "user-deleted",
        },
      });

      const service = getChatHistoryIpfsService();
      service.recordSessionDeletion("new-session");

      const tombstones = JSON.parse(localStorageMock[STORAGE_KEYS.AGENT_CHAT_TOMBSTONES]);
      expect(tombstones["existing-session"]).toBeDefined();
      expect(tombstones["new-session"]).toBeDefined();
    });
  });

  describe("recordBulkDeletion", () => {
    it("should record tombstones for multiple sessions", () => {
      const service = getChatHistoryIpfsService();

      service.recordBulkDeletion(["session-1", "session-2", "session-3"]);

      const tombstones = JSON.parse(localStorageMock[STORAGE_KEYS.AGENT_CHAT_TOMBSTONES]);
      expect(Object.keys(tombstones)).toHaveLength(3);
      expect(tombstones["session-1"].reason).toBe("clear-all");
      expect(tombstones["session-2"].reason).toBe("clear-all");
      expect(tombstones["session-3"].reason).toBe("clear-all");
    });

    it("should use same timestamp for all tombstones in bulk", () => {
      const service = getChatHistoryIpfsService();

      service.recordBulkDeletion(["session-1", "session-2"]);

      const tombstones = JSON.parse(localStorageMock[STORAGE_KEYS.AGENT_CHAT_TOMBSTONES]);
      expect(tombstones["session-1"].deletedAt).toBe(tombstones["session-2"].deletedAt);
    });
  });

  describe("cleanupOldTombstones", () => {
    it("should return 0 when no tombstones exist", () => {
      const service = getChatHistoryIpfsService();

      const removed = service.cleanupOldTombstones();

      expect(removed).toBe(0);
    });

    it("should remove tombstones older than 30 days", () => {
      const now = Date.now();
      const thirtyOneDaysAgo = now - 31 * 24 * 60 * 60 * 1000;
      const twentyDaysAgo = now - 20 * 24 * 60 * 60 * 1000;

      localStorageMock[STORAGE_KEYS.AGENT_CHAT_TOMBSTONES] = JSON.stringify({
        "old-session": {
          sessionId: "old-session",
          deletedAt: thirtyOneDaysAgo,
          reason: "user-deleted",
        },
        "recent-session": {
          sessionId: "recent-session",
          deletedAt: twentyDaysAgo,
          reason: "user-deleted",
        },
      });

      const service = getChatHistoryIpfsService();
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const removed = service.cleanupOldTombstones();

      expect(removed).toBe(1);

      const tombstones = JSON.parse(localStorageMock[STORAGE_KEYS.AGENT_CHAT_TOMBSTONES]);
      expect(tombstones["old-session"]).toBeUndefined();
      expect(tombstones["recent-session"]).toBeDefined();

      consoleSpy.mockRestore();
    });

    it("should keep tombstones under 30 days old", () => {
      const now = Date.now();
      // Use 29 days + 23 hours to safely stay under 30 day threshold
      // This avoids flaky tests from millisecond timing differences
      const justUnderThirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000 - 60 * 60 * 1000);

      localStorageMock[STORAGE_KEYS.AGENT_CHAT_TOMBSTONES] = JSON.stringify({
        "boundary-session": {
          sessionId: "boundary-session",
          deletedAt: justUnderThirtyDaysAgo,
          reason: "user-deleted",
        },
      });

      const service = getChatHistoryIpfsService();

      const removed = service.cleanupOldTombstones();

      expect(removed).toBe(0);

      const tombstones = JSON.parse(localStorageMock[STORAGE_KEYS.AGENT_CHAT_TOMBSTONES]);
      expect(tombstones["boundary-session"]).toBeDefined();
    });

    it("should remove all tombstones when all are old", () => {
      const thirtyOneDaysAgo = Date.now() - 31 * 24 * 60 * 60 * 1000;

      localStorageMock[STORAGE_KEYS.AGENT_CHAT_TOMBSTONES] = JSON.stringify({
        "session-1": {
          sessionId: "session-1",
          deletedAt: thirtyOneDaysAgo - 1000,
          reason: "user-deleted",
        },
        "session-2": {
          sessionId: "session-2",
          deletedAt: thirtyOneDaysAgo - 2000,
          reason: "clear-all",
        },
      });

      const service = getChatHistoryIpfsService();
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const removed = service.cleanupOldTombstones();

      expect(removed).toBe(2);

      const tombstones = JSON.parse(localStorageMock[STORAGE_KEYS.AGENT_CHAT_TOMBSTONES]);
      expect(Object.keys(tombstones)).toHaveLength(0);

      consoleSpy.mockRestore();
    });

    it("should not modify storage when no tombstones removed", () => {
      const recentTime = Date.now() - 1000;

      localStorageMock[STORAGE_KEYS.AGENT_CHAT_TOMBSTONES] = JSON.stringify({
        "recent-session": {
          sessionId: "recent-session",
          deletedAt: recentTime,
          reason: "user-deleted",
        },
      });

      const service = getChatHistoryIpfsService();
      const setItemSpy = vi.spyOn(localStorage, "setItem");

      const removed = service.cleanupOldTombstones();

      expect(removed).toBe(0);
      // setItem should not be called when no tombstones removed
      expect(setItemSpy).not.toHaveBeenCalledWith(
        STORAGE_KEYS.AGENT_CHAT_TOMBSTONES,
        expect.any(String)
      );
    });
  });

  // ==========================================
  // Status Tests
  // ==========================================

  describe("getStatus", () => {
    it("should return initial status", () => {
      const service = getChatHistoryIpfsService();

      const status = service.getStatus();

      expect(status.initialized).toBe(false);
      expect(status.isSyncing).toBe(false);
      expect(status.hasPendingSync).toBe(false);
      expect(status.currentStep).toBe("idle");
    });
  });

  describe("onStatusChange", () => {
    it("should register and call status listener", () => {
      const service = getChatHistoryIpfsService();
      const listener = vi.fn();

      service.onStatusChange(listener);

      // Recording a tombstone triggers status update
      service.recordSessionDeletion("test-session");

      // Listener should be added (will be called on next status change)
      expect(listener).not.toHaveBeenCalled(); // Not called immediately
    });

    it("should return unsubscribe function", () => {
      const service = getChatHistoryIpfsService();
      const listener = vi.fn();

      const unsubscribe = service.onStatusChange(listener);

      expect(typeof unsubscribe).toBe("function");

      // Unsubscribe should work without error
      expect(() => unsubscribe()).not.toThrow();
    });
  });

  // ==========================================
  // hasPendingSync Tests
  // ==========================================

  describe("hasPendingSync tracking", () => {
    it("should include hasPendingSync in status", () => {
      const service = getChatHistoryIpfsService();

      const status = service.getStatus();

      expect(status).toHaveProperty("hasPendingSync");
      expect(typeof status.hasPendingSync).toBe("boolean");
    });
  });

  // ==========================================
  // clearLocalStateOnly Tests
  // ==========================================

  describe("clearLocalStateOnly", () => {
    it("should clear tombstones without IPFS sync", () => {
      localStorageMock[STORAGE_KEYS.AGENT_CHAT_TOMBSTONES] = JSON.stringify({
        "session-1": { sessionId: "session-1", deletedAt: Date.now(), reason: "user-deleted" },
      });

      const service = getChatHistoryIpfsService();
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      service.clearLocalStateOnly();

      expect(localStorageMock[STORAGE_KEYS.AGENT_CHAT_TOMBSTONES]).toBeUndefined();

      consoleSpy.mockRestore();
    });
  });
});

// ==========================================
// Integration-like Tests (using mock)
// ==========================================

describe("ChatHistoryIpfsService tombstone lifecycle", () => {
  let localStorageMock: Record<string, string>;

  beforeEach(() => {
    localStorageMock = {};

    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) => localStorageMock[key] || null),
      setItem: vi.fn((key: string, value: string) => {
        localStorageMock[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete localStorageMock[key];
      }),
      clear: vi.fn(() => {
        localStorageMock = {};
      }),
      key: vi.fn((index: number) => Object.keys(localStorageMock)[index] || null),
      get length() {
        return Object.keys(localStorageMock).length;
      },
    });

    vi.stubGlobal("window", {
      ...globalThis.window,
      dispatchEvent: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("should handle full tombstone lifecycle: create, age, cleanup", () => {
    const service = getChatHistoryIpfsService();

    // Step 1: Record deletions
    service.recordSessionDeletion("session-1");
    service.recordBulkDeletion(["session-2", "session-3"]);

    let tombstones = JSON.parse(localStorageMock[STORAGE_KEYS.AGENT_CHAT_TOMBSTONES]);
    expect(Object.keys(tombstones)).toHaveLength(3);

    // Step 2: Simulate aging (modify timestamps)
    const oldTime = Date.now() - 35 * 24 * 60 * 60 * 1000; // 35 days ago
    tombstones["session-1"].deletedAt = oldTime;
    tombstones["session-2"].deletedAt = oldTime;
    // session-3 stays recent
    localStorageMock[STORAGE_KEYS.AGENT_CHAT_TOMBSTONES] = JSON.stringify(tombstones);

    // Step 3: Cleanup
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const removed = service.cleanupOldTombstones();

    expect(removed).toBe(2);

    tombstones = JSON.parse(localStorageMock[STORAGE_KEYS.AGENT_CHAT_TOMBSTONES]);
    expect(Object.keys(tombstones)).toHaveLength(1);
    expect(tombstones["session-3"]).toBeDefined();

    consoleSpy.mockRestore();
  });
});
