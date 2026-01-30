/**
 * TXF Serializer
 * Converts between Token model and TXF format for IPFS storage
 */

import { Token, TokenStatus } from "../data/model";
import type { NametagData } from "./types/TxfTypes";
import {
  type TxfStorageData,
  type TxfMeta,
  type TxfToken,
  type TxfGenesis,
  type TxfTransaction,
  type TxfInclusionProof,
  type TombstoneEntry,
  type InvalidatedNametagEntry,
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
import type { OutboxEntry, MintOutboxEntry } from "./types/OutboxTypes";
import {
  safeParseTxfToken,
  safeParseTxfMeta,
  validateTokenEntry,
} from "./types/TxfSchemas";
import { validateNametagData } from "../../../../utils/tokenValidation";

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
    // Parse and NORMALIZE the data - this ensures all bytes objects are converted
    // to hex strings BEFORE Zod validation and BEFORE writing to IPFS.
    // This is critical for fixing tokens that were stored with bytes format before
    // the normalization fix was deployed.
    const txfData = normalizeSdkTokenToStorage(JSON.parse(token.jsonData));

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
    // Note: safeParseTxfToken already logs validation errors
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
// SDK Token Normalization
// ==========================================

/**
 * Convert bytes array/object to hex string
 */
function bytesToHexInternal(bytes: number[] | Uint8Array): string {
  const arr = Array.isArray(bytes) ? bytes : Array.from(bytes);
  return arr.map(b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Normalize a value that may be a hex string, bytes object, or Buffer to hex string
 */
function normalizeToHex(value: unknown): string {
  if (typeof value === "string") {
    return value; // Already hex string
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    // SDK format: { bytes: [...] }
    if ("bytes" in obj && (Array.isArray(obj.bytes) || obj.bytes instanceof Uint8Array)) {
      return bytesToHexInternal(obj.bytes as number[] | Uint8Array);
    }
    // Buffer.toJSON() format: { type: "Buffer", data: [...] }
    if (obj.type === "Buffer" && Array.isArray(obj.data)) {
      return bytesToHexInternal(obj.data as number[]);
    }
  }
  console.warn("Unknown bytes format, returning as-is:", value);
  return String(value);
}

/**
 * Normalize SDK token JSON to canonical TXF storage format.
 * Converts all bytes objects to hex strings before storage.
 *
 * Call this immediately after Token.toJSON() to ensure consistent storage format.
 * This prevents storing SDK's internal format (bytes objects) and ensures all
 * tokenId, tokenType, salt, publicKey, signature fields are hex strings.
 */
export function normalizeSdkTokenToStorage(sdkTokenJson: unknown): TxfToken {
  // Deep copy to avoid mutating the original
  const txf = JSON.parse(JSON.stringify(sdkTokenJson));

  // Normalize genesis.data fields (tokenId, tokenType, salt)
  if (txf.genesis?.data) {
    const data = txf.genesis.data;
    if (data.tokenId !== undefined) {
      data.tokenId = normalizeToHex(data.tokenId);
    }
    if (data.tokenType !== undefined) {
      data.tokenType = normalizeToHex(data.tokenType);
    }
    if (data.salt !== undefined) {
      data.salt = normalizeToHex(data.salt);
    }
  }

  // Normalize authenticator fields in genesis inclusion proof
  if (txf.genesis?.inclusionProof?.authenticator) {
    const auth = txf.genesis.inclusionProof.authenticator;
    if (auth.publicKey !== undefined) {
      auth.publicKey = normalizeToHex(auth.publicKey);
    }
    if (auth.signature !== undefined) {
      auth.signature = normalizeToHex(auth.signature);
    }
  }

  // Normalize transaction authenticators and state hash fields
  if (Array.isArray(txf.transactions)) {
    for (const tx of txf.transactions) {
      if (tx.inclusionProof?.authenticator) {
        const auth = tx.inclusionProof.authenticator;
        if (auth.publicKey !== undefined) {
          auth.publicKey = normalizeToHex(auth.publicKey);
        }
        if (auth.signature !== undefined) {
          auth.signature = normalizeToHex(auth.signature);
        }
      }

      // SDK may store previousStateHash/newStateHash in nested data object
      // Map them to top-level fields as expected by TxfTransaction
      if (!tx.previousStateHash && tx.data?.previousStateHash) {
        tx.previousStateHash = normalizeToHex(tx.data.previousStateHash);
      }
      if (!tx.newStateHash && tx.data?.newStateHash) {
        tx.newStateHash = normalizeToHex(tx.data.newStateHash);
      }

      // Normalize state hash fields if they exist
      if (tx.previousStateHash !== undefined) {
        tx.previousStateHash = normalizeToHex(tx.previousStateHash);
      }
      if (tx.newStateHash !== undefined) {
        tx.newStateHash = normalizeToHex(tx.newStateHash);
      }
    }
  }

  return txf as TxfToken;
}

// ==========================================
// Storage Data Building
// ==========================================

/**
 * Build complete TXF storage data from tokens and metadata
 * Now async to support stateHash computation for genesis-only tokens
 */
export async function buildTxfStorageData(
  tokens: Token[],
  meta: Omit<TxfMeta, "formatVersion">,
  nametag?: NametagData,
  _tombstones?: unknown, // Deprecated: tombstones no longer written to IPFS
  archivedTokens?: Map<string, TxfToken>,
  forkedTokens?: Map<string, TxfToken>,
  outboxEntries?: OutboxEntry[],
  mintOutboxEntries?: MintOutboxEntry[],
  invalidatedNametags?: InvalidatedNametagEntry[]
): Promise<TxfStorageData> {
  const storageData: TxfStorageData = {
    _meta: {
      ...meta,
      formatVersion: "2.0",
    },
  };

  // Validate nametag before exporting to IPFS
  if (nametag) {
    const nametagValidation = validateNametagData(nametag, {
      requireInclusionProof: false, // May have stripped proofs
      context: "IPFS export",
    });
    if (nametagValidation.isValid) {
      storageData._nametag = nametag;
    } else {
      // Log error but DO NOT export corrupted nametag data
      console.error("❌ Skipping corrupted nametag during IPFS export:", nametagValidation.errors);
    }
  }

  // Note: Tombstones are deprecated - Sent folder now provides spent state tracking.
  // We no longer write _tombstones to IPFS. Old IPFS data may still contain them
  // and will be read during parseTxfStorageData() for backward compatibility.

  // Add outbox entries (CRITICAL for transfer recovery)
  if (outboxEntries && outboxEntries.length > 0) {
    storageData._outbox = outboxEntries;
  }

  // Add mint outbox entries (CRITICAL for mint recovery)
  if (mintOutboxEntries && mintOutboxEntries.length > 0) {
    storageData._mintOutbox = mintOutboxEntries;
  }

  // Add invalidated nametags (preserves history across devices)
  if (invalidatedNametags && invalidatedNametags.length > 0) {
    storageData._invalidatedNametags = invalidatedNametags;
  }

  // Add each active token with _<tokenId> key
  for (const token of tokens) {
    let txf = tokenToTxf(token);
    if (txf) {
      // Compute stateHash for genesis-only tokens that don't have it
      if (needsStateHashComputation(txf)) {
        try {
          txf = await computeAndPatchStateHash(txf);
        } catch (err) {
          console.warn(`Failed to compute stateHash for token ${token.id.slice(0, 8)}...:`, err);
        }
      }
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
  outboxEntries: OutboxEntry[];
  mintOutboxEntries: MintOutboxEntry[];
  invalidatedNametags: InvalidatedNametagEntry[];
  validationErrors: string[];
} {
  const result: {
    tokens: Token[];
    meta: TxfMeta | null;
    nametag: NametagData | null;
    tombstones: TombstoneEntry[];
    archivedTokens: Map<string, TxfToken>;
    forkedTokens: Map<string, TxfToken>;
    outboxEntries: OutboxEntry[];
    mintOutboxEntries: MintOutboxEntry[];
    invalidatedNametags: InvalidatedNametagEntry[];
    validationErrors: string[];
  } = {
    tokens: [],
    meta: null,
    nametag: null,
    tombstones: [],
    archivedTokens: new Map(),
    forkedTokens: new Map(),
    outboxEntries: [],
    mintOutboxEntries: [],
    invalidatedNametags: [],
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

  // Extract and validate nametag
  if (storageData._nametag && typeof storageData._nametag === "object") {
    const nametagValidation = validateNametagData(storageData._nametag, {
      requireInclusionProof: false, // IPFS data may have stripped proofs
      context: "IPFS import",
    });
    if (nametagValidation.isValid) {
      result.nametag = storageData._nametag as NametagData;
    } else {
      // Log warning but include validation errors
      console.warn("Nametag validation failed during IPFS import:", nametagValidation.errors);
      result.validationErrors.push(`Nametag validation: ${nametagValidation.errors.join(", ")}`);
      // Do NOT import corrupted nametag - prevents token: {} bug
    }
  }

  // Extract tombstones (DEPRECATED - kept for backward compat with old IPFS data)
  // Tombstones are no longer created or used - Sent folder provides spent state tracking.
  // We still parse them in case old IPFS data contains them, but they are ignored.
  if (storageData._tombstones && Array.isArray(storageData._tombstones)) {
    for (const entry of storageData._tombstones) {
      if (
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as TombstoneEntry).tokenId === "string" &&
        typeof (entry as TombstoneEntry).stateHash === "string" &&
        typeof (entry as TombstoneEntry).timestamp === "number"
      ) {
        result.tombstones.push(entry as TombstoneEntry);
      }
    }
  }

  // Extract outbox entries (CRITICAL for transfer recovery)
  if (storageData._outbox && Array.isArray(storageData._outbox)) {
    for (const entry of storageData._outbox) {
      // Basic validation for OutboxEntry structure
      if (
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as OutboxEntry).id === "string" &&
        typeof (entry as OutboxEntry).status === "string" &&
        typeof (entry as OutboxEntry).sourceTokenId === "string" &&
        typeof (entry as OutboxEntry).salt === "string" &&
        typeof (entry as OutboxEntry).commitmentJson === "string"
      ) {
        result.outboxEntries.push(entry as OutboxEntry);
      } else {
        result.validationErrors.push("Invalid outbox entry structure");
      }
    }
  }

  // Extract mint outbox entries (CRITICAL for mint recovery)
  if (storageData._mintOutbox && Array.isArray(storageData._mintOutbox)) {
    for (const entry of storageData._mintOutbox) {
      // Basic validation for MintOutboxEntry structure
      if (
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as MintOutboxEntry).id === "string" &&
        typeof (entry as MintOutboxEntry).status === "string" &&
        typeof (entry as MintOutboxEntry).type === "string" &&
        typeof (entry as MintOutboxEntry).salt === "string" &&
        typeof (entry as MintOutboxEntry).requestIdHex === "string" &&
        typeof (entry as MintOutboxEntry).mintDataJson === "string"
      ) {
        result.mintOutboxEntries.push(entry as MintOutboxEntry);
      } else {
        result.validationErrors.push("Invalid mint outbox entry structure");
      }
    }
  }

  // Extract invalidated nametags (preserves history across devices)
  if (storageData._invalidatedNametags && Array.isArray(storageData._invalidatedNametags)) {
    for (const entry of storageData._invalidatedNametags) {
      // Basic validation for InvalidatedNametagEntry structure
      if (
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as InvalidatedNametagEntry).name === "string" &&
        typeof (entry as InvalidatedNametagEntry).invalidatedAt === "number" &&
        typeof (entry as InvalidatedNametagEntry).invalidationReason === "string"
      ) {
        result.invalidatedNametags.push(entry as InvalidatedNametagEntry);
      } else {
        result.validationErrors.push("Invalid invalidated nametag entry structure");
      }
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
 * Get the stored current state hash from a TXF token
 * - If has transactions: use newStateHash from last transaction
 * - If genesis-only: use _integrity.currentStateHash (if computed and stored)
 * - Otherwise: returns undefined (SDK should calculate it)
 */
export function getCurrentStateHash(txf: TxfToken): string | undefined {
  // Handle tokens with transactions - use newStateHash from last transaction
  if (txf.transactions && txf.transactions.length > 0) {
    const lastTx = txf.transactions[txf.transactions.length - 1];
    if (lastTx?.newStateHash) {
      return lastTx.newStateHash;
    }
    // Fallback: check authenticator from last transaction's inclusion proof
    if (lastTx?.inclusionProof?.authenticator?.stateHash) {
      return lastTx.inclusionProof.authenticator.stateHash;
    }
    // Missing newStateHash is expected for older tokens - SDK will calculate it
    return undefined;
  }

  // Genesis-only tokens: check _integrity.currentStateHash (computed post-import)
  if (txf._integrity?.currentStateHash) {
    return txf._integrity.currentStateHash;
  }

  // Genesis-only tokens: check genesis inclusion proof authenticator
  // This is where newly minted tokens store their initial stateHash
  if (txf.genesis?.inclusionProof?.authenticator?.stateHash) {
    return txf.genesis.inclusionProof.authenticator.stateHash;
  }

  // No stored state hash available - SDK must calculate it
  return undefined;
}

/**
 * Get current state hash from a Token object (parses jsonData)
 */
export function getCurrentStateHashFromToken(token: Token): string | null {
  if (!token.jsonData) return null;

  try {
    const txf = JSON.parse(token.jsonData) as TxfToken;
    return getCurrentStateHash(txf) ?? null;
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

/**
 * Check if a TXF token has missing newStateHash on any transaction
 * This can happen with tokens sent from older versions of the app
 */
export function hasMissingNewStateHash(txf: TxfToken): boolean {
  if (!txf.transactions || txf.transactions.length === 0) {
    return false;
  }
  return txf.transactions.some(tx => !tx.newStateHash);
}

/**
 * Check if a TXF token needs its currentStateHash computed
 * Returns true for genesis-only tokens without a stored currentStateHash
 */
export function needsStateHashComputation(txf: TxfToken): boolean {
  // Tokens with transactions don't need this - they have newStateHash
  if (txf.transactions && txf.transactions.length > 0) {
    return false;
  }
  // Genesis-only tokens need computation if currentStateHash is missing
  return !txf._integrity?.currentStateHash;
}

/**
 * Compute and patch the currentStateHash for a genesis-only token.
 *
 * For genesis-only tokens (no transactions), the current state hash must be
 * calculated from the SDK's Token.state.calculateHash(). This function:
 * 1. Parses the TXF with the SDK
 * 2. Calculates the current state hash
 * 3. Stores it in _integrity.currentStateHash
 *
 * @param txf - The TXF token to patch
 * @returns Patched TXF token, or original if no patch needed or computation failed
 */
export async function computeAndPatchStateHash(txf: TxfToken): Promise<TxfToken> {
  // Only patch genesis-only tokens that don't have currentStateHash
  if (!needsStateHashComputation(txf)) {
    return txf;
  }

  try {
    // Dynamic import to avoid bundling issues
    const { Token } = await import(
      "@unicitylabs/state-transition-sdk/lib/token/Token"
    );

    // Parse with SDK to access state.calculateHash()
    const sdkToken = await Token.fromJSON(txf);

    // Calculate the current state hash
    const calculatedStateHash = await sdkToken.state.calculateHash();
    const stateHashStr = calculatedStateHash.toJSON();

    // Deep copy the TXF to avoid mutating the original
    const patchedTxf = JSON.parse(JSON.stringify(txf)) as TxfToken;

    // Ensure _integrity exists
    if (!patchedTxf._integrity) {
      patchedTxf._integrity = {
        genesisDataJSONHash: "0000" + "0".repeat(60),
      };
    }

    // Store the computed state hash
    patchedTxf._integrity.currentStateHash = stateHashStr;

    console.log(
      `📦 Computed stateHash for genesis-only token ${txf.genesis.data.tokenId.slice(0, 8)}...: ${stateHashStr.slice(0, 16)}...`
    );

    return patchedTxf;
  } catch (err) {
    console.error(
      `Failed to compute stateHash for token ${txf.genesis?.data?.tokenId?.slice(0, 8)}...:`,
      err
    );
    return txf;
  }
}

/**
 * Compute and patch stateHash for a Token model (updates jsonData)
 * @returns New Token with patched jsonData, or original if no patch needed
 */
export async function computeAndPatchTokenStateHash(token: Token): Promise<Token> {
  if (!token.jsonData) return token;

  try {
    const txf = JSON.parse(token.jsonData) as TxfToken;

    // Check if patch is needed
    if (!needsStateHashComputation(txf)) {
      return token;
    }

    // Patch the TXF
    const patchedTxf = await computeAndPatchStateHash(txf);

    // If unchanged, return original
    if (patchedTxf === txf) {
      return token;
    }

    // Return new Token with patched jsonData
    return new Token({
      ...token,
      jsonData: JSON.stringify(patchedTxf),
    });
  } catch {
    return token;
  }
}

/**
 * Repair a TXF token by calculating missing newStateHash values using the SDK.
 *
 * BACKGROUND: Tokens sent before a bug fix were missing the `newStateHash` field
 * on their transfer transactions. The SDK's Token.fromJSON can still parse these
 * tokens because it recalculates state hashes internally from the `state` field.
 *
 * This function:
 * 1. Parses the TXF with the SDK (which calculates hashes internally)
 * 2. Gets the calculated state hash from the SDK token
 * 3. Patches the last transaction with the correct newStateHash
 *
 * @param txf - The TXF token to repair
 * @returns Repaired TXF token, or null if repair failed
 */
export async function repairMissingStateHash(txf: TxfToken): Promise<TxfToken | null> {
  if (!txf.transactions || txf.transactions.length === 0) {
    // No transactions to repair
    return txf;
  }

  // Check if repair is needed
  const lastTx = txf.transactions[txf.transactions.length - 1];
  if (lastTx.newStateHash) {
    // Already has newStateHash, no repair needed
    return txf;
  }

  try {
    // Dynamic import to avoid bundling issues
    const { Token } = await import(
      "@unicitylabs/state-transition-sdk/lib/token/Token"
    );

    // Parse with SDK - this calculates state hashes internally
    const sdkToken = await Token.fromJSON(txf);

    // Get the calculated state hash from the SDK token's current state
    const calculatedStateHash = await sdkToken.state.calculateHash();
    const stateHashStr = calculatedStateHash.toJSON();

    // Deep copy the TXF to avoid mutating the original
    const repairedTxf = JSON.parse(JSON.stringify(txf)) as TxfToken;

    // Patch the last transaction with the calculated state hash
    const lastTxIndex = repairedTxf.transactions.length - 1;
    repairedTxf.transactions[lastTxIndex] = {
      ...repairedTxf.transactions[lastTxIndex],
      newStateHash: stateHashStr,
    };

    console.log(`🔧 Repaired token ${txf.genesis.data.tokenId.slice(0, 8)}... - added missing newStateHash: ${stateHashStr.slice(0, 12)}...`);

    return repairedTxf;
  } catch (err) {
    console.error(`Failed to repair token ${txf.genesis?.data?.tokenId?.slice(0, 8)}...:`, err);
    return null;
  }
}

/**
 * Repair a Token model by calculating missing newStateHash values.
 * Returns a new Token with repaired jsonData, or the original if no repair needed/possible.
 */
export async function repairTokenMissingStateHash(token: Token): Promise<Token> {
  if (!token.jsonData) return token;

  try {
    const txf = JSON.parse(token.jsonData) as TxfToken;

    // Check if repair is needed
    if (!hasMissingNewStateHash(txf)) {
      return token;
    }

    // Repair the TXF
    const repairedTxf = await repairMissingStateHash(txf);
    if (!repairedTxf) {
      return token; // Repair failed, return original
    }

    // Return new Token with repaired jsonData
    return new Token({
      ...token,
      jsonData: JSON.stringify(repairedTxf),
    });
  } catch {
    return token;
  }
}

/**
 * Extract the last inclusion proof from a TxfToken.
 * This is used for tombstone verification using Sent folder proofs.
 *
 * For tokens with transactions: returns the proof from the last transaction
 * For genesis-only tokens: returns the genesis inclusion proof
 * Returns null if no valid proof found
 *
 * @param token - The TXF token to extract proof from
 * @returns The last inclusion proof, or null if not found
 */
export function extractLastInclusionProof(token: TxfToken): TxfInclusionProof | null {
  // If token has transactions, get proof from last transaction
  if (token.transactions && token.transactions.length > 0) {
    const lastTx = token.transactions[token.transactions.length - 1];
    return lastTx.inclusionProof || null;
  }

  // Genesis-only token: use genesis inclusion proof
  return token.genesis?.inclusionProof || null;
}

// ==========================================
// State Hash Computation for Legacy Tokens
// ==========================================

/**
 * Cache for computed state hashes: tokenId -> finalStateHash
 * Avoids recomputing the same tokens repeatedly during sync operations.
 */
const stateHashCache = new Map<string, string>();

/**
 * Compute the current/final state hash for a token using the SDK.
 * This is the stateHash that would be in the last transaction's newStateHash field.
 * Returns null if computation fails or token has no transactions.
 *
 * LIMITATION: SDK can only compute the FINAL state hash (after all transactions).
 * Cannot compute intermediate transaction hashes (SDK doesn't expose intermediate states).
 *
 * USE CASE: Handles legacy tokens sent before newStateHash was stored in transactions.
 * For single-transaction tokens (95% of cases), this computes the missing hash.
 *
 * @param txf - The TXF token to compute state hash for
 * @returns The final state hash as hex string, or null if computation failed
 */
export async function computeFinalStateHash(txf: TxfToken): Promise<string | null> {
  if (!txf.transactions || txf.transactions.length === 0) {
    return null; // Genesis-only token, no transaction to compute for
  }

  // If last transaction already has newStateHash, return it
  const lastTx = txf.transactions[txf.transactions.length - 1];
  if (lastTx.newStateHash) {
    return lastTx.newStateHash;
  }

  try {
    const { Token } = await import("@unicitylabs/state-transition-sdk/lib/token/Token");
    const sdkToken = await Token.fromJSON(txf);
    const calculatedStateHash = await sdkToken.state.calculateHash();
    return calculatedStateHash.toJSON();
  } catch (err) {
    console.warn(`Failed to compute state hash for token:`, err);
    return null;
  }
}

/**
 * Compute final state hash with caching to avoid redundant SDK calculations.
 * Caches results by tokenId for performance during batch operations.
 *
 * @param txf - The TXF token to compute state hash for
 * @returns The final state hash as hex string, or null if computation failed
 */
export async function computeFinalStateHashCached(txf: TxfToken): Promise<string | null> {
  const tokenId = txf.genesis?.data?.tokenId;
  if (!tokenId) return null;

  // Check cache first
  const cached = stateHashCache.get(tokenId);
  if (cached) return cached;

  const result = await computeFinalStateHash(txf);
  if (result) {
    stateHashCache.set(tokenId, result);
  }
  return result;
}

/**
 * Clear the state hash computation cache.
 * Useful for tests or when memory needs to be freed.
 */
export function clearStateHashCache(): void {
  stateHashCache.clear();
}
