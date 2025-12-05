/**
 * TXF Serializer
 * Converts between Token model and TXF format for IPFS storage
 */

import { Token, TokenStatus } from "../data/model";
import type { NametagData } from "../../../../repositories/WalletRepository";
import {
  type TxfStorageData,
  type TxfMeta,
  type TxfToken,
  type TxfGenesis,
  type TxfTransaction,
  isTokenKey,
  tokenIdFromKey,
  keyFromTokenId,
} from "./types/TxfTypes";

// ==========================================
// Token → TXF Conversion
// ==========================================

/**
 * Extract TXF token structure from Token.jsonData
 * The jsonData field already contains TXF-format JSON string
 */
export function tokenToTxf(token: Token): TxfToken | null {
  if (!token.jsonData) {
    console.warn(`Token ${token.id} has no jsonData, skipping TXF conversion`);
    return null;
  }

  try {
    const txfData = JSON.parse(token.jsonData);

    // Validate it has the expected TXF structure
    if (!txfData.genesis || !txfData.state) {
      console.warn(`Token ${token.id} jsonData is not in TXF format`);
      return null;
    }

    // Ensure version field is present
    if (!txfData.version) {
      txfData.version = "2.0";
    }

    // Ensure transactions array exists
    if (!txfData.transactions) {
      txfData.transactions = [];
    }

    // Ensure nametags array exists
    if (!txfData.nametags) {
      txfData.nametags = [];
    }

    // Ensure _integrity exists
    if (!txfData._integrity) {
      txfData._integrity = {
        genesisDataJSONHash: computeGenesisHash(txfData.genesis.data),
      };
    }

    return txfData as TxfToken;
  } catch (err) {
    console.error(`Failed to parse token ${token.id} jsonData:`, err);
    return null;
  }
}

/**
 * Compute hash of genesis data for integrity field
 * Returns hex string with "0000" prefix
 */
function computeGenesisHash(genesisData: TxfGenesis["data"]): string {
  // For now, return placeholder - proper implementation would use SHA-256
  // The actual hash should be computed when the token is created
  void genesisData; // Will be used when proper hashing is implemented
  return "0000" + "0".repeat(60);
}

// ==========================================
// TXF → Token Conversion
// ==========================================

/**
 * Convert TXF token back to Token model
 */
export function txfToToken(tokenId: string, txf: TxfToken): Token {
  // Extract coin info from genesis data
  const coinData = txf.genesis.data.coinData;
  const totalAmount = coinData.reduce((sum, [, amt]) => {
    return sum + BigInt(amt || "0");
  }, BigInt(0));

  // Get coin ID (use first non-zero coin, or first coin if all zero)
  let coinId = coinData[0]?.[0] || "";
  for (const [cid, amt] of coinData) {
    if (BigInt(amt || "0") > 0) {
      coinId = cid;
      break;
    }
  }

  // Determine token status based on transaction proofs
  let status: TokenStatus = TokenStatus.CONFIRMED;
  if (txf.transactions.length > 0) {
    const lastTx = txf.transactions[txf.transactions.length - 1];
    if (lastTx.inclusionProof === null) {
      status = TokenStatus.PENDING;
    }
  }

  // Extract token type for display name
  const tokenType = txf.genesis.data.tokenType;
  const isNft = tokenType === "455ad8720656b08e8dbd5bac1f3c73eeea5431565f6c1c3af742b1aa12d41d89";

  return new Token({
    id: tokenId,
    name: isNft ? "NFT" : "Token",
    type: isNft ? "NFT" : "UCT",
    timestamp: Date.now(),
    jsonData: JSON.stringify(txf),
    status,
    amount: totalAmount.toString(),
    coinId,
    symbol: isNft ? "NFT" : "UCT",
    sizeBytes: JSON.stringify(txf).length,
  });
}

// ==========================================
// Storage Data Building
// ==========================================

/**
 * Build complete TXF storage data from tokens and metadata
 */
export function buildTxfStorageData(
  tokens: Token[],
  meta: Omit<TxfMeta, "formatVersion">,
  nametag?: NametagData
): TxfStorageData {
  const storageData: TxfStorageData = {
    _meta: {
      ...meta,
      formatVersion: "2.0",
    },
  };

  if (nametag) {
    storageData._nametag = nametag;
  }

  // Add each token with _<tokenId> key
  for (const token of tokens) {
    const txf = tokenToTxf(token);
    if (txf) {
      // Use the token's actual ID from genesis data
      const actualTokenId = txf.genesis.data.tokenId;
      storageData[keyFromTokenId(actualTokenId)] = txf;
    }
  }

  return storageData;
}

