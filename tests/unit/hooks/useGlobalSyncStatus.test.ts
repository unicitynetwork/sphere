import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { SyncStep } from "../../../src/components/agents/shared/ChatHistoryIpfsService";

// ==========================================
// Mock Setup
// ==========================================

// Mock ChatHistoryIpfsService
const mockGetStatus = vi.fn(() => ({
  initialized: false,
  isSyncing: false,
  hasPendingSync: false,
  lastSync: null,
  ipnsName: null,
  currentStep: "idle" as SyncStep,
}));

const mockOnStatusChange = vi.fn(() => {
  // Return unsubscribe function
  return () => {};
});

vi.mock("../../../src/components/agents/shared/ChatHistoryIpfsService", () => ({
  getChatHistoryIpfsService: vi.fn(() => ({
    getStatus: mockGetStatus,
    onStatusChange: mockOnStatusChange,
  })),
}));

// Mock IpfsStorageService
const mockIsCurrentlySyncing = vi.fn(() => false);

vi.mock("../../../src/components/wallet/L3/services/IpfsStorageService", () => ({
  IpfsStorageService: {
    getInstance: vi.fn(() => ({
      isCurrentlySyncing: mockIsCurrentlySyncing,
    })),
  },
}));

// Mock IdentityManager
vi.mock("../../../src/components/wallet/L3/services/IdentityManager", () => ({
  IdentityManager: {
    getInstance: vi.fn(() => ({})),
  },
}));

// Import after mocking
import {
  useGlobalSyncStatus,
  waitForAllSyncsToComplete,
} from "../../../src/hooks/useGlobalSyncStatus";

// ==========================================
// useGlobalSyncStatus Tests
// ==========================================

