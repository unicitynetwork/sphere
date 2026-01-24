/**
 * Token Repository - Platform-Independent Base Interface & Pure Functions
 *
 * Defines the core interface for token storage and provides pure utility functions
 * that can be used by any implementation (browser, CLI, etc.).
 *
 * Implementation:
 * - WalletRepository (uses KeyValueStorage) - see sdk/storage/wallet-repository.ts
 *
 * Storage Providers:
 * - LocalStorageProvider (browser) - see sdk/storage/key-value-storage.ts
 * - InMemoryStorageProvider (testing) - see sdk/storage/key-value-storage.ts
 * - FileStorageProvider (Node.js) - see sdk/storage/file-storage.ts
 */

import type { TxfToken, TombstoneEntry, TxfTransaction, NametagDataBase } from '../types';

// Re-export base type for convenience
export type { NametagDataBase } from '../types';

// ==========================================
// Stored Wallet Data Structure
// ==========================================

/**
 * Transaction history entry
 */
export interface TransactionHistoryEntry {
  id: string;
  type: 'SENT' | 'RECEIVED';
  amount: string;
  coinId: string;
  symbol: string;
  iconUrl?: string;
  timestamp: number;
  recipientNametag?: string;
  senderPubkey?: string;
}

/**
 * Base token interface for storage (minimal required fields)
 * App implementations can extend with additional fields
 */
export interface StoredToken {
  id: string;
  jsonData?: string;  // Serialized TxfToken
  coinId?: string;
  amount?: string;
  symbol?: string;
  timestamp?: number;
}

/**
 * Stored wallet data structure (for type safety when parsing JSON)
 * TNametag allows app to use extended nametag type (e.g., with full token object)
 */
export interface StoredWalletData<
  TToken extends StoredToken = StoredToken,
  TNametag extends NametagDataBase = NametagDataBase
> {
  id: string;
  name: string;
  address: string;
  tokens: TToken[];
  nametag?: TNametag;
  tombstones?: TombstoneEntry[];
  archivedTokens?: Record<string, TxfToken>;
  forkedTokens?: Record<string, TxfToken>;
}

// ==========================================
// Token Repository Interface
// ==========================================

/**
 * Token Repository interface - platform-independent
 *
 * Implementations must provide storage for:
 * - Active tokens (current wallet tokens)
 * - Tombstones (spent token states for sync)
 * - Archived tokens (spent token history)
 * - Forked tokens (alternative transaction histories)
 * - Nametag (one per identity)
 * - Transaction history
 */
export interface TokenRepository<
  TToken extends StoredToken = StoredToken,
  TNametag extends NametagDataBase = NametagDataBase