/**
 * Parse TXF storage data from IPFS
 */
export function parseTxfStorageData(data: unknown): {
  tokens: Token[];
  meta: TxfMeta | null;
  nametag: NametagData | null;
} {
  const result: {
    tokens: Token[];
    meta: TxfMeta | null;
    nametag: NametagData | null;
  } = {
    tokens: [],
    meta: null,
    nametag: null,
  };

  if (!data || typeof data !== "object") {
    return result;
  }

  const storageData = data as Record<string, unknown>;

  // Extract metadata
  if (storageData._meta && typeof storageData._meta === "object") {
    result.meta = storageData._meta as TxfMeta;
  }

  // Extract nametag
  if (storageData._nametag && typeof storageData._nametag === "object") {
    result.nametag = storageData._nametag as NametagData;
  }

  // Extract tokens
  for (const key of Object.keys(storageData)) {
    if (isTokenKey(key)) {
      const tokenId = tokenIdFromKey(key);
      const txfToken = storageData[key] as TxfToken;

      try {
        const token = txfToToken(tokenId, txfToken);
        result.tokens.push(token);
      } catch (err) {
        console.error(`Failed to parse token ${tokenId}:`, err);
      }
    }
  }

  return result;
}

// ==========================================
// TXF File Export/Import
// ==========================================

/**
 * Build TXF export file from tokens (for manual export)
 * This creates a standard TXF file without metadata envelope
 */
export function buildTxfExportFile(tokens: Token[]): Record<string, TxfToken> {
  const txfFile: Record<string, TxfToken> = {};

  for (const token of tokens) {
    const txf = tokenToTxf(token);
    if (txf) {
      const tokenId = txf.genesis.data.tokenId;
      txfFile[keyFromTokenId(tokenId)] = txf;
    }
  }

  return txfFile;
}

/**
 * Parse TXF file content (for manual import)
 */
export function parseTxfFile(content: unknown): Token[] {
  if (!content || typeof content !== "object") {
    return [];
  }

  const tokens: Token[] = [];
  const data = content as Record<string, unknown>;

  for (const key of Object.keys(data)) {
    if (isTokenKey(key)) {
      const tokenId = tokenIdFromKey(key);
      const txfToken = data[key] as TxfToken;

      try {
        const token = txfToToken(tokenId, txfToken);
        tokens.push(token);
      } catch (err) {
        console.error(`Failed to parse TXF token ${tokenId}:`, err);
      }
    }
  }

  return tokens;
}

// ==========================================
// Utility Functions
// ==========================================

/**
 * Get token ID from Token object
 * Prefers the genesis.data.tokenId if available
 */
export function getTokenId(token: Token): string {
  if (token.jsonData) {
    try {
      const txf = JSON.parse(token.jsonData);
      if (txf.genesis?.data?.tokenId) {
        return txf.genesis.data.tokenId;
      }
    } catch {
      // Fall through to use token.id
    }
  }
  return token.id;
}

/**
 * Check if token has valid TXF data
 */
export function hasValidTxfData(token: Token): boolean {
  if (!token.jsonData) return false;

  try {
    const txf = JSON.parse(token.jsonData);
    return !!(
      txf.genesis &&
      txf.genesis.data &&
      txf.genesis.data.tokenId &&
      txf.state &&
      txf.genesis.inclusionProof
    );
  } catch {
    return false;
  }
}

/**
 * Count committed transactions in a token
 */
export function countCommittedTransactions(token: Token): number {
  if (!token.jsonData) return 0;

  try {
    const txf = JSON.parse(token.jsonData);
    if (!txf.transactions) return 0;

    return txf.transactions.filter(
      (tx: TxfTransaction) => tx.inclusionProof !== null
    ).length;
  } catch {
    return 0;
  }
}

/**
 * Check if token has uncommitted transactions
 */
export function hasUncommittedTransactions(token: Token): boolean {
  if (!token.jsonData) return false;

  try {
    const txf = JSON.parse(token.jsonData);
    if (!txf.transactions || txf.transactions.length === 0) return false;

    return txf.transactions.some(
      (tx: TxfTransaction) => tx.inclusionProof === null
    );
  } catch {
    return false;
  }
}
