import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ==========================================
// Mock Dependencies
// ==========================================

// Mock IdentityManager
const mockGetCurrentIdentity = vi.fn();
vi.mock("../../../src/components/wallet/L3/services/IdentityManager", () => ({
  IdentityManager: {
    getInstance: () => ({
      getCurrentIdentity: mockGetCurrentIdentity,
    }),
  },
}));

// Mock NostrService
const mockQueryPubkeyByNametag = vi.fn();
vi.mock("../../../src/components/wallet/L3/services/NostrService", () => ({
  NostrService: {
    getInstance: () => ({
      queryPubkeyByNametag: mockQueryPubkeyByNametag,
      publishNametagBinding: vi.fn().mockResolvedValue(true),
    }),
  },
}));

// Mock InventorySyncService
const mockGetNametagForAddress = vi.fn();
vi.mock("../../../src/components/wallet/L3/services/InventorySyncService", () => ({
  getNametagForAddress: mockGetNametagForAddress,
}));

// Mock ServiceProvider
const mockGetInclusionProof = vi.fn();
vi.mock("../../../src/components/wallet/L3/services/ServiceProvider", () => ({
  ServiceProvider: {
    stateTransitionClient: {
      getInclusionProof: mockGetInclusionProof,
    },
  },
}));

// Mock Nostr SDK
vi.mock("@unicitylabs/nostr-js-sdk", () => ({
  NostrKeyManager: {
    fromPrivateKey: () => ({
      getPublicKeyHex: () => "nostr-pubkey-" + "a".repeat(52),
    }),
  },
}));

