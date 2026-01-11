import { describe, it, expect } from "vitest";
import {
  tokenToTxf,
  txfToToken,
  buildTxfStorageData,
  parseTxfStorageData,
  parseTxfFile,
  getTokenId,
  hasValidTxfData,
  countCommittedTransactions,
  hasUncommittedTransactions,
} from "../../../../../../src/components/wallet/L3/services/TxfSerializer";
import { Token, TokenStatus } from "../../../../../../src/components/wallet/L3/data/model";
import type { TxfToken, TxfStorageData } from "../../../../../../src/components/wallet/L3/services/types/TxfTypes";

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
// tokenToTxf Tests
// ==========================================

describe("tokenToTxf", () => {
  it("should convert token with valid jsonData to TxfToken", () => {
    const token = createMockToken();
    const result = tokenToTxf(token);

    expect(result).not.toBeNull();
    expect(result?.version).toBe("2.0");
    expect(result?.genesis.data.tokenId).toBe("a".repeat(64));
  });

  it("should return null for token without jsonData", () => {
    const token = createMockToken({ jsonData: undefined });
    const result = tokenToTxf(token);

    expect(result).toBeNull();
  });

  it("should return null for token with invalid JSON", () => {
    const token = createMockToken({ jsonData: "not valid json" });
    const result = tokenToTxf(token);

    expect(result).toBeNull();
  });

  it("should return null for token with non-TXF structure", () => {
    const token = createMockToken({ jsonData: JSON.stringify({ foo: "bar" }) });
    const result = tokenToTxf(token);

    expect(result).toBeNull();
  });

  it("should add default version if missing", () => {
    const tokenWithoutVersion = { ...validTxfToken };
    // @ts-expect-error - Testing missing version
    delete tokenWithoutVersion.version;

    const token = createMockToken({
      jsonData: JSON.stringify(tokenWithoutVersion),
    });
    const result = tokenToTxf(token);

    expect(result).not.toBeNull();
    expect(result?.version).toBe("2.0");
  });

  it("should add default transactions array if missing", () => {
    const tokenWithoutTxs = { ...validTxfToken };
    // @ts-expect-error - Testing missing transactions
    delete tokenWithoutTxs.transactions;

    const token = createMockToken({
      jsonData: JSON.stringify(tokenWithoutTxs),
    });
    const result = tokenToTxf(token);

    expect(result).not.toBeNull();
    expect(result?.transactions).toEqual([]);
  });
});

// ==========================================
// txfToToken Tests
// ==========================================

