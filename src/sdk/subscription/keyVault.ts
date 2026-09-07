/**
 * Wallet-side bookkeeping of SGW subscription keys (gateway-side, keys are
 * bearer tokens — nothing is address-bound there; see docs/API.md).
 *
 * Model (INDIVIDUAL per address by default; inherit is opt-in):
 * - Each address gets its OWN key by default (its own free plan / quota),
 *   stored in a slot keyed by that address's pubkey. Address index 0's own
 *   key doubles as the "wallet key" (the one another address can inherit).
 * - An address inherits the wallet (index-0) key ONLY when its persisted
 *   preference is 'inherit' — the opt-in the user makes via the prompt's
 *   checkbox, useful when index 0 holds a PAID plan to share.
 * - No own key and no preference ⇒ this address still needs a key: the caller
 *   provisions its own free key silently, EXCEPT when index 0 is on a paid
 *   plan, where a one-time prompt first offers "share the paid plan (inherit)".
 * - The boot cache (localStorage, plaintext, sync) feeds
 *   getActiveOracleApiKey() at provider-build time with whatever key the
 *   resolver/caller picked for the active address.
 *
 * All key values are encrypted at rest (XChaCha20-Poly1305; key derived
 * deterministically from the seed via the index-0 private key, so any
 * restored device can decrypt). Preferences are plain strings (not secret).
 */
import type { Sphere } from '@unicitylabs/sphere-sdk';
import { deriveFieldEncryptionKey, encryptField, decryptField, getPublicKey } from '@unicitylabs/sphere-sdk';
import { STORAGE_KEYS } from '../../config/storageKeys';
import { setStoredSubscriptionKey } from '../../config/subscriptionKeyCache';

export type AddressKeyPreference = 'own' | 'inherit';

export interface ResolvedKey {
  /** The resolved key, or null when the address still needs one provisioned. */
  key: string | null;
  /**
   * 'own'       — the active address's own key (or index-0's wallet key);
   * 'wallet'    — inheriting the index-0 wallet key (preference 'inherit');
   * 'needs-own' — no key yet; the caller must provision this address's own key
   *               (or, if index 0 is paid and `undecided`, prompt first).
   */
  source: 'own' | 'wallet' | 'needs-own';
  /** True only for 'needs-own' with NO recorded preference (paid case may prompt). */
  undecided: boolean;
}

export function scopedSubscriptionSlot(network: string, pubkey: string): string {
  return `${STORAGE_KEYS.SUBSCRIPTION_API_KEY}.${network}.${pubkey}`;
}

function preferenceSlot(network: string, pubkey: string): string {
  return `${STORAGE_KEYS.SUBSCRIPTION_API_KEY}.pref.${network}.${pubkey}`;
}

/**
 * The wallet's subscription identity: the index-0 address keypair — fixed
 * derivation index so neither the wallet slot nor the encryption key changes
 * with the active address.
 */
function rootIdentity(sphere: Sphere): { privateKey: string; pubkey: string } {
  const { privateKey } = sphere.deriveAddress(0);
  return { privateKey, pubkey: getPublicKey(privateKey) };
}

async function readKeySlot(sphere: Sphere, network: string, pubkey: string): Promise<string | null> {
  try {
    const blob = await sphere.getStorage().get(scopedSubscriptionSlot(network, pubkey));
    if (!blob) return null;
    return decryptField(deriveFieldEncryptionKey(rootIdentity(sphere).privateKey), blob);
  } catch {
    // Not initialized / corrupt / foreign blob — caller falls back to
    // re-provisioning or the prompt (idempotent on the gateway).
    return null;
  }
}

async function writeKeySlot(sphere: Sphere, network: string, pubkey: string, apiKey: string): Promise<void> {
  await sphere
    .getStorage()
    .set(scopedSubscriptionSlot(network, pubkey), encryptField(deriveFieldEncryptionKey(rootIdentity(sphere).privateKey), apiKey));
}

