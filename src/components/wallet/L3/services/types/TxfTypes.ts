/**
 * TXF (Token eXchange Format) Type Definitions
 * Based on TXF Format Specification v2.0
 */

import type { NametagData } from "../../../../../repositories/WalletRepository";
import type { OutboxEntry, MintOutboxEntry } from "./OutboxTypes";

// ==========================================
// Storage Format (for IPFS)
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

/**
 * Entry for invalidated nametags (Unicity IDs)
 * Stored when a nametag is found to be owned by a different Nostr pubkey
 */
export interface InvalidatedNametagEntry {
  name: string;              // The invalidated nametag name
  token: object;             // Original token data
  timestamp: number;         // Original creation timestamp
  format: string;
  version: string;
  invalidatedAt: number;     // When invalidated (epoch ms)
  invalidationReason: string;
}

/**
 * Complete storage data structure for IPFS
 * Contains metadata, nametag, tombstones, outbox, invalidated nametags, and all tokens keyed by their IDs
 */
export interface TxfStorageData {
  _meta: TxfMeta;
  _nametag?: NametagData;
  _tombstones?: TombstoneEntry[];              // State-hash-aware tombstones (spent token states)
  _invalidatedNametags?: InvalidatedNametagEntry[]; // Nametags that failed Nostr validation
  _outbox?: OutboxEntry[];                     // Pending transfers (CRITICAL for recovery)
  _mintOutbox?: MintOutboxEntry[];             // Pending mints (CRITICAL for recovery)
  // Dynamic keys for tokens: _<tokenId>
  [key: string]: TxfToken | TxfMeta | NametagData | TombstoneEntry[] | InvalidatedNametagEntry[] | OutboxEntry[] | MintOutboxEntry[] | undefined;
}

/**
 * Storage metadata
 * Note: timestamp is excluded to ensure CID stability (same content = same CID)
 */
export interface TxfMeta {
  version: number;           // Monotonic counter (increments each sync)
  address: string;           // Wallet L3 address
  ipnsName: string;          // IPNS name for this wallet
  formatVersion: "2.0";      // TXF format version
  lastCid?: string;          // Last successfully stored CID
  deviceId?: string;         // Unique device identifier for conflict resolution
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
// Validation Types
// ==========================================

export interface ValidationResult {
  validTokens: import("../../data/model").Token[];
  issues: ValidationIssue[];
}

export interface ValidationIssue {
  tokenId: string;
  reason: string;
  recoverable?: boolean;
}

export interface TokenValidationResult {
  isValid: boolean;
  token?: import("../../data/model").Token;
  reason?: string;
}

// ==========================================
// Conflict Resolution Types
// ==========================================

export interface TokenConflict {
  tokenId: string;
  localVersion: TxfToken;
  remoteVersion: TxfToken;
  resolution: "local" | "remote";
  reason: string;
}

export interface MergeResult {
  merged: TxfStorageData;
  conflicts: TokenConflict[];
  newTokens: string[];      // Token IDs added from remote
  removedTokens: string[];  // Token IDs only in local (if remote is newer)
}

// ==========================================
// Utility Types
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
         key !== "_invalidatedNametags" &&
         key !== "_outbox" &&
         key !== "_mintOutbox" &&
         key !== "_integrity";
}

/**
 * Check if a key is a token key (starts with _ but not reserved)
 * NOTE: This now only returns true for ACTIVE tokens (excludes archived/forked)
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
  // Find underscore after 64-char tokenId
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
