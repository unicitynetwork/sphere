/**
 * IPNS Name Derivation Utility (Platform-Independent)
 *
 * Derives IPNS names from secp256k1 private keys without requiring
 * full Helia/IPFS initialization. Uses the same derivation logic
 * as IpfsStorageService for compatibility.
 *
 * Derivation path:
 *   secp256k1 privateKey (hex)
 *     → HKDF(sha256, key, info="ipfs-storage-ed25519-v1", 32 bytes)
 *     → Ed25519 key pair
 *     → libp2p PeerId
 *     → IPNS name (e.g., "12D3KooW...")
 */

import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { generateKeyPairFromSeed } from "@libp2p/crypto/keys";
import { peerIdFromPrivateKey } from "@libp2p/peer-id";

// Import hex utilities from core to avoid duplication
import { hexToBytes } from "../core/utils";

// ==========================================
// Constants
// ==========================================

/**
 * HKDF info string for deriving Ed25519 keys from wallet keys
 * Must match IpfsStorageService.HKDF_INFO for compatible IPNS names
 */
export const IPNS_HKDF_INFO = "ipfs-storage-ed25519-v1";

// ==========================================
// IPNS Derivation
// ==========================================

/**
 * Derive Ed25519 key material from a secp256k1 private key using HKDF
 *
 * @param privateKeyHex - The secp256k1 private key in hex format
 * @param info - HKDF info string (default: IPNS_HKDF_INFO)
 * @returns 32-byte derived key material suitable for Ed25519
 */
export function deriveEd25519KeyMaterial(
  privateKeyHex: string,
  info: string = IPNS_HKDF_INFO
): Uint8Array {
  const walletSecret = hexToBytes(privateKeyHex);

  return hkdf(
    sha256,
    walletSecret,
    undefined, // no salt for deterministic derivation
    info,
    32
  );
}

/**
 * Derive IPNS name from a secp256k1 private key
 *
 * @param privateKeyHex - The secp256k1 private key in hex format
 * @returns The IPNS name (libp2p PeerId string, e.g., "12D3KooW...")
 */
export async function deriveIpnsNameFromPrivateKey(
  privateKeyHex: string
): Promise<string> {
  // 1. Derive Ed25519 key material using HKDF
  const derivedKey = deriveEd25519KeyMaterial(privateKeyHex);

  // 2. Generate Ed25519 key pair from the derived key
  const keyPair = await generateKeyPairFromSeed("Ed25519", derivedKey);

  // 3. Convert to libp2p PeerId which gives us the IPNS name
  const peerId = peerIdFromPrivateKey(keyPair);

  return peerId.toString();
}

/**
 * Derive Ed25519 key pair from a secp256k1 private key
 * Useful when you need the full key pair, not just the IPNS name
 *
 * @param privateKeyHex - The secp256k1 private key in hex format
 * @returns Ed25519 key pair
 */
export async function deriveEd25519KeyPair(
  privateKeyHex: string
) {
  const derivedKey = deriveEd25519KeyMaterial(privateKeyHex);
  return generateKeyPairFromSeed("Ed25519", derivedKey);
}

/**
 * Get PeerId from a secp256k1 private key
 * Returns the full PeerId object (use toString() to get the string representation)
 *
 * @param privateKeyHex - The secp256k1 private key in hex format
 * @returns libp2p PeerId object
 */
export async function derivePeerIdFromPrivateKey(
  privateKeyHex: string
): Promise<ReturnType<typeof peerIdFromPrivateKey>> {
  const keyPair = await deriveEd25519KeyPair(privateKeyHex);
  return peerIdFromPrivateKey(keyPair);
}