describe("useGlobalSyncStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.stubGlobal("window", {
      ...globalThis.window,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });

    // Reset mock return values
    mockGetStatus.mockReturnValue({
      initialized: false,
      isSyncing: false,
      hasPendingSync: false,
      lastSync: null,
      ipnsName: null,
      currentStep: "idle" as SyncStep,
    });
    mockIsCurrentlySyncing.mockReturnValue(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ==========================================
  // Basic State Tests
  // ==========================================

  describe("initial state", () => {
    it("should return initial sync status", () => {
      const { result } = renderHook(() => useGlobalSyncStatus());

      expect(result.current.chatSyncing).toBe(false);
      expect(result.current.tokenSyncing).toBe(false);
      expect(result.current.isAnySyncing).toBe(false);
    });

    it("should return idle chat step", () => {
      const { result } = renderHook(() => useGlobalSyncStatus());

      expect(result.current.chatStep).toBe("idle");
    });

    it("should return 'All data synced' message when not syncing", () => {
      const { result } = renderHook(() => useGlobalSyncStatus());

      expect(result.current.statusMessage).toBe("All data synced");
    });
  });

  // ==========================================
  // Chat Syncing Tests
  // ==========================================

  describe("chat syncing", () => {
    it("should detect active chat sync", () => {
      mockGetStatus.mockReturnValue({
        initialized: true,
        isSyncing: true,
        hasPendingSync: false,
        lastSync: null,
        ipnsName: null,
        currentStep: "uploading" as SyncStep,
      });

      const { result } = renderHook(() => useGlobalSyncStatus());

      expect(result.current.chatSyncing).toBe(true);
      expect(result.current.isAnySyncing).toBe(true);
    });

    it("should detect pending chat sync (debounce period)", () => {
      mockGetStatus.mockReturnValue({
        initialized: true,
        isSyncing: false,
        hasPendingSync: true,
        lastSync: null,
        ipnsName: null,
        currentStep: "idle" as SyncStep,
      });

      const { result } = renderHook(() => useGlobalSyncStatus());

      expect(result.current.chatSyncing).toBe(true);
      expect(result.current.isAnySyncing).toBe(true);
    });

    it("should show correct status message for each sync step", () => {
      const steps: Array<{ step: string; expected: string }> = [
        { step: "initializing", expected: "Initializing..." },
        { step: "resolving-ipns", expected: "Resolving chat history..." },
        { step: "fetching-content", expected: "Fetching chat history..." },
        { step: "importing-data", expected: "Importing chat data..." },
        { step: "building-data", expected: "Preparing chat data..." },
        { step: "uploading", expected: "Uploading chat history..." },
        { step: "publishing-ipns", expected: "Publishing chat to network..." },
      ];

      for (const { step, expected } of steps) {
        mockGetStatus.mockReturnValue({
          initialized: true,
          isSyncing: true,
          hasPendingSync: false,
          lastSync: null,
          ipnsName: null,
          currentStep: step as SyncStep,
        });

        const { result } = renderHook(() => useGlobalSyncStatus());

        expect(result.current.statusMessage).toBe(expected);
      }
    });

    it("should show 'Preparing to sync chat...' for pending sync in idle state", () => {
      mockGetStatus.mockReturnValue({
        initialized: true,
        isSyncing: false,
        hasPendingSync: true,
        lastSync: null,
        ipnsName: null,
        currentStep: "idle" as SyncStep,
      });

      const { result } = renderHook(() => useGlobalSyncStatus());

      expect(result.current.statusMessage).toBe("Preparing to sync chat...");
    });
  });

  // ==========================================
  // Token Syncing Tests
  // ==========================================

  describe("token syncing", () => {
    it("should detect token sync from service", () => {
      mockIsCurrentlySyncing.mockReturnValue(true);

      const { result } = renderHook(() => useGlobalSyncStatus());

      expect(result.current.tokenSyncing).toBe(true);
      expect(result.current.isAnySyncing).toBe(true);
    });

    it("should show token syncing in status message", () => {
      mockIsCurrentlySyncing.mockReturnValue(true);

      const { result } = renderHook(() => useGlobalSyncStatus());

      expect(result.current.statusMessage).toContain("Syncing tokens...");
    });
  });

  // ==========================================
  // Combined Sync Status Tests
  // ==========================================

  describe("combined sync status", () => {
    it("should show both services syncing", () => {
      mockGetStatus.mockReturnValue({
        initialized: true,
        isSyncing: true,
        hasPendingSync: false,
        lastSync: null,
        ipnsName: null,
        currentStep: "uploading" as SyncStep,
      });
      mockIsCurrentlySyncing.mockReturnValue(true);

      const { result } = renderHook(() => useGlobalSyncStatus());

      expect(result.current.chatSyncing).toBe(true);
      expect(result.current.tokenSyncing).toBe(true);
      expect(result.current.isAnySyncing).toBe(true);
      expect(result.current.statusMessage).toContain("Uploading chat history...");
      expect(result.current.statusMessage).toContain("Syncing tokens...");
    });

    it("should detect syncing when only one service is active", () => {
      // Only chat syncing
      mockGetStatus.mockReturnValue({
        initialized: true,
        isSyncing: true,
        hasPendingSync: false,
        lastSync: null,
        ipnsName: null,
        currentStep: "uploading" as SyncStep,
      });
      mockIsCurrentlySyncing.mockReturnValue(false);

      const { result: result1 } = renderHook(() => useGlobalSyncStatus());
      expect(result1.current.isAnySyncing).toBe(true);

      // Only token syncing
      mockGetStatus.mockReturnValue({
        initialized: true,
        isSyncing: false,
        hasPendingSync: false,
        lastSync: null,
        ipnsName: null,
        currentStep: "idle" as SyncStep,
      });
      mockIsCurrentlySyncing.mockReturnValue(true);

      const { result: result2 } = renderHook(() => useGlobalSyncStatus());
      expect(result2.current.isAnySyncing).toBe(true);
    });
  });

  // ==========================================
  // Event Subscription Tests
  // ==========================================

  describe("event subscriptions", () => {
    it("should subscribe to chat status changes", () => {
      renderHook(() => useGlobalSyncStatus());

      expect(mockOnStatusChange).toHaveBeenCalled();
    });

    it("should subscribe to token sync events", () => {
      renderHook(() => useGlobalSyncStatus());

      expect(window.addEventListener).toHaveBeenCalledWith(
        "ipfs-storage-event",
        expect.any(Function)
      );
    });

    it("should cleanup subscriptions on unmount", () => {
      const { unmount } = renderHook(() => useGlobalSyncStatus());

      unmount();

      expect(window.removeEventListener).toHaveBeenCalledWith(
        "ipfs-storage-event",
        expect.any(Function)
      );
    });
  });
});

