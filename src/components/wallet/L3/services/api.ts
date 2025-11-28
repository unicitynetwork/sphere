import axios from "axios";

const REGISTRY_URL =
  "https://raw.githubusercontent.com/unicitynetwork/unicity-ids/refs/heads/main/unicity-ids.testnet.json";
const COINGECKO_URL = "https://api.coingecko.com/api/v3/simple/price";

const DEFAULT_PRICES: Record<string, CryptoPriceData> = {
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

export interface CryptoPriceData {
  priceUsd: number;
  priceEur: number;
  change24h: number;
  timestamp: number;
}

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

interface CoinGeckoResponse {
  [key: string]: {
    usd: number;
    eur: number;
    usd_24h_change: number;
  };
}

export const ApiService = {
  fetchPrices: async (): Promise<Record<string, CryptoPriceData>> => {
    try {
      const response = await axios.get<CoinGeckoResponse>(COINGECKO_URL, {
        params: {
          ids: "bitcoin,ethereum,tether,solana",
          vs_currencies: "usd,eur",
          include_24hr_change: "true",
        },
        timeout: 5000,
      });

      const prices: Record<string, CryptoPriceData> = {};
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
      return DEFAULT_PRICES;
    }
  },


  fetchRegistry: async (): Promise<TokenDefinition[]> => {
    try {
      const response = await axios.get<TokenDefinition[]>(REGISTRY_URL, {
        timeout: 10000,
      });

      if (Array.isArray(response.data)) {
        return response.data;
      }
      return [];
    } catch (error) {
      console.error("API: Failed to fetch registry", error);
      return [];
    }
  },

  getBestIconUrl: (def: TokenDefinition): string | null => {
    if (def.icons && def.icons.length > 0) {
      const pngIcon = def.icons.find((i) =>
        i.url.toLowerCase().includes(".png")
      );
      if (pngIcon) return pngIcon.url;
      return def.icons[0].url;
    }
    return def.icon || null;
  },
};
