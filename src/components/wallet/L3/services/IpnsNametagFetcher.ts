/**
 * IPNS Nametag Fetcher
 *
 * Re-exports from SDK browser module with app-specific configuration.
 * @see sdk/browser/ipns-nametag-fetcher.ts for implementation
 */

import {
  fetchNametagFromIpns as sdkFetchNametagFromIpns,
  fetchNametagsForKeys as sdkFetchNametagsForKeys,
  type IpnsNametagResult,
  type IpnsNametagConfig,
} from "../../sdk/browser";
import {
  getAllBackendGatewayUrls,
  getBackendGatewayUrl,
  IPNS_RESOLUTION_CONFIG,
} from "../../../../config/ipfs.config";

// Re-export types
export type { IpnsNametagResult, IpnsNametagConfig };

/**
 * Get default gateway configuration from app config
 */
function getDefaultConfig(): IpnsNametagConfig {
  const gatewayUrls = getAllBackendGatewayUrls();
  if (gatewayUrls.length === 0) {
    const fallbackUrl = getBackendGatewayUrl();
    if (fallbackUrl) {
      gatewayUrls.push(fallbackUrl);
    }
  }

  return {
    gatewayUrls,
    gatewayPathTimeoutMs: IPNS_RESOLUTION_CONFIG.gatewayPathTimeoutMs,
    perGatewayTimeoutMs: IPNS_RESOLUTION_CONFIG.perGatewayTimeoutMs,
  };
}

/**
 * Fetch nametag from IPFS using IPNS resolution
 *
 * @param privateKeyHex - The secp256k1 private key in hex format
 * @returns Result containing IPNS name and resolved nametag (if found)
 */
export async function fetchNametagFromIpns(
  privateKeyHex: string
): Promise<IpnsNametagResult> {
  return sdkFetchNametagFromIpns(privateKeyHex, getDefaultConfig());
}

/**
 * Batch fetch nametags for multiple private keys in parallel
 *
 * @param privateKeys - Array of private keys in hex format
 * @returns Array of results (same order as input)
 */
export async function fetchNametagsForKeys(
  privateKeys: string[]
): Promise<IpnsNametagResult[]> {
  return sdkFetchNametagsForKeys(privateKeys, getDefaultConfig());
}