// ==========================================
// waitForAllSyncsToComplete Tests
// ==========================================

describe("waitForAllSyncsToComplete", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    mockGetStatus.mockReturnValue({
      initialized: false,
      isSyncing: false,
      hasPendingSync: false,
      lastSync: null,
      ipnsName: null,
      currentStep: "idle" as SyncStep,
    });
    mockIsCurrentlySyncing.mockReturnValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should resolve immediately when no sync in progress", async () => {
    const resultPromise = waitForAllSyncsToComplete();

    // Advance timer to trigger first check
    await vi.advanceTimersByTimeAsync(0);

    const result = await resultPromise;
    expect(result).toBe(true);
  });

  it("should wait for chat sync to complete", async () => {
    // Start with syncing
    mockGetStatus.mockReturnValue({
      initialized: true,
      isSyncing: true,
      hasPendingSync: false,
      lastSync: null,
      ipnsName: null,
      currentStep: "uploading" as SyncStep,
    });

    const resultPromise = waitForAllSyncsToComplete();

    // First check - still syncing
    await vi.advanceTimersByTimeAsync(500);

    // Complete sync
    mockGetStatus.mockReturnValue({
      initialized: true,
      isSyncing: false,
      hasPendingSync: false,
      lastSync: null,
      ipnsName: null,
      currentStep: "idle" as SyncStep,
    });

    // Second check - should resolve
    await vi.advanceTimersByTimeAsync(500);

    const result = await resultPromise;
    expect(result).toBe(true);
  });

  it("should wait for pending sync (debounce period)", async () => {
    // Start with pending sync
    mockGetStatus.mockReturnValue({
      initialized: true,
      isSyncing: false,
      hasPendingSync: true,
      lastSync: null,
      ipnsName: null,
      currentStep: "idle" as SyncStep,
    });

    const resultPromise = waitForAllSyncsToComplete();

    // First check - still has pending
    await vi.advanceTimersByTimeAsync(500);

    // Clear pending
    mockGetStatus.mockReturnValue({
      initialized: true,
      isSyncing: false,
      hasPendingSync: false,
      lastSync: null,
      ipnsName: null,
      currentStep: "idle" as SyncStep,
    });

    // Second check - should resolve
    await vi.advanceTimersByTimeAsync(500);

    const result = await resultPromise;
    expect(result).toBe(true);
  });

  it("should timeout after specified duration", async () => {
    // Sync never completes
    mockGetStatus.mockReturnValue({
      initialized: true,
      isSyncing: true,
      hasPendingSync: false,
      lastSync: null,
      ipnsName: null,
      currentStep: "uploading" as SyncStep,
    });

    const resultPromise = waitForAllSyncsToComplete(2000); // 2 second timeout

    // Advance past timeout
    await vi.advanceTimersByTimeAsync(2500);

    const result = await resultPromise;
    expect(result).toBe(false);
  });

  it("should use default timeout of 60 seconds", async () => {
    mockGetStatus.mockReturnValue({
      initialized: true,
      isSyncing: true,
      hasPendingSync: false,
      lastSync: null,
      ipnsName: null,
      currentStep: "uploading" as SyncStep,
    });

    const resultPromise = waitForAllSyncsToComplete();

    // Advance to just before default timeout
    await vi.advanceTimersByTimeAsync(59000);

    // Sync completes
    mockGetStatus.mockReturnValue({
      initialized: true,
      isSyncing: false,
      hasPendingSync: false,
      lastSync: null,
      ipnsName: null,
      currentStep: "idle" as SyncStep,
    });

    await vi.advanceTimersByTimeAsync(500);

    const result = await resultPromise;
    expect(result).toBe(true);
  });
});
