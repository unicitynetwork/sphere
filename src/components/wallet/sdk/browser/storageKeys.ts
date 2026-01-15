/**
 * SDK Storage Keys
 *
 * Storage key constants for wallet data.
 * These are the keys used by the SDK for localStorage/IndexedDB.
 *
 * Apps using this SDK can customize the prefix via configuration.
 */

// ============================================================================
// DEFAULT PREFIX
// ============================================================================

/**
 * Default storage key prefix.
 * Can be overridden via SDK configuration.
 */
export const DEFAULT_STORAGE_PREFIX = 'sphere_';

// ============================================================================
// WALLET STORAGE KEYS
// ============================================================================

/**
 * Static storage keys for wallet data
 */
export const WALLET_STORAGE_KEYS = {
  // ============================================================================
  // UNIFIED KEY MANAGER (Core Wallet Keys - Encrypted)
  // ============================================================================

  /** AES-256 encrypted BIP39 mnemonic (12 words) */
  MNEMONIC: 'wallet_mnemonic',

  /** AES-256 encrypted master private key (hex) */
  MASTER_KEY: 'wallet_master',

  /** Chain code for BIP32 derivation */
  CHAIN_CODE: 'wallet_chaincode',

  /** Source type: "mnemonic" | "file" | "unknown" */
  SOURCE: 'wallet_source',

  /** Derivation mode: "bip32" | "legacy_hmac" | "wif_hmac" */
  DERIVATION_MODE: 'wallet_derivation_mode',

  /** Base BIP32 path (default "m/44'/0'/0'") */
  BASE_PATH: 'wallet_base_path',

  // ============================================================================
  // ADDRESS SELECTION
  // ============================================================================

  /** BIP32 derivation path for selected address */
  SELECTED_ADDRESS_PATH: 'selected_address_path',

  /** Legacy encrypted seed storage (for mnemonic) */
  ENCRYPTED_SEED: 'encrypted_seed',

  // ============================================================================
  // L1 WALLET DATA
  // ============================================================================

  /** Main L1 wallet */
  L1_WALLET_MAIN: 'l1_wallet_main',

  /** Transaction history */
  TRANSACTION_HISTORY: 'transaction_history',

  // ============================================================================
  // L3 TOKEN OPERATIONS
  // ============================================================================

  /** Pending token transfers (outbox) */
  OUTBOX: 'outbox',

  /** Token split groups for pending transfers */
  OUTBOX_SPLIT_GROUPS: 'outbox_split_groups',

  // ============================================================================
  // BACKUP & SYNC
  // ============================================================================

  /** Token backup timestamp */
  TOKEN_BACKUP_TIMESTAMP: 'token_backup_timestamp',

  /** Last successful IPFS sync timestamp */
  LAST_IPFS_SYNC: 'last_ipfs_sync',

  /** Encrypted token backup (AES-256-GCM, Base64) */
  ENCRYPTED_TOKEN_BACKUP: 'encrypted_token_backup',

  // ============================================================================
  // NOSTR SERVICE
  // ============================================================================

  /** Last Nostr sync timestamp */
  NOSTR_LAST_SYNC: 'nostr_last_sync',

  /** Processed Nostr event IDs */
  NOSTR_PROCESSED_EVENTS: 'nostr_processed_events',
} as const;

// ============================================================================
// DYNAMIC KEY GENERATORS
// ============================================================================

/**
 * Dynamic key generators for wallet-related storage
 */
export const WALLET_KEY_GENERATORS = {
  /** Per-address wallet data: `wallet_${address}` */
  walletByAddress: (address: string) => `wallet_${address}` as const,

  /** L1 wallet by key: `l1_wallet_${key}` */
  l1WalletByKey: (key: string) => `l1_wallet_${key}` as const,

  /** IPFS version tracking: `ipfs_version_${ipnsName}` */
  ipfsVersion: (ipnsName: string) => `ipfs_version_${ipnsName}` as const,

  /** IPFS last CID: `ipfs_last_cid_${ipnsName}` */
  ipfsLastCid: (ipnsName: string) => `ipfs_last_cid_${ipnsName}` as const,

  /** IPFS pending IPNS: `ipfs_pending_ipns_${ipnsName}` */
  ipfsPendingIpns: (ipnsName: string) => `ipfs_pending_ipns_${ipnsName}` as const,

  /** IPFS last sequence: `ipfs_last_seq_${ipnsName}` */
  ipfsLastSeq: (ipnsName: string) => `ipfs_last_seq_${ipnsName}` as const,
} as const;

