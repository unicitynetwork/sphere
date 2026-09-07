import { describe, it, expect, beforeEach } from 'vitest';
import { getPublicKey } from '@unicitylabs/sphere-sdk';
import {
  saveWalletKey,
  saveAddressKey,
  loadWalletKey,
  resolveActiveKey,
  setAddressPreference,
  scopedSubscriptionSlot,
  persistKeyDurably,
} from '@/sdk/subscription/keyVault';
import { getStoredSubscriptionKey } from '@/config/subscriptionKeyCache';

const ROOT_PRIV = '1'.repeat(64);
const ROOT_PUBKEY = getPublicKey(ROOT_PRIV);
const ADDR2_PUBKEY = '02' + 'b'.repeat(64);

function fakeSphere(activePubkey: string = ROOT_PUBKEY) {
  const store = new Map<string, string>();
  return {
    deriveAddress: (i: number) => {
      if (i !== 0) throw new Error('fake only derives index 0');
      return { privateKey: ROOT_PRIV };
    },
    identity: { chainPubkey: activePubkey },
    getStorage: () => ({
      get: async (k: string) => store.get(k) ?? null,
      set: async (k: string, v: string) => void store.set(k, v),
      remove: async (k: string) => void store.delete(k),
    }),
    _store: store,
  };
}

describe('keyVault (individual per address by default; inherit is opt-in)', () => {
  beforeEach(() => localStorage.clear());

  it('saveWalletKey writes the encrypted ROOT slot regardless of active address + boot cache', async () => {
    const sphere = fakeSphere(ADDR2_PUBKEY); // active on address 2
    await saveWalletKey(sphere as never, 'testnet2', 'sk_wallet');
    expect(sphere._store.get(scopedSubscriptionSlot('testnet2', ROOT_PUBKEY))).toMatch(/^enc1\./);
    expect(sphere._store.has(scopedSubscriptionSlot('testnet2', ADDR2_PUBKEY))).toBe(false);
    expect(getStoredSubscriptionKey()).toBe('sk_wallet');
    await expect(loadWalletKey(sphere as never, 'testnet2')).resolves.toBe('sk_wallet');
  });

  it('index 0 resolves to its own (wallet) key', async () => {
    const sphere = fakeSphere(ROOT_PUBKEY);
    await saveWalletKey(sphere as never, 'testnet2', 'sk_wallet');
    const resolved = await resolveActiveKey(sphere as never, 'testnet2');
    expect(resolved).toEqual({ key: 'sk_wallet', source: 'wallet', undecided: false });
  });

  it('index 0 with no key yet → needs-own (first-time provision)', async () => {
    const sphere = fakeSphere(ROOT_PUBKEY);
    const resolved = await resolveActiveKey(sphere as never, 'testnet2');
    expect(resolved).toEqual({ key: null, source: 'needs-own', undecided: false });
  });

  it('a fresh non-root address needs its OWN key by default (NOT inherit)', async () => {
    const sphere = fakeSphere(ADDR2_PUBKEY);
    await saveWalletKey(sphere as never, 'testnet2', 'sk_wallet'); // primary exists…
    const resolved = await resolveActiveKey(sphere as never, 'testnet2');
    expect(resolved).toEqual({ key: null, source: 'needs-own', undecided: true }); // …but address 2 does NOT inherit it
  });

  it('saveAddressKey gives the active address its own key (own wins)', async () => {
    const sphere = fakeSphere(ADDR2_PUBKEY);
    await saveAddressKey(sphere as never, 'testnet2', 'sk_own');
    expect(sphere._store.get(scopedSubscriptionSlot('testnet2', ADDR2_PUBKEY))).toMatch(/^enc1\./);
    expect(getStoredSubscriptionKey()).toBe('sk_own');
    const resolved = await resolveActiveKey(sphere as never, 'testnet2');
    expect(resolved).toEqual({ key: 'sk_own', source: 'own', undecided: false });
  });

  it("only a recorded 'inherit' preference makes an address use the wallet key", async () => {
    const sphere = fakeSphere(ADDR2_PUBKEY);
    await saveWalletKey(sphere as never, 'testnet2', 'sk_wallet');
    await setAddressPreference(sphere as never, 'testnet2', 'inherit');
    const resolved = await resolveActiveKey(sphere as never, 'testnet2');
    expect(resolved).toEqual({ key: 'sk_wallet', source: 'wallet', undecided: false });
  });

  it("preference 'own' with a lost slot → needs-own but no longer undecided (re-provision, don't prompt)", async () => {
    const sphere = fakeSphere(ADDR2_PUBKEY);
    await saveWalletKey(sphere as never, 'testnet2', 'sk_wallet');
    await setAddressPreference(sphere as never, 'testnet2', 'own');
    const resolved = await resolveActiveKey(sphere as never, 'testnet2');
    expect(resolved).toEqual({ key: null, source: 'needs-own', undecided: false });
  });

  it('own key WINS over a set inherit preference', async () => {
    const sphere = fakeSphere(ADDR2_PUBKEY);
    await saveWalletKey(sphere as never, 'testnet2', 'sk_wallet');
    await setAddressPreference(sphere as never, 'testnet2', 'inherit');
    await saveAddressKey(sphere as never, 'testnet2', 'sk_own'); // overrides pref back to 'own'
    const resolved = await resolveActiveKey(sphere as never, 'testnet2');
    expect(resolved.key).toBe('sk_own');
    expect(resolved.source).toBe('own');
  });

  it('undecryptable root slot → index 0 reads as needs-own', async () => {
    const sphere = fakeSphere(ROOT_PUBKEY);
    sphere._store.set(scopedSubscriptionSlot('testnet2', ROOT_PUBKEY), 'enc1.garbage');
    await expect(loadWalletKey(sphere as never, 'testnet2')).resolves.toBeNull();
    const resolved = await resolveActiveKey(sphere as never, 'testnet2');
    expect(resolved).toEqual({ key: null, source: 'needs-own', undecided: false });
  });
});

describe('persistKeyDurably (sphere#501: never ack a key the vault refused)', () => {
  beforeEach(() => localStorage.clear());

  it('writes the wallet slot and reports the key durable', async () => {
    const sphere = fakeSphere(ROOT_PUBKEY);
    await expect(persistKeyDurably(sphere as never, 'testnet2', 'sk_bought', true)).resolves.toBe(true);
    expect(sphere._store.get(scopedSubscriptionSlot('testnet2', ROOT_PUBKEY))).toMatch(/^enc1\./);
  });

  it('writes the ACTIVE address slot when the purchase is address-scoped', async () => {
    const sphere = fakeSphere(ADDR2_PUBKEY);
    await expect(persistKeyDurably(sphere as never, 'testnet2', 'sk_bought', false)).resolves.toBe(true);
    expect(sphere._store.get(scopedSubscriptionSlot('testnet2', ADDR2_PUBKEY))).toMatch(/^enc1\./);
  });

  it('reports NOT durable when the vault write fails, without throwing', async () => {
    const sphere = fakeSphere(ROOT_PUBKEY);
    sphere.getStorage = () => ({
      get: async () => null,
      set: async () => { throw new Error('storage blocked'); },
      remove: async () => {},
    });
    // The caller must be able to withhold the delivery ack on this: acking
    // would end the gateway's redelivery of a key nothing durably holds.
    await expect(persistKeyDurably(sphere as never, 'testnet2', 'sk_bought', true)).resolves.toBe(false);
  });
});
