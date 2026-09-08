import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { STORAGE_KEYS } from '@/config/storageKeys';
import { getStoredSubscriptionKey, setStoredSubscriptionKey } from '@/config/subscriptionKeyCache';

/**
 * The runtime config a deployment needs before mainnet is even selectable: a
 * backend URL for it, per-wallet subscription keys (mainnet refuses the shared
 * build-time aggregator key) and the explicit rollout switch. DEFAULT_NETWORK
 * only accepts a network that clears all three, so a paid-plans test on mainnet
 * has to supply them.
 */
const MAINNET_LIVE = {
  DEFAULT_NETWORK: 'mainnet',
  WALLET_API_URL_MAINNET: 'https://wallet-api.example',
  SUBSCRIPTION_ENABLED: 'true',
  MAINNET_ROLLOUT_ENABLED: 'true',
} as const;

describe('subscription storage key', () => {
  beforeEach(() => localStorage.clear());

  it('uses the sphere_ prefix', () => {
    expect(STORAGE_KEYS.SUBSCRIPTION_API_KEY).toBe('sphere_subscription_api_key');
  });

  it('round-trips the stored key', () => {
    expect(getStoredSubscriptionKey()).toBeNull();
    setStoredSubscriptionKey('key_abc123');
    expect(getStoredSubscriptionKey()).toBe('key_abc123');
  });
});

// The module reads window.__SPHERE_RUNTIME_CONFIG__ at import time (that's
// how the Docker image swaps values per environment without a rebuild), so
// each case resets the module registry and re-imports.
describe('runtime config global (window.__SPHERE_RUNTIME_CONFIG__)', () => {
  type RuntimeWindow = typeof window & {
    __SPHERE_RUNTIME_CONFIG__?: Record<string, string>;
  };

  afterEach(() => {
    delete (window as RuntimeWindow).__SPHERE_RUNTIME_CONFIG__;
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('runtime flag values win over build-time env', async () => {
    // Precedence is what this pins: the runtime config must win over the
    // build-time env for both flags.
    vi.stubEnv('VITE_SUBSCRIPTION_ENABLED', 'false');
    vi.stubEnv('VITE_PAID_PLANS_ENABLED', 'false');
    (window as RuntimeWindow).__SPHERE_RUNTIME_CONFIG__ = {
      // Spread FIRST so the two flags under test are the last word — this case is
      // about precedence, so nothing may quietly overwrite its subject.
      ...MAINNET_LIVE,
      SUBSCRIPTION_ENABLED: 'true',
      PAID_PLANS_ENABLED: 'true',
    };
    vi.resetModules();
    const cfg = await import('@/config/subscription');
    expect(cfg.SUBSCRIPTION_ENABLED).toBe(true);
    expect(cfg.PAID_PLANS_ENABLED).toBe(true);
  });

  it('does not consult the network — the catalogue decides that (reverses #497 item 2)', async () => {
    // #497 item 2 ANDed chargesRealMoney(SPHERE_NETWORK) into this flag so a
    // user who switched to a test network could not pay real money for a key
    // belonging to it. That guard now lives in the DATA instead: the store is
    // per-network (SUBSCRIPTION_API_URL derives from the active network's
    // aggregatorUrl), so a test gateway with no priced plan sells nothing and
    // every purchase surface hides itself on an empty catalogue. The cost of
    // the move is explicit: pricing a plan on a test gateway now makes the
    // wallet sell it.
    vi.stubEnv('VITE_PAID_PLANS_ENABLED', 'true');
    (window as RuntimeWindow).__SPHERE_RUNTIME_CONFIG__ = { PAID_PLANS_ENABLED: 'true' };
    vi.resetModules();
    const cfg = await import('@/config/subscription');
    // Default suite network is testnet2, and the flag no longer cares.
    expect(cfg.PAID_PLANS_ENABLED).toBe(true);
  });

  it('still needs the operator flag — it is the kill switch, not the catalogue', async () => {
    vi.stubEnv('VITE_PAID_PLANS_ENABLED', 'false');
    (window as RuntimeWindow).__SPHERE_RUNTIME_CONFIG__ = { ...MAINNET_LIVE };
    vi.resetModules();
    const cfg = await import('@/config/subscription');
    expect(cfg.PAID_PLANS_ENABLED).toBe(false);
  });

  it('empty runtime values (unset container env) fall back to build-time env', async () => {
    vi.stubEnv('VITE_SUBSCRIPTION_ENABLED', 'true');
    vi.stubEnv('VITE_PAID_PLANS_ENABLED', ''); // pin: ambient env must not leak in
    (window as RuntimeWindow).__SPHERE_RUNTIME_CONFIG__ = {
      SUBSCRIPTION_ENABLED: '',
      PAID_PLANS_ENABLED: '',
    };
    vi.resetModules();
    const cfg = await import('@/config/subscription');
    expect(cfg.SUBSCRIPTION_ENABLED).toBe(true);
    expect(cfg.PAID_PLANS_ENABLED).toBe(false);
  });

  it('only exactly "true" enables the flags', async () => {
    (window as RuntimeWindow).__SPHERE_RUNTIME_CONFIG__ = {
      SUBSCRIPTION_ENABLED: 'TRUE',
      PAID_PLANS_ENABLED: '1',
    };
    vi.resetModules();
    const cfg = await import('@/config/subscription');
    expect(cfg.SUBSCRIPTION_ENABLED).toBe(false);
    expect(cfg.PAID_PLANS_ENABLED).toBe(false);
  });

  it('SUBSCRIPTION_API_URL: VITE override wins, else derives from the SDK network table', async () => {
    vi.stubEnv('VITE_SUBSCRIPTION_API_URL', '/sgw');
    vi.resetModules();
    let cfg = await import('@/config/subscription');
    expect(cfg.SUBSCRIPTION_API_URL).toBe('/sgw');

    vi.stubEnv('VITE_SUBSCRIPTION_API_URL', '');
    vi.resetModules();
    cfg = await import('@/config/subscription');
    const { NETWORKS } = await import('@unicitylabs/sphere-sdk');
    const { SPHERE_NETWORK } = await import('@/config/network');
    expect(cfg.SUBSCRIPTION_API_URL).toBe(NETWORKS[SPHERE_NETWORK].aggregatorUrl);
    expect(cfg.SUBSCRIPTION_API_URL).toMatch(/^https:\/\//);
  });
});
