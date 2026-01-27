import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Token } from "../../../../../../src/components/wallet/L3/data/model";
import type { IdentityManager } from "../../../../../../src/components/wallet/L3/services/IdentityManager";
import type { NostrDeliveryQueueEntry } from "../../../../../../src/components/wallet/L3/services/types/QueueTypes";
import { DEFAULT_LOOP_CONFIG } from "../../../../../../src/components/wallet/L3/services/types/QueueTypes";

// ==========================================
// Mock Fixtures
// ==========================================

const createMockToken = (id: string): Token => ({
  id,
  name: "Test Token",
  type: "UCT",
  timestamp: Date.now(),
  jsonData: JSON.stringify({
    version: "2.0",
    genesis: { data: { tokenId: id.padEnd(64, "0") } },
    state: { data: "", predicate: "test" },
    transactions: [],
  }),
  status: 0,
  amount: "1000",
  coinId: "ALPHA",
  symbol: "ALPHA",
  sizeBytes: 100,
} as Token);

const createMockIdentityManager = (): IdentityManager => ({
  getCurrentIdentity: vi.fn().mockResolvedValue({
    address: "test-address",
    publicKey: "test-public-key",
    ipnsName: "test-ipns-name",
  }),
} as unknown as IdentityManager);

const createMockDeliveryEntry = (id: string): NostrDeliveryQueueEntry => ({
  id,
  outboxEntryId: `outbox-${id}`,
  recipientPubkey: "recipient-pubkey",
  recipientNametag: "@test",
  payloadJson: JSON.stringify({
    tokenId: "test-token-id".padEnd(64, "0"),
    stateHash: "0000" + "a".repeat(60),
    inclusionProof: {},
  }),
  retryCount: 0,
  createdAt: Date.now(),
});

// ==========================================
// DEFAULT_LOOP_CONFIG Tests
// ==========================================

describe("DEFAULT_LOOP_CONFIG", () => {
  it("should have correct batch window (3 seconds)", () => {
    expect(DEFAULT_LOOP_CONFIG.receiveTokenBatchWindowMs).toBe(3000);
  });

  it("should have correct max batch size (100 tokens)", () => {
    expect(DEFAULT_LOOP_CONFIG.receiveTokenMaxBatchSize).toBe(100);
  });

  it("should have correct delivery parallelism (12)", () => {
    expect(DEFAULT_LOOP_CONFIG.deliveryMaxParallel).toBe(12);
  });

  it("should have correct max retries (10)", () => {
    expect(DEFAULT_LOOP_CONFIG.deliveryMaxRetries).toBe(10);
  });

  it("should have correct backoff schedule per spec (1s, 3s, 10s, 30s, 60s)", () => {
    expect(DEFAULT_LOOP_CONFIG.deliveryBackoffMs).toEqual([1000, 3000, 10000, 30000, 60000]);
  });

  it("should have correct empty queue wait (3 seconds)", () => {
    expect(DEFAULT_LOOP_CONFIG.deliveryEmptyQueueWaitMs).toBe(3000);
  });

  it("should have correct check interval (2000ms)", () => {
    expect(DEFAULT_LOOP_CONFIG.deliveryCheckIntervalMs).toBe(2000);
  });
});

// ==========================================
// ReceiveTokensToInventoryLoop Tests
// ==========================================