describe("txfToToken", () => {
  it("should convert TxfToken to Token model", () => {
    const tokenId = "a".repeat(64);
    const result = txfToToken(tokenId, validTxfToken);

    expect(result).toBeInstanceOf(Token);
    expect(result.id).toBe(tokenId);
    expect(result.status).toBe(TokenStatus.CONFIRMED);
    expect(result.amount).toBe("1000000000");
    expect(result.coinId).toBe("ALPHA");
  });

  it("should set status to PENDING when last transaction has no proof", () => {
    const tokenWithPendingTx: TxfToken = {
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

    const result = txfToToken("test-id", tokenWithPendingTx);
    expect(result.status).toBe(TokenStatus.PENDING);
  });

  it("should calculate total amount from coinData", () => {
    const tokenWithMultipleCoins: TxfToken = {
      ...validTxfToken,
      genesis: {
        ...validTxfToken.genesis,
        data: {
          ...validTxfToken.genesis.data,
          coinData: [
            ["COIN1", "1000"],
            ["COIN2", "2000"],
          ],
        },
      },
    };

    const result = txfToToken("test-id", tokenWithMultipleCoins);
    expect(result.amount).toBe("3000");
  });
});

// ==========================================
// buildTxfStorageData Tests
// ==========================================

describe("buildTxfStorageData", () => {
  it("should build storage data with tokens and metadata", () => {
    const tokens = [createMockToken()];
    const meta = {
      version: 1,
      timestamp: Date.now(),
      address: "0x123",
      ipnsName: "ipns-test",
    };

    const result = buildTxfStorageData(tokens, meta);

    expect(result._meta).toBeDefined();
    expect(result._meta.formatVersion).toBe("2.0");
    expect(result._meta.version).toBe(1);
    expect(Object.keys(result).length).toBeGreaterThan(1);
  });

  it("should include nametag if provided", () => {
    const tokens = [createMockToken()];
    const meta = {
      version: 1,
      timestamp: Date.now(),
      address: "0x123",
      ipnsName: "ipns-test",
    };
    const nametag = {
      name: "testuser",
      token: validTxfToken, // Must be a valid token, not empty object
      timestamp: Date.now(),
      format: "1.0",
      version: "1.0",
    };

    const result = buildTxfStorageData(tokens, meta, nametag);

    expect(result._nametag).toBeDefined();
    expect(result._nametag?.name).toBe("testuser");
  });

  it("should skip tokens without valid TXF data", () => {
    const invalidToken = createMockToken({ jsonData: undefined });
    const meta = {
      version: 1,
      timestamp: Date.now(),
      address: "0x123",
      ipnsName: "ipns-test",
    };

    const result = buildTxfStorageData([invalidToken], meta);

    // Should only have _meta key
    const tokenKeys = Object.keys(result).filter((k) => k.startsWith("_") && k !== "_meta");
    expect(tokenKeys.length).toBe(0);
  });
});

// ==========================================
// parseTxfStorageData Tests
// ==========================================

describe("parseTxfStorageData", () => {
  it("should parse valid storage data", () => {
    const storageData: TxfStorageData = {
      _meta: {
        version: 1,
        timestamp: Date.now(),
        address: "0x123",
        ipnsName: "ipns-test",
        formatVersion: "2.0",
      },
      ["_" + "a".repeat(64)]: validTxfToken,
    };

    const result = parseTxfStorageData(storageData);

    expect(result.tokens.length).toBe(1);
    expect(result.meta).toBeDefined();
    expect(result.validationErrors.length).toBe(0);
  });

  it("should return errors for non-object data", () => {
    const result = parseTxfStorageData("not an object");

    expect(result.tokens.length).toBe(0);
    expect(result.validationErrors.length).toBeGreaterThan(0);
  });

  it("should extract nametag if present", () => {
    const storageData = {
      _meta: {
        version: 1,
        timestamp: Date.now(),
        address: "0x123",
        ipnsName: "ipns-test",
        formatVersion: "2.0",
      },
      _nametag: {
        name: "testuser",
        token: validTxfToken, // Must be a valid token, not empty object
        timestamp: Date.now(),
        format: "1.0",
        version: "1.0",
      },
    };

    const result = parseTxfStorageData(storageData);

    expect(result.nametag).toBeDefined();
    expect(result.nametag?.name).toBe("testuser");
  });

  it("should report validation errors for invalid tokens", () => {
    const storageData = {
      _meta: {
        version: 1,
        timestamp: Date.now(),
        address: "0x123",
        ipnsName: "ipns-test",
        formatVersion: "2.0",
      },
      _invalidToken: { notATxfToken: true },
    };

    const result = parseTxfStorageData(storageData);

    expect(result.validationErrors.length).toBeGreaterThan(0);
  });
});

// ==========================================
// parseTxfFile Tests
// ==========================================

describe("parseTxfFile", () => {
  it("should parse valid TXF file content", () => {
    const content = {
      ["_" + "a".repeat(64)]: validTxfToken,
    };

    const result = parseTxfFile(content);

    expect(result.tokens.length).toBe(1);
    expect(result.errors.length).toBe(0);
  });

  it("should return empty for non-object content", () => {
    const result = parseTxfFile("not an object");

    expect(result.tokens.length).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("should skip non-token keys", () => {
    const content = {
      _meta: { version: 1 },
      regularKey: { foo: "bar" },
    };

    const result = parseTxfFile(content);

    expect(result.tokens.length).toBe(0);
  });
});

// ==========================================
// Utility Function Tests
// ==========================================

describe("getTokenId", () => {
  it("should extract tokenId from jsonData genesis", () => {
    const token = createMockToken();
    const result = getTokenId(token);

    expect(result).toBe("a".repeat(64));
  });

  it("should fall back to token.id when no jsonData", () => {
    const token = createMockToken({ jsonData: undefined, id: "fallback-id" });
    const result = getTokenId(token);

    expect(result).toBe("fallback-id");
  });
});

describe("hasValidTxfData", () => {
  it("should return true for valid TXF token", () => {
    const token = createMockToken();
    expect(hasValidTxfData(token)).toBe(true);
  });

  it("should return false for token without jsonData", () => {
    const token = createMockToken({ jsonData: undefined });
    expect(hasValidTxfData(token)).toBe(false);
  });

  it("should return false for incomplete TXF structure", () => {
    const incompleteToken = { genesis: { data: {} } };
    const token = createMockToken({
      jsonData: JSON.stringify(incompleteToken),
    });
    expect(hasValidTxfData(token)).toBe(false);
  });
});

describe("countCommittedTransactions", () => {
  it("should return 0 for token with no transactions", () => {
    const token = createMockToken();
    expect(countCommittedTransactions(token)).toBe(0);
  });

  it("should count transactions with proofs", () => {
    const tokenWithTxs: TxfToken = {
      ...validTxfToken,
      transactions: [
        {
          previousStateHash: "a".repeat(64),
          newStateHash: "b".repeat(64),
          predicate: "c".repeat(64),
          inclusionProof: validTxfToken.genesis.inclusionProof,
        },
        {
          previousStateHash: "b".repeat(64),
          newStateHash: "c".repeat(64),
          predicate: "d".repeat(64),
          inclusionProof: null,
        },
      ],
    };

    const token = createMockToken({
      jsonData: JSON.stringify(tokenWithTxs),
    });

    expect(countCommittedTransactions(token)).toBe(1);
  });
});

describe("hasUncommittedTransactions", () => {
  it("should return false for token with no transactions", () => {
    const token = createMockToken();
    expect(hasUncommittedTransactions(token)).toBe(false);
  });

  it("should return true for token with uncommitted transaction", () => {
    const tokenWithUncommitted: TxfToken = {
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
      jsonData: JSON.stringify(tokenWithUncommitted),
    });

    expect(hasUncommittedTransactions(token)).toBe(true);
  });

  it("should return false when all transactions are committed", () => {
    const tokenWithCommitted: TxfToken = {
      ...validTxfToken,
      transactions: [
        {
          previousStateHash: "a".repeat(64),
          newStateHash: "b".repeat(64),
          predicate: "c".repeat(64),
          inclusionProof: validTxfToken.genesis.inclusionProof,
        },
      ],
    };

    const token = createMockToken({
      jsonData: JSON.stringify(tokenWithCommitted),
    });

    expect(hasUncommittedTransactions(token)).toBe(false);
  });
});
