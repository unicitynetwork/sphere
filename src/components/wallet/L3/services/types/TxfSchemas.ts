/**
 * TXF Zod Schemas for Runtime Validation
 * Provides safe parsing of external data (IPFS, file imports)
 */

import { z } from "zod";

// ==========================================
// Basic Patterns
// ==========================================

// Note: hexString and hexString64 replaced by hexStringOrBytesAny and hexStringOrBytes64
// which accept both hex strings and SDK bytes objects for backward compatibility

/**
 * Helper to convert bytes object/array to hex string
 * SDK tokens sometimes serialize IDs as { bytes: [...] } or Uint8Array
 */
function bytesToHex(bytes: number[] | Uint8Array): string {
  const arr = Array.isArray(bytes) ? bytes : Array.from(bytes);
  return arr.map(b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Schema that accepts both hex string and bytes object, normalizing to hex string
 * Handles SDK token format where IDs are objects with bytes arrays
 */
const hexStringOrBytes64 = z.union([
  // Direct hex string (preferred format)
  z.string().regex(/^[0-9a-fA-F]{64}$/),
  // SDK format: object with bytes array
  z.object({
    bytes: z.union([
      z.array(z.number()),
      z.instanceof(Uint8Array),
    ]),
  }).transform(obj => bytesToHex(obj.bytes)),
  // Buffer-like format from JSON.stringify
  z.object({
    type: z.literal("Buffer"),
    data: z.array(z.number()),
  }).transform(obj => bytesToHex(obj.data)),
]);

/**
 * Schema for variable-length hex strings or bytes objects (no length restriction)
 * Used for signatures, public keys, etc.
 */
const hexStringOrBytesAny = z.union([
  // Direct hex string (preferred format)
  z.string().regex(/^[0-9a-fA-F]*$/),
  // SDK format: object with bytes array
  z.object({
    bytes: z.union([
      z.array(z.number()),
      z.instanceof(Uint8Array),
    ]),
  }).transform(obj => bytesToHex(obj.bytes)),
  // Buffer-like format from JSON.stringify
  z.object({
    type: z.literal("Buffer"),
    data: z.array(z.number()),
  }).transform(obj => bytesToHex(obj.data)),
]);

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
  publicKey: hexStringOrBytesAny,
  signature: hexStringOrBytesAny,
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
  // Use hexStringOrBytes64 to handle both string and SDK bytes object formats
  tokenId: hexStringOrBytes64,
  tokenType: hexStringOrBytes64,
  coinData: z.array(z.tuple([z.string(), z.string()])).optional().default([]),
  // tokenData can be null/undefined in stored data, coerce to empty string
  tokenData: z.string().nullable().optional().transform((v) => v ?? ""),
  salt: hexStringOrBytes64,
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
  // newStateHash is optional for backwards compatibility with older tokens
  // that were created before this field was added to transfers
  newStateHash: z.string().optional(),
  predicate: z.string(),
  inclusionProof: TxfInclusionProofSchema.nullable(),
  data: z.record(z.string(), z.unknown()).optional(),
});

export const TxfIntegritySchema = z.object({
  genesisDataJSONHash: z.string(),
  currentStateHash: z.string().optional(),
});

// ==========================================
// Complete Token
// ==========================================

export const TxfTokenSchema = z.object({
  version: z.literal("2.0"),
  genesis: TxfGenesisSchema,
  state: TxfStateSchema,
  transactions: z.array(TxfTransactionSchema),
  // nametags is optional for backwards compatibility (defaults to empty array)
  nametags: z.array(z.string()).optional().default([]),
  // _integrity is optional for backwards compatibility with older token formats
  _integrity: TxfIntegritySchema.optional(),
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
 * Logs validation errors once (concise format) for debugging
 */
export function safeParseTxfToken(data: unknown): z.infer<typeof TxfTokenSchema> | null {
  const result = TxfTokenSchema.safeParse(data);
  if (result.success) {
    return result.data;
  }
  // Log concise error summary (detailed format available via result.error.format())
  const flatErrors = result.error.flatten();
  const fieldKeys = Object.keys(flatErrors.fieldErrors);
  if (fieldKeys.length > 0) {
    console.debug("TxfToken validation failed, fields:", fieldKeys.join(", "));
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

  // Log detailed error path for debugging
  const issues = result.error.issues;
  if (issues.length > 0) {
    const firstIssue = issues[0];
    const path = firstIssue.path.join(".");
    console.debug(`[Zod] Token validation failed at path "${path}": ${firstIssue.message} (code: ${firstIssue.code})`);
    // Log the actual value at the failing path for debugging
    if (firstIssue.path.length > 0 && value && typeof value === "object") {
      let current: unknown = value;
      for (const segment of firstIssue.path) {
        if (current && typeof current === "object" && segment in current) {
          current = (current as Record<string, unknown>)[segment as string];
        } else {
          break;
        }
      }
      console.debug(`[Zod] Value at failing path:`, current);
    }
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
