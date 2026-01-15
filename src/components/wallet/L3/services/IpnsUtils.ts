/**
 * IPNS Name Derivation Utility
 *
 * This module re-exports from the SDK for backwards compatibility.
 * All implementation is now in ../../sdk/ipns/
 */

export {
  // Constants
  IPNS_HKDF_INFO,
  // Utility functions
  hexToBytes,
  bytesToHex,
  // IPNS derivation
  deriveEd25519KeyMaterial,
  deriveIpnsNameFromPrivateKey,
  deriveEd25519KeyPair,
  derivePeerIdFromPrivateKey,
} from "../../sdk/ipns";

// Re-export the main function under original name for backwards compatibility
export { deriveIpnsNameFromPrivateKey as default } from "../../sdk/ipns";
