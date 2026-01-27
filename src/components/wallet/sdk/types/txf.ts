/**
 * TXF (Token eXchange Format) Type Definitions
 * Based on TXF Format Specification v2.0
 *
 * Platform-independent types for token serialization.
 */

// ==========================================
// Nametag Types (generic, no app dependencies)
// ==========================================

/**
 * Nametag data structure
 * Generic interface - app can extend with additional fields
 */
export interface NametagDataBase {
  name: string;
  proxyAddress?: string;
  l3Address?: string;
  registeredAt?: number;
  tokenId?: string;
}

// ==========================================
// Tombstone Types
// ==========================================

/**
 * Tombstone entry for tracking spent token states
 * Tracks both tokenId AND stateHash to allow same token to return with new state
 */
export interface TombstoneEntry {
  tokenId: string;    // 64-char hex token ID
  stateHash: string;  // State hash that was spent (with "0000" prefix)
  timestamp: number;  // When tombstoned (epoch ms)
}

// ==========================================
// Outbox Types (re-exported from outbox.ts)
// ==========================================

// Import outbox types to use in TxfStorageDataBase
import type { OutboxEntryBase } from './outbox';

// Re-export for backwards compatibility
export type { OutboxEntryStatus as OutboxStatus, OutboxEntryBase } from './outbox';

// ==========================================
// Storage Format (for IPFS)
// ==========================================

/**
 * Storage metadata
 */
export interface TxfMeta {
  version: number;           // Monotonic counter (increments each sync)
  lastModified?: number;     // Timestamp of last modification
  format?: string;           // Format identifier (e.g., 'txf')
  formatVersion?: string;    // TXF format version (e.g., '2.0')
  address?: string;          // Wallet L3 address
  ipnsName?: string;         // IPNS name for this wallet
  lastCid?: string;          // Last successfully stored CID
  deviceId?: string;         // Unique device identifier for conflict resolution
}

/**
 * Complete storage data structure for IPFS
 * Generic version without app-specific types
 */
export interface TxfStorageDataBase {
  _meta: TxfMeta;
  _nametag?: NametagDataBase;
  _tombstones?: TombstoneEntry[];
  _outbox?: OutboxEntryBase[];
  // Dynamic keys for tokens: _<tokenId>
  [key: string]: TxfToken | TxfMeta | NametagDataBase | TombstoneEntry[] | OutboxEntryBase[] | undefined;
}

// ==========================================
// Token Structure (TXF v2.0)
// ==========================================

/**
 * Complete token object in TXF format
 */
export interface TxfToken {
  version: "2.0";
  genesis: TxfGenesis;
  state: TxfState;
  transactions: TxfTransaction[];
  nametags: string[];
  _integrity: TxfIntegrity;
}

/**
 * Genesis transaction (initial minting)
 */
export interface TxfGenesis {
  data: TxfGenesisData;
  inclusionProof: TxfInclusionProof;
}

/**
 * Genesis data payload
 */
export interface TxfGenesisData {
  tokenId: string;           // 64-char hex
  tokenType: string;         // 64-char hex
  coinData: [string, string][]; // [[coinId, amount], ...]
  tokenData: string;         // Optional metadata
  salt: string;              // 64-char hex
  recipient: string;         // DIRECT://... address
  recipientDataHash: string | null;
  reason: string | null;
}

/**
 * Current token state
 */
export interface TxfState {
  data: string;              // State data (can be empty)
  predicate: string;         // Hex-encoded CBOR predicate
  stateHash?: string;        // Current state hash (hex with "0000" prefix)
}

/**
 * State transition transaction
 */
export interface TxfTransaction {
  previousStateHash: string;
  newStateHash: string;
  predicate: string;         // New owner's predicate
  inclusionProof: TxfInclusionProof | null; // null = uncommitted
  data?: Record<string, unknown>; // Optional transfer metadata
}

/**
 * Sparse Merkle Tree inclusion proof
 */
export interface TxfInclusionProof {
  authenticator: TxfAuthenticator;
  merkleTreePath: TxfMerkleTreePath;
  transactionHash: string;
  unicityCertificate: string; // Hex-encoded CBOR
}

/**
 * Proof authenticator
 */
export interface TxfAuthenticator {
  algorithm: string;         // e.g., "secp256k1"
  publicKey: string;         // Aggregator's public key (hex)
  signature: string;         // Signature over state hash (hex)
  stateHash: string;         // Hash being authenticated (hex with "0000" prefix)
}

/**
 * Merkle tree path for proof verification
 */
