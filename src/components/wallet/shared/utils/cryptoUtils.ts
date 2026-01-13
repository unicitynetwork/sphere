/**
 * Shared cryptographic utilities for wallet operations
 *
 * This module re-exports from SDK for backward compatibility.
 * New code should import directly from ../../sdk
 */

// Re-export everything from SDK
export {
  computeHash160,
  hash160ToBytes,
  publicKeyToAddress,
  privateKeyToAddressInfo,
  generateAddressInfo,
  ec,
} from "../../sdk";