> {
  // ==========================================
  // Wallet Lifecycle
  // ==========================================

  /**
   * Load wallet for a specific address
   * Returns null if no wallet exists for the address
   */
  loadWalletForAddress(address: string): StoredWalletData<TToken, TNametag> | null;

  /**
   * Create a new wallet for the given address
   * @param address - The wallet address
   * @param name - Optional wallet name
   */
  createWallet(address: string, name?: string): StoredWalletData<TToken, TNametag>;

  /**
   * Save wallet to storage
   */
  saveWallet(wallet: StoredWalletData<TToken, TNametag>): void;

  /**
   * Get the current active address
   */
  getCurrentAddress(): string | null;

  /**
   * Switch to a different address
   */
  switchToAddress(address: string): StoredWalletData<TToken, TNametag> | null;

  /**
   * Clear wallet data for current address
   */
  clearWallet(): void;

  // ==========================================
  // Token Operations
  // ==========================================

  /**
   * Get all active tokens
   */
  getTokens(): TToken[];

  /**
   * Add a token to the wallet
   * Returns false if duplicate detected
   */
  addToken(token: TToken, skipHistory?: boolean): boolean;

  /**
   * Update an existing token
   */
  updateToken(token: TToken): void;

  /**
   * Remove a token by ID
   * @param tokenId - Token ID to remove
   * @param recipientNametag - Optional recipient for history
   * @param skipHistory - Skip adding to transaction history
   */
  removeToken(tokenId: string, recipientNametag?: string, skipHistory?: boolean): void;

  // ==========================================
  // Tombstone Operations
  // ==========================================

  /**
   * Get all tombstones
   */
  getTombstones(): TombstoneEntry[];

  /**
   * Check if a specific token state is tombstoned
   */
  isStateTombstoned(tokenId: string, stateHash: string): boolean;

  /**
   * Merge remote tombstones into local
   * Returns number of tokens removed due to tombstones
   */
  mergeTombstones(remoteTombstones: TombstoneEntry[]): number;

  /**
   * Prune old tombstones
   * @param maxAge - Maximum age in milliseconds (default 30 days)
   */
  pruneTombstones(maxAge?: number): void;

  // ==========================================
  // Archive Operations
  // ==========================================

  /**
   * Archive a token (preserve spent token history)
   */
  archiveToken(token: TToken): void;

  /**
   * Get all archived tokens
   */
  getArchivedTokens(): Map<string, TxfToken>;

  /**
   * Get the best archived version of a token
   */
  getBestArchivedVersion(tokenId: string): TxfToken | null;

  /**
   * Import archived token from remote
   */
  importArchivedToken(tokenId: string, txfToken: TxfToken): void;

  /**
   * Merge remote archived tokens into local
   * Returns number of tokens updated/added
   */
  mergeArchivedTokens(remoteArchived: Map<string, TxfToken>): number;

  /**
   * Prune archived tokens to prevent unlimited growth
   * @param maxCount - Maximum number of tokens to keep (default 100)
   */
  pruneArchivedTokens?(maxCount?: number): void;

  // ==========================================
  // Forked Token Operations
  // ==========================================

  /**
   * Store a forked token
   */
  storeForkedToken(tokenId: string, stateHash: string, txfToken: TxfToken): void;

  /**
   * Get all forked tokens
   */
  getForkedTokens(): Map<string, TxfToken>;

  /**
   * Import forked token from remote
   */
  importForkedToken(key: string, txfToken: TxfToken): void;

  /**
   * Merge remote forked tokens into local
   * Returns number of tokens added
   */
  mergeForkedTokens(remoteForked: Map<string, TxfToken>): number;

  /**
   * Prune forked tokens to prevent unlimited growth
   * @param maxCount - Maximum number of tokens to keep (default 50)
   */
  pruneForkedTokens?(maxCount?: number): void;

  // ==========================================
  // Nametag Operations
  // ==========================================

  /**
   * Set nametag for current identity
   */
  setNametag(nametag: TNametag): void;

  /**
   * Get nametag for current identity
   */
  getNametag(): TNametag | null;

  /**
   * Check if current identity has a nametag
   */
  hasNametag(): boolean;

  /**
   * Clear nametag for current identity
   */
  clearNametag(): void;

  // ==========================================
  // Transaction History
  // ==========================================

  /**
   * Get transaction history
   */
  getTransactionHistory(): TransactionHistoryEntry[];

  /**
   * Add transaction to history
   */
  addTransactionToHistory(entry: Omit<TransactionHistoryEntry, 'id'>): void;
}

// ==========================================
// Pure Functions - Token Comparison
// ==========================================

/**
 * Check if an incoming token is an incremental (non-forking) update to an existing archived token
 *
 * Incremental update criteria:
 * 1. Same genesis (tokenId matches)
 * 2. Incoming has >= transactions than existing
 * 3. All existing transactions match incoming (same state hashes in order)
 * 4. New transactions have inclusion proofs (committed)
 */
export function isIncrementalUpdate(existing: TxfToken, incoming: TxfToken): boolean {
  // 1. Same genesis (tokenId must match)
  if (existing.genesis?.data?.tokenId !== incoming.genesis?.data?.tokenId) {
    return false;
  }

  const existingTxns = existing.transactions || [];
  const incomingTxns = incoming.transactions || [];

  // 2. Incoming must have >= transactions
  if (incomingTxns.length < existingTxns.length) {
    return false;
  }

  // 3. All existing transactions must match incoming (same state hashes in order)
  for (let i = 0; i < existingTxns.length; i++) {
    const existingTx = existingTxns[i];
    const incomingTx = incomingTxns[i];

    if (existingTx.previousStateHash !== incomingTx.previousStateHash ||
        existingTx.newStateHash !== incomingTx.newStateHash) {
      return false;
    }
  }

  // 4. New transactions (if any) must have inclusion proofs (committed)
  for (let i = existingTxns.length; i < incomingTxns.length; i++) {
    const newTx = incomingTxns[i] as TxfTransaction;
    if (newTx.inclusionProof === null) {
      return false;
    }
  }

  return true;
}

