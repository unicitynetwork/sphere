import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  TokenValidationService,
  getTokenValidationService,
} from "../TokenValidationService";
import { Token, TokenStatus } from "../../data/model";
import type { TxfToken } from "../types/TxfTypes";

// ==========================================
// Mock fetch globally
// ==========================================

const mockFetch = vi.fn();
global.fetch = mockFetch;

// ==========================================
// Test Fixtures
// ==========================================

const validTxfToken: TxfToken = {
  version: "2.0",
  genesis: {
    data: {
      tokenId: "a".repeat(64),
      tokenType: "b".repeat(64),
      coinData: [["ALPHA", "1000000000"]],
      tokenData: "",
      salt: "c".repeat(64),
      recipient: "DIRECT://abc123",
      recipientDataHash: null,
      reason: null,
    },
    inclusionProof: {
      authenticator: {
        algorithm: "secp256k1",
        publicKey: "d".repeat(64),
        signature: "e".repeat(128),
        stateHash: "0000" + "f".repeat(60),
      },
      merkleTreePath: {
        root: "0000" + "1".repeat(60),
        steps: [{ data: "2".repeat(64), path: "1" }],
      },
      transactionHash: "3".repeat(64),
      unicityCertificate: "4".repeat(100),
    },
  },
  state: {
    data: "",
    predicate: "5".repeat(64),
  },
  transactions: [],
  nametags: [],
  _integrity: {
    genesisDataJSONHash: "0000" + "6".repeat(60),
  },
};

const createMockToken = (overrides: Partial<Token> = {}): Token => {
  return new Token({
    id: "test-token-id",
    name: "Test Token",
    type: "UCT",
    timestamp: Date.now(),
    jsonData: JSON.stringify(validTxfToken),
    status: TokenStatus.CONFIRMED,
    amount: "1000000000",
    coinId: "ALPHA",
    symbol: "ALPHA",
    sizeBytes: 1000,
    ...overrides,
  });
};

// ==========================================
// TokenValidationService Tests
// ==========================================