export interface TxfMerkleTreePath {
  root: string;              // Tree root hash (hex with "0000" prefix)
  steps: TxfMerkleStep[];
}

/**
 * Single step in merkle path
 */
export interface TxfMerkleStep {
  data: string;              // Sibling node hash
  path: string;              // Path direction as numeric string
}

/**
 * Token integrity metadata
 */
export interface TxfIntegrity {
  genesisDataJSONHash: string; // SHA-256 hash with "0000" prefix
}

// ==========================================
// Conflict Resolution Types
// ==========================================

/**
 * Token conflict information
 */
export interface TokenConflict {
  tokenId: string;
  localVersion: TxfToken;
  remoteVersion: TxfToken;
  resolution: "local" | "remote";
  reason: string;
}

/**
 * Result of merging two storage data sets
 */
export interface MergeResult<TStorageData extends TxfStorageDataBase = TxfStorageDataBase> {
  merged: TStorageData;
  conflicts: TokenConflict[];
  newTokens: string[];      // Token IDs added from remote
  removedTokens: string[];  // Token IDs only in local (if remote is newer)
}

// ==========================================
// Key Utilities
// ==========================================

// Key prefixes for special storage types
const ARCHIVED_PREFIX = "_archived_";
const FORKED_PREFIX = "_forked_";

/**
 * Check if a key is an archived token key
 */
export function isArchivedKey(key: string): boolean {
  return key.startsWith(ARCHIVED_PREFIX);
}

/**
 * Check if a key is a forked token key
 */
export function isForkedKey(key: string): boolean {
  return key.startsWith(FORKED_PREFIX);
}

/**
 * Check if a key is an active token key (not archived, forked, or reserved)
 */
export function isActiveTokenKey(key: string): boolean {
  return key.startsWith("_") &&
         !key.startsWith(ARCHIVED_PREFIX) &&
         !key.startsWith(FORKED_PREFIX) &&
         key !== "_meta" &&
         key !== "_nametag" &&
         key !== "_tombstones" &&
         key !== "_outbox" &&
         key !== "_integrity";
}

/**
 * Check if a key is a token key (starts with _ but not reserved)
 * NOTE: This only returns true for ACTIVE tokens (excludes archived/forked)
 */
export function isTokenKey(key: string): boolean {
  return isActiveTokenKey(key);
}

/**
 * Extract token ID from key (remove leading underscore)
 */
export function tokenIdFromKey(key: string): string {
  return key.startsWith("_") ? key.substring(1) : key;
}

/**
 * Create token key from ID (add leading underscore)
 */
export function keyFromTokenId(tokenId: string): string {
  return `_${tokenId}`;
}

/**
 * Create archived token key from token ID
 */
export function archivedKeyFromTokenId(tokenId: string): string {
  return `${ARCHIVED_PREFIX}${tokenId}`;
}

/**
 * Extract token ID from archived key
 */
export function tokenIdFromArchivedKey(key: string): string {
  return key.startsWith(ARCHIVED_PREFIX) ? key.substring(ARCHIVED_PREFIX.length) : key;
}

/**
 * Create forked token key from token ID and state hash
 */
export function forkedKeyFromTokenIdAndState(tokenId: string, stateHash: string): string {
  return `${FORKED_PREFIX}${tokenId}_${stateHash}`;
}

/**
 * Parse forked key into tokenId and stateHash
 * Returns null if key is not a valid forked key
 */
export function parseForkedKey(key: string): { tokenId: string; stateHash: string } | null {
  if (!key.startsWith(FORKED_PREFIX)) return null;
  const remainder = key.substring(FORKED_PREFIX.length);
  // Format: tokenId_stateHash
  // tokenId is 64 chars, stateHash starts with "0000" (68+ chars)
  const underscoreIndex = remainder.indexOf("_");
  if (underscoreIndex === -1 || underscoreIndex < 64) return null;
  return {
    tokenId: remainder.substring(0, underscoreIndex),
    stateHash: remainder.substring(underscoreIndex + 1),
  };
}

/**
 * Validate 64-character hex token ID
 */
export function isValidTokenId(tokenId: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(tokenId);
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
 * Count total inclusion proofs in a token
 */
export function countProofs(token: TxfToken): number {
  let count = 0;

  // Genesis always has a proof
  if (token.genesis?.inclusionProof) {
    count++;
  }

  // Count transaction proofs
  if (token.transactions) {
    count += token.transactions.filter(
      (tx: TxfTransaction) => tx.inclusionProof !== null
    ).length;
  }

  return count;
}
