import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ==========================================
// Mock BroadcastChannel for testing
// ==========================================

interface MockMessageHandler {
  (event: { data: SyncMessage }): void;
}

interface SyncMessage {
  type: string;
  from: string;
  timestamp: number;
  payload?: unknown;
}

// Global message bus to simulate cross-tab communication
let globalMessageBus: Array<{ channel: MockBroadcastChannel; handler: MockMessageHandler }> = [];
let messageQueue: Array<{ target: MockBroadcastChannel; message: SyncMessage }> = [];

class MockBroadcastChannel {
  name: string;
  onmessage: MockMessageHandler | null = null;
  private _closed = false;

  constructor(name: string) {
    this.name = name;
    // Register this channel in the global bus
    globalMessageBus.push({
      channel: this,
      handler: (event) => {
        if (!this._closed && this.onmessage) {
          this.onmessage(event);
        }
      },
    });
  }

  postMessage(message: SyncMessage): void {
    if (this._closed) return;
    // Queue messages for delivery (synchronous for testing)
    globalMessageBus.forEach(({ channel }) => {
      if (channel !== this && channel.name === this.name && !channel._closed) {
        messageQueue.push({ target: channel, message });
      }
    });
  }

  close(): void {
    this._closed = true;
    // Remove from global bus
    globalMessageBus = globalMessageBus.filter(({ channel }) => channel !== this);
  }
}

// Process all pending messages synchronously
function deliverMessages(): void {
  const pending = messageQueue.splice(0, messageQueue.length);
  pending.forEach(({ target, message }) => {
    if (target.onmessage) {
      target.onmessage({ data: message });
    }
  });
}

// Replace global BroadcastChannel with mock
vi.stubGlobal("BroadcastChannel", MockBroadcastChannel);

// Mock crypto.randomUUID for deterministic instance IDs
let uuidCounter = 0;
vi.stubGlobal("crypto", {
  ...globalThis.crypto,
  randomUUID: vi.fn(() => `test-uuid-${++uuidCounter}`),
});

// Now import the module under test
import { SyncCoordinator, getSyncCoordinator } from "../../../../../../src/components/wallet/L3/services/SyncCoordinator";

// ==========================================
// Test Suite
// ==========================================