describe("TokenValidationService", () => {
  let service: TokenValidationService;

  beforeEach(() => {
    service = new TokenValidationService("https://test-aggregator.example.com");
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================
  // validateToken Tests
  // ==========================================

  describe("validateToken", () => {
    it("should return invalid for token without jsonData", async () => {
      const token = createMockToken({ jsonData: undefined });

      const result = await service.validateToken(token);

      expect(result.isValid).toBe(false);
      expect(result.reason).toContain("no jsonData");
    });

    it("should return invalid for token with unparseable JSON", async () => {
      const token = createMockToken({ jsonData: "not valid json" });

      const result = await service.validateToken(token);

      expect(result.isValid).toBe(false);
      expect(result.reason).toContain("parse");
    });

    it("should return invalid for token without TXF structure", async () => {
      const token = createMockToken({
        jsonData: JSON.stringify({ foo: "bar" }),
      });

      const result = await service.validateToken(token);

      expect(result.isValid).toBe(false);
      expect(result.reason).toContain("TXF fields");
    });

    it("should return valid for token with proper TXF structure", async () => {
      const token = createMockToken();

      // Mock SDK verification to throw (optional verification)
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const result = await service.validateToken(token);

      expect(result.isValid).toBe(true);
      expect(result.token).toBeDefined();
    });

    it("should attempt to fetch proofs for uncommitted transactions", async () => {
      const txfWithUncommitted = {
        ...validTxfToken,
        transactions: [
          {
            previousStateHash: "a".repeat(64),
            newStateHash: "b".repeat(64),
            predicate: "c".repeat(64),
            inclusionProof: null, // Uncommitted
          },
        ],
      };

      const token = createMockToken({
        jsonData: JSON.stringify(txfWithUncommitted),
      });

      // Mock aggregator returning a proof
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: validTxfToken.genesis.inclusionProof,
        }),
      });

      await service.validateToken(token);

      expect(mockFetch).toHaveBeenCalled();
      // Should have tried to fetch proof
      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[0]).toContain("/proof");
    });
  });

  // ==========================================
  // validateAllTokens Tests
  // ==========================================

  describe("validateAllTokens", () => {
    it("should validate all tokens and return results", async () => {
      const tokens = [
        createMockToken({ id: "token1" }),
        createMockToken({ id: "token2" }),
        createMockToken({ id: "token3", jsonData: undefined }),
      ];

      const result = await service.validateAllTokens(tokens);

      expect(result.validTokens.length).toBe(2);
      expect(result.issues.length).toBe(1);
      expect(result.issues[0].tokenId).toBe("token3");
    });

    it("should process tokens in batches", async () => {
      const tokens = Array.from({ length: 10 }, (_, i) =>
        createMockToken({ id: `token${i}` })
      );

      const progressUpdates: { completed: number; total: number }[] = [];

      await service.validateAllTokens(tokens, {
        batchSize: 3,
        onProgress: (completed, total) => {
          progressUpdates.push({ completed, total });
        },
      });

      // Should have multiple progress updates
      expect(progressUpdates.length).toBeGreaterThan(0);
      // Last update should have completed all
      expect(progressUpdates[progressUpdates.length - 1].completed).toBe(10);
    });

    it("should use custom batch size", async () => {
      const tokens = Array.from({ length: 6 }, (_, i) =>
        createMockToken({ id: `token${i}` })
      );

      const progressUpdates: number[] = [];
      await service.validateAllTokens(tokens, {
        batchSize: 2,
        onProgress: (completed) => {
          progressUpdates.push(completed);
        },
      });

      // With batch size 2 and 6 tokens, progress is reported once per batch
      // So we should get 3 progress calls (one per batch) with cumulative completed counts
      expect(progressUpdates.length).toBe(3); // 3 batches
      expect(progressUpdates).toEqual([2, 4, 6]); // After each batch: 2, 4, 6 tokens complete
    });

    it("should handle validation errors gracefully", async () => {
      const tokens = [
        createMockToken({ id: "valid-token" }),
        createMockToken({ id: "invalid-token", jsonData: "invalid" }),
      ];

      const result = await service.validateAllTokens(tokens);

      // Should still return valid tokens
      expect(result.validTokens.length).toBe(1);
      // Should report issues for invalid tokens
      expect(result.issues.length).toBe(1);
    });
  });

  // ==========================================
  // fetchMissingProofs Tests
  // ==========================================

  describe("fetchMissingProofs", () => {
    it("should return null for token without jsonData", async () => {
      const token = createMockToken({ jsonData: undefined });

      const result = await service.fetchMissingProofs(token);

      expect(result).toBeNull();
    });

    it("should return null for token without transactions", async () => {
      const token = createMockToken();

      const result = await service.fetchMissingProofs(token);

      expect(result).toBeNull();
    });

    it("should fetch and apply proofs for uncommitted transactions", async () => {
      const txfWithUncommitted = {
        ...validTxfToken,
        transactions: [
          {
            previousStateHash: "a".repeat(64),
            newStateHash: "b".repeat(64),
            predicate: "c".repeat(64),
            inclusionProof: null,
          },
        ],
      };

      const token = createMockToken({
        jsonData: JSON.stringify(txfWithUncommitted),
      });

      // Mock successful proof fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: validTxfToken.genesis.inclusionProof,
        }),
      });

      const result = await service.fetchMissingProofs(token);

      expect(result).not.toBeNull();
      expect(result?.status).toBe(TokenStatus.CONFIRMED);

      // Verify proof was applied
      const updatedTxf = JSON.parse(result!.jsonData!);
      expect(updatedTxf.transactions[0].inclusionProof).not.toBeNull();
    });

    it("should return null when proof fetch fails", async () => {
      // Reset mock to ensure clean state
      mockFetch.mockReset();

      const txfWithUncommitted = {
        ...validTxfToken,
        transactions: [
          {
            previousStateHash: "a".repeat(64),
            newStateHash: "b".repeat(64),
            predicate: "c".repeat(64),
            inclusionProof: null,
          },
        ],
      };

      const token = createMockToken({
        jsonData: JSON.stringify(txfWithUncommitted),
      });

      // Mock failed proof fetch - return error response
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
      });

      const result = await service.fetchMissingProofs(token);

      expect(result).toBeNull();
    });

    it("should skip transactions that already have proofs", async () => {
      const txfWithMixedTransactions = {
        ...validTxfToken,
        transactions: [
          {
            previousStateHash: "a".repeat(64),
            newStateHash: "b".repeat(64),
            predicate: "c".repeat(64),
            inclusionProof: validTxfToken.genesis.inclusionProof, // Already has proof
          },
          {
            previousStateHash: "b".repeat(64),
            newStateHash: "c".repeat(64),
            predicate: "d".repeat(64),
            inclusionProof: null, // Needs proof
          },
        ],
      };

      const token = createMockToken({
        jsonData: JSON.stringify(txfWithMixedTransactions),
      });

      // Only one fetch call should be made (for the uncommitted tx)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: validTxfToken.genesis.inclusionProof,
        }),
      });

      await service.fetchMissingProofs(token);

      // Only one fetch call for the uncommitted transaction
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});

// ==========================================
// Singleton Tests
// ==========================================

describe("getTokenValidationService", () => {
  it("should return the same instance on multiple calls", () => {
    const instance1 = getTokenValidationService();
    const instance2 = getTokenValidationService();

    expect(instance1).toBe(instance2);
  });
});
