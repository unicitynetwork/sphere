/**
 * Nostr Configuration
 *
 * Configuration for Nostr relay connections used for DMs and token transfers.
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
 * Default relay URLs for DMs and token transfers
 */
const DEFAULT_NOSTR_RELAYS = ['wss://nostr-relay.testnet.unicity.network'];

export const NOSTR_CONFIG = {
  /**
   * WebSocket URLs for Nostr relays (DMs, token transfers, payment requests)
   * Override with VITE_NOSTR_RELAYS environment variable (comma-separated)
   *
   * Example: VITE_NOSTR_RELAYS=wss://relay1.example.com,wss://relay2.example.com
   */
  RELAYS: parseRelayUrls(import.meta.env.VITE_NOSTR_RELAYS, DEFAULT_NOSTR_RELAYS),

  /**
   * Maximum number of processed event IDs to store (for deduplication)
   */
  MAX_PROCESSED_EVENTS: 100,
} as const;
