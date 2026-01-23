/**
 * Storage Keys Configuration
 *
 * Centralized configuration for all localStorage and sessionStorage keys
 * used throughout the Sphere application.
 *
 * Wallet-related keys are imported from SDK and prefixed with app prefix.
 * App-specific keys (chat, agents, theme) are defined here.
 */

import {
  buildWalletStorageKeys,
  buildWalletKeyGenerators,
  buildWalletKeyPrefixes,
} from '../components/wallet/sdk/browser';

// ============================================================================
// APP PREFIX
// ============================================================================

/**
 * App-specific prefix for all storage keys
 */
export const APP_PREFIX = 'sphere_';

// ============================================================================
// SDK WALLET KEYS (with app prefix)
// ============================================================================

const SDK_WALLET_KEYS = buildWalletStorageKeys(APP_PREFIX);
const SDK_KEY_GENERATORS = buildWalletKeyGenerators(APP_PREFIX);
const SDK_KEY_PREFIXES = buildWalletKeyPrefixes(APP_PREFIX);

// ============================================================================
// STATIC STORAGE KEYS
// ============================================================================

export const STORAGE_KEYS = {
  // ============================================================================
  // THEME & UI STATE (App-specific)
  // ============================================================================

  /** Theme preference (light/dark) */
  THEME: 'sphere_theme',

  /** Active wallet layer (L1/L3) */
  WALLET_ACTIVE_LAYER: 'sphere_wallet_active_layer',

  /** Welcome screen acceptance flag */
  WELCOME_ACCEPTED: 'sphere_welcome_accepted',

  // ============================================================================
  // ONBOARDING & AUTHENTICATION (App-specific)
  // ============================================================================

  /** Flag indicating user has completed onboarding and is authenticated */
  AUTHENTICATED: 'sphere_authenticated',

  /** Flag indicating onboarding is currently in progress (prevents auto-sync) */
  ONBOARDING_IN_PROGRESS: 'sphere_onboarding_in_progress',

  /** Flag indicating onboarding steps are complete (before final auth) */
  ONBOARDING_COMPLETE: 'sphere_onboarding_complete',

  /** Flag indicating address creation is in progress via modal (prevents auto-sync) */
  ADDRESS_CREATION_IN_PROGRESS: 'sphere_address_creation_in_progress',

  // ============================================================================
  // UNIFIED KEY MANAGER (from SDK)
  // ============================================================================

  /** AES-256 encrypted BIP39 mnemonic (12 words) */
  UNIFIED_WALLET_MNEMONIC: SDK_WALLET_KEYS.MNEMONIC,

  /** AES-256 encrypted master private key (hex) */
  UNIFIED_WALLET_MASTER: SDK_WALLET_KEYS.MASTER_KEY,

  /** Chain code for BIP32 derivation */
  UNIFIED_WALLET_CHAINCODE: SDK_WALLET_KEYS.CHAIN_CODE,

  /** Source type: "mnemonic" | "file" | "unknown" */
  UNIFIED_WALLET_SOURCE: SDK_WALLET_KEYS.SOURCE,

  /** Derivation mode: "bip32" | "legacy_hmac" | "wif_hmac" */
  UNIFIED_WALLET_DERIVATION_MODE: SDK_WALLET_KEYS.DERIVATION_MODE,

  /** Base BIP32 path (default "m/44'/0'/0'") */
  UNIFIED_WALLET_BASE_PATH: SDK_WALLET_KEYS.BASE_PATH,

  // ============================================================================
  // ADDRESS SELECTION (from SDK)
  // ============================================================================

  /** BIP32 derivation path for selected L3 address */
  L3_SELECTED_ADDRESS_PATH: SDK_WALLET_KEYS.SELECTED_ADDRESS_PATH,

  /** LEGACY: L3 selected address index (migrated to path-based) */
  L3_SELECTED_ADDRESS_INDEX_LEGACY: 'sphere_l3_selected_address_index',

  /** Legacy encrypted seed storage (for mnemonic) */
  ENCRYPTED_SEED: SDK_WALLET_KEYS.ENCRYPTED_SEED,

  // ============================================================================
  // WALLET DATA (from SDK)
  // ============================================================================

  /** Transaction history */
  TRANSACTION_HISTORY: SDK_WALLET_KEYS.TRANSACTION_HISTORY,

  /** LEGACY: Old single-wallet format (being migrated) */
  WALLET_DATA_LEGACY: 'sphere_wallet_data',

  /** Main L1 wallet */
  WALLET_MAIN: SDK_WALLET_KEYS.L1_WALLET_MAIN,

  // ============================================================================
  // TOKEN OPERATIONS (from SDK)
  // ============================================================================

  /** Pending token transfers */
  OUTBOX: SDK_WALLET_KEYS.OUTBOX,

  /** Token split groups for pending transfers */
  OUTBOX_SPLIT_GROUPS: SDK_WALLET_KEYS.OUTBOX_SPLIT_GROUPS,

  // ============================================================================
  // CHAT (User-to-User DMs)
  // ============================================================================

  /** Chat conversations list */
  CHAT_CONVERSATIONS: 'sphere_chat_conversations',

  /** Chat messages */
  CHAT_MESSAGES: 'sphere_chat_messages',

  // ============================================================================
  // GROUP CHAT (NIP-29)
  // ============================================================================

  /** Joined groups list */
  GROUP_CHAT_GROUPS: 'sphere_group_chat_groups',

  /** Group messages */
  GROUP_CHAT_MESSAGES: 'sphere_group_chat_messages',

  /** Group members cache */
  GROUP_CHAT_MEMBERS: 'sphere_group_chat_members',

  /** Group chat relay URL */
  GROUP_CHAT_RELAY_URL: 'sphere_group_chat_relay_url',

  /** Processed group event IDs (for deduplication) */
  GROUP_CHAT_PROCESSED_EVENTS: 'sphere_group_chat_processed_events',

  // ============================================================================
  // AGENT CHAT SESSIONS
  // ============================================================================

  /** Agent chat sessions metadata */
  AGENT_CHAT_SESSIONS: 'sphere_agent_chat_sessions',

  /** Agent chat tombstones (deleted sessions tracking) */
  AGENT_CHAT_TOMBSTONES: 'sphere_agent_chat_tombstones',

  // ============================================================================
  // BACKUP & SYNC (from SDK)
  // ============================================================================

  /** Token backup timestamp */
  TOKEN_BACKUP_TIMESTAMP: SDK_WALLET_KEYS.TOKEN_BACKUP_TIMESTAMP,

  /** Spent token state cache (persisted SPENT results) */
  SPENT_TOKEN_CACHE: 'sphere_spent_token_cache',

  /** Last successful IPFS sync timestamp */
  LAST_IPFS_SYNC_SUCCESS: SDK_WALLET_KEYS.LAST_IPFS_SYNC,

  /** Encrypted token backup (AES-256-GCM, Base64) */
  ENCRYPTED_TOKEN_BACKUP: SDK_WALLET_KEYS.ENCRYPTED_TOKEN_BACKUP,

  // ============================================================================
  // REGISTRY CACHE (App-specific)
  // ============================================================================

  /** Unicity IDs cache (from GitHub) */
  UNICITY_IDS_CACHE: 'sphere_unicity_ids_cache',

  /** Unicity IDs cache timestamp */
  UNICITY_IDS_TIMESTAMP: 'sphere_unicity_ids_timestamp',

  // ============================================================================
  // NOSTR SERVICE (from SDK)
  // ============================================================================

  /** Last Nostr sync timestamp */
  NOSTR_LAST_SYNC: SDK_WALLET_KEYS.NOSTR_LAST_SYNC,

  /** Processed Nostr event IDs */
  NOSTR_PROCESSED_EVENTS: SDK_WALLET_KEYS.NOSTR_PROCESSED_EVENTS,

  // ============================================================================
  // DEV SETTINGS
  // ============================================================================

  /** Custom aggregator URL (dev mode) */
  DEV_AGGREGATOR_URL: 'sphere_dev_aggregator_url',

  /** Trust base verification skip flag (dev mode) */
  DEV_SKIP_TRUST_BASE: 'sphere_dev_skip_trust_base',
} as const;

