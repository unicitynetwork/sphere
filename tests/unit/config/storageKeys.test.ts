import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  STORAGE_KEYS,
  STORAGE_KEY_GENERATORS,
  clearAllSphereData,
} from "../../../src/config/storageKeys";

// ==========================================
// Test: STORAGE_KEYS
// ==========================================

describe("STORAGE_KEYS", () => {
  it("should have all keys prefixed with sphere_", () => {
    const keys = Object.values(STORAGE_KEYS);

    for (const key of keys) {
      expect(key).toMatch(/^sphere_/);
    }
  });

  it("should have unique key values", () => {
    const values = Object.values(STORAGE_KEYS);
    const uniqueValues = new Set(values);

    expect(uniqueValues.size).toBe(values.length);
  });

  it("should contain expected UI keys", () => {
    expect(STORAGE_KEYS.THEME).toBe("sphere_theme");
  });

  it("should contain expected dev keys", () => {
    expect(STORAGE_KEYS.DEV_AGGREGATOR_URL).toBe("sphere_dev_aggregator_url");
    expect(STORAGE_KEYS.DEV_SKIP_TRUST_BASE).toBe("sphere_dev_skip_trust_base");
  });
});

// ==========================================
// Test: STORAGE_KEY_GENERATORS
// ==========================================

describe("STORAGE_KEY_GENERATORS", () => {
  describe("agentMemory", () => {
    it("should generate correct key format", () => {
      const userId = "user1";
      const activityId = "activity1";
      const key = STORAGE_KEY_GENERATORS.agentMemory(userId, activityId);

      expect(key).toBe("sphere_agent_memory:user1:activity1");
    });
  });

  describe("agentChatMessages", () => {
    it("should generate correct key format", () => {
      const sessionId = "session123";
      const key = STORAGE_KEY_GENERATORS.agentChatMessages(sessionId);

      expect(key).toBe("sphere_agent_chat_messages:session123");
    });
  });
});

// ==========================================
// Test: clearAllSphereData
// ==========================================

describe("clearAllSphereData", () => {
  // Mock localStorage
  let localStorageMock: { [key: string]: string };

  beforeEach(() => {
    localStorageMock = {};

    // Mock localStorage methods
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
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("should remove all sphere_ keys but preserve non-sphere keys", () => {
    // Setup: add sphere keys (should all be removed)
    localStorageMock["sphere_theme"] = "dark";
    localStorageMock["sphere_chat_messages"] = "data";
    localStorageMock["sphere_agent_chat_sessions"] = "sessions";
    localStorageMock["sphere_direct_messages"] = "sdk_data";

    // Setup: add non-sphere key (should NOT be removed)
    localStorageMock["other_app_key"] = "some_value";

    clearAllSphereData();

    // Verify all sphere keys are removed
    expect(localStorageMock["sphere_theme"]).toBeUndefined();
    expect(localStorageMock["sphere_chat_messages"]).toBeUndefined();
    expect(localStorageMock["sphere_agent_chat_sessions"]).toBeUndefined();
    expect(localStorageMock["sphere_direct_messages"]).toBeUndefined();

    // Verify non-sphere key is preserved
    expect(localStorageMock["other_app_key"]).toBe("some_value");
  });

  it("should handle empty localStorage", () => {
    expect(() => clearAllSphereData()).not.toThrow();
  });

  it("should remove dynamically generated keys", () => {
    // Setup: add dynamic keys
    localStorageMock["sphere_agent_memory:user1:activity1"] = "memory_data";
    localStorageMock["sphere_agent_chat_messages:session1"] = "messages";

    clearAllSphereData();

    expect(localStorageMock["sphere_agent_memory:user1:activity1"]).toBeUndefined();
    expect(localStorageMock["sphere_agent_chat_messages:session1"]).toBeUndefined();
  });

  it("should log the number of cleared keys", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    // Add known app keys
    localStorageMock["sphere_theme"] = "dark";
    localStorageMock["sphere_chat_messages"] = "data";
    localStorageMock["sphere_agent_memory:u1:a1"] = "mem";

    clearAllSphereData();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("sphere keys")
    );

    consoleSpy.mockRestore();
  });
});
