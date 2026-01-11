/**
 * Shared cryptographic utilities for wallet operations
 * Consolidates duplicate HASH160 and address generation logic
 */

import CryptoJS from "crypto-js";
import elliptic from "elliptic";
import { createBech32 } from "../../L1/sdk/bech32";

const ec = new elliptic.ec("secp256k1");

/**
 * Compute HASH160 (SHA256 -> RIPEMD160) of a public key
 * @param publicKey - Compressed public key as hex string
 * @returns HASH160 as hex string
 */
export function computeHash160(publicKey: string): string {
  const sha = CryptoJS.SHA256(CryptoJS.enc.Hex.parse(publicKey)).toString();
  const hash160 = CryptoJS.RIPEMD160(CryptoJS.enc.Hex.parse(sha)).toString();
  return hash160;
}

/**
 * Convert HASH160 hex string to Uint8Array (witness program bytes)
 * @param hash160 - HASH160 as hex string
 * @returns 20-byte Uint8Array
 */
export function hash160ToBytes(hash160: string): Uint8Array {
  return Uint8Array.from(hash160.match(/../g)!.map((x) => parseInt(x, 16)));
}

/**
 * Generate bech32 address from public key
 * @param publicKey - Compressed public key as hex string
 * @param prefix - Address prefix (default: "alpha")
 * @param witnessVersion - Witness version (default: 0)
 * @returns Bech32 encoded address
 */
export function publicKeyToAddress(
  publicKey: string,
  prefix: string = "alpha",
  witnessVersion: number = 0
): string {
  const hash160 = computeHash160(publicKey);
  const programBytes = hash160ToBytes(hash160);
  return createBech32(prefix, witnessVersion, programBytes);
}

/**
 * Generate address info from a private key
 * @param privateKey - Private key as hex string
 * @returns Object with address, publicKey
 */
export function privateKeyToAddressInfo(privateKey: string): {
  address: string;
  publicKey: string;
} {
  const keyPair = ec.keyFromPrivate(privateKey);
  const publicKey = keyPair.getPublic(true, "hex");
  const address = publicKeyToAddress(publicKey);
  return { address, publicKey };
}

/**
 * Generate full address info from private key with index and path
 * @param privateKey - Private key as hex string
 * @param index - Address index
 * @param path - Derivation path
 * @returns Full address info object
 */
export function generateAddressInfo(
  privateKey: string,
  index: number,
  path: string
): {
  address: string;
  privateKey: string;
  publicKey: string;
  index: number;
  path: string;
} {
  const { address, publicKey } = privateKeyToAddressInfo(privateKey);
  return {
    address,
    privateKey,
    publicKey,
    index,
    path,
  };
}

// Re-export elliptic instance for use in other modules
export { ec };
