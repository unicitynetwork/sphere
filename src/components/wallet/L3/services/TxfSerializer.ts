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
  type TombstoneEntry,
  isTokenKey,
  isArchivedKey,
  isForkedKey,
  tokenIdFromKey,
  tokenIdFromArchivedKey,
  parseForkedKey,
  keyFromTokenId,
  archivedKeyFromTokenId,
  forkedKeyFromTokenIdAndState,
} from "./types/TxfTypes";
import {
  safeParseTxfToken,
  safeParseTxfMeta,
  validateTokenEntry,
} from "./types/TxfSchemas";

// ==========================================
// Token → TXF Conversion
// ==========================================

/**
 * Extract TXF token structure from Token.jsonData
 * The jsonData field already contains TXF-format JSON string
 * Uses Zod validation for type safety
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
      console.warn(`Token ${token.id} jsonData is not in TXF format`, {
        hasGenesis: !!txfData.genesis,
        hasState: !!txfData.state,
        topLevelKeys: Object.keys(txfData),
        genesisKeys: txfData.genesis ? Object.keys(txfData.genesis) : [],
      });
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

    // Validate with Zod schema
    const validated = safeParseTxfToken(txfData);
    if (validated) {
      return validated;
    }

    // Fallback: return without strict validation (for backwards compatibility)
    console.warn(`Token ${token.id}: Zod validation failed, using unvalidated data`);
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
  nametag?: NametagData,
  tombstones?: TombstoneEntry[],
  archivedTokens?: Map<string, TxfToken>,
  forkedTokens?: Map<string, TxfToken>
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

  // Add tombstones for spent token states (prevents zombie token resurrection)
  if (tombstones && tombstones.length > 0) {
    storageData._tombstones = tombstones;
  }

  // Add each active token with _<tokenId> key
  for (const token of tokens) {
    const txf = tokenToTxf(token);
    if (txf) {
      // Use the token's actual ID from genesis data
      const actualTokenId = txf.genesis.data.tokenId;
      storageData[keyFromTokenId(actualTokenId)] = txf;
    }
  }

  // Add archived tokens with _archived_<tokenId> key
  if (archivedTokens && archivedTokens.size > 0) {
    for (const [tokenId, txf] of archivedTokens) {
      storageData[archivedKeyFromTokenId(tokenId)] = txf;
    }
  }

  // Add forked tokens with _forked_<tokenId>_<stateHash> key
  if (forkedTokens && forkedTokens.size > 0) {
    for (const [key, txf] of forkedTokens) {
      // Key is already in format tokenId_stateHash
      const [tokenId, stateHash] = key.split("_");
      if (tokenId && stateHash) {
        storageData[forkedKeyFromTokenIdAndState(tokenId, stateHash)] = txf;
      }
    }
  }

  return storageData;
}

/**
 * Parse TXF storage data from IPFS with Zod validation
 */