// ============================================================================
// DYNAMIC KEY GENERATORS
// ============================================================================

export const STORAGE_KEY_GENERATORS = {
  // From SDK
  walletByAddress: SDK_KEY_GENERATORS.walletByAddress,
  l1WalletByKey: SDK_KEY_GENERATORS.l1WalletByKey,
  ipfsVersion: SDK_KEY_GENERATORS.ipfsVersion,
  ipfsLastCid: SDK_KEY_GENERATORS.ipfsLastCid,
  ipfsPendingIpns: SDK_KEY_GENERATORS.ipfsPendingIpns,
  ipfsLastSeq: SDK_KEY_GENERATORS.ipfsLastSeq,

  // App-specific generators
  agentMemory: (userId: string, activityId: string) =>
    `sphere_agent_memory:${userId}:${activityId}` as const,

  agentChatMessages: (sessionId: string) =>
    `sphere_agent_chat_messages:${sessionId}` as const,

  ipfsChatVersion: (ipnsName: string) => `sphere_ipfs_chat_version_${ipnsName}` as const,
  ipfsChatCid: (ipnsName: string) => `sphere_ipfs_chat_cid_${ipnsName}` as const,
  ipfsChatSeq: (ipnsName: string) => `sphere_ipfs_chat_seq_${ipnsName}` as const,
} as const;

