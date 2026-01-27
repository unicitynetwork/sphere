/**
 * TanStack Query Keys Configuration
 *
 * Centralized query keys for all TanStack Query operations.
 * Use these keys when defining queries or invalidating them from services.
 */

export const QUERY_KEYS = {
  // Wallet identity and authentication
  IDENTITY: ['wallet', 'identity'],
  NAMETAG: ['wallet', 'nametag'],

  // Token data
  TOKENS: ['wallet', 'tokens'],
  AGGREGATED: ['wallet', 'aggregated'],
  TRANSACTION_HISTORY: ['wallet', 'transaction-history'],

  // Market data
  PRICES: ['market', 'prices'],
  REGISTRY: ['market', 'registry'],

  // L1 wallet
  L1_WALLET: ['l1', 'wallet'],
  L1_BALANCE: ['l1', 'balance'],
  L1_VESTING: ['l1', 'vesting'],
} as const;
