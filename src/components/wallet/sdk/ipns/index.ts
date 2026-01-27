/**
 * IPNS utilities - platform-independent
 *
 * NOTE: hexToBytes/bytesToHex are in core/utils.ts - import from there
 */

export {
  // Constants
  IPNS_HKDF_INFO,
  // IPNS derivation
  deriveEd25519KeyMaterial,
  deriveIpnsNameFromPrivateKey,
  deriveEd25519KeyPair,
  derivePeerIdFromPrivateKey,
} from './utils';
