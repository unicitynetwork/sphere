/**
 * Storage Keys Configuration
 *
 * Centralized configuration for all localStorage and sessionStorage keys
 * used throughout the Sphere application.
 *
 * All keys use the `sphere_` prefix for:
 * - Easy identification of app-specific data
 * - Bulk cleanup on wallet logout
 * - Avoiding conflicts with other apps
 */

// ============================================================================
// STATIC STORAGE KEYS
// ============================================================================

export const STORAGE_KEYS = {
  // ============================================================================
  // THEME & UI STATE
  // ============================================================================

  // Theme preference (light/dark)
  THEME: 'sphere_theme',

  // Active wallet layer (L1/L3)
  WALLET_ACTIVE_LAYER: 'sphere_wallet_active_layer',

  // Welcome screen acceptance flag
  WELCOME_ACCEPTED: 'sphere_welcome_accepted',

  // ============================================================================
  // ONBOARDING & AUTHENTICATION
  // ============================================================================

  // Flag indicating user has completed onboarding and is authenticated
  AUTHENTICATED: 'sphere_authenticated',

  // Flag indicating onboarding is currently in progress (prevents auto-sync)
  ONBOARDING_IN_PROGRESS: 'sphere_onboarding_in_progress',

  // Flag indicating onboarding steps are complete (before final auth)
  ONBOARDING_COMPLETE: 'sphere_onboarding_complete',

  // Flag indicating address creation is in progress via modal (prevents auto-sync)
  ADDRESS_CREATION_IN_PROGRESS: 'sphere_address_creation_in_progress',

  // ============================================================================
  // UNIFIED KEY MANAGER (Core Wallet Keys - Encrypted)
  // ============================================================================

  // AES-256 encrypted BIP39 mnemonic (12 words)
  UNIFIED_WALLET_MNEMONIC: 'sphere_wallet_mnemonic',

  // AES-256 encrypted master private key (hex)
  UNIFIED_WALLET_MASTER: 'sphere_wallet_master',

  // Chain code for BIP32 derivation
  UNIFIED_WALLET_CHAINCODE: 'sphere_wallet_chaincode',

  // Source type: "mnemonic" | "file" | "unknown"
  UNIFIED_WALLET_SOURCE: 'sphere_wallet_source',

  // Derivation mode: "bip32" | "legacy_hmac" | "wif_hmac"
  UNIFIED_WALLET_DERIVATION_MODE: 'sphere_wallet_derivation_mode',

  // Base BIP32 path (default "m/44'/0'/0'")
  UNIFIED_WALLET_BASE_PATH: 'sphere_wallet_base_path',

  // ============================================================================
  // ADDRESS SELECTION
  // ============================================================================

  // BIP32 derivation path for selected L3 address
  L3_SELECTED_ADDRESS_PATH: 'sphere_l3_selected_address_path',

  // LEGACY: L3 selected address index (migrated to path-based)
  L3_SELECTED_ADDRESS_INDEX_LEGACY: 'sphere_l3_selected_address_index',

  // Legacy encrypted seed storage (for mnemonic)
  ENCRYPTED_SEED: 'sphere_encrypted_seed',

  // ============================================================================
  // WALLET DATA
  // ============================================================================

  // Transaction history
  TRANSACTION_HISTORY: 'sphere_transaction_history',

  // LEGACY: Old single-wallet format (being migrated)
  WALLET_DATA_LEGACY: 'sphere_wallet_data',

  // Main L1 wallet
  WALLET_MAIN: 'sphere_wallet_main',

  // ============================================================================
  // CHAT (User-to-User DMs)
  // ============================================================================

  // Chat conversations list
  CHAT_CONVERSATIONS: 'sphere_chat_conversations',

  // Chat messages
  CHAT_MESSAGES: 'sphere_chat_messages',

  // ============================================================================
  // GROUP CHAT (NIP-29)
  // ============================================================================

  // Joined groups list
  GROUP_CHAT_GROUPS: 'sphere_group_chat_groups',

  // Group messages
  GROUP_CHAT_MESSAGES: 'sphere_group_chat_messages',

  // Group members cache
  GROUP_CHAT_MEMBERS: 'sphere_group_chat_members',

  // Group chat relay URL
  GROUP_CHAT_RELAY_URL: 'sphere_group_chat_relay_url',

  // Processed group event IDs (for deduplication)
  GROUP_CHAT_PROCESSED_EVENTS: 'sphere_group_chat_processed_events',

  // ============================================================================
  // CHAT UI STATE (Persistence across navigation)
  // ============================================================================

  // Chat mode (global/dm)
  CHAT_MODE: 'sphere_chat_mode',

  // Selected group ID (when in global mode)
  CHAT_SELECTED_GROUP: 'sphere_chat_selected_group',

  // Selected DM conversation pubkey (when in dm mode)
  CHAT_SELECTED_DM: 'sphere_chat_selected_dm',

  // ============================================================================
  // AGENT CHAT SESSIONS
  // ============================================================================

  // Agent chat sessions metadata
  AGENT_CHAT_SESSIONS: 'sphere_agent_chat_sessions',

  // Agent chat tombstones (deleted sessions tracking)
  AGENT_CHAT_TOMBSTONES: 'sphere_agent_chat_tombstones',

  // ============================================================================
  // DEV SETTINGS
  // ============================================================================

  // Custom aggregator URL (dev mode)
  DEV_AGGREGATOR_URL: 'sphere_dev_aggregator_url',

  // Trust base verification skip flag (dev mode)
  DEV_SKIP_TRUST_BASE: 'sphere_dev_skip_trust_base',
} as const;

// ============================================================================
// DYNAMIC KEY GENERATORS
// For keys that include dynamic parts (like addresses, session IDs, etc.)
// ============================================================================

export const STORAGE_KEY_GENERATORS = {
  // Per-address wallet data: `sphere_wallet_${address}`
  walletByAddress: (address: string) => `sphere_wallet_${address}` as const,

  // L1 wallet by key: `sphere_l1_wallet_${key}`
  l1WalletByKey: (key: string) => `sphere_l1_wallet_${key}` as const,

  // Agent memory: `sphere_agent_memory:${userId}:${activityId}`
  agentMemory: (userId: string, activityId: string) =>
    `sphere_agent_memory:${userId}:${activityId}` as const,

  // Agent chat messages per session: `sphere_agent_chat_messages:${sessionId}`
  agentChatMessages: (sessionId: string) =>
    `sphere_agent_chat_messages:${sessionId}` as const,

} as const;

// ============================================================================
// KEY PREFIXES
// For identifying groups of keys (useful for cleanup/migration)
// ============================================================================

export const STORAGE_KEY_PREFIXES = {
  // Main app prefix - ALL sphere keys start with this
  APP: 'sphere_',

  // Per-address wallet data prefix
  WALLET_ADDRESS: 'sphere_wallet_',

  // L1 wallet prefix
  L1_WALLET: 'sphere_l1_wallet_',

  // Agent memory prefix
  AGENT_MEMORY: 'sphere_agent_memory:',

  // Agent chat messages prefix
  AGENT_CHAT_MESSAGES: 'sphere_agent_chat_messages:',

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
        STORAGE_KEYS.AUTHENTICATED,
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