export function parseTxfStorageData(data: unknown): {
  tokens: Token[];
  meta: TxfMeta | null;
  nametag: NametagData | null;
  tombstones: TombstoneEntry[];
  archivedTokens: Map<string, TxfToken>;
  forkedTokens: Map<string, TxfToken>;
  validationErrors: string[];
} {
  const result: {
    tokens: Token[];
    meta: TxfMeta | null;
    nametag: NametagData | null;
    tombstones: TombstoneEntry[];
    archivedTokens: Map<string, TxfToken>;
    forkedTokens: Map<string, TxfToken>;
    validationErrors: string[];
  } = {
    tokens: [],
    meta: null,
    nametag: null,
    tombstones: [],
    archivedTokens: new Map(),
    forkedTokens: new Map(),
    validationErrors: [],
  };

  if (!data || typeof data !== "object") {
    result.validationErrors.push("Storage data is not an object");
    return result;
  }

  const storageData = data as Record<string, unknown>;

  // Extract and validate metadata using Zod
  if (storageData._meta) {
    const validatedMeta = safeParseTxfMeta(storageData._meta);
    if (validatedMeta) {
      result.meta = validatedMeta;
    } else {
      result.validationErrors.push("Invalid _meta structure");
      // Still try to use it as fallback
      if (typeof storageData._meta === "object") {
        result.meta = storageData._meta as TxfMeta;
      }
    }
  }

  // Extract nametag (less strict validation)
  if (storageData._nametag && typeof storageData._nametag === "object") {
    result.nametag = storageData._nametag as NametagData;
  }

  // Extract tombstones (state-hash-aware entries)
  if (storageData._tombstones && Array.isArray(storageData._tombstones)) {
    for (const entry of storageData._tombstones) {
      // Parse TombstoneEntry objects (new format)
      if (
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as TombstoneEntry).tokenId === "string" &&
        typeof (entry as TombstoneEntry).stateHash === "string" &&
        typeof (entry as TombstoneEntry).timestamp === "number"
      ) {
        result.tombstones.push(entry as TombstoneEntry);
      }
      // Legacy string format: discard (no state hash info)
      // Per migration strategy: start fresh with state-hash-aware tombstones
    }
  }

  // Extract and validate all keys
  for (const key of Object.keys(storageData)) {
    // Active tokens: _<tokenId>
    if (isTokenKey(key)) {
      const tokenId = tokenIdFromKey(key);
      const validation = validateTokenEntry(key, storageData[key]);

      if (validation.valid && validation.token) {
        try {
          const token = txfToToken(tokenId, validation.token);
          result.tokens.push(token);
        } catch (err) {
          result.validationErrors.push(`Token ${tokenId}: conversion failed - ${err}`);
        }
      } else {
        result.validationErrors.push(`Token ${tokenId}: ${validation.error || "validation failed"}`);
        // Try fallback without strict validation
        try {
          const txfToken = storageData[key] as TxfToken;
          if (txfToken?.genesis?.data?.tokenId) {
            const token = txfToToken(tokenId, txfToken);
            result.tokens.push(token);
            console.warn(`Token ${tokenId} loaded with fallback (failed Zod validation)`);
          }
        } catch {
          // Skip invalid token
        }
      }
    }
    // Archived tokens: _archived_<tokenId>
    else if (isArchivedKey(key)) {
      const tokenId = tokenIdFromArchivedKey(key);
      try {
        const txfToken = storageData[key] as TxfToken;
        if (txfToken?.genesis?.data?.tokenId) {
          result.archivedTokens.set(tokenId, txfToken);
        }
      } catch {
        result.validationErrors.push(`Archived token ${tokenId}: invalid structure`);
      }
    }
    // Forked tokens: _forked_<tokenId>_<stateHash>
    else if (isForkedKey(key)) {
      const parsed = parseForkedKey(key);
      if (parsed) {
        try {
          const txfToken = storageData[key] as TxfToken;
          if (txfToken?.genesis?.data?.tokenId) {
            // Store with key format tokenId_stateHash (matching WalletRepository format)
            const mapKey = `${parsed.tokenId}_${parsed.stateHash}`;
            result.forkedTokens.set(mapKey, txfToken);
          }
        } catch {
          result.validationErrors.push(`Forked token ${parsed.tokenId}: invalid structure`);
        }
      }
    }
  }

  if (result.validationErrors.length > 0) {
    console.warn("TXF storage data validation issues:", result.validationErrors);
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
 * Parse TXF file content (for manual import) with Zod validation
 */
export function parseTxfFile(content: unknown): { tokens: Token[]; errors: string[] } {
  if (!content || typeof content !== "object") {
    return { tokens: [], errors: ["Content is not an object"] };
  }

  const tokens: Token[] = [];
  const errors: string[] = [];
  const data = content as Record<string, unknown>;

  for (const key of Object.keys(data)) {
    if (isTokenKey(key)) {
      const tokenId = tokenIdFromKey(key);

      // First try with Zod validation
      const validatedToken = safeParseTxfToken(data[key]);

      if (validatedToken) {
        try {
          const token = txfToToken(tokenId, validatedToken);
          tokens.push(token);
        } catch (err) {
          errors.push(`Token ${tokenId}: conversion failed - ${err}`);
        }
      } else {
        // Fallback: try without strict validation
        errors.push(`Token ${tokenId}: Zod validation failed, trying fallback`);
        try {
          const txfToken = data[key] as TxfToken;
          if (txfToken?.genesis?.data?.tokenId) {
            const token = txfToToken(tokenId, txfToken);
            tokens.push(token);
          }
        } catch (err) {
          errors.push(`Token ${tokenId}: fallback also failed - ${err}`);
        }
      }
    }
  }

  if (errors.length > 0) {
    console.warn("TXF file parsing issues:", errors);
  }

  return { tokens, errors };
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
 * Get the current state hash from a TXF token
 * - If no transactions: use genesis state hash
 * - If has transactions: use newStateHash from last transaction
 */
export function getCurrentStateHash(txf: TxfToken): string {
  if (txf.transactions.length === 0) {
    // No transfers yet - use genesis state hash
    return txf.genesis.inclusionProof.authenticator.stateHash;
  }
  // Use newStateHash from the most recent transaction
  return txf.transactions[txf.transactions.length - 1].newStateHash;
}

/**
 * Get current state hash from a Token object (parses jsonData)
 */
export function getCurrentStateHashFromToken(token: Token): string | null {
  if (!token.jsonData) return null;

  try {
    const txf = JSON.parse(token.jsonData) as TxfToken;
    return getCurrentStateHash(txf);
  } catch {
    return null;
  }
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
