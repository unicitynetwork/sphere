/**
 * API Types (Platform-Independent)
 */

// ==========================================
// Price Data Types
// ==========================================

/**
 * Cryptocurrency price data
 */
export interface CryptoPriceData {
  priceUsd: number;
  priceEur: number;
  change24h: number;
  timestamp: number;
}

/**
 * Price data for multiple cryptocurrencies
 */
export type PriceMap = Record<string, CryptoPriceData>;

// ==========================================
// Token Registry Types
// ==========================================

/**
 * Token definition from the registry
 */
export interface TokenDefinition {
  id: string;
  network: string;
  assetKind: "fungible" | "non-fungible";
  name: string;
  symbol: string;
  decimals: number;
  description: string;
  icon?: string;
  icons?: Array<{ url: string }>;
}

// ==========================================
// HTTP Client Abstraction
// ==========================================

/**
 * HTTP response interface
 */
export interface HttpResponse<T> {
  data: T;
  status: number;
  ok: boolean;
}

/**
 * HTTP request options
 */
export interface HttpRequestOptions {
  params?: Record<string, string | number | boolean>;
  timeout?: number;
  headers?: Record<string, string>;
}

/**
 * HTTP client interface for dependency injection
 * Allows using fetch, axios, or any other HTTP client
 */
export interface HttpClient {
  get<T>(url: string, options?: HttpRequestOptions): Promise<HttpResponse<T>>;
}

// ==========================================
// CoinGecko API Types
// ==========================================

/**
 * CoinGecko API response format
 */
export interface CoinGeckoResponse {
  [key: string]: {
    usd: number;
    eur: number;
    usd_24h_change: number;
  };
}

// ==========================================
// API Configuration
// ==========================================

/**
 * API service configuration
 */
export interface ApiServiceConfig {
  registryUrl?: string;
  priceApiUrl?: string;
  httpClient?: HttpClient;
  defaultPrices?: PriceMap;
}