/**
 * Get current state hash from a TxfToken
 */
export function getTokenCurrentStateHash(txf: TxfToken): string {
  if (txf.transactions && txf.transactions.length > 0) {
    return txf.transactions[txf.transactions.length - 1].newStateHash || "";
  }
  return txf.genesis?.inclusionProof?.authenticator?.stateHash || "";
}

/**
 * Count committed transactions (transactions with inclusion proofs)
 */
export function countCommittedTxns(txf: TxfToken): number {
  return (txf.transactions || []).filter(
    (tx: TxfTransaction) => tx.inclusionProof !== null
  ).length;
}

// ==========================================
// Pure Functions - Token ID Extraction
// ==========================================

/**
 * Extract SDK token ID from stored token's jsonData
 */
export function extractTokenIdFromJsonData(jsonData: string | undefined): string | null {
  if (!jsonData) return null;
  try {
    const txf = JSON.parse(jsonData);
    return txf.genesis?.data?.tokenId || null;
  } catch {
    return null;
  }
}

/**
 * Extract state hash from stored token's jsonData
 */
export function extractStateHashFromJsonData(jsonData: string | undefined): string {
  if (!jsonData) return "";
  try {
    const txf = JSON.parse(jsonData);
    return getTokenCurrentStateHash(txf);
  } catch {
    return "";
  }
}

/**
 * Check if two stored tokens are the same (by genesis tokenId)
 */
export function isSameStoredToken(t1: StoredToken, t2: StoredToken): boolean {
  if (t1.id === t2.id) return true;

  const id1 = extractTokenIdFromJsonData(t1.jsonData);
  const id2 = extractTokenIdFromJsonData(t2.jsonData);

  return !!(id1 && id2 && id1 === id2);
}

// ==========================================
// Pure Functions - Tombstone Creation
// ==========================================

/**
 * Create a tombstone entry from token data
 */
export function createTombstoneFromStoredToken(token: StoredToken, tokenId?: string): TombstoneEntry | null {
  const actualTokenId = tokenId || extractTokenIdFromJsonData(token.jsonData);
  if (!actualTokenId) return null;

  const stateHash = extractStateHashFromJsonData(token.jsonData);

  return {
    tokenId: actualTokenId,
    stateHash,
    timestamp: Date.now(),
  };
}

// ==========================================
// Pure Functions - Address Validation
// ==========================================

/**
 * Validate L3 address format
 * L3 addresses can be in format: DIRECT://... or PROXY://...
 */
export function validateL3Address(address: string | null | undefined): address is string {
  if (!address || typeof address !== "string") {
    return false;
  }

  const trimmed = address.trim();

  // Check minimum length (L3 addresses are typically long)
  if (trimmed.length < 20) {
    return false;
  }

  // Block dangerous characters: <, >, ", ', \, and path traversal (..)
  if (/[<>"'\\]|\.\./.test(trimmed)) {
    return false;
  }

  return true;
}

// ==========================================
// Pure Functions - Wallet Data Validation
// ==========================================

/**
 * Validate stored wallet data structure
 */
export function validateStoredWalletData<
  T extends StoredToken = StoredToken,
  N extends NametagDataBase = NametagDataBase
>(
  data: unknown
): data is StoredWalletData<T, N> {
  if (!data || typeof data !== "object") return false;

  const wallet = data as Record<string, unknown>;

  return (
    typeof wallet.id === "string" &&
    typeof wallet.address === "string" &&
    Array.isArray(wallet.tokens)
  );
}

/**
 * Parse tombstones from stored data
 * Handles legacy format (string[]) by discarding it
 */
export function parseTombstones(storedTombstones: unknown): TombstoneEntry[] {
  if (!Array.isArray(storedTombstones)) return [];

  const tombstones: TombstoneEntry[] = [];

  for (const entry of storedTombstones) {
    // New format: TombstoneEntry objects
    if (
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as TombstoneEntry).tokenId === "string" &&
      typeof (entry as TombstoneEntry).stateHash === "string" &&
      typeof (entry as TombstoneEntry).timestamp === "number"
    ) {
      tombstones.push(entry as TombstoneEntry);
    }
    // Legacy string format: discard (no state hash info)
  }

  return tombstones;
}

