/**
 * TXF Zod Schemas for Runtime Validation
 * Provides safe parsing of external data (IPFS, file imports)
 */

import { z } from "zod";

// ==========================================
// Basic Patterns
// ==========================================

const hexString = z.string().regex(/^[0-9a-fA-F]*$/, "Must be hex string");
const hexString64 = z.string().regex(/^[0-9a-fA-F]{64}$/, "Must be 64-char hex");
// const hexWithPrefix = z.string().regex(/^0000[0-9a-fA-F]+$/, "Must be hex with 0000 prefix");

// ==========================================
// Merkle Tree Path
// ==========================================

export const TxfMerkleStepSchema = z.object({
  data: z.string(),
  path: z.string(),
});

export const TxfMerkleTreePathSchema = z.object({
  root: z.string(),
  steps: z.array(TxfMerkleStepSchema),
});

// ==========================================
// Authenticator
// ==========================================

export const TxfAuthenticatorSchema = z.object({
  algorithm: z.string(),
  publicKey: hexString,
  signature: hexString,
  stateHash: z.string(),
});

// ==========================================
// Inclusion Proof
// ==========================================

export const TxfInclusionProofSchema = z.object({
  authenticator: TxfAuthenticatorSchema,
  merkleTreePath: TxfMerkleTreePathSchema,
  transactionHash: z.string(),
  unicityCertificate: z.string(),
});

// ==========================================
// Token Components
// ==========================================

export const TxfGenesisDataSchema = z.object({
  tokenId: hexString64,
  tokenType: hexString64,
  coinData: z.array(z.tuple([z.string(), z.string()])).optional().default([]),
  // tokenData can be null/undefined in stored data, coerce to empty string
  tokenData: z.string().nullable().optional().transform((v) => v ?? ""),
  salt: hexString64,
  recipient: z.string(),
  recipientDataHash: z.string().nullable(),
  reason: z.string().nullable(),
});

export const TxfGenesisSchema = z.object({
  data: TxfGenesisDataSchema,
  inclusionProof: TxfInclusionProofSchema,
});

export const TxfStateSchema = z.object({
  // state.data can be null/undefined in stored data, coerce to empty string
  data: z.string().nullable().optional().transform((v) => v ?? ""),
  predicate: z.string(),
});

export const TxfTransactionSchema = z.object({
  previousStateHash: z.string(),
  newStateHash: z.string(),
  predicate: z.string(),
  inclusionProof: TxfInclusionProofSchema.nullable(),
  data: z.record(z.string(), z.unknown()).optional(),
});

export const TxfIntegritySchema = z.object({
  genesisDataJSONHash: z.string(),
});

// ==========================================
// Complete Token
// ==========================================

export const TxfTokenSchema = z.object({
  version: z.literal("2.0"),
  genesis: TxfGenesisSchema,
  state: TxfStateSchema,
  transactions: z.array(TxfTransactionSchema),
  nametags: z.array(z.string()),
  _integrity: TxfIntegritySchema,
});

// ==========================================
// Storage Metadata
// ==========================================

export const TxfMetaSchema = z.object({
  version: z.number().int().nonnegative(),
  address: z.string(),
  ipnsName: z.string(),
  formatVersion: z.literal("2.0"),
  lastCid: z.string().optional(),
});

// ==========================================
// Nametag Data
// ==========================================

export const NametagDataSchema = z.object({
  name: z.string(),
  tokenId: z.string(),
  registeredAt: z.number().optional(),
}).passthrough(); // Allow additional fields

// ==========================================
// Complete Storage Data
// ==========================================

export const TxfStorageDataSchema = z.object({
  _meta: TxfMetaSchema,
  _nametag: NametagDataSchema.optional(),
}).catchall(z.union([TxfTokenSchema, z.unknown()]));

// ==========================================
// Validation Functions
// ==========================================

/**
 * Parse and validate TXF token data
 */
export function parseTxfToken(data: unknown): z.infer<typeof TxfTokenSchema> {
  return TxfTokenSchema.parse(data);
}

/**
 * Safely parse TXF token, returning null on failure
 */
export function safeParseTxfToken(data: unknown): z.infer<typeof TxfTokenSchema> | null {
  const result = TxfTokenSchema.safeParse(data);
  if (result.success) {
    return result.data;
  }
  // Log detailed errors for debugging
  console.warn("TxfToken validation failed:", result.error.format());
  // Show specific field errors
  const flatErrors = result.error.flatten();
  if (Object.keys(flatErrors.fieldErrors).length > 0) {
    console.warn("Field errors:", flatErrors.fieldErrors);
  }
  return null;
}

/**
 * Parse and validate TXF storage data
 */
export function parseTxfStorageData(data: unknown): z.infer<typeof TxfStorageDataSchema> {
  return TxfStorageDataSchema.parse(data);
}

/**
 * Safely parse TXF storage data, returning null on failure
 */
export function safeParseTxfStorageData(data: unknown): z.infer<typeof TxfStorageDataSchema> | null {
  const result = TxfStorageDataSchema.safeParse(data);
  if (result.success) {
    return result.data;
  }
  console.warn("TxfStorageData validation failed:", result.error.format());
  return null;
}

/**
 * Parse and validate TXF metadata
 */
export function parseTxfMeta(data: unknown): z.infer<typeof TxfMetaSchema> {
  return TxfMetaSchema.parse(data);
}

/**
 * Safely parse TXF metadata, returning null on failure
 */
export function safeParseTxfMeta(data: unknown): z.infer<typeof TxfMetaSchema> | null {
  const result = TxfMetaSchema.safeParse(data);
  if (result.success) {
    return result.data;
  }
  console.warn("TxfMeta validation failed:", result.error.format());
  return null;
}

/**
 * Validate a token key-value pair from storage data
 */
export function validateTokenEntry(key: string, value: unknown): { valid: boolean; token?: z.infer<typeof TxfTokenSchema>; error?: string } {
  if (!key.startsWith("_") || key === "_meta" || key === "_nametag" || key === "_integrity") {
    return { valid: false, error: "Invalid token key" };
  }

  const result = TxfTokenSchema.safeParse(value);
  if (result.success) {
    return { valid: true, token: result.data };
  }

  return { valid: false, error: result.error.message };
}

// ==========================================
// Type Exports (inferred from schemas)
// ==========================================

export type ValidatedTxfToken = z.infer<typeof TxfTokenSchema>;
export type ValidatedTxfMeta = z.infer<typeof TxfMetaSchema>;
export type ValidatedTxfStorageData = z.infer<typeof TxfStorageDataSchema>;
export type ValidatedTxfGenesis = z.infer<typeof TxfGenesisSchema>;
export type ValidatedTxfTransaction = z.infer<typeof TxfTransactionSchema>;
export type ValidatedTxfInclusionProof = z.infer<typeof TxfInclusionProofSchema>;
