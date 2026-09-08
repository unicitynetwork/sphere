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

  /**
   * The deployment matrix this flag exists to express, split by the KIND of
   * money rather than by network id:
   *
   *            | test money | real money
   *   Staging  |   sells    |   sells
   *   Prod     |   hides    |   sells
   *
   * The catalogue cannot express it: SUBSCRIPTION_API_URL derives from
   * NETWORKS[network].aggregatorUrl, so a prod build and a staging build on the
   * same test network talk to the SAME gateway and see the same plans. Only the
   * deployment knows which of the two it is.
   */
  it('prod hides paid plans where the money is play money', async () => {
    // Prod says only the deployment-wide flag, which speaks for real money.
    vi.stubEnv('VITE_PAID_PLANS_ENABLED', 'true');
    (window as RuntimeWindow).__SPHERE_RUNTIME_CONFIG__ = { PAID_PLANS_ENABLED: 'true' };
    vi.resetModules();
    const cfg = await import('@/config/subscription');
    expect(cfg.PAID_PLANS_ENABLED).toBe(false); // suite network is testnet2
  });

  it('prod sells on mainnet, saying nothing new', async () => {
    vi.stubEnv('VITE_PAID_PLANS_ENABLED', 'true');
    (window as RuntimeWindow).__SPHERE_RUNTIME_CONFIG__ = { ...MAINNET_LIVE, PAID_PLANS_ENABLED: 'true' };
    vi.resetModules();
    const cfg = await import('@/config/subscription');
    expect(cfg.PAID_PLANS_ENABLED).toBe(true);
  });

  it('staging sells on a test network, because it opted in', async () => {
    (window as RuntimeWindow).__SPHERE_RUNTIME_CONFIG__ = { PAID_PLANS_ON_TEST_NETWORKS: 'true' };
    vi.resetModules();
    const cfg = await import('@/config/subscription');
    expect(cfg.PAID_PLANS_ENABLED).toBe(true);
  });

  it('the two flags do not stand in for each other', async () => {
    // The deployment-wide flag must not open a test network...
    vi.stubEnv('VITE_PAID_PLANS_ENABLED', 'true');
    (window as RuntimeWindow).__SPHERE_RUNTIME_CONFIG__ = { PAID_PLANS_ENABLED: 'true' };
    vi.resetModules();
    expect((await import('@/config/subscription')).PAID_PLANS_ENABLED).toBe(false);

    // ...and the test-money opt-in must not open mainnet.
    vi.resetModules();
    (window as RuntimeWindow).__SPHERE_RUNTIME_CONFIG__ = {
      ...MAINNET_LIVE,
      PAID_PLANS_ENABLED: 'false',
      PAID_PLANS_ON_TEST_NETWORKS: 'true',
    };
    vi.stubEnv('VITE_PAID_PLANS_ENABLED', 'false');
    vi.resetModules();
    expect((await import('@/config/subscription')).PAID_PLANS_ENABLED).toBe(false);
  });

  it('reads exactly "true", like every other flag here', async () => {
    (window as RuntimeWindow).__SPHERE_RUNTIME_CONFIG__ = { PAID_PLANS_ON_TEST_NETWORKS: 'TRUE' };
    vi.resetModules();
    const cfg = await import('@/config/subscription');
    expect(cfg.PAID_PLANS_ENABLED).toBe(false);
  });

  it('asks its own question about which networks need the opt-in', async () => {
    // Not isTestMoney borrowed: a real-money network whose store is not open yet
    // must be able to join that set without redefining "test money".
    const caps = await import('@/config/networkCapabilities');
    expect(caps.requiresSalesOptIn('testnet2')).toBe(true);
    expect(caps.requiresSalesOptIn('mainnet')).toBe(false);
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
