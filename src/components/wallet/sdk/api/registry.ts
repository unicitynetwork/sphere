/**
 * Token Registry Service (Platform-Independent)
 *
 * Fetches token definitions from the Unicity token registry.
 * Uses HTTP client abstraction for platform independence.
 */

import type {
  TokenDefinition,
  HttpClient,
} from './types';

// ==========================================
// Constants
// ==========================================

export const UNICITY_REGISTRY_URL =
  "https://raw.githubusercontent.com/unicitynetwork/unicity-ids/refs/heads/main/unicity-ids.testnet.json";

// ==========================================
// Registry Service Functions
// ==========================================

/**
 * Fetch token registry from remote URL
 *
 * @param httpClient - HTTP client implementation
 * @param registryUrl - Registry URL
 * @returns Array of token definitions
 */
export async function fetchRegistry(
  httpClient: HttpClient,
  registryUrl: string = UNICITY_REGISTRY_URL
): Promise<TokenDefinition[]> {
  try {
    const response = await httpClient.get<TokenDefinition[]>(registryUrl, {
      timeout: 10000,
    });

    if (!response.ok) {
      console.error("API: Registry fetch returned non-OK status");
      return [];
    }

    if (Array.isArray(response.data)) {
      return response.data;
    }
    return [];
  } catch (error) {
    console.error("API: Failed to fetch registry", error);
    return [];
  }
}

/**
 * Get best icon URL from token definition
 * Prefers PNG format, falls back to first icon or legacy icon field
 *
 * @param def - Token definition
 * @returns Icon URL or null
 */
export function getBestIconUrl(def: TokenDefinition): string | null {
  if (def.icons && def.icons.length > 0) {
    // Prefer PNG format
    const pngIcon = def.icons.find((i) =>
      i.url.toLowerCase().includes(".png")
    );
    if (pngIcon) return pngIcon.url;
    return def.icons[0].url;
  }
  return def.icon || null;
}

/**
 * Find token definition by coin ID
 *
 * @param registry - Array of token definitions
 * @param coinId - Coin ID to search for
 * @returns Token definition or undefined
 */
export function findTokenByCoinId(
  registry: TokenDefinition[],
  coinId: string
): TokenDefinition | undefined {
  return registry.find((def) => def.id === coinId);
}

/**
 * Find token definition by symbol
 *
 * @param registry - Array of token definitions
 * @param symbol - Symbol to search for (case-insensitive)
 * @returns Token definition or undefined
 */
export function findTokenBySymbol(
  registry: TokenDefinition[],
  symbol: string
): TokenDefinition | undefined {
  const lowerSymbol = symbol.toLowerCase();
  return registry.find((def) => def.symbol.toLowerCase() === lowerSymbol);
}

/**
 * Filter registry by network
 *
 * @param registry - Array of token definitions
 * @param network - Network name
 * @returns Filtered array of token definitions
 */
export function filterByNetwork(
  registry: TokenDefinition[],
  network: string
): TokenDefinition[] {
  return registry.filter((def) => def.network === network);
}

/**
 * Filter registry by asset kind
 *
 * @param registry - Array of token definitions
 * @param kind - Asset kind ("fungible" or "non-fungible")
 * @returns Filtered array of token definitions
 */
export function filterByAssetKind(
  registry: TokenDefinition[],
  kind: "fungible" | "non-fungible"
): TokenDefinition[] {
  return registry.filter((def) => def.assetKind === kind);
}
