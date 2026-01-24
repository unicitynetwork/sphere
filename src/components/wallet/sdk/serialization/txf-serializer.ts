/**
 * TXF Serializer (Platform-Independent)
 * Core serialization logic for TXF format
 *
 * This module provides generic TXF serialization without app-specific dependencies.
 * App adapters can extend this with model-specific conversions.
 */

import type {
  TxfToken,
  TxfGenesis,
  TxfTransaction,
  TxfMeta,
  TxfStorageDataBase,
  TombstoneEntry,
  NametagDataBase,
  OutboxEntryBase,
} from '../types/txf';

import {
  isTokenKey,
  isArchivedKey,
  isForkedKey,
  tokenIdFromKey,
  tokenIdFromArchivedKey,
  parseForkedKey,
  keyFromTokenId,
  archivedKeyFromTokenId,
  forkedKeyFromTokenIdAndState,
  getCurrentStateHash,
} from '../types/txf';

import {
  safeParseTxfToken,
  safeParseTxfMeta,
  validateTokenEntry,
} from '../types/txf-schemas';

// Re-export key utilities for convenience
export {
  isTokenKey,
  isArchivedKey,
  isForkedKey,
  tokenIdFromKey,
  tokenIdFromArchivedKey,
  parseForkedKey,
  keyFromTokenId,
  archivedKeyFromTokenId,
  forkedKeyFromTokenIdAndState,
  getCurrentStateHash,
};

// ==========================================
// Types
// ==========================================

/**
 * Result of parsing TXF storage data
 */
export interface ParseTxfStorageResult {
  tokens: Map<string, TxfToken>;      // tokenId -> TxfToken
  meta: TxfMeta | null;
  nametag: NametagDataBase | null;
  tombstones: TombstoneEntry[];
  archivedTokens: Map<string, TxfToken>;
  forkedTokens: Map<string, TxfToken>;  // key format: tokenId_stateHash
  outboxEntries: OutboxEntryBase[];
  validationErrors: string[];
}

/**
 * Options for building TXF storage data
 */
export interface BuildTxfStorageOptions<
  TNametag extends NametagDataBase = NametagDataBase,
  TOutbox extends OutboxEntryBase = OutboxEntryBase
> {
  meta: Omit<TxfMeta, 'formatVersion'>;
  tokens: TxfToken[];
  nametag?: TNametag;
  tombstones?: TombstoneEntry[];
  archivedTokens?: Map<string, TxfToken>;
  forkedTokens?: Map<string, TxfToken>;
  outboxEntries?: TOutbox[];
}

// ==========================================
// Storage Data Building
// ==========================================

/**
 * Build complete TXF storage data structure
 */
export function buildTxfStorageData<
  TNametag extends NametagDataBase = NametagDataBase,
  TOutbox extends OutboxEntryBase = OutboxEntryBase
>(
  options: BuildTxfStorageOptions<TNametag, TOutbox>
): TxfStorageDataBase {
  const {
    meta,
    tokens,
    nametag,
    tombstones,
    archivedTokens,
    forkedTokens,
    outboxEntries,
  } = options;

  const storageData: TxfStorageDataBase = {
    _meta: {
      ...meta,
      formatVersion: '2.0',
    },
  };

  if (nametag) {
    storageData._nametag = nametag;
  }

  // Add tombstones for spent token states
  if (tombstones && tombstones.length > 0) {
    storageData._tombstones = tombstones;
  }

  // Add outbox entries (for transfer recovery)
  if (outboxEntries && outboxEntries.length > 0) {
    storageData._outbox = outboxEntries;
  }

  // Add active tokens with _<tokenId> key
  for (const token of tokens) {
    const tokenId = token.genesis.data.tokenId;
    storageData[keyFromTokenId(tokenId)] = token;
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
      // Key is in format tokenId_stateHash
      const underscoreIndex = key.indexOf('_');
      if (underscoreIndex > 0) {
        const tokenId = key.substring(0, underscoreIndex);
        const stateHash = key.substring(underscoreIndex + 1);
        storageData[forkedKeyFromTokenIdAndState(tokenId, stateHash)] = txf;
      }
    }
  }

  return storageData;
}

// ==========================================
// Storage Data Parsing
// ==========================================

/**
 * Parse TXF storage data with Zod validation
 */
