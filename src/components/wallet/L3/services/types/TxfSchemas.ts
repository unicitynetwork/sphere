/**
 * TXF Zod Schemas for Runtime Validation
 * Provides safe parsing of external data (IPFS, file imports)
 *
 * This module re-exports SDK schemas and may add app-specific extensions.
 */

import { z } from "zod";

// Re-export all SDK schemas for backwards compatibility
export {
  // Schemas
  TxfMerkleStepSchema,
  TxfMerkleTreePathSchema,
  TxfAuthenticatorSchema,
  TxfInclusionProofSchema,
  TxfGenesisDataSchema,
  TxfGenesisSchema,
  TxfStateSchema,
  TxfTransactionSchema,
  TxfIntegritySchema,
  TxfTokenSchema,
  TxfMetaSchema,
  NametagDataBaseSchema,
  TombstoneEntrySchema,
  OutboxEntryBaseSchema,
  TxfStorageDataBaseSchema,
  // Validation functions
  parseTxfToken,
  safeParseTxfToken,
  parseTxfStorageData,
  safeParseTxfStorageData,
  parseTxfMeta,
  safeParseTxfMeta,
  validateTokenEntry,
} from '../../../sdk';

export type {
  ValidatedTxfToken,
  ValidatedTxfMeta,
  ValidatedTxfStorageData,
  ValidatedTxfGenesis,
  ValidatedTxfTransaction,
  ValidatedTxfInclusionProof,
  ValidatedNametagDataBase,
  ValidatedTombstoneEntry,
  ValidatedOutboxEntryBase,
} from '../../../sdk';

// ==========================================
// App-Specific Schema Extensions
// ==========================================

// Import base schemas for extension
import {
  TxfMetaSchema as BaseMetaSchema,
  TxfTokenSchema as BaseTokenSchema,
} from '../../../sdk';

/**
 * App-specific nametag schema with additional fields
 */
export const NametagDataSchema = z.object({
  name: z.string(),
  tokenId: z.string(),
  registeredAt: z.number().optional(),
  proxyAddress: z.string().optional(),
  l3Address: z.string().optional(),
}).passthrough(); // Allow additional fields

/**
 * App-specific storage data schema
 * Uses app-specific NametagDataSchema
 */
export const TxfStorageDataSchema = z.object({
  _meta: BaseMetaSchema,
  _nametag: NametagDataSchema.optional(),
}).catchall(z.union([BaseTokenSchema, z.unknown()]));
