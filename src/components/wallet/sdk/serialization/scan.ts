/**
 * SDK Scan - Pure functions for wallet address scanning
 *
 * Platform-independent utilities for HD wallet address generation.
 * Browser-specific scan logic (IPFS, localStorage) stays in L1/sdk/scan.ts
 */

import { deriveKeyAtPath } from '../core/derivation';
import { publicKeyToAddress, ec } from '../address/address';

/**
 * Result of address generation at a specific path
 */
export interface GeneratedAddressInfo {
  address: string;
  privateKey: string;
  publicKey: string;
  path: string;
}

/**
 * Scanned address with balance and L3 inventory info
 */
export interface ScannedAddress {
  index: number;
  address: string;
  path: string;
  balance: number;
  privateKey: string;
  publicKey: string;
  isChange?: boolean;
  // L3 inventory fields
  l3Nametag?: string;       // Nametag (Unicity ID) if found
  hasL3Inventory?: boolean; // True if has L3 inventory
  l3Synced?: boolean;       // True if IPFS sync completed for this address
}

/**
 * Progress callback data for scanning
 */
export interface ScanProgress {
  current: number;
  total: number;
  found: number;
  totalBalance: number;
  foundAddresses: ScannedAddress[];
  l1ScanComplete?: boolean;  // True when L1 balance scan is done (IPNS may still be running)
}

/**
 * Final scan result
 */
export interface ScanResult {
  addresses: ScannedAddress[];
  totalBalance: number;
  scannedCount: number;
}

/**
 * Generate address at specific BIP32 path (supports both external and change chains)
 *
 * Pure function - no network or storage dependencies.
 *
 * @param masterPrivKey - Master private key hex
 * @param chainCode - Chain code hex
 * @param path - Full BIP32 path like "m/84'/1'/0'/0/0"
 * @returns Generated address info
 */
export function generateAddressAtPath(
  masterPrivKey: string,
  chainCode: string,
  path: string
): GeneratedAddressInfo {
  const derived = deriveKeyAtPath(masterPrivKey, chainCode, path);

  const keyPair = ec.keyFromPrivate(derived.privateKey);
  const publicKey = keyPair.getPublic(true, "hex");
  const address = publicKeyToAddress(publicKey);

  return {
    address,
    privateKey: derived.privateKey,
    publicKey,
    path,
  };
}

/**
 * Generate multiple addresses for a given chain (external or change)
 *
 * @param masterPrivKey - Master private key hex
 * @param chainCode - Chain code hex
 * @param basePath - Base BIP32 path like "m/44'/0'/0'"
 * @param chain - 0 for external, 1 for change
 * @param count - Number of addresses to generate
 * @returns Array of generated address info
 */
export function generateAddresses(
  masterPrivKey: string,
  chainCode: string,
  basePath: string,
  chain: 0 | 1,
  count: number
): GeneratedAddressInfo[] {
  const addresses: GeneratedAddressInfo[] = [];

  for (let i = 0; i < count; i++) {
    const fullPath = `${basePath}/${chain}/${i}`;
    try {
      addresses.push(generateAddressAtPath(masterPrivKey, chainCode, fullPath));
    } catch (e) {
      console.warn(`Error deriving address at ${fullPath}:`, e);
    }
  }

  return addresses;
}

/**
 * Default BIP44 mainnet path for Alpha
 */
export const DEFAULT_BASE_PATH_SCAN = "m/44'/0'/0'";

/**
 * Number of addresses to actively sync IPFS in parallel
 */
export const ACTIVE_SYNC_LIMIT = 10;
