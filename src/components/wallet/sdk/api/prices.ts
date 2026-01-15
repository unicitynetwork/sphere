/**
 * Price API Service (Platform-Independent)
 *
 * Fetches cryptocurrency prices from CoinGecko or similar APIs.
 * Uses HTTP client abstraction for platform independence.
 */

import type {
  CryptoPriceData,
  PriceMap,
  HttpClient,
  CoinGeckoResponse,
} from './types';

// ==========================================
// Constants
// ==========================================

export const COINGECKO_API_URL = "https://api.coingecko.com/api/v3/simple/price";

/**
 * Default price data when API is unavailable
 */
export const DEFAULT_PRICES: PriceMap = {
  bitcoin: {
    priceUsd: 98500.0,
    priceEur: 91200.0,
    change24h: 2.3,
    timestamp: Date.now(),
  },
  ethereum: {
    priceUsd: 3850.0,
    priceEur: 3560.0,
    change24h: 1.8,
    timestamp: Date.now(),
  },
  tether: {
    priceUsd: 1.0,
    priceEur: 0.92,
    change24h: 0.01,
    timestamp: Date.now(),
  },
  solana: {
    priceUsd: 220.0,
    priceEur: 218.92,
    change24h: 0.11,
    timestamp: Date.now(),
  },
  efranc: {
    priceUsd: 0.00169,
    priceEur: 0.00152,
    change24h: 0.01,
    timestamp: Date.now(),
  },
  enaira: {
    priceUsd: 0.000647,
    priceEur: 0.000564,
    change24h: 0.02,
    timestamp: Date.now(),
  },
};

// ==========================================
// Price Service Functions
// ==========================================

/**
 * Fetch cryptocurrency prices from CoinGecko API
 *
 * @param httpClient - HTTP client implementation
 * @param cryptoIds - Comma-separated list of crypto IDs (e.g., "bitcoin,ethereum")
 * @param apiUrl - API endpoint URL
 * @returns Price data for requested cryptocurrencies
 */
export async function fetchPrices(
  httpClient: HttpClient,
  cryptoIds: string = "bitcoin,ethereum,tether,solana",
  apiUrl: string = COINGECKO_API_URL
): Promise<PriceMap> {
  try {
    const response = await httpClient.get<CoinGeckoResponse>(apiUrl, {
      params: {
        ids: cryptoIds,
        vs_currencies: "usd,eur",
        include_24hr_change: "true",
      },
      timeout: 5000,
    });

    if (!response.ok) {
      console.warn("API: Price fetch returned non-OK status, using defaults");
      return { ...DEFAULT_PRICES };
    }

    const prices: PriceMap = {};
    const data = response.data;
    const now = Date.now();

    Object.keys(data).forEach((key) => {
      prices[key] = {
        priceUsd: data[key].usd || DEFAULT_PRICES[key]?.priceUsd || 0,
        priceEur: data[key].eur || DEFAULT_PRICES[key]?.priceEur || 0,
        change24h:
          data[key].usd_24h_change || DEFAULT_PRICES[key]?.change24h || 0,
        timestamp: now,
      };
    });

    return { ...DEFAULT_PRICES, ...prices };
  } catch (error) {
    console.warn("API: Failed to fetch prices (using defaults)", error);
    return { ...DEFAULT_PRICES };
  }
}

/**
 * Get price for a specific cryptocurrency
 *
 * @param prices - Price map
 * @param cryptoId - Cryptocurrency ID (e.g., "bitcoin")
 * @returns Price data or undefined
 */
export function getPrice(prices: PriceMap, cryptoId: string): CryptoPriceData | undefined {
  return prices[cryptoId.toLowerCase()];
}

/**
 * Calculate USD value from amount and price
 *
 * @param amount - Amount in base units
 * @param decimals - Number of decimals for the token
 * @param priceUsd - Price in USD
 * @returns USD value
 */
export function calculateUsdValue(
  amount: bigint | string,
  decimals: number,
  priceUsd: number
): number {
  const amountBigInt = typeof amount === "string" ? BigInt(amount) : amount;
  const divisor = BigInt(10 ** decimals);
  const wholeUnits = Number(amountBigInt) / Number(divisor);
  return wholeUnits * priceUsd;
}

/**
 * Format price for display
 *
 * @param price - Price value
 * @param currency - Currency symbol (default: "$")
 * @param decimals - Number of decimal places (default: 2)
 * @returns Formatted price string
 */
export function formatPrice(
  price: number,
  currency: string = "$",
  decimals: number = 2
): string {
  if (price < 0.01 && price > 0) {
    return `${currency}${price.toExponential(2)}`;
  }
  return `${currency}${price.toFixed(decimals)}`;
}
