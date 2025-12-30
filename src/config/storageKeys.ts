/**
 * Storage Keys Configuration
 *
 * Centralized configuration for all localStorage and sessionStorage keys
 * used throughout the Sphere application.
 *
 * This file ensures consistency and makes it easy to track, rename,
 * or migrate storage keys across the application.
 */

// ============================================================================
// THEME & UI STATE
// ============================================================================

export const STORAGE_KEYS = {
  // Theme preference (light/dark)
  THEME: 'sphere-theme',

  // Active wallet layer (L1/L3)
  WALLET_ACTIVE_LAYER: 'wallet-active-layer',

  // Welcome screen acceptance flag
  WELCOME_ACCEPTED: 'sphere_welcome_accepted',

  // ============================================================================
  // UNIFIED KEY MANAGER (Core Wallet Keys - Encrypted)
  // ============================================================================

  // AES-256 encrypted BIP39 mnemonic (12 words)
  UNIFIED_WALLET_MNEMONIC: 'unified_wallet_mnemonic',

  // AES-256 encrypted master private key (hex)
  UNIFIED_WALLET_MASTER: 'unified_wallet_master',

  // Chain code for BIP32 derivation
  UNIFIED_WALLET_CHAINCODE: 'unified_wallet_chaincode',

  // Source type: "mnemonic" | "file" | "unknown"
  UNIFIED_WALLET_SOURCE: 'unified_wallet_source',

  // Derivation mode: "bip32" | "legacy_hmac" | "wif_hmac"
  UNIFIED_WALLET_DERIVATION_MODE: 'unified_wallet_derivation_mode',

  // Base BIP32 path (default "m/44'/0'/0'")
  UNIFIED_WALLET_BASE_PATH: 'unified_wallet_base_path',

  // ============================================================================
  // ADDRESS SELECTION
  // ============================================================================

  // BIP32 derivation path for selected L3 address
  L3_SELECTED_ADDRESS_PATH: 'l3_selected_address_path',

  // LEGACY: Selected address index (deprecated, migrating to path-based)
  L3_SELECTED_ADDRESS_INDEX: 'l3_selected_address_index',

  // LEGACY: L3 selected address index (migrated to path-based)
  L3_SELECTED_ADDRESS_INDEX_LEGACY: 'l3_selected_address_index',

  // Legacy encrypted seed storage (for mnemonic)
  ENCRYPTED_SEED: 'encrypted_seed',

  // ============================================================================
  // WALLET DATA
  // ============================================================================

  // Transaction history
  TRANSACTION_HISTORY: 'unicity_transaction_history',

  // LEGACY: Old single-wallet format (being migrated)
  WALLET_DATA_LEGACY: 'unicity_wallet_data',

  // ============================================================================
  // TOKEN OPERATIONS (Outbox)
  // ============================================================================

  // Pending token transfers
  OUTBOX: 'unicity_outbox',

  // Token split groups for pending transfers
  OUTBOX_SPLIT_GROUPS: 'unicity_outbox_split_groups',

  // ============================================================================
  // CHAT (User-to-User)
  // ============================================================================

  // Chat conversations list
  CHAT_CONVERSATIONS: 'unicity_chat_conversations',

  // Chat messages
  CHAT_MESSAGES: 'unicity_chat_messages',

  // ============================================================================
  // AGENT CHAT SESSIONS
  // ============================================================================

  // Agent chat sessions metadata
  AGENT_CHAT_SESSIONS: 'sphere_agent_chat_sessions',

  // Agent chat tombstones (deleted sessions tracking)
  AGENT_CHAT_TOMBSTONES: 'sphere_agent_chat_tombstones',

  // ============================================================================
  // BACKUP & SYNC
  // ============================================================================

  // Token backup timestamp
  TOKEN_BACKUP_TIMESTAMP: 'token_backup_timestamp',

  // Last successful IPFS sync timestamp
  LAST_IPFS_SYNC_SUCCESS: 'last_ipfs_sync_success',

  // Encrypted token backup (AES-256-GCM, Base64)
  ENCRYPTED_TOKEN_BACKUP: 'encrypted_token_backup',

  // ============================================================================
  // REGISTRY CACHE
  // ============================================================================

  // Cached token definitions from registry
  IDS_CACHE: 'unicity_ids_cache',

  // Registry cache timestamp
  IDS_TIMESTAMP: 'unicity_ids_timestamp',

  // Unicity IDs cache (from GitHub)
  UNICITY_IDS_CACHE: 'unicity_ids_cache',

  // Unicity IDs cache timestamp
  UNICITY_IDS_TIMESTAMP: 'unicity_ids_timestamp',

  // ============================================================================
  // NOSTR SERVICE
  // ============================================================================

  // Last Nostr sync timestamp
  NOSTR_LAST_SYNC: 'unicity_nostr_last_sync',

  // Processed Nostr event IDs
  NOSTR_PROCESSED_EVENTS: 'unicity_processed_events',

  // ============================================================================
  // L1 WALLET (Legacy)
  // ============================================================================

  // Main L1 wallet
  WALLET_MAIN: 'wallet_main',
} as const;

