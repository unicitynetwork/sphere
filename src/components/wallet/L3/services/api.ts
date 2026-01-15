/**
 * API Service
 *
 * This module re-exports from the SDK and provides an axios-based implementation
 * for backwards compatibility.
 */

import axios from "axios";
import {
  createAxiosHttpClient,
  fetchPrices as sdkFetchPrices,
  fetchRegistry as sdkFetchRegistry,
  getBestIconUrl,
  DEFAULT_PRICES,
  COINGECKO_API_URL,
  UNICITY_REGISTRY_URL,
} from "../../sdk/api";

// Re-export types from SDK
export type { CryptoPriceData, TokenDefinition } from "../../sdk/api";

// Create axios-based HTTP client for use in the app
const httpClient = createAxiosHttpClient(axios);

/**
 * API Service singleton with axios implementation
 */
export const ApiService = {
  fetchPrices: async () => sdkFetchPrices(httpClient, "bitcoin,ethereum,tether,solana", COINGECKO_API_URL),
  fetchRegistry: async () => sdkFetchRegistry(httpClient, UNICITY_REGISTRY_URL),
  getBestIconUrl,
};

// Re-export DEFAULT_PRICES for backwards compatibility
export { DEFAULT_PRICES };