// ============================================================================
// KEY PREFIXES
// ============================================================================

/**
 * Key prefixes for wallet-related storage
 */
export const WALLET_KEY_PREFIXES = {
  /** Per-address wallet data prefix */
  WALLET_ADDRESS: 'wallet_',

  /** L1 wallet prefix */
  L1_WALLET: 'l1_wallet_',

  /** IPFS version prefix */
  IPFS_VERSION: 'ipfs_version_',

  /** IPFS CID prefix */
  IPFS_LAST_CID: 'ipfs_last_cid_',

  /** IPFS pending IPNS prefix */
  IPFS_PENDING_IPNS: 'ipfs_pending_ipns_',

  /** IPFS sequence prefix */
  IPFS_LAST_SEQ: 'ipfs_last_seq_',

  /** IPNS sequence number prefix */
  IPNS_SEQ: 'ipns_seq_',
} as const;

// ============================================================================
// STORAGE KEY BUILDER
// ============================================================================

/**
 * Build full storage key with prefix
 */
export function buildStorageKey(key: string, prefix: string = DEFAULT_STORAGE_PREFIX): string {
  return `${prefix}${key}`;
}

/**
 * Build all wallet storage keys with a custom prefix
 */
export function buildWalletStorageKeys(prefix: string = DEFAULT_STORAGE_PREFIX) {
  const keys: Record<string, string> = {};
  for (const [name, key] of Object.entries(WALLET_STORAGE_KEYS)) {
    keys[name] = buildStorageKey(key, prefix);
  }
  return keys as { [K in keyof typeof WALLET_STORAGE_KEYS]: string };
}

/**
 * Build wallet key generators with a custom prefix
 */
export function buildWalletKeyGenerators(prefix: string = DEFAULT_STORAGE_PREFIX) {
  return {
    walletByAddress: (address: string) => buildStorageKey(WALLET_KEY_GENERATORS.walletByAddress(address), prefix),
    l1WalletByKey: (key: string) => buildStorageKey(WALLET_KEY_GENERATORS.l1WalletByKey(key), prefix),
    ipfsVersion: (ipnsName: string) => buildStorageKey(WALLET_KEY_GENERATORS.ipfsVersion(ipnsName), prefix),
    ipfsLastCid: (ipnsName: string) => buildStorageKey(WALLET_KEY_GENERATORS.ipfsLastCid(ipnsName), prefix),
    ipfsPendingIpns: (ipnsName: string) => buildStorageKey(WALLET_KEY_GENERATORS.ipfsPendingIpns(ipnsName), prefix),
    ipfsLastSeq: (ipnsName: string) => buildStorageKey(WALLET_KEY_GENERATORS.ipfsLastSeq(ipnsName), prefix),
  };
}

/**
 * Build wallet key prefixes with a custom prefix
 */
export function buildWalletKeyPrefixes(prefix: string = DEFAULT_STORAGE_PREFIX) {
  const prefixes: Record<string, string> = {};
  for (const [name, keyPrefix] of Object.entries(WALLET_KEY_PREFIXES)) {
    prefixes[name] = `${prefix}${keyPrefix}`;
  }
  return prefixes as { [K in keyof typeof WALLET_KEY_PREFIXES]: string };
}

// ============================================================================
// VESTING CACHE (IndexedDB)
// ============================================================================

/**
 * IndexedDB database names for SDK
 */
export const INDEXEDDB_NAMES = {
  /** Vesting classification cache */
  VESTING_CACHE: 'unicity-vesting-cache',
} as const;

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type WalletStorageKey = typeof WALLET_STORAGE_KEYS[keyof typeof WALLET_STORAGE_KEYS];
export type WalletKeyPrefix = typeof WALLET_KEY_PREFIXES[keyof typeof WALLET_KEY_PREFIXES];