export function parseTxfStorageDataGeneric(data: unknown): ParseTxfStorageResult {
  const result: ParseTxfStorageResult = {
    tokens: new Map(),
    meta: null,
    nametag: null,
    tombstones: [],
    archivedTokens: new Map(),
    forkedTokens: new Map(),
    outboxEntries: [],
    validationErrors: [],
  };

  if (!data || typeof data !== 'object') {
    result.validationErrors.push('Storage data is not an object');
    return result;
  }

  const storageData = data as Record<string, unknown>;

  // Extract and validate metadata
  if (storageData._meta) {
    const validatedMeta = safeParseTxfMeta(storageData._meta);
    if (validatedMeta) {
      result.meta = validatedMeta;
    } else {
      result.validationErrors.push('Invalid _meta structure');
      // Still try to use it as fallback
      if (typeof storageData._meta === 'object') {
        result.meta = storageData._meta as TxfMeta;
      }
    }
  }

  // Extract nametag
  if (storageData._nametag && typeof storageData._nametag === 'object') {
    result.nametag = storageData._nametag as NametagDataBase;
  }

  // Extract tombstones
  if (storageData._tombstones && Array.isArray(storageData._tombstones)) {
    for (const entry of storageData._tombstones) {
      if (
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as TombstoneEntry).tokenId === 'string' &&
        typeof (entry as TombstoneEntry).stateHash === 'string' &&
        typeof (entry as TombstoneEntry).timestamp === 'number'
      ) {
        result.tombstones.push(entry as TombstoneEntry);
      }
    }
  }

  // Extract outbox entries
  if (storageData._outbox && Array.isArray(storageData._outbox)) {
    for (const entry of storageData._outbox) {
      if (
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as OutboxEntryBase).id === 'string' &&
        typeof (entry as OutboxEntryBase).status === 'string' &&
        typeof (entry as OutboxEntryBase).sourceTokenId === 'string'
      ) {
        result.outboxEntries.push(entry as OutboxEntryBase);
      } else {
        result.validationErrors.push('Invalid outbox entry structure');
      }
    }
  }

  // Extract tokens
  for (const key of Object.keys(storageData)) {
    // Active tokens
    if (isTokenKey(key)) {
      const tokenId = tokenIdFromKey(key);
      const validation = validateTokenEntry(key, storageData[key]);

      if (validation.valid && validation.token) {
        result.tokens.set(tokenId, validation.token);
      } else {
        result.validationErrors.push(`Token ${tokenId}: ${validation.error || 'validation failed'}`);
        // Try fallback
        try {
          const txfToken = storageData[key] as TxfToken;
          if (txfToken?.genesis?.data?.tokenId) {
            result.tokens.set(tokenId, txfToken);
            console.warn(`Token ${tokenId} loaded with fallback`);
          }
        } catch {
          // Skip
        }
      }
    }
    // Archived tokens
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
    // Forked tokens
    else if (isForkedKey(key)) {
      const parsed = parseForkedKey(key);
      if (parsed) {
        try {
          const txfToken = storageData[key] as TxfToken;
          if (txfToken?.genesis?.data?.tokenId) {
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
    console.warn('TXF storage data validation issues:', result.validationErrors);
  }

  return result;
}

// ==========================================
// TXF File Export/Import
// ==========================================

/**
 * Build TXF export file from tokens
 */
export function buildTxfExportFile(tokens: TxfToken[]): Record<string, TxfToken> {
  const txfFile: Record<string, TxfToken> = {};

  for (const token of tokens) {
    const tokenId = token.genesis.data.tokenId;
    txfFile[keyFromTokenId(tokenId)] = token;
  }

  return txfFile;
}

/**
 * Parse TXF file content with validation
 */
export function parseTxfFile(content: unknown): { tokens: TxfToken[]; errors: string[] } {
  if (!content || typeof content !== 'object') {
    return { tokens: [], errors: ['Content is not an object'] };
  }

  const tokens: TxfToken[] = [];
  const errors: string[] = [];
  const data = content as Record<string, unknown>;

  for (const key of Object.keys(data)) {
    if (isTokenKey(key)) {
      const tokenId = tokenIdFromKey(key);
      const validatedToken = safeParseTxfToken(data[key]);

      if (validatedToken) {
        tokens.push(validatedToken);
      } else {
        errors.push(`Token ${tokenId}: Zod validation failed`);
        // Try fallback
        try {
          const txfToken = data[key] as TxfToken;
          if (txfToken?.genesis?.data?.tokenId) {
            tokens.push(txfToken);
          }
        } catch (err) {
          errors.push(`Token ${tokenId}: fallback also failed - ${err}`);
        }
      }
    }
  }

  return { tokens, errors };
}

// ==========================================
// Utility Functions
// ==========================================

/**
 * Check if TXF token has valid structure
 */
export function isValidTxfToken(token: unknown): token is TxfToken {
  if (!token || typeof token !== 'object') return false;
  const t = token as TxfToken;
  return !!(
    t.genesis &&
    t.genesis.data &&
    t.genesis.data.tokenId &&
    t.state &&
    t.genesis.inclusionProof
  );
}

/**
 * Count committed transactions in a TXF token
 */
export function countCommittedTransactions(token: TxfToken): number {
  if (!token.transactions) return 0;
  return token.transactions.filter(
    (tx: TxfTransaction) => tx.inclusionProof !== null
  ).length;
}

/**
 * Check if TXF token has uncommitted transactions
 */
export function hasUncommittedTransactions(token: TxfToken): boolean {
  if (!token.transactions || token.transactions.length === 0) return false;
  return token.transactions.some(
    (tx: TxfTransaction) => tx.inclusionProof === null
  );
}

/**
 * Get total coin amount from TXF token
 */
export function getTotalAmount(token: TxfToken): bigint {
  const coinData = token.genesis.data.coinData;
  return coinData.reduce((sum, [, amt]) => {
    return sum + BigInt(amt || '0');
  }, BigInt(0));
}

/**
 * Get primary coin ID from TXF token
 */
export function getPrimaryCoinId(token: TxfToken): string {
  const coinData = token.genesis.data.coinData;
  if (coinData.length === 0) return '';

  // Return first non-zero coin, or first coin if all zero
  for (const [coinId, amt] of coinData) {
    if (BigInt(amt || '0') > 0) {
      return coinId;
    }
  }
  return coinData[0]?.[0] || '';
}

/**
 * Compute hash of genesis data for integrity field
 * Returns hex string with "0000" prefix
 */
export function computeGenesisHash(genesisData: TxfGenesis['data']): string {
  // Placeholder - proper implementation would use SHA-256
  void genesisData;
  return '0000' + '0'.repeat(60);
}

/**
 * Ensure TXF token has all required fields
 */
export function normalizeTxfToken(partial: Partial<TxfToken>): TxfToken | null {
  if (!partial.genesis || !partial.state) {
    return null;
  }

  return {
    version: partial.version || '2.0',
    genesis: partial.genesis,
    state: partial.state,
    transactions: partial.transactions || [],
    nametags: partial.nametags || [],
    _integrity: partial._integrity || {
      genesisDataJSONHash: computeGenesisHash(partial.genesis.data),
    },
  };
}
