/**
 * Storage Keys Configuration
 *
 * Centralized configuration for all localStorage keys
 * used throughout the Sphere application.
 *
 * All keys use the `sphere_` prefix for:
 * - Easy identification of app-specific data
 * - Bulk cleanup on wallet logout
 * - Avoiding conflicts with other apps
 */

export const STORAGE_KEYS = {
  // Theme preference (light/dark)
  THEME: 'sphere_theme',

  // Tutorial completion flag
  TUTORIAL_COMPLETED: 'sphere_tutorial_completed',

  // Chat UI State
  CHAT_MODE: 'sphere_chat_mode',
  CHAT_SELECTED_GROUP: 'sphere_chat_selected_group',
  CHAT_SELECTED_DM: 'sphere_chat_selected_dm',

  // Agent Chat Sessions
  AGENT_CHAT_SESSIONS: 'sphere_agent_chat_sessions',

  // IPFS
  IPFS_ENABLED: 'sphere_ipfs_enabled',

  // Desktop state (open tabs, active tab)
  DESKTOP_STATE: 'sphere_desktop_state',

  // Dev Settings
  DEV_AGGREGATOR_URL: 'sphere_dev_aggregator_url',
  DEV_SKIP_TRUST_BASE: 'sphere_dev_skip_trust_base',
} as const;

export const STORAGE_KEY_GENERATORS = {
  // Agent memory: `sphere_agent_memory:${userId}:${activityId}`
  agentMemory: (userId: string, activityId: string) =>
    `sphere_agent_memory:${userId}:${activityId}` as const,

  // Agent chat messages per session: `sphere_agent_chat_messages:${sessionId}`
  agentChatMessages: (sessionId: string) =>
    `sphere_agent_chat_messages:${sessionId}` as const,

} as const;

const STORAGE_PREFIX = 'sphere_';

/**
 * Clear all Sphere data from localStorage.
 * Messages are recovered from Nostr relay on next login (self-wrap replay).
 */
export function clearAllSphereData(): void {
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(STORAGE_PREFIX)) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach((key) => localStorage.removeItem(key));
  if (import.meta.env.DEV) console.log(`Cleared ${keysToRemove.length} sphere keys from localStorage`);
}

export type StorageKey = typeof STORAGE_KEYS[keyof typeof STORAGE_KEYS];
