import { describe, it, expect } from "vitest";
import {
  detectSyncMode,
  shouldSkipIpfs,
  shouldSkipSpentDetection,
  isReadOnlyMode,
  shouldAcquireSyncLock,
  type SyncModeParams,
} from "../../../../../../../src/components/wallet/L3/services/utils/SyncModeDetector";
import type { Token } from "../../../../../../../src/components/wallet/L3/data/model";
import type { OutboxEntry } from "../../../../../../../src/components/wallet/L3/services/types/OutboxTypes";

// ==========================================
// Test Fixtures
// ==========================================

const createMockToken = (id: string): Token => ({
  id,
  name: "Test Token",
  type: "UCT",
  timestamp: Date.now(),
  jsonData: "{}",
  status: 0,
  amount: "1000",
  coinId: "ALPHA",
  symbol: "ALPHA",
  sizeBytes: 100,
} as Token);

const createMockOutboxEntry = (id: string): OutboxEntry => ({
  id,
  tokenId: "test-token-id",
  status: "PENDING_IPFS_SYNC",
  createdAt: Date.now(),
  updatedAt: Date.now(),
  retryCount: 0,
  recipientAddress: "DIRECT://test",
} as OutboxEntry);

// ==========================================
// detectSyncMode Tests
// ==========================================

describe("detectSyncMode", () => {
  describe("Precedence Order (Section 6.1)", () => {
    it("should return LOCAL when local=true (highest precedence)", () => {
      const params: SyncModeParams = {
        local: true,
        nametag: true,
        incomingTokens: [createMockToken("1")],
        outboxTokens: [createMockOutboxEntry("1")],
      };
      expect(detectSyncMode(params)).toBe("LOCAL");
    });

    it("should return LOCAL when circuit breaker is active", () => {
      const params: SyncModeParams = {
        nametag: true,
        incomingTokens: [createMockToken("1")],
        circuitBreaker: {
          localModeActive: true,
          consecutiveConflicts: 5,
          consecutiveIpfsFailures: 0,
        },
      };
      expect(detectSyncMode(params)).toBe("LOCAL");
    });

    it("should return NAMETAG when nametag=true and not LOCAL", () => {
      const params: SyncModeParams = {
        nametag: true,
        incomingTokens: [createMockToken("1")],
      };
      expect(detectSyncMode(params)).toBe("NAMETAG");
    });

    it("should return FAST when incomingTokens non-empty and not LOCAL/NAMETAG", () => {
      const params: SyncModeParams = {
        incomingTokens: [createMockToken("1")],
      };
      expect(detectSyncMode(params)).toBe("FAST");
    });

    it("should return FAST when outboxTokens non-empty and not LOCAL/NAMETAG", () => {
      const params: SyncModeParams = {
        outboxTokens: [createMockOutboxEntry("1")],
      };
      expect(detectSyncMode(params)).toBe("FAST");
    });

    it("should return FAST when both incomingTokens AND outboxTokens non-empty", () => {
      const params: SyncModeParams = {
        incomingTokens: [createMockToken("1")],
        outboxTokens: [createMockOutboxEntry("1")],
      };
      expect(detectSyncMode(params)).toBe("FAST");
    });

    it("should return NORMAL when no special conditions (default)", () => {
      const params: SyncModeParams = {};
      expect(detectSyncMode(params)).toBe("NORMAL");
    });
  });

  describe("Edge Cases", () => {
    it("should return NORMAL when incomingTokens is empty array", () => {
      const params: SyncModeParams = {
        incomingTokens: [],
      };
      expect(detectSyncMode(params)).toBe("NORMAL");
    });

    it("should return NORMAL when outboxTokens is empty array", () => {
      const params: SyncModeParams = {
        outboxTokens: [],
      };
      expect(detectSyncMode(params)).toBe("NORMAL");
    });

    it("should return NORMAL when incomingTokens is null", () => {
      const params: SyncModeParams = {
        incomingTokens: null,
      };
      expect(detectSyncMode(params)).toBe("NORMAL");
    });

    it("should return NORMAL when circuitBreaker.localModeActive is false", () => {
      const params: SyncModeParams = {
        circuitBreaker: {
          localModeActive: false,
          consecutiveConflicts: 0,
          consecutiveIpfsFailures: 0,
        },
      };
      expect(detectSyncMode(params)).toBe("NORMAL");
    });

    it("should handle local=false explicitly", () => {
      const params: SyncModeParams = {
        local: false,
      };
      expect(detectSyncMode(params)).toBe("NORMAL");
    });

    it("should handle nametag=false explicitly", () => {
      const params: SyncModeParams = {
        nametag: false,
      };
      expect(detectSyncMode(params)).toBe("NORMAL");
    });
  });
});

// ==========================================
// shouldSkipIpfs Tests
// ==========================================

describe("shouldSkipIpfs", () => {
  it("should return true for LOCAL mode", () => {
    expect(shouldSkipIpfs("LOCAL")).toBe(true);
  });

  it("should return false for NAMETAG mode", () => {
    expect(shouldSkipIpfs("NAMETAG")).toBe(false);
  });

  it("should return false for FAST mode", () => {
    expect(shouldSkipIpfs("FAST")).toBe(false);
  });

  it("should return false for NORMAL mode", () => {
    expect(shouldSkipIpfs("NORMAL")).toBe(false);
  });
});

// ==========================================
// shouldSkipSpentDetection Tests
// ==========================================

describe("shouldSkipSpentDetection", () => {
  it("should return true for LOCAL mode", () => {
    expect(shouldSkipSpentDetection("LOCAL")).toBe(true);
  });

  it("should return true for FAST mode", () => {
    expect(shouldSkipSpentDetection("FAST")).toBe(true);
  });

  it("should return false for NAMETAG mode", () => {
    expect(shouldSkipSpentDetection("NAMETAG")).toBe(false);
  });

  it("should return false for NORMAL mode", () => {
    expect(shouldSkipSpentDetection("NORMAL")).toBe(false);
  });
});

// ==========================================
// isReadOnlyMode Tests
// ==========================================

describe("isReadOnlyMode", () => {
  it("should return true for NAMETAG mode", () => {
    expect(isReadOnlyMode("NAMETAG")).toBe(true);
  });

  it("should return false for LOCAL mode", () => {
    expect(isReadOnlyMode("LOCAL")).toBe(false);
  });

  it("should return false for FAST mode", () => {
    expect(isReadOnlyMode("FAST")).toBe(false);
  });

  it("should return false for NORMAL mode", () => {
    expect(isReadOnlyMode("NORMAL")).toBe(false);
  });
});

// ==========================================
// shouldAcquireSyncLock Tests
// ==========================================

describe("shouldAcquireSyncLock", () => {
  it("should return false for NAMETAG mode (no lock needed for read-only)", () => {
    expect(shouldAcquireSyncLock("NAMETAG")).toBe(false);
  });

  it("should return true for LOCAL mode", () => {
    expect(shouldAcquireSyncLock("LOCAL")).toBe(true);
  });

  it("should return true for FAST mode", () => {
    expect(shouldAcquireSyncLock("FAST")).toBe(true);
  });

  it("should return true for NORMAL mode", () => {
    expect(shouldAcquireSyncLock("NORMAL")).toBe(true);
  });
});