/** Persist the WALLET-wide key (root slot) and make it the active oracle key. */
export async function saveWalletKey(sphere: Sphere, network: string, apiKey: string): Promise<void> {
  await writeKeySlot(sphere, network, rootIdentity(sphere).pubkey, apiKey);
  setStoredSubscriptionKey(apiKey); // boot cache for the next provider build
}

/**
 * Persist a key as the ACTIVE address's OWN key (records the 'own'
 * preference) and make it the active oracle key.
 */
export async function saveAddressKey(sphere: Sphere, network: string, apiKey: string): Promise<void> {
  const pubkey = sphere.identity?.chainPubkey;
  if (!pubkey) throw new Error('Wallet identity unavailable');
  await writeKeySlot(sphere, network, pubkey, apiKey);
  await setAddressPreference(sphere, network, 'own');
  setStoredSubscriptionKey(apiKey);
}

export async function setAddressPreference(sphere: Sphere, network: string, pref: AddressKeyPreference): Promise<void> {
  const pubkey = sphere.identity?.chainPubkey;
  if (!pubkey) throw new Error('Wallet identity unavailable');
  await sphere.getStorage().set(preferenceSlot(network, pubkey), pref);
}

async function getAddressPreference(sphere: Sphere, network: string, pubkey: string): Promise<AddressKeyPreference | null> {
  try {
    const v = await sphere.getStorage().get(preferenceSlot(network, pubkey));
    return v === 'own' || v === 'inherit' ? v : null;
  } catch {
    return null;
  }
}

/** The wallet-wide key (root slot), if any. */
export function loadWalletKey(sphere: Sphere, network: string): Promise<string | null> {
  try {
    return readKeySlot(sphere, network, rootIdentity(sphere).pubkey);
  } catch {
    return Promise.resolve(null);
  }
}

/**
 * Picks the key the ACTIVE address should use (INDIVIDUAL by default):
 * - active address IS index 0 → its own key IS the wallet key ('wallet');
 * - address has its own key → it wins ('own');
 * - preference 'inherit' → the wallet key ('wallet');
 * - otherwise → 'needs-own' (the caller provisions this address's own key,
 *   or prompts first when index 0 is paid and no choice was made yet).
 */
export async function resolveActiveKey(sphere: Sphere, network: string): Promise<ResolvedKey> {
  try {
    const root = rootIdentity(sphere);
    const active = sphere.identity?.chainPubkey;

    // Index 0: its own key is the wallet key. null ⇒ needs first-time provision.
    if (!active || active === root.pubkey) {
      const walletKey = await readKeySlot(sphere, network, root.pubkey);
      return { key: walletKey, source: walletKey ? 'wallet' : 'needs-own', undecided: false };
    }

    const own = await readKeySlot(sphere, network, active);
    if (own) return { key: own, source: 'own', undecided: false };

    const pref = await getAddressPreference(sphere, network, active);
    if (pref === 'inherit') {
      const walletKey = await readKeySlot(sphere, network, root.pubkey);
      return { key: walletKey, source: walletKey ? 'wallet' : 'needs-own', undecided: false };
    }

    // Default: this address needs its OWN key. `undecided` iff no preference yet
    // (so the paid-plan case can offer inherit before auto-provisioning).
    return { key: null, source: 'needs-own', undecided: pref === null };
  } catch {
    return { key: null, source: 'needs-own', undecided: false };
  }
}

/**
 * Write a key to the encrypted vault, reporting whether it is DURABLY stored.
 *
 * The distinction is load-bearing for a purchased key: the gateway keeps
 * redelivering a fresh key until the wallet acknowledges receipt, so acking on
 * a failed vault write ends the only recovery path for a key that exists
 * nowhere but this tab's plaintext boot cache (sphere#501). Callers ack and
 * drop the pending-order record only on `true`.
 */
export async function persistKeyDurably(
  sphere: Sphere,
  network: string,
  apiKey: string,
  walletWide: boolean,
): Promise<boolean> {
  try {
    await (walletWide ? saveWalletKey(sphere, network, apiKey) : saveAddressKey(sphere, network, apiKey));
    return true;
  } catch {
    return false;
  }
}
