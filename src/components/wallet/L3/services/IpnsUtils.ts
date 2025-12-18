/**
 * IPNS Name Derivation Utility
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

// Must match IpfsStorageService.HKDF_INFO for compatible IPNS names
const HKDF_INFO = "ipfs-storage-ed25519-v1";

/**
 * Convert hex string to Uint8Array
 */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
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
  // 1. Convert private key from hex to bytes
  const walletSecret = hexToBytes(privateKeyHex);

  // 2. Derive Ed25519 key material using HKDF
  const derivedKey = hkdf(
    sha256,
    walletSecret,
    undefined, // no salt for deterministic derivation
    HKDF_INFO,
    32
  );

  // 3. Generate Ed25519 key pair from the derived key
  const keyPair = await generateKeyPairFromSeed("Ed25519", derivedKey);

  // 4. Convert to libp2p PeerId which gives us the IPNS name
  const peerId = peerIdFromPrivateKey(keyPair);

  return peerId.toString();
}