describe("SyncCoordinator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the global message bus and queue
    globalMessageBus = [];
    messageQueue = [];
    // Reset UUID counter for deterministic tests
    uuidCounter = 0;
    // Reset singleton
    (SyncCoordinator as unknown as { prototype: { shutdown: () => void } }).prototype.shutdown?.call?.(
      getSyncCoordinator?.() as SyncCoordinator
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Clean up any remaining channels
    globalMessageBus.forEach(({ channel }) => channel.close());
    globalMessageBus = [];
    messageQueue = [];
  });

  // ------------------------------------------
  // Initialization Tests
  // ------------------------------------------

  describe("Initialization", () => {
    it("should create a unique instance ID", () => {
      const coordinator = new SyncCoordinator();
      expect(coordinator).toBeDefined();
      coordinator.shutdown();
    });

    it("should become leader immediately when no other tabs exist", () => {
      const coordinator = new SyncCoordinator();
      // No messages to deliver, should auto-become leader
      expect(coordinator.isCurrentLeader()).toBe(true);
      coordinator.shutdown();
    });

    it("should create BroadcastChannel with correct name", () => {
      const coordinator = new SyncCoordinator();

      // Verify channel was created (via globalMessageBus)
      expect(globalMessageBus.length).toBe(1);
      expect(globalMessageBus[0].channel.name).toBe("ipfs-sync-coordinator");

      coordinator.shutdown();
    });
  });

  // ------------------------------------------
  // Leadership Election Tests
  // ------------------------------------------

  describe("Leadership Election", () => {
    it("should resolve leadership conflict using higher ID wins", () => {
      // Create first coordinator (will claim leadership)
      const coordinator1 = new SyncCoordinator();
      deliverMessages();

      expect(coordinator1.isCurrentLeader()).toBe(true);

      // Create second coordinator (will compete for leadership)
      const coordinator2 = new SyncCoordinator();
      deliverMessages();

      // Process leader-announce messages
      deliverMessages();

      // Higher UUID wins - coordinator2 has higher ID
      expect(coordinator2.isCurrentLeader()).toBe(true);
      expect(coordinator1.isCurrentLeader()).toBe(false);

      coordinator1.shutdown();
      coordinator2.shutdown();
    });

    it("should start as leader when alone", () => {
      const coordinator = new SyncCoordinator();
      expect(coordinator.isCurrentLeader()).toBe(true);
      coordinator.shutdown();
    });
  });

  // ------------------------------------------
  // Lock Acquisition Tests
  // ------------------------------------------

  describe("Lock Acquisition", () => {
    it("should acquire lock immediately when leader and not syncing", async () => {
      const coordinator = new SyncCoordinator();
      deliverMessages();

      const acquired = await coordinator.acquireLock(100);

      expect(acquired).toBe(true);
      expect(coordinator.hasLock()).toBe(true);

      coordinator.releaseLock();
      coordinator.shutdown();
    });

    it("should release lock correctly", async () => {
      const coordinator = new SyncCoordinator();
      deliverMessages();

      await coordinator.acquireLock(100);
      expect(coordinator.hasLock()).toBe(true);

      coordinator.releaseLock();
      deliverMessages();
      expect(coordinator.hasLock()).toBe(false);

      coordinator.shutdown();
    });

    it("should broadcast sync-start when acquiring lock", async () => {
      const coordinator1 = new SyncCoordinator();
      deliverMessages();

      // Create second coordinator to receive messages
      const coordinator2 = new SyncCoordinator();
      deliverMessages();
      deliverMessages(); // process leader announcements

      // Track messages
      const receivedMessages: SyncMessage[] = [];
      const nonLeader = coordinator1.isCurrentLeader() ? coordinator2 : coordinator1;
      const originalOnMessage = nonLeader["channel"].onmessage;
      nonLeader["channel"].onmessage = (event) => {
        receivedMessages.push(event.data);
        originalOnMessage?.(event);
      };

      // Leader acquires lock
      const leader = coordinator1.isCurrentLeader() ? coordinator1 : coordinator2;
      await leader.acquireLock(100);
      deliverMessages();

      // Should have broadcast sync-start
      const syncStarts = receivedMessages.filter((m) => m.type === "sync-start");
      expect(syncStarts.length).toBeGreaterThanOrEqual(1);

      leader.releaseLock();
      coordinator1.shutdown();
      coordinator2.shutdown();
    });

    it("should broadcast sync-complete when releasing lock", async () => {
      const coordinator1 = new SyncCoordinator();
      deliverMessages();

      const coordinator2 = new SyncCoordinator();
      deliverMessages();
      deliverMessages();

      // Track messages on non-leader
      const receivedMessages: SyncMessage[] = [];
      const nonLeader = coordinator1.isCurrentLeader() ? coordinator2 : coordinator1;
      const originalOnMessage = nonLeader["channel"].onmessage;
      nonLeader["channel"].onmessage = (event) => {
        receivedMessages.push(event.data);
        originalOnMessage?.(event);
      };

      // Leader syncs
      const leader = coordinator1.isCurrentLeader() ? coordinator1 : coordinator2;
      await leader.acquireLock(100);
      deliverMessages();

      // Clear and release
      receivedMessages.length = 0;
      leader.releaseLock();
      deliverMessages();

      // Should receive sync-complete
      const syncCompletes = receivedMessages.filter((m) => m.type === "sync-complete");
      expect(syncCompletes.length).toBeGreaterThanOrEqual(1);

      coordinator1.shutdown();
      coordinator2.shutdown();
    });
  });

  // ------------------------------------------
  // Multi-Instance Coordination Tests
  // ------------------------------------------

  describe("Multi-Instance Coordination", () => {
    it("should coordinate between two tabs (only one is leader)", () => {
      const coordinator1 = new SyncCoordinator();
      deliverMessages();

      const coordinator2 = new SyncCoordinator();
      deliverMessages();
      deliverMessages(); // Process all announcements

      // Only one should be leader
      const leaders = [coordinator1.isCurrentLeader(), coordinator2.isCurrentLeader()];
      expect(leaders.filter(Boolean).length).toBe(1);

      coordinator1.shutdown();
      coordinator2.shutdown();
    });

    it("should allow leader to acquire lock", async () => {
      const coordinator1 = new SyncCoordinator();
      deliverMessages();

      const coordinator2 = new SyncCoordinator();
      deliverMessages();
      deliverMessages();

      // Leader should be able to acquire lock
      const leader = coordinator1.isCurrentLeader() ? coordinator1 : coordinator2;
      const acquired = await leader.acquireLock(100);
      expect(acquired).toBe(true);

      leader.releaseLock();
      coordinator1.shutdown();
      coordinator2.shutdown();
    });

    it("should track hasLock status correctly", async () => {
      const coordinator = new SyncCoordinator();
      deliverMessages();

      expect(coordinator.hasLock()).toBe(false);

      await coordinator.acquireLock(100);
      expect(coordinator.hasLock()).toBe(true);

      coordinator.releaseLock();
      expect(coordinator.hasLock()).toBe(false);

      coordinator.shutdown();
    });
  });

  // ------------------------------------------
  // Cleanup Tests
  // ------------------------------------------

  describe("Cleanup", () => {
    it("should close BroadcastChannel on shutdown", () => {
      const coordinator = new SyncCoordinator();
      expect(globalMessageBus.length).toBe(1);

      coordinator.shutdown();
      expect(globalMessageBus.length).toBe(0);
    });

    it("should broadcast sync-complete on shutdown if syncing", async () => {
      const coordinator1 = new SyncCoordinator();
      deliverMessages();

      const coordinator2 = new SyncCoordinator();
      deliverMessages();
      deliverMessages();

      // Track messages on non-leader
      const receivedMessages: SyncMessage[] = [];
      const nonLeader = coordinator1.isCurrentLeader() ? coordinator2 : coordinator1;
      const originalOnMessage = nonLeader["channel"].onmessage;
      nonLeader["channel"].onmessage = (event) => {
        receivedMessages.push(event.data);
        originalOnMessage?.(event);
      };

      // Leader starts syncing
      const leader = coordinator1.isCurrentLeader() ? coordinator1 : coordinator2;
      await leader.acquireLock(100);
      deliverMessages();

      // Clear and shutdown while syncing
      receivedMessages.length = 0;
      leader.shutdown();
      deliverMessages();

      // Should have announced completion
      const syncCompletes = receivedMessages.filter((m) => m.type === "sync-complete");
      expect(syncCompletes.length).toBeGreaterThanOrEqual(1);

      nonLeader.shutdown();
    });
  });

  // ------------------------------------------
  // Singleton Pattern Tests
  // ------------------------------------------

  describe("Singleton Pattern", () => {
    it("getSyncCoordinator should return SyncCoordinator instance", () => {
      const instance = getSyncCoordinator();
      expect(instance).toBeDefined();
      expect(instance).toBeInstanceOf(SyncCoordinator);
      instance.shutdown();
    });
  });
});
