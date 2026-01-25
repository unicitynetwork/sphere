import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ==========================================
// Mock Dependencies
// ==========================================

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock SDK Token to avoid CBOR parsing issues
vi.mock("@unicitylabs/state-transition-sdk/lib/token/Token", () => ({
  Token: {
    fromJSON: vi.fn().mockResolvedValue({
      id: "mock-token-id",
      name: "mock-token",
    }),
  },
}));

// Mock IdentityManager
const mockGetCurrentIdentity = vi.fn();
vi.mock("../../../../../../src/components/wallet/L3/services/IdentityManager", () => ({
  IdentityManager: {
    getInstance: () => ({
      getCurrentIdentity: mockGetCurrentIdentity,
    }),
  },
}));

// Mock ServiceProvider
const mockGetInclusionProof = vi.fn();
const mockSubmitMintCommitment = vi.fn();
vi.mock("../../../../../../src/components/wallet/L3/services/ServiceProvider", () => ({
  ServiceProvider: {
    stateTransitionClient: {
      getInclusionProof: mockGetInclusionProof,
      submitMintCommitment: mockSubmitMintCommitment,
    },
    getRootTrustBase: () => ({}),
    isTrustBaseVerificationSkipped: () => false,
  },
}));

// Mock InventorySyncService
const mockGetNametagForAddress = vi.fn();
const mockSetNametagForAddress = vi.fn();
vi.mock("../../../../../../src/components/wallet/L3/services/InventorySyncService", () => ({
  getNametagForAddress: mockGetNametagForAddress,
  setNametagForAddress: mockSetNametagForAddress,
}));

// Mock devTools
const mockReconstructMintCommitment = vi.fn();
const mockSubmitMintCommitmentToAggregator = vi.fn();
const mockWaitForMintProofWithSDK = vi.fn();
const mockIsInclusionProofNotExclusion = vi.fn();
vi.mock("../../../../../../src/utils/devTools", () => ({
  reconstructMintCommitment: mockReconstructMintCommitment,
  submitMintCommitmentToAggregator: mockSubmitMintCommitmentToAggregator,
  waitForMintProofWithSDK: mockWaitForMintProofWithSDK,
  isInclusionProofNotExclusion: mockIsInclusionProofNotExclusion,
}));