// ============================================================================
// DYNAMIC KEY GENERATORS
// For keys that include dynamic parts (like addresses, session IDs, etc.)
// ============================================================================

export const STORAGE_KEY_GENERATORS = {
  // Per-address wallet data: `unicity_wallet_${address}`
  walletByAddress: (address: string) => `unicity_wallet_${address}` as const,

  // L1 wallet by key: `wallet_${key}`
  l1WalletByKey: (key: string) => `wallet_${key}` as const,

  // Agent memory: `unicity_agent_memory:${userId}:${activityId}`
  agentMemory: (userId: string, activityId: string) =>
    `unicity_agent_memory:${userId}:${activityId}` as const,

  // Agent chat messages per session: `sphere_agent_chat_messages:${sessionId}`
  agentChatMessages: (sessionId: string) =>
    `sphere_agent_chat_messages:${sessionId}` as const,

  // IPFS version tracking: `ipfs_version_${ipnsName}`
  ipfsVersion: (ipnsName: string) => `ipfs_version_${ipnsName}` as const,

  // IPFS last CID: `ipfs_last_cid_${ipnsName}`
  ipfsLastCid: (ipnsName: string) => `ipfs_last_cid_${ipnsName}` as const,

  // IPFS pending IPNS: `ipfs_pending_ipns_${ipnsName}`
  ipfsPendingIpns: (ipnsName: string) => `ipfs_pending_ipns_${ipnsName}` as const,

  // IPFS last sequence: `ipfs_last_seq_${ipnsName}`
  ipfsLastSeq: (ipnsName: string) => `ipfs_last_seq_${ipnsName}` as const,

  // IPFS chat version: `ipfs_chat_version_${ipnsName}`
  ipfsChatVersion: (ipnsName: string) => `ipfs_chat_version_${ipnsName}` as const,

  // IPFS chat CID: `ipfs_chat_cid_${ipnsName}`
  ipfsChatCid: (ipnsName: string) => `ipfs_chat_cid_${ipnsName}` as const,

  // IPFS chat sequence: `ipfs_chat_seq_${ipnsName}`
  ipfsChatSeq: (ipnsName: string) => `ipfs_chat_seq_${ipnsName}` as const,
} as const;

// ============================================================================
// KEY PREFIXES
// For identifying groups of keys (useful for cleanup/migration)
// ============================================================================

export const STORAGE_KEY_PREFIXES = {
  // Per-address wallet data prefix
  WALLET_ADDRESS: 'unicity_wallet_',

  // L1 wallet prefix
  L1_WALLET: 'wallet_',

  // Agent memory prefix
  AGENT_MEMORY: 'unicity_agent_memory:',

  // Agent chat messages prefix
  AGENT_CHAT_MESSAGES: 'sphere_agent_chat_messages:',

  // IPFS version prefix
  IPFS_VERSION: 'ipfs_version_',

  // IPFS CID prefix
  IPFS_LAST_CID: 'ipfs_last_cid_',

  // IPFS pending IPNS prefix
  IPFS_PENDING_IPNS: 'ipfs_pending_ipns_',

  // IPFS sequence prefix
  IPFS_LAST_SEQ: 'ipfs_last_seq_',

  // IPNS sequence number prefix
  IPNS_SEQ: 'ipns_seq_',

  // IPFS chat version prefix
  IPFS_CHAT_VERSION: 'ipfs_chat_version_',

  // IPFS chat CID prefix
  IPFS_CHAT_CID: 'ipfs_chat_cid_',

  // IPFS chat sequence prefix
  IPFS_CHAT_SEQ: 'ipfs_chat_seq_',

  // Unified wallet prefix (for cleanup)
  UNIFIED_WALLET: 'unified_wallet_',
} as const;

// Type exports for TypeScript support
export type StorageKey = typeof STORAGE_KEYS[keyof typeof STORAGE_KEYS];
export type StorageKeyPrefix = typeof STORAGE_KEY_PREFIXES[keyof typeof STORAGE_KEY_PREFIXES];
