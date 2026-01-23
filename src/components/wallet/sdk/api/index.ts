/**
 * API Services - platform-independent
 */

// Types
export type {
  CryptoPriceData,
  PriceMap,
  TokenDefinition,
  HttpClient,
  HttpResponse,
  HttpRequestOptions,
  CoinGeckoResponse,
  ApiServiceConfig,
} from './types';

// HTTP Client
export {
  createFetchHttpClient,
  createAxiosHttpClient,
  getDefaultHttpClient,
  setDefaultHttpClient,
} from './http-client';

// Price API
export {
  COINGECKO_API_URL,
  DEFAULT_PRICES,
  fetchPrices,
  getPrice,
  calculateUsdValue,
  formatPrice,
} from './prices';

// Registry API
export {
  UNICITY_REGISTRY_URL,
  fetchRegistry,
  getBestIconUrl,
  findTokenByCoinId,
  findTokenBySymbol,
  filterByNetwork,
  filterByAssetKind,
} from './registry';
