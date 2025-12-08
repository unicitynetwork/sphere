/**
 * TXF (Token eXchange Format) Type Definitions
 * Based on TXF Format Specification v2.0
 */

import type { NametagData } from "../../../../../repositories/WalletRepository";

// ==========================================
// Storage Format (for IPFS)
// ==========================================

/**
 * Complete storage data structure for IPFS
 * Contains metadata, nametag, tombstones, and all tokens keyed by their IDs
 */
export interface TxfStorageData {
  _meta: TxfMeta;
  _nametag?: NametagData;
  _tombstones?: string[];  // Array of deleted token IDs (prevents zombie tokens)
  // Dynamic keys for tokens: _<tokenId>
  [key: string]: TxfToken | TxfMeta | NametagData | string[] | undefined;
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

/**
 * Check if a key is a token key (starts with _ but not reserved)
 */
export function isTokenKey(key: string): boolean {
  return key.startsWith("_") &&
         key !== "_meta" &&
         key !== "_nametag" &&
         key !== "_tombstones" &&
         key !== "_integrity";
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
 * Validate 64-character hex token ID
 */
export function isValidTokenId(tokenId: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(tokenId);
}