// Mock SDK types
vi.mock("@unicitylabs/state-transition-sdk/lib/transaction/MintTransactionData", () => ({
  MintTransactionData: {
    fromJSON: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock("@unicitylabs/state-transition-sdk/lib/transaction/MintCommitment", () => ({
  MintCommitment: {
    create: vi.fn().mockResolvedValue({
      requestId: { toJSON: () => "mock-request-id" },
    }),
  },
}));

// ==========================================
// Test Fixtures
// ==========================================

const mockIdentity = {
  address: "0x" + "a".repeat(64),
  publicKey: "02" + "b".repeat(64),
  privateKey: "c".repeat(64),
};

const mockNametagData = {
  name: "alice",
  timestamp: Date.now(),
  format: "2.0",
  version: "1.0",
  token: {
    version: "2.0",
    genesis: {
      data: {
        tokenId: "d".repeat(64),
        tokenType: "f8aa13834268d29355ff12183066f0cb902003629bbc5eb9ef0efbe397867509",
        recipient: "DIRECT://" + "a".repeat(64),
        salt: "e".repeat(64),
        recipientDataHash: null,
        reason: null,
        coinData: null,
        tokenData: "alice",
      },
      inclusionProof: {
        authenticator: {
          algorithm: "secp256k1",
          publicKey: "f".repeat(64),
          signature: "1".repeat(128),
          stateHash: "0000" + "2".repeat(60),
        },
        merkleTreePath: {
          root: "0000" + "3".repeat(60),
          steps: [],
        },
        transactionHash: "4".repeat(64),
        unicityCertificate: "5".repeat(100),
      },
    },
    state: {
      data: "",
      predicate: "6".repeat(64),
    },
    transactions: [],
    nametags: [],
  },
};

const expectedNostrPubkey = "nostr-pubkey-" + "a".repeat(52);

// ==========================================
// unicityIdValidator Tests
// ==========================================

describe("unicityIdValidator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentIdentity.mockResolvedValue(mockIdentity);
    mockGetNametagForAddress.mockReturnValue(mockNametagData);
    mockQueryPubkeyByNametag.mockResolvedValue(expectedNostrPubkey);
    mockGetInclusionProof.mockResolvedValue({
      inclusionProof: {
        authenticator: { algorithm: "secp256k1" }, // Valid inclusion proof
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================
  // validateUnicityId Tests
  // ==========================================

  describe("validateUnicityId", () => {
    it("should return invalid when no identity exists", async () => {
      mockGetCurrentIdentity.mockResolvedValue(null);

      const { validateUnicityId } = await import("../../../src/utils/unicityIdValidator");
      const result = await validateUnicityId();

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("No identity found - wallet not initialized");
      expect(result.identity).toBeNull();
    });

    it("should return invalid when no nametag exists", async () => {
      mockGetNametagForAddress.mockReturnValue(null);

      const { validateUnicityId } = await import("../../../src/utils/unicityIdValidator");
      const result = await validateUnicityId();

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("No nametag registered locally");
      expect(result.nametag?.hasToken).toBe(false);
    });

    it("should return invalid when nametag not on aggregator", async () => {
      // Return exclusion proof (authenticator === null)
      mockGetInclusionProof.mockResolvedValue({
        inclusionProof: {
          authenticator: null,
        },
      });

      const { validateUnicityId } = await import("../../../src/utils/unicityIdValidator");
      const result = await validateUnicityId();

      expect(result.isValid).toBe(false);
      expect(result.nametag?.isOnAggregator).toBe(false);
      expect(result.errors.some(e => e.includes("NOT registered on the aggregator"))).toBe(true);
    });

    it("should return invalid when Nostr binding does not match identity", async () => {
      // Return a different pubkey from Nostr
      mockQueryPubkeyByNametag.mockResolvedValue("different-pubkey-" + "x".repeat(48));

      const { validateUnicityId } = await import("../../../src/utils/unicityIdValidator");
      const result = await validateUnicityId();

      expect(result.isValid).toBe(false);
      expect(result.nostrBinding?.matchesIdentity).toBe(false);
      expect(result.errors.some(e => e.includes("owned by different pubkey"))).toBe(true);
    });

    it("should return invalid when nametag not published to Nostr", async () => {
      mockQueryPubkeyByNametag.mockResolvedValue(null);

      const { validateUnicityId } = await import("../../../src/utils/unicityIdValidator");
      const result = await validateUnicityId();

      expect(result.isValid).toBe(false);
      expect(result.nostrBinding?.resolvedPubkey).toBeNull();
      expect(result.errors.some(e => e.includes("not published to Nostr"))).toBe(true);
    });

    it("should return valid when all checks pass", async () => {
      // All mocks return valid data by default from beforeEach

      const { validateUnicityId } = await import("../../../src/utils/unicityIdValidator");
      const result = await validateUnicityId();

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.identity).toBeDefined();
      expect(result.nametag?.hasToken).toBe(true);
      expect(result.nametag?.isOnAggregator).toBe(true);
      expect(result.nostrBinding?.matchesIdentity).toBe(true);
    });

    it("should include warning when aggregator check fails", async () => {
      mockGetInclusionProof.mockRejectedValue(new Error("Network timeout"));

      const { validateUnicityId } = await import("../../../src/utils/unicityIdValidator");
      const result = await validateUnicityId();

      // Should still be invalid due to Nostr check (with warning about aggregator)
      expect(result.warnings.some(w => w.includes("Could not verify nametag on aggregator"))).toBe(true);
    });
  });

  // ==========================================
  // deriveNostrPubkeyFromIdentity Tests
  // ==========================================

  describe("deriveNostrPubkeyFromIdentity", () => {
    it("should derive Nostr pubkey from identity private key", async () => {
      const { deriveNostrPubkeyFromIdentity } = await import("../../../src/utils/unicityIdValidator");

      const pubkey = deriveNostrPubkeyFromIdentity(mockIdentity as unknown as Parameters<typeof deriveNostrPubkeyFromIdentity>[0]);

      expect(pubkey).toBeDefined();
      expect(pubkey).toBe(expectedNostrPubkey);
    });
  });

  // ==========================================
  // repairUnicityId Tests
  // ==========================================

  describe("repairUnicityId", () => {
    it("should return true when already valid", async () => {
      // All checks pass by default

      const { repairUnicityId } = await import("../../../src/utils/unicityIdValidator");
      const result = await repairUnicityId();

      expect(result).toBe(true);
    });

    it("should return false when no identity", async () => {
      mockGetCurrentIdentity.mockResolvedValue(null);

      const { repairUnicityId } = await import("../../../src/utils/unicityIdValidator");
      const result = await repairUnicityId();

      expect(result).toBe(false);
    });

    it("should return false when no nametag", async () => {
      mockGetNametagForAddress.mockReturnValue(null);

      const { repairUnicityId } = await import("../../../src/utils/unicityIdValidator");
      const result = await repairUnicityId();

      expect(result).toBe(false);
    });
  });

  // ==========================================
  // isNametagAvailable Tests
  // ==========================================

  describe("isNametagAvailable", () => {
    it("should return true when nametag not found on Nostr", async () => {
      mockQueryPubkeyByNametag.mockResolvedValue(null);

      const { isNametagAvailable } = await import("../../../src/utils/unicityIdValidator");
      const result = await isNametagAvailable("newname");

      expect(result).toBe(true);
    });

    it("should return false when nametag exists on Nostr", async () => {
      mockQueryPubkeyByNametag.mockResolvedValue("some-pubkey");

      const { isNametagAvailable } = await import("../../../src/utils/unicityIdValidator");
      const result = await isNametagAvailable("existingname");

      expect(result).toBe(false);
    });
  });
});
