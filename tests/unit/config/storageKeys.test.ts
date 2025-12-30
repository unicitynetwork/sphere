import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  STORAGE_KEYS,
  STORAGE_KEY_GENERATORS,
  STORAGE_KEY_PREFIXES,
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

  it("should have unique key values (except intentional legacy duplicates)", () => {
    const values = Object.values(STORAGE_KEYS);
    const uniqueValues = new Set(values);

    // L3_SELECTED_ADDRESS_INDEX and L3_SELECTED_ADDRESS_INDEX_LEGACY intentionally share same value
    // for migration purposes, so we expect 1 less unique value
    const expectedDuplicates = 1;
    expect(uniqueValues.size).toBe(values.length - expectedDuplicates);
  });

  it("should contain expected wallet keys", () => {
    expect(STORAGE_KEYS.UNIFIED_WALLET_MNEMONIC).toBe("sphere_wallet_mnemonic");
    expect(STORAGE_KEYS.UNIFIED_WALLET_MASTER).toBe("sphere_wallet_master");
    expect(STORAGE_KEYS.UNIFIED_WALLET_CHAINCODE).toBe("sphere_wallet_chaincode");
  });

  it("should contain expected UI keys", () => {
    expect(STORAGE_KEYS.THEME).toBe("sphere_theme");
    expect(STORAGE_KEYS.WALLET_ACTIVE_LAYER).toBe("sphere_wallet_active_layer");
    expect(STORAGE_KEYS.WELCOME_ACCEPTED).toBe("sphere_welcome_accepted");
  });

  it("should contain expected Nostr keys", () => {
    expect(STORAGE_KEYS.NOSTR_LAST_SYNC).toBe("sphere_nostr_last_sync");
    expect(STORAGE_KEYS.NOSTR_PROCESSED_EVENTS).toBe("sphere_nostr_processed_events");
  });
});

// ==========================================
// Test: STORAGE_KEY_GENERATORS
// ==========================================

describe("STORAGE_KEY_GENERATORS", () => {
  describe("walletByAddress", () => {
    it("should generate correct key format", () => {
      const address = "abc123";
      const key = STORAGE_KEY_GENERATORS.walletByAddress(address);

      expect(key).toBe("sphere_wallet_abc123");
    });

    it("should handle empty address", () => {
      const key = STORAGE_KEY_GENERATORS.walletByAddress("");

      expect(key).toBe("sphere_wallet_");
    });
  });

  describe("l1WalletByKey", () => {
    it("should generate correct key format", () => {
      const walletKey = "main";
      const key = STORAGE_KEY_GENERATORS.l1WalletByKey(walletKey);

      expect(key).toBe("sphere_l1_wallet_main");
    });
  });

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

  describe("ipfsVersion", () => {
    it("should generate correct key format", () => {
      const ipnsName = "k51qzi5uqu5d...";
      const key = STORAGE_KEY_GENERATORS.ipfsVersion(ipnsName);

      expect(key).toBe("sphere_ipfs_version_k51qzi5uqu5d...");
    });
  });

  describe("ipfsLastCid", () => {
    it("should generate correct key format", () => {
      const ipnsName = "k51qzi5uqu5d...";
      const key = STORAGE_KEY_GENERATORS.ipfsLastCid(ipnsName);

      expect(key).toBe("sphere_ipfs_last_cid_k51qzi5uqu5d...");
    });
  });

  describe("ipfsPendingIpns", () => {
    it("should generate correct key format", () => {
      const ipnsName = "k51test";
      const key = STORAGE_KEY_GENERATORS.ipfsPendingIpns(ipnsName);

      expect(key).toBe("sphere_ipfs_pending_ipns_k51test");
    });
  });

  describe("ipfsLastSeq", () => {
    it("should generate correct key format", () => {
      const ipnsName = "k51test";
      const key = STORAGE_KEY_GENERATORS.ipfsLastSeq(ipnsName);

      expect(key).toBe("sphere_ipfs_last_seq_k51test");
    });
  });

  describe("ipfsChatVersion", () => {
    it("should generate correct key format", () => {
      const ipnsName = "k51chat";
      const key = STORAGE_KEY_GENERATORS.ipfsChatVersion(ipnsName);

      expect(key).toBe("sphere_ipfs_chat_version_k51chat");
    });
  });

  describe("ipfsChatCid", () => {
    it("should generate correct key format", () => {
      const ipnsName = "k51chat";
      const key = STORAGE_KEY_GENERATORS.ipfsChatCid(ipnsName);

      expect(key).toBe("sphere_ipfs_chat_cid_k51chat");
    });
  });

  describe("ipfsChatSeq", () => {
    it("should generate correct key format", () => {
      const ipnsName = "k51chat";
      const key = STORAGE_KEY_GENERATORS.ipfsChatSeq(ipnsName);

      expect(key).toBe("sphere_ipfs_chat_seq_k51chat");
    });
  });
});

// ==========================================
// Test: STORAGE_KEY_PREFIXES
// ==========================================

