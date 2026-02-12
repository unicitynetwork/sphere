import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useGlobalSyncStatus } from "../../../src/hooks/useGlobalSyncStatus";

describe("useGlobalSyncStatus", () => {
  it("should return not syncing", () => {
    const { result } = renderHook(() => useGlobalSyncStatus());

    expect(result.current.isAnySyncing).toBe(false);
  });

  it("should return 'All data synced' message", () => {
    const { result } = renderHook(() => useGlobalSyncStatus());

    expect(result.current.statusMessage).toBe("All data synced");
  });
});