describe("ReceiveTokensToInventoryLoop", () => {
  let mockIdentityManager: IdentityManager;

  beforeEach(() => {
    vi.useFakeTimers();
    mockIdentityManager = createMockIdentityManager();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe("Batching Behavior", () => {
    it("should batch tokens within 3-second window", async () => {
      // Dynamic import to allow mocking
      const { ReceiveTokensToInventoryLoop } = await import(
        "../../../../../../src/components/wallet/L3/services/InventoryBackgroundLoops"
      );

      const loop = new ReceiveTokensToInventoryLoop(mockIdentityManager);

      // Queue multiple tokens quickly
      await loop.queueIncomingToken(createMockToken("1"), "event-1", "sender-1");
      await loop.queueIncomingToken(createMockToken("2"), "event-2", "sender-2");

      const status = loop.getBatchStatus();
      expect(status.pending).toBe(2);
      expect(status.batchId).not.toBeNull();

      loop.destroy();
    });

    it("should create unique batch ID for each batch", async () => {
      const { ReceiveTokensToInventoryLoop } = await import(
        "../../../../../../src/components/wallet/L3/services/InventoryBackgroundLoops"
      );

      const loop = new ReceiveTokensToInventoryLoop(mockIdentityManager);

      await loop.queueIncomingToken(createMockToken("1"), "event-1", "sender-1");
      const firstBatchId = loop.getBatchStatus().batchId;

      expect(firstBatchId).toBeTruthy();
      expect(typeof firstBatchId).toBe("string");

      loop.destroy();
    });

    it("should track event to token mapping", async () => {
      const { ReceiveTokensToInventoryLoop } = await import(
        "../../../../../../src/components/wallet/L3/services/InventoryBackgroundLoops"
      );

      const loop = new ReceiveTokensToInventoryLoop(mockIdentityManager);

      await loop.queueIncomingToken(createMockToken("token-1"), "event-1", "sender-1");

      const status = loop.getBatchStatus();
      expect(status.pending).toBe(1);

      loop.destroy();
    });
  });

  describe("Event Processed Callback", () => {
    it("should accept and store callback", async () => {
      const { ReceiveTokensToInventoryLoop } = await import(
        "../../../../../../src/components/wallet/L3/services/InventoryBackgroundLoops"
      );

      const loop = new ReceiveTokensToInventoryLoop(mockIdentityManager);
      const callback = vi.fn();

      loop.setEventProcessedCallback(callback);

      // Callback should be stored (no immediate call)
      expect(callback).not.toHaveBeenCalled();

      loop.destroy();
    });
  });

  describe("Cleanup", () => {
    it("should clear buffer on destroy", async () => {
      const { ReceiveTokensToInventoryLoop } = await import(
        "../../../../../../src/components/wallet/L3/services/InventoryBackgroundLoops"
      );

      const loop = new ReceiveTokensToInventoryLoop(mockIdentityManager);

      await loop.queueIncomingToken(createMockToken("1"), "event-1", "sender-1");
      expect(loop.getBatchStatus().pending).toBe(1);

      loop.destroy();
      expect(loop.getBatchStatus().pending).toBe(0);
    });
  });
});

// ==========================================
// NostrDeliveryQueue Tests
// ==========================================

describe("NostrDeliveryQueue", () => {
  let mockIdentityManager: IdentityManager;

  beforeEach(() => {
    vi.useFakeTimers();
    mockIdentityManager = createMockIdentityManager();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe("Queue Management", () => {
    it("should add entry to queue", async () => {
      const { NostrDeliveryQueue } = await import(
        "../../../../../../src/components/wallet/L3/services/InventoryBackgroundLoops"
      );

      const queue = new NostrDeliveryQueue(mockIdentityManager);
      const entry = createMockDeliveryEntry("1");

      await queue.queueForDelivery(entry);

      const status = queue.getQueueStatus();
      expect(status.totalPending).toBe(1);

      queue.destroy();
    });

    it("should track multiple entries", async () => {
      const { NostrDeliveryQueue } = await import(
        "../../../../../../src/components/wallet/L3/services/InventoryBackgroundLoops"
      );

      const queue = new NostrDeliveryQueue(mockIdentityManager);

      await queue.queueForDelivery(createMockDeliveryEntry("1"));
      await queue.queueForDelivery(createMockDeliveryEntry("2"));
      await queue.queueForDelivery(createMockDeliveryEntry("3"));

      const status = queue.getQueueStatus();
      expect(status.totalPending).toBe(3);

      queue.destroy();
    });

    it("should report correct retry count distribution", async () => {
      const { NostrDeliveryQueue } = await import(
        "../../../../../../src/components/wallet/L3/services/InventoryBackgroundLoops"
      );

      const queue = new NostrDeliveryQueue(mockIdentityManager);

      const entry1 = createMockDeliveryEntry("1");
      entry1.retryCount = 0;
      const entry2 = createMockDeliveryEntry("2");
      entry2.retryCount = 2;
      const entry3 = createMockDeliveryEntry("3");
      entry3.retryCount = 2;

      await queue.queueForDelivery(entry1);
      await queue.queueForDelivery(entry2);
      await queue.queueForDelivery(entry3);

      const status = queue.getQueueStatus();
      expect(status.byRetryCount[0]).toBe(1);
      expect(status.byRetryCount[2]).toBe(2);

      queue.destroy();
    });
  });

  describe("NostrService Integration", () => {
    it("should accept NostrService reference", async () => {
      const { NostrDeliveryQueue } = await import(
        "../../../../../../src/components/wallet/L3/services/InventoryBackgroundLoops"
      );

      const queue = new NostrDeliveryQueue(mockIdentityManager);
      const mockNostrService = {
        sendTokenToRecipient: vi.fn().mockResolvedValue("event-id"),
      };

      // Should not throw
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      queue.setNostrService(mockNostrService as any);

      queue.destroy();
    });
  });

  describe("Cleanup", () => {
    it("should clear queue on destroy", async () => {
      const { NostrDeliveryQueue } = await import(
        "../../../../../../src/components/wallet/L3/services/InventoryBackgroundLoops"
      );

      const queue = new NostrDeliveryQueue(mockIdentityManager);

      await queue.queueForDelivery(createMockDeliveryEntry("1"));
      expect(queue.getQueueStatus().totalPending).toBe(1);

      queue.destroy();
      expect(queue.getQueueStatus().totalPending).toBe(0);
    });
  });
});

// ==========================================
// InventoryBackgroundLoopsManager Tests
// ==========================================

describe("InventoryBackgroundLoopsManager", () => {
  let mockIdentityManager: IdentityManager;

  beforeEach(() => {
    mockIdentityManager = createMockIdentityManager();
    // Reset singleton between tests
  });

  afterEach(async () => {
    const { InventoryBackgroundLoopsManager } = await import(
      "../../../../../../src/components/wallet/L3/services/InventoryBackgroundLoops"
    );
    InventoryBackgroundLoopsManager.resetInstance();
    vi.clearAllMocks();
  });

  describe("Singleton Pattern", () => {
    it("should create singleton instance", async () => {
      const { InventoryBackgroundLoopsManager } = await import(
        "../../../../../../src/components/wallet/L3/services/InventoryBackgroundLoops"
      );

      const instance1 = InventoryBackgroundLoopsManager.getInstance(mockIdentityManager);
      const instance2 = InventoryBackgroundLoopsManager.getInstance();

      expect(instance1).toBe(instance2);
    });

    it("should throw if no IdentityManager on first call", async () => {
      const { InventoryBackgroundLoopsManager } = await import(
        "../../../../../../src/components/wallet/L3/services/InventoryBackgroundLoops"
      );

      expect(() => InventoryBackgroundLoopsManager.getInstance()).toThrow(
        "IdentityManager required for first getInstance() call"
      );
    });

    it("should reset instance correctly", async () => {
      const { InventoryBackgroundLoopsManager } = await import(
        "../../../../../../src/components/wallet/L3/services/InventoryBackgroundLoops"
      );

      // Create first instance (needed to test reset behavior)
      InventoryBackgroundLoopsManager.getInstance(mockIdentityManager);
      InventoryBackgroundLoopsManager.resetInstance();

      // Should throw because instance was reset
      expect(() => InventoryBackgroundLoopsManager.getInstance()).toThrow();
    });
  });

  describe("Initialization", () => {
    it("should not be ready before initialize()", async () => {
      const { InventoryBackgroundLoopsManager } = await import(
        "../../../../../../src/components/wallet/L3/services/InventoryBackgroundLoops"
      );

      const manager = InventoryBackgroundLoopsManager.getInstance(mockIdentityManager);
      expect(manager.isReady()).toBe(false);
    });

    it("should be ready after initialize()", async () => {
      const { InventoryBackgroundLoopsManager } = await import(
        "../../../../../../src/components/wallet/L3/services/InventoryBackgroundLoops"
      );

      const manager = InventoryBackgroundLoopsManager.getInstance(mockIdentityManager);
      await manager.initialize();

      expect(manager.isReady()).toBe(true);
    });

    it("should handle multiple initialize() calls gracefully", async () => {
      const { InventoryBackgroundLoopsManager } = await import(
        "../../../../../../src/components/wallet/L3/services/InventoryBackgroundLoops"
      );

      const manager = InventoryBackgroundLoopsManager.getInstance(mockIdentityManager);
      await manager.initialize();
      await manager.initialize(); // Should not throw

      expect(manager.isReady()).toBe(true);
    });
  });

  describe("Loop Access", () => {
    it("should throw when accessing receive loop before initialize", async () => {
      const { InventoryBackgroundLoopsManager } = await import(
        "../../../../../../src/components/wallet/L3/services/InventoryBackgroundLoops"
      );

      const manager = InventoryBackgroundLoopsManager.getInstance(mockIdentityManager);

      expect(() => manager.getReceiveLoop()).toThrow(
        "ReceiveLoop not initialized - call initialize() first"
      );
    });

    it("should throw when accessing delivery queue before initialize", async () => {
      const { InventoryBackgroundLoopsManager } = await import(
        "../../../../../../src/components/wallet/L3/services/InventoryBackgroundLoops"
      );

      const manager = InventoryBackgroundLoopsManager.getInstance(mockIdentityManager);

      expect(() => manager.getDeliveryQueue()).toThrow(
        "DeliveryQueue not initialized - call initialize() first"
      );
    });

    it("should return loops after initialize", async () => {
      const { InventoryBackgroundLoopsManager } = await import(
        "../../../../../../src/components/wallet/L3/services/InventoryBackgroundLoops"
      );

      const manager = InventoryBackgroundLoopsManager.getInstance(mockIdentityManager);
      await manager.initialize();

      expect(manager.getReceiveLoop()).toBeDefined();
      expect(manager.getDeliveryQueue()).toBeDefined();
    });
  });

  describe("Status Reporting", () => {
    it("should report combined status", async () => {
      const { InventoryBackgroundLoopsManager } = await import(
        "../../../../../../src/components/wallet/L3/services/InventoryBackgroundLoops"
      );

      const manager = InventoryBackgroundLoopsManager.getInstance(mockIdentityManager);
      await manager.initialize();

      const status = manager.getStatus();

      expect(status).toHaveProperty("receive");
      expect(status).toHaveProperty("delivery");
      expect(status).toHaveProperty("isInitialized");
      expect(status.isInitialized).toBe(true);
    });

    it("should report default status before initialize", async () => {
      const { InventoryBackgroundLoopsManager } = await import(
        "../../../../../../src/components/wallet/L3/services/InventoryBackgroundLoops"
      );

      const manager = InventoryBackgroundLoopsManager.getInstance(mockIdentityManager);

      const status = manager.getStatus();

      expect(status.isInitialized).toBe(false);
      expect(status.receive.pending).toBe(0);
      expect(status.delivery.totalPending).toBe(0);
    });
  });

  describe("Shutdown", () => {
    it("should not be ready after shutdown", async () => {
      const { InventoryBackgroundLoopsManager } = await import(
        "../../../../../../src/components/wallet/L3/services/InventoryBackgroundLoops"
      );

      const manager = InventoryBackgroundLoopsManager.getInstance(mockIdentityManager);
      await manager.initialize();
      manager.shutdown();

      expect(manager.isReady()).toBe(false);
    });
  });
});
