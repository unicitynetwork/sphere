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


  // Desktop state (open tabs, active tab)
  DESKTOP_STATE: 'sphere_desktop_state',

  // Connected Sites (approved dApp origins)
  CONNECTED_SITES: 'sphere_connected_sites',

  // Dev Settings
  DEV_AGGREGATOR_URL: 'sphere_dev_aggregator_url',
  DEV_SKIP_TRUST_BASE: 'sphere_dev_skip_trust_base',

  // wallet-api device label — one session row per (owner, device) on the
  // backend; the SDK stores the refresh token under it (ARCHITECTURE §4).
  WALLET_API_DEVICE_ID: 'sphere_wallet_api_device_id',

  // Per-wallet aggregator subscription API key (cached; also recoverable
  // from identity via the SGW /auth flow). Cleared on wallet deletion.
  SUBSCRIPTION_API_KEY: 'sphere_subscription_api_key',

  // Active network choice (runtime network switcher). Read ONCE at module
  // load by src/config/network.ts; written by setActiveNetwork(), which then
  // reloads the page. Carries the sphere_ prefix on purpose: wallet deletion
  // (clearAllSphereData) also resets the network choice to the build default.
  ACTIVE_NETWORK: 'sphere_active_network',

  // Set once the user has been told mainnet is live — whether they switched or
  // declined. The announcement is an invitation, so it must never nag.
  MAINNET_ANNOUNCED: 'sphere_mainnet_announced',

  // Idle auto-lock timeout, encrypted at rest with the wallet password
  // (encodeLockSettings/decodeLockSettings — src/sdk/walletLock/lockSettings.ts)
  // so cold-storage tampering can't silently disable/shorten it. Written by
  // the Settings "Security" section (#449, separate task); absent means the
  // secure default (DEFAULT_AUTO_LOCK_MINUTES).
  AUTO_LOCK_TIMEOUT: 'sphere_auto_lock_timeout',

  // Opaque per-browser id for page-view telemetry (services/telemetry.ts).
  // Random, or adopted from the `_ga` cookie the removed Google tag left behind —
  // never derived from the wallet identity, which is non-resettable and
  // deanonymising against a public ledger. Carries the `sphere_` prefix so wallet
  // deletion resets the analytics identity too.
  TELEMETRY_CLIENT_ID: 'sphere_telemetry_client_id',

  // Timestamp of the most recent wallet lock, in any tab. Read on mount /
  // pageshow / visibilitychange so a tab that never re-runs initialize() — a
  // bfcache restore, or a hidden tab that missed the lock BroadcastChannel
  // message — cannot come back holding a decrypted Sphere. Carries no secret,
  // only a timestamp (graceful lock §8.4).
  LOCK_EPOCH: 'sphere_lock_epoch',
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

/**
 * Stable per-device label for the wallet-api session (ARCHITECTURE §4: one
 * session row per (owner, device); the refresh token is stored under it).
 * Persisted so reloads reuse the session instead of forcing a fresh
 * challenge sign-in and a new server session row per page load.
 *
 * The key carries the `sphere_` prefix, so `clearAllSphereData()` (wallet
 * deletion) resets the device identity together with everything else.
 */
export function getOrCreateWalletApiDeviceId(): string {
  const existing = localStorage.getItem(STORAGE_KEYS.WALLET_API_DEVICE_ID);
  if (existing) return existing;
  const deviceId = `sphere-web-${crypto.randomUUID()}`;
  localStorage.setItem(STORAGE_KEYS.WALLET_API_DEVICE_ID, deviceId);
  return deviceId;
}

// The network-switch marker lives in sessionStorage (src/config/network.ts,
// NETWORK_SWITCH_MARKER) and is deliberately NOT listed here: this file's sweep
// walks localStorage only, and that marker must die with the tab anyway.

// The subscription boot cache is scoped per network and therefore lives in
// src/config/subscriptionKeyCache.ts — this module is the leaf that
// src/config/network.ts imports, so it cannot know the active network.
