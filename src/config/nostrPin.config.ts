/**
 * Nostr IPFS Pin Publisher Configuration
 *
 * When enabled, publishes CID announcements to Nostr relays
 * after successful IPFS storage. Pin services subscribed to
 * these relays will automatically pin the announced content.
 */

export const NOSTR_PIN_CONFIG = {
  /** Enable/disable automatic CID publishing to Nostr */
  enabled: true,

  /** NIP-78 app-specific data event kind */
  eventKind: 30078,

  /** Distinguisher tag for IPFS pin requests */
  dTag: "ipfs-pin",

  /** Log publishing activity to console */
  debug: true,
};
