import { describe, it, expect } from "vitest";
import {
  createDefaultCircuitBreakerState,
  createDefaultSyncOperationStats,
  createDefaultTokenInventoryStats,
  type CircuitBreakerState,
  type SyncOperationStats,
  type TokenInventoryStats,
  type SyncMode,
  type SyncStatus,
  type SyncErrorCode,
  type InvalidReasonCode,
} from "../../../../../../src/components/wallet/L3/types/SyncTypes";

// ==========================================
// createDefaultCircuitBreakerState Tests
// ==========================================

describe("createDefaultCircuitBreakerState", () => {
  it("should create state with localModeActive=false", () => {
    const state = createDefaultCircuitBreakerState();
    expect(state.localModeActive).toBe(false);
  });

  it("should create state with zero consecutive conflicts", () => {
    const state = createDefaultCircuitBreakerState();
    expect(state.consecutiveConflicts).toBe(0);
  });

  it("should create state with zero consecutive IPFS failures", () => {
    const state = createDefaultCircuitBreakerState();
    expect(state.consecutiveIpfsFailures).toBe(0);
  });

  it("should not include optional timestamp fields by default", () => {
    const state = createDefaultCircuitBreakerState();
    expect(state.localModeActivatedAt).toBeUndefined();
    expect(state.nextRecoveryAttempt).toBeUndefined();
    expect(state.lastConflictTimestamp).toBeUndefined();
  });

  it("should return a new object each time", () => {
    const state1 = createDefaultCircuitBreakerState();
    const state2 = createDefaultCircuitBreakerState();
    expect(state1).not.toBe(state2);
    expect(state1).toEqual(state2);
  });
});

// ==========================================
// createDefaultSyncOperationStats Tests
// ==========================================

describe("createDefaultSyncOperationStats", () => {
  it("should create stats with all counters at zero", () => {
    const stats = createDefaultSyncOperationStats();
    expect(stats.tokensImported).toBe(0);
    expect(stats.tokensRemoved).toBe(0);
    expect(stats.tokensUpdated).toBe(0);
    expect(stats.conflictsResolved).toBe(0);
    expect(stats.tokensValidated).toBe(0);
    expect(stats.tombstonesAdded).toBe(0);
  });

  it("should return a new object each time", () => {
    const stats1 = createDefaultSyncOperationStats();
    const stats2 = createDefaultSyncOperationStats();
    expect(stats1).not.toBe(stats2);
    expect(stats1).toEqual(stats2);
  });

  it("should have all required fields", () => {
    const stats = createDefaultSyncOperationStats();
    const requiredFields: (keyof SyncOperationStats)[] = [
      "tokensImported",
      "tokensRemoved",
      "tokensUpdated",
      "conflictsResolved",
      "tokensValidated",
      "tombstonesAdded",
    ];
    for (const field of requiredFields) {
      expect(stats).toHaveProperty(field);
    }
  });
});

// ==========================================
// createDefaultTokenInventoryStats Tests
// ==========================================

describe("createDefaultTokenInventoryStats", () => {
  it("should create stats with all folder counts at zero", () => {
    const stats = createDefaultTokenInventoryStats();
    expect(stats.activeTokens).toBe(0);
    expect(stats.sentTokens).toBe(0);
    expect(stats.outboxTokens).toBe(0);
    expect(stats.invalidTokens).toBe(0);
    expect(stats.nametagTokens).toBe(0);
    expect(stats.tombstoneCount).toBe(0);
  });

  it("should return a new object each time", () => {
    const stats1 = createDefaultTokenInventoryStats();
    const stats2 = createDefaultTokenInventoryStats();
    expect(stats1).not.toBe(stats2);
    expect(stats1).toEqual(stats2);
  });

  it("should have all required fields per spec Section 3.1", () => {
    const stats = createDefaultTokenInventoryStats();
    const requiredFields: (keyof TokenInventoryStats)[] = [
      "activeTokens",
      "sentTokens",
      "outboxTokens",
      "invalidTokens",
      "nametagTokens",
      "tombstoneCount",
    ];
    for (const field of requiredFields) {
      expect(stats).toHaveProperty(field);
    }
  });
});

// ==========================================
// Type Guard Tests (TypeScript compilation validation)
// ==========================================

describe("SyncMode type", () => {
  it("should accept valid sync modes", () => {
    const modes: SyncMode[] = ["LOCAL", "NAMETAG", "FAST", "NORMAL"];
    expect(modes).toHaveLength(4);
  });
});

describe("SyncStatus type", () => {
  it("should accept valid sync statuses", () => {
    const statuses: SyncStatus[] = [
      "SUCCESS",
      "PARTIAL_SUCCESS",
      "LOCAL_ONLY",
      "NAMETAG_ONLY",
      "ERROR",
    ];
    expect(statuses).toHaveLength(5);
  });
});

describe("SyncErrorCode type", () => {
  it("should accept valid error codes", () => {
    const codes: SyncErrorCode[] = [
      "IPFS_UNAVAILABLE",
      "IPNS_PUBLISH_FAILED",
      "IPNS_RESOLUTION_FAILED",
      "AGGREGATOR_UNREACHABLE",
      "PROOF_FETCH_FAILED",
      "VALIDATION_FAILED",
      "INTEGRITY_FAILURE",
      "CONFLICT_LOOP",
      "PARTIAL_OPERATION",
      "STORAGE_ERROR",
      "UNKNOWN",
    ];
    expect(codes).toHaveLength(11);
  });
});

describe("InvalidReasonCode type", () => {
  it("should accept valid reason codes per spec Section 3.3", () => {
    const codes: InvalidReasonCode[] = [
      "SDK_VALIDATION",
      "INTEGRITY_FAILURE",
      "NAMETAG_MISMATCH",
      "MISSING_FIELDS",
      "OWNERSHIP_MISMATCH",
      "PROOF_MISMATCH",
    ];
    expect(codes).toHaveLength(6);
  });
});

// ==========================================
// CircuitBreakerState Structure Tests
// ==========================================

describe("CircuitBreakerState structure", () => {
  it("should support LOCAL mode activation", () => {
    const state: CircuitBreakerState = {
      localModeActive: true,
      localModeActivatedAt: Date.now(),
      nextRecoveryAttempt: Date.now() + 3600000, // 1 hour
      consecutiveConflicts: 5,
      consecutiveIpfsFailures: 10,
    };

    expect(state.localModeActive).toBe(true);
    expect(state.localModeActivatedAt).toBeGreaterThan(0);
    expect(state.nextRecoveryAttempt).toBeGreaterThan(state.localModeActivatedAt!);
  });

  it("should support conflict tracking", () => {
    const state: CircuitBreakerState = {
      localModeActive: false,
      consecutiveConflicts: 3,
      lastConflictTimestamp: Date.now(),
      consecutiveIpfsFailures: 0,
    };

    expect(state.consecutiveConflicts).toBe(3);
    expect(state.lastConflictTimestamp).toBeGreaterThan(0);
  });
});