// Mock TokenRecoveryService
const mockRecoverNametagInvalidatedTokens = vi.fn();
vi.mock("../../../../../../src/components/wallet/L3/services/TokenRecoveryService", () => ({
  TokenRecoveryService: {
    getInstance: () => ({
      recoverNametagInvalidatedTokens: mockRecoverNametagInvalidatedTokens,
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

const mockInclusionProof = {
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
};

const mockExclusionProof = {
  authenticator: null,
  merkleTreePath: {
    root: "0000" + "3".repeat(60),
    steps: [],
  },
  transactionHash: null,
  unicityCertificate: null,
};

// ==========================================
// NametagService Tests
// ==========================================

describe("NametagService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentIdentity.mockResolvedValue(mockIdentity);
    mockGetNametagForAddress.mockReturnValue(mockNametagData);
    mockRecoverNametagInvalidatedTokens.mockResolvedValue({ recovered: 0, errors: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================
  // recoverNametagProofs Tests
  // ==========================================

  describe("recoverNametagProofs", () => {
    it("should return null when no identity exists", async () => {
      mockGetCurrentIdentity.mockResolvedValue(null);

      const { NametagService } = await import(
        "../../../../../../src/components/wallet/L3/services/NametagService"
      );
      const service = NametagService.getInstance({
        getCurrentIdentity: mockGetCurrentIdentity,
      } as any);

      const result = await service.recoverNametagProofs();

      expect(result).toBeNull();
    });

    it("should return null when no nametag token exists", async () => {
      mockGetNametagForAddress.mockReturnValue(null);

      const { NametagService } = await import(
        "../../../../../../src/components/wallet/L3/services/NametagService"
      );
      const service = NametagService.getInstance({
        getCurrentIdentity: mockGetCurrentIdentity,
      } as any);

      const result = await service.recoverNametagProofs();

      expect(result).toBeNull();
    });

    it("should return null when nametag is missing salt", async () => {
      const nametagWithoutSalt = {
        ...mockNametagData,
        token: {
          ...mockNametagData.token,
          genesis: {
            ...mockNametagData.token.genesis,
            data: {
              ...mockNametagData.token.genesis.data,
              salt: undefined, // No salt
            },
          },
        },
      };
      mockGetNametagForAddress.mockReturnValue(nametagWithoutSalt);

      const { NametagService } = await import(
        "../../../../../../src/components/wallet/L3/services/NametagService"
      );
      const service = NametagService.getInstance({
        getCurrentIdentity: mockGetCurrentIdentity,
      } as any);

      const result = await service.recoverNametagProofs();

      expect(result).toBeNull();
    });

    it("should recover nametag when REQUEST_ID_EXISTS is returned", async () => {
      mockReconstructMintCommitment.mockResolvedValue({
        commitment: { requestId: { toJSON: () => "mock-request-id" } },
        error: null,
      });
      mockSubmitMintCommitmentToAggregator.mockResolvedValue({
        success: true,
        status: "REQUEST_ID_EXISTS",
      });
      mockWaitForMintProofWithSDK.mockResolvedValue(mockInclusionProof);
      mockIsInclusionProofNotExclusion.mockReturnValue(true);

      const { NametagService } = await import(
        "../../../../../../src/components/wallet/L3/services/NametagService"
      );
      const service = NametagService.getInstance({
        getCurrentIdentity: mockGetCurrentIdentity,
      } as any);

      const result = await service.recoverNametagProofs();

      expect(mockSubmitMintCommitmentToAggregator).toHaveBeenCalled();
      expect(mockSetNametagForAddress).toHaveBeenCalled();
      // Result should be a token (mocked)
      expect(result).toBeDefined();
    });

    it("should trigger token recovery after successful nametag recovery", async () => {
      mockReconstructMintCommitment.mockResolvedValue({
        commitment: { requestId: { toJSON: () => "mock-request-id" } },
        error: null,
      });
      mockSubmitMintCommitmentToAggregator.mockResolvedValue({
        success: true,
        status: "SUCCESS",
      });
      mockWaitForMintProofWithSDK.mockResolvedValue(mockInclusionProof);
      mockIsInclusionProofNotExclusion.mockReturnValue(true);
      mockRecoverNametagInvalidatedTokens.mockResolvedValue({ recovered: 3, errors: [] });

      const { NametagService } = await import(
        "../../../../../../src/components/wallet/L3/services/NametagService"
      );
      const service = NametagService.getInstance({
        getCurrentIdentity: mockGetCurrentIdentity,
      } as any);

      await service.recoverNametagProofs();

      // Token recovery should be triggered
      expect(mockRecoverNametagInvalidatedTokens).toHaveBeenCalled();
    });

    it("should throw error when submission fails", async () => {
      mockReconstructMintCommitment.mockResolvedValue({
        commitment: { requestId: { toJSON: () => "mock-request-id" } },
        error: null,
      });
      mockSubmitMintCommitmentToAggregator.mockResolvedValue({
        success: false,
        status: "FAILED",
      });

      const { NametagService } = await import(
        "../../../../../../src/components/wallet/L3/services/NametagService"
      );
      const service = NametagService.getInstance({
        getCurrentIdentity: mockGetCurrentIdentity,
      } as any);

      await expect(service.recoverNametagProofs()).rejects.toThrow("Submission failed");
    });

    it("should throw error when commitment reconstruction fails", async () => {
      mockReconstructMintCommitment.mockResolvedValue({
        commitment: null,
        error: "Cannot reconstruct commitment",
      });

      const { NametagService } = await import(
        "../../../../../../src/components/wallet/L3/services/NametagService"
      );
      const service = NametagService.getInstance({
        getCurrentIdentity: mockGetCurrentIdentity,
      } as any);

      await expect(service.recoverNametagProofs()).rejects.toThrow("Cannot reconstruct commitment");
    });
  });

  // ==========================================
  // refreshNametagProof Tests (existing function)
  // ==========================================

  describe("refreshNametagProof", () => {
    it("should return null when no nametag exists", async () => {
      mockGetNametagForAddress.mockReturnValue(null);

      const { NametagService } = await import(
        "../../../../../../src/components/wallet/L3/services/NametagService"
      );
      const service = NametagService.getInstance({
        getCurrentIdentity: mockGetCurrentIdentity,
      } as any);

      const result = await service.refreshNametagProof();

      expect(result).toBeNull();
    });
  });
});