describe("STORAGE_KEY_PREFIXES", () => {
  it("should have APP prefix as sphere_", () => {
    expect(STORAGE_KEY_PREFIXES.APP).toBe("sphere_");
  });

  it("should have all prefixes start with sphere_", () => {
    const prefixes = Object.values(STORAGE_KEY_PREFIXES);

    for (const prefix of prefixes) {
      expect(prefix).toMatch(/^sphere_/);
    }
  });

  it("should have expected prefix values", () => {
    expect(STORAGE_KEY_PREFIXES.WALLET_ADDRESS).toBe("sphere_wallet_");
    expect(STORAGE_KEY_PREFIXES.L1_WALLET).toBe("sphere_l1_wallet_");
    expect(STORAGE_KEY_PREFIXES.AGENT_MEMORY).toBe("sphere_agent_memory:");
    expect(STORAGE_KEY_PREFIXES.AGENT_CHAT_MESSAGES).toBe("sphere_agent_chat_messages:");
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

  it("should remove all sphere_* keys", () => {
    // Setup: add some sphere keys
    localStorageMock["sphere_theme"] = "dark";
    localStorageMock["sphere_wallet_mnemonic"] = "encrypted_data";
    localStorageMock["sphere_nostr_last_sync"] = "1234567890";

    // Setup: add non-sphere key (should NOT be removed)
    localStorageMock["other_app_key"] = "some_value";

    clearAllSphereData();

    // Verify sphere keys are removed
    expect(localStorageMock["sphere_theme"]).toBeUndefined();
    expect(localStorageMock["sphere_wallet_mnemonic"]).toBeUndefined();
    expect(localStorageMock["sphere_nostr_last_sync"]).toBeUndefined();

    // Verify non-sphere key is preserved
    expect(localStorageMock["other_app_key"]).toBe("some_value");
  });

  it("should handle empty localStorage", () => {
    expect(() => clearAllSphereData()).not.toThrow();
  });

  it("should remove dynamically generated keys", () => {
    // Setup: add dynamic keys
    localStorageMock["sphere_wallet_abc123"] = "wallet_data";
    localStorageMock["sphere_agent_chat_messages:session1"] = "messages";
    localStorageMock["sphere_ipfs_version_k51..."] = "5";

    clearAllSphereData();

    expect(localStorageMock["sphere_wallet_abc123"]).toBeUndefined();
    expect(localStorageMock["sphere_agent_chat_messages:session1"]).toBeUndefined();
    expect(localStorageMock["sphere_ipfs_version_k51..."]).toBeUndefined();
  });

  it("should log the number of cleared keys", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    localStorageMock["sphere_key1"] = "value1";
    localStorageMock["sphere_key2"] = "value2";
    localStorageMock["sphere_key3"] = "value3";

    clearAllSphereData();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("3 sphere_* keys")
    );

    consoleSpy.mockRestore();
  });
});

// ==========================================
// Test: Key consistency
// ==========================================

describe("Key consistency", () => {
  it("should have matching static keys and prefixes", () => {
    // WALLET_ADDRESS prefix should match walletByAddress generator
    const generatedKey = STORAGE_KEY_GENERATORS.walletByAddress("test");
    expect(generatedKey.startsWith(STORAGE_KEY_PREFIXES.WALLET_ADDRESS)).toBe(true);
  });

  it("should have matching L1_WALLET prefix and generator", () => {
    const generatedKey = STORAGE_KEY_GENERATORS.l1WalletByKey("main");
    expect(generatedKey.startsWith(STORAGE_KEY_PREFIXES.L1_WALLET)).toBe(true);
  });

  it("should have matching AGENT_CHAT_MESSAGES prefix and generator", () => {
    const generatedKey = STORAGE_KEY_GENERATORS.agentChatMessages("session1");
    expect(generatedKey.startsWith(STORAGE_KEY_PREFIXES.AGENT_CHAT_MESSAGES)).toBe(true);
  });

  it("should have matching IPFS prefixes and generators", () => {
    const ipnsName = "k51test";

    expect(
      STORAGE_KEY_GENERATORS.ipfsVersion(ipnsName).startsWith(STORAGE_KEY_PREFIXES.IPFS_VERSION)
    ).toBe(true);

    expect(
      STORAGE_KEY_GENERATORS.ipfsLastCid(ipnsName).startsWith(STORAGE_KEY_PREFIXES.IPFS_LAST_CID)
    ).toBe(true);

    expect(
      STORAGE_KEY_GENERATORS.ipfsPendingIpns(ipnsName).startsWith(STORAGE_KEY_PREFIXES.IPFS_PENDING_IPNS)
    ).toBe(true);

    expect(
      STORAGE_KEY_GENERATORS.ipfsLastSeq(ipnsName).startsWith(STORAGE_KEY_PREFIXES.IPFS_LAST_SEQ)
    ).toBe(true);
  });

  it("should have matching IPFS chat prefixes and generators", () => {
    const ipnsName = "k51chat";

    expect(
      STORAGE_KEY_GENERATORS.ipfsChatVersion(ipnsName).startsWith(STORAGE_KEY_PREFIXES.IPFS_CHAT_VERSION)
    ).toBe(true);

    expect(
      STORAGE_KEY_GENERATORS.ipfsChatCid(ipnsName).startsWith(STORAGE_KEY_PREFIXES.IPFS_CHAT_CID)
    ).toBe(true);

    expect(
      STORAGE_KEY_GENERATORS.ipfsChatSeq(ipnsName).startsWith(STORAGE_KEY_PREFIXES.IPFS_CHAT_SEQ)
    ).toBe(true);
  });

  it("should have matching AGENT_MEMORY prefix and generator", () => {
    const generatedKey = STORAGE_KEY_GENERATORS.agentMemory("user1", "activity1");
    expect(generatedKey.startsWith(STORAGE_KEY_PREFIXES.AGENT_MEMORY)).toBe(true);
  });
});
