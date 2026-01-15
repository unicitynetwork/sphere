/**
 * TXF (Token eXchange Format) Type Definitions
 * Based on TXF Format Specification v2.0
 *
 * This module extends the SDK's generic TXF types with app-specific types.
 */

// Re-export all SDK TXF types for backwards compatibility
export {
  // Key utility functions
  isArchivedKey,
  isForkedKey,
  isActiveTokenKey,
  isTokenKey,
  tokenIdFromKey,
  keyFromTokenId,
  archivedKeyFromTokenId,
  tokenIdFromArchivedKey,
  forkedKeyFromTokenIdAndState,
  parseForkedKey,
  isValidTokenId,
  getCurrentStateHash,
  countProofs,
} from '../../../sdk';

export type {
  // Base types
  NametagDataBase,
  TombstoneEntry,
  OutboxStatus,
  OutboxEntryBase,
  TxfMeta,
  TxfStorageDataBase,
  // Token structure
  TxfToken,
  TxfGenesis,
  TxfGenesisData,
  TxfState,
  TxfTransaction,
  TxfInclusionProof,
  TxfAuthenticator,
  TxfMerkleTreePath,
  TxfMerkleStep,
  TxfIntegrity,
  // Conflict resolution
  TokenConflict,
  MergeResult,
} from '../../../sdk';

// ==========================================
// App-Specific Type Extensions
// ==========================================

import type { NametagData } from "../../../../../repositories/WalletRepository";
import type { OutboxEntry } from "./OutboxTypes";
import type {
  TxfToken,
  TxfMeta,
  TombstoneEntry,
} from '../../../sdk';

/**
 * Complete storage data structure for IPFS
 * App-specific version using NametagData and OutboxEntry from repositories
 */
export interface TxfStorageData {
  _meta: TxfMeta;
  _nametag?: NametagData;
  _tombstones?: TombstoneEntry[];
  _outbox?: OutboxEntry[];
  // Dynamic keys for tokens: _<tokenId>
  [key: string]: TxfToken | TxfMeta | NametagData | TombstoneEntry[] | OutboxEntry[] | undefined;
}

// ==========================================
// Validation Types (app-specific)
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
