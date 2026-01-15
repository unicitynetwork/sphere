/**
 * IPNS utilities - platform-independent
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
} from './utils';
