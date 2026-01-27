/**
 * Token Validation Utilities
 *
 * CRITICAL: These validation functions MUST be used at ALL token import/export boundaries
 * to prevent corrupted data from entering or leaving the system.
 *
 * Validation is required at:
 * - WalletRepository.saveNametagForAddress()
 * - WalletRepository.setNametag()
 * - WalletRepository.addToken()
 * - WalletRepository.updateToken()
 * - IpfsStorageService (import and export)
 * - NostrService (receive tokens)
 * - Any other entry/exit point for token data
 */

import type { NametagData } from "../components/wallet/L3/services/types/TxfTypes";

/**
 * Result of token validation
 */
export interface TokenValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * Validate that a token JSON object has the required SDK structure.
 *
 * A valid SDK Token JSON must have:
 * - version: string
 * - state: object with predicate
 * - genesis: object with data and inclusionProof
 * - transactions: array
 * - nametags: array (can be empty)
 *
 * @param token - The token object to validate
 * @param options - Validation options
 * @returns Validation result with isValid flag and error messages
 */
export function validateTokenJson(
  token: unknown,
  options: {
    requireInclusionProof?: boolean;
    context?: string; // For error messages
  } = {}
): TokenValidationResult {
  const errors: string[] = [];
  const context = options.context ? `[${options.context}] ` : "";
  const requireProof = options.requireInclusionProof ?? true;

  // Check basic structure
  if (!token || typeof token !== "object") {
    errors.push(`${context}Token must be a non-null object`);
    return { isValid: false, errors };
  }

  const t = token as Record<string, unknown>;

  // Check for empty object (the bug we're preventing)
  if (Object.keys(t).length === 0) {
    errors.push(`${context}Token is an empty object - this indicates data corruption`);
    return { isValid: false, errors };
  }

  // Version check
  if (!t.version || typeof t.version !== "string") {
    errors.push(`${context}Token missing required 'version' field`);
  }

  // State check
  if (!t.state || typeof t.state !== "object") {
    errors.push(`${context}Token missing required 'state' object`);
  } else {
    const state = t.state as Record<string, unknown>;
    // Predicate is hex-encoded CBOR string, not an object
    if (!state.predicate || typeof state.predicate !== "string") {
      errors.push(`${context}Token state missing required 'predicate' string`);
    }
  }

  // Genesis check (required for all tokens)
  if (!t.genesis || typeof t.genesis !== "object") {
    errors.push(`${context}Token missing required 'genesis' object`);
  } else {
    const genesis = t.genesis as Record<string, unknown>;

    // Genesis must have data
    if (!genesis.data || typeof genesis.data !== "object") {
      errors.push(`${context}Token genesis missing required 'data' object`);
    } else {
      const data = genesis.data as Record<string, unknown>;

      // Genesis data must have tokenId
      if (!data.tokenId || typeof data.tokenId !== "string") {
        errors.push(`${context}Token genesis.data missing required 'tokenId' string`);
      }

      // Genesis data must have salt (for reconstruction)
      if (!data.salt || typeof data.salt !== "string") {
        errors.push(`${context}Token genesis.data missing required 'salt' string`);
      }

      // Genesis data must have recipient
      if (!data.recipient || typeof data.recipient !== "string") {
        errors.push(`${context}Token genesis.data missing required 'recipient' string`);
      }
    }

    // Genesis must have inclusionProof (unless explicitly skipped)
    if (requireProof) {
      if (!genesis.inclusionProof || typeof genesis.inclusionProof !== "object") {
        errors.push(`${context}Token genesis missing required 'inclusionProof' object`);
      } else {
        const proof = genesis.inclusionProof as Record<string, unknown>;
        if (!proof.authenticator || typeof proof.authenticator !== "object") {
          errors.push(`${context}Token genesis.inclusionProof missing 'authenticator'`);
        }
      }
    }
  }

  // Transactions check (must be array, can be empty)
  if (!Array.isArray(t.transactions)) {
    errors.push(`${context}Token missing required 'transactions' array`);
  }

  // Nametags check (must be array, can be empty)
  if (!Array.isArray(t.nametags)) {
    // Note: Some older tokens might not have this field, so just warn
    // errors.push(`${context}Token missing 'nametags' array`);
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Validate a NametagData object before storing.
 *
 * A valid NametagData must have:
 * - name: non-empty string
 * - token: valid SDK Token JSON (NOT an empty object)
 * - timestamp: number
 * - format: string
 * - version: string
 *
 * @param nametag - The NametagData to validate
 * @param options - Validation options
 * @returns Validation result with isValid flag and error messages
 */
export function validateNametagData(
  nametag: unknown,
  options: {
    requireInclusionProof?: boolean;
    context?: string;
  } = {}
): TokenValidationResult {
  const errors: string[] = [];
  const context = options.context ? `[${options.context}] ` : "";

  // Check basic structure
  if (!nametag || typeof nametag !== "object") {
    errors.push(`${context}NametagData must be a non-null object`);
    return { isValid: false, errors };
  }

  const n = nametag as Record<string, unknown>;

  // Name check
  if (!n.name || typeof n.name !== "string" || n.name.trim().length === 0) {
    errors.push(`${context}NametagData missing required 'name' string`);
  }

  // Token check - THIS IS THE CRITICAL VALIDATION
  if (!n.token) {
    errors.push(`${context}NametagData missing required 'token' object`);
  } else {
    const tokenValidation = validateTokenJson(n.token, {
      requireInclusionProof: options.requireInclusionProof,
      context: `${context}NametagData.token`,
    });
    if (!tokenValidation.isValid) {
      errors.push(...tokenValidation.errors);
    }
  }

  // Timestamp check
  if (typeof n.timestamp !== "number" || n.timestamp <= 0) {
    errors.push(`${context}NametagData missing valid 'timestamp' number`);
  }

  // Format check
  if (!n.format || typeof n.format !== "string") {
    errors.push(`${context}NametagData missing required 'format' string`);
  }

  // Version check
  if (!n.version || typeof n.version !== "string") {
    errors.push(`${context}NametagData missing required 'version' string`);
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Validate a NametagData and throw if invalid.
 * Use this at storage boundaries to prevent corrupted data from being saved.
 *
 * @param nametag - The NametagData to validate
 * @param context - Context for error messages (e.g., "IPFS import", "wallet import")
 * @throws Error if validation fails
 */
export function assertValidNametagData(
  nametag: NametagData | unknown,
  context: string = "storage"
): asserts nametag is NametagData {
  const result = validateNametagData(nametag, { context });
  if (!result.isValid) {
    const errorMsg = `Invalid NametagData at ${context}:\n${result.errors.join("\n")}`;
    console.error(errorMsg);
    throw new Error(errorMsg);
  }
}

/**
 * Validate a token JSON and throw if invalid.
 * Use this at storage boundaries to prevent corrupted data from being saved.
 *
 * @param token - The token JSON to validate
 * @param context - Context for error messages
 * @throws Error if validation fails
 */
export function assertValidTokenJson(
  token: unknown,
  context: string = "storage"
): void {
  const result = validateTokenJson(token, { context });
  if (!result.isValid) {
    const errorMsg = `Invalid Token JSON at ${context}:\n${result.errors.join("\n")}`;
    console.error(errorMsg);
    throw new Error(errorMsg);
  }
}

/**
 * Check if a nametag token is corrupted (empty or missing critical fields).
 * This is a quick check for the common corruption case of `token: {}`.
 *
 * @param nametag - The NametagData to check
 * @returns true if the nametag appears corrupted
 */
export function isNametagCorrupted(nametag: NametagData | null | undefined): boolean {
  if (!nametag) return false; // No nametag is not corruption

  // Check for empty token object (the main corruption case)
  if (!nametag.token || typeof nametag.token !== "object") {
    return true;
  }

  if (Object.keys(nametag.token).length === 0) {
    return true;
  }

  // Check for missing critical fields
  const token = nametag.token as Record<string, unknown>;
  if (!token.genesis || !token.state) {
    return true;
  }

  return false;
}

/**
 * Sanitize a NametagData for logging (hide sensitive data).
 */
export function sanitizeNametagForLogging(nametag: NametagData | null | undefined): object {
  if (!nametag) return { exists: false };

  const tokenKeys = nametag.token ? Object.keys(nametag.token) : [];

  return {
    name: nametag.name,
    tokenKeyCount: tokenKeys.length,
    tokenKeys: tokenKeys.slice(0, 10), // First 10 keys only
    hasGenesis: tokenKeys.includes("genesis"),
    hasState: tokenKeys.includes("state"),
    format: nametag.format,
    version: nametag.version,
    timestamp: nametag.timestamp,
  };
}
