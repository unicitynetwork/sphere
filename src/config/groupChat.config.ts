/**
 * Group Chat Configuration
 *
 * Configuration for NIP-29 group chat functionality using dedicated Zooid relay(s).
 */

/**
 * Parse a comma-separated list of relay URLs from an environment variable.
 * Filters out empty strings and trims whitespace.
 */
function parseRelayUrls(envValue: string | undefined, defaults: string[]): string[] {
  if (!envValue) {
    return defaults;
  }

  const parsed = envValue
    .split(',')
    .map((url) => url.trim())
    .filter((url) => url.length > 0);

  return parsed.length > 0 ? parsed : defaults;
}

/**
 * Default relay URLs for group chat (Zooid with NIP-29 support)
 */
const DEFAULT_GROUP_CHAT_RELAYS = ['ws://localhost:3334'];

export const GROUP_CHAT_CONFIG = {
  /**
   * WebSocket URLs for group chat relays (Zooid with NIP-29 support)
   * Override with VITE_GROUP_CHAT_RELAYS environment variable (comma-separated)
   *
   * Example: VITE_GROUP_CHAT_RELAYS=ws://localhost:3334,wss://groups.example.com
   */
  RELAYS: parseRelayUrls(import.meta.env.VITE_GROUP_CHAT_RELAYS, DEFAULT_GROUP_CHAT_RELAYS),

  /**
   * Default number of messages to fetch when loading a group
   */
  DEFAULT_MESSAGE_LIMIT: 50,

  /**
   * Maximum number of previous message IDs to include in new messages
   * (NIP-29 requires "previous" tags for message ordering)
   */
  MAX_PREVIOUS_TAGS: 3,

  /**
   * Reconnection settings
   */
  RECONNECT_DELAY_MS: 3000,
  MAX_RECONNECT_ATTEMPTS: 5,
} as const;