// ============================================================================
// KEY PREFIXES
// ============================================================================

export const STORAGE_KEY_PREFIXES = {
  // Main app prefix
  APP: APP_PREFIX,

  // From SDK
  WALLET_ADDRESS: SDK_KEY_PREFIXES.WALLET_ADDRESS,
  L1_WALLET: SDK_KEY_PREFIXES.L1_WALLET,
  IPFS_VERSION: SDK_KEY_PREFIXES.IPFS_VERSION,
  IPFS_LAST_CID: SDK_KEY_PREFIXES.IPFS_LAST_CID,
  IPFS_PENDING_IPNS: SDK_KEY_PREFIXES.IPFS_PENDING_IPNS,
  IPFS_LAST_SEQ: SDK_KEY_PREFIXES.IPFS_LAST_SEQ,
  IPNS_SEQ: SDK_KEY_PREFIXES.IPNS_SEQ,

  // App-specific prefixes
  AGENT_MEMORY: 'sphere_agent_memory:',
  AGENT_CHAT_MESSAGES: 'sphere_agent_chat_messages:',
  IPFS_CHAT_VERSION: 'sphere_ipfs_chat_version_',
  IPFS_CHAT_CID: 'sphere_ipfs_chat_cid_',
  IPFS_CHAT_SEQ: 'sphere_ipfs_chat_seq_',
} as const;

// ============================================================================
// CLEANUP UTILITY
// ============================================================================

/**
 * Clear all Sphere app data from localStorage.
 *
 * @param fullCleanup - If true (default), deletes ALL sphere_* keys (use for logout).
 *                      If false, preserves onboarding flags (use during wallet create/import in onboarding).
 */
export function clearAllSphereData(fullCleanup: boolean = true): void {
  const keysToRemove: string[] = [];

  const preserveKeys: Set<string> = fullCleanup
    ? new Set<string>()
    : new Set([
        STORAGE_KEYS.ONBOARDING_IN_PROGRESS,
        STORAGE_KEYS.ONBOARDING_COMPLETE,
        STORAGE_KEYS.WELCOME_ACCEPTED,
      ]);

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(STORAGE_KEY_PREFIXES.APP) && !preserveKeys.has(key)) {
      keysToRemove.push(key);
    }
  }

  keysToRemove.forEach(key => localStorage.removeItem(key));

  console.log(`🧹 Cleared ${keysToRemove.length} sphere_* keys from localStorage${fullCleanup ? '' : ' (preserved onboarding flags)'}`);
}

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type StorageKey = typeof STORAGE_KEYS[keyof typeof STORAGE_KEYS];
export type StorageKeyPrefix = typeof STORAGE_KEY_PREFIXES[keyof typeof STORAGE_KEY_PREFIXES];