/**
 * Parse archived tokens from stored data
 */
export function parseArchivedTokens(
  storedArchived: Record<string, unknown> | undefined
): Map<string, TxfToken> {
  const archived = new Map<string, TxfToken>();

  if (!storedArchived || typeof storedArchived !== "object") {
    return archived;
  }

  for (const [tokenId, txfToken] of Object.entries(storedArchived)) {
    if (
      txfToken &&
      typeof txfToken === "object" &&
      (txfToken as TxfToken).genesis
    ) {
      archived.set(tokenId, txfToken as TxfToken);
    }
  }

  return archived;
}

/**
 * Parse forked tokens from stored data
 */
export function parseForkedTokens(
  storedForked: Record<string, unknown> | undefined
): Map<string, TxfToken> {
  const forked = new Map<string, TxfToken>();

  if (!storedForked || typeof storedForked !== "object") {
    return forked;
  }

  for (const [key, txfToken] of Object.entries(storedForked)) {
    if (
      txfToken &&
      typeof txfToken === "object" &&
      (txfToken as TxfToken).genesis
    ) {
      forked.set(key, txfToken as TxfToken);
    }
  }

  return forked;
}

// ==========================================
// Pure Functions - Pruning
// ==========================================

/**
 * Prune tombstones by age and count
 * Returns new array of tombstones (does not mutate input)
 * @param tombstones - Current tombstones
 * @param maxAge - Maximum age in milliseconds (default 30 days)
 * @param maxCount - Maximum number of tombstones to keep (default 100)
 */
export function pruneTombstonesByAge(
  tombstones: TombstoneEntry[],
  maxAge: number = 30 * 24 * 60 * 60 * 1000,
  maxCount: number = 100
): TombstoneEntry[] {
  const now = Date.now();

  // Filter by age
  let result = tombstones.filter(t => (now - t.timestamp) < maxAge);

  // Limit count (keep most recent)
  if (result.length > maxCount) {
    result = [...result].sort((a, b) => b.timestamp - a.timestamp);
    result = result.slice(0, maxCount);
  }

  return result;
}

/**
 * Prune a Map by count (keeps arbitrary subset)
 * Returns new Map (does not mutate input)
 * @param items - Map to prune
 * @param maxCount - Maximum number of items to keep
 */
export function pruneMapByCount<T>(
  items: Map<string, T>,
  maxCount: number
): Map<string, T> {
  if (items.size <= maxCount) {
    return new Map(items);
  }

  const entries = [...items.entries()];
  const toKeep = entries.slice(entries.length - maxCount);
  return new Map(toKeep);
}

// ==========================================
// Pure Functions - Best Version Selection
// ==========================================

/**
 * Find the best version of a token from archived and forked collections
 * Returns the version with the most committed transactions
 * @param tokenId - Token ID to find
 * @param archivedTokens - Map of archived tokens
 * @param forkedTokens - Map of forked tokens (keys are tokenId_stateHash)
 */
export function findBestTokenVersion(
  tokenId: string,
  archivedTokens: Map<string, TxfToken>,
  forkedTokens: Map<string, TxfToken>
): TxfToken | null {
  const candidates: TxfToken[] = [];

  // Check main archive
  const archived = archivedTokens.get(tokenId);
  if (archived) candidates.push(archived);

  // Check forked versions (keys are tokenId_stateHash)
  for (const [key, forked] of forkedTokens) {
    if (key.startsWith(tokenId + "_")) {
      candidates.push(forked);
    }
  }

  if (candidates.length === 0) return null;

  // Sort by committed transactions count (desc)
  candidates.sort((a, b) => countCommittedTxns(b) - countCommittedTxns(a));

  return candidates[0];
}
