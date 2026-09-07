import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * THE DAY LANDED. This file was written against a mocked SDK table, because the
 * then-pinned SDK gave NETWORKS.mainnet no networkId: `unavailableReasonFor`
 * returned 'not-onboarded' on its first line, so the later gates were
 * unreachable for mainnet and the rest of the suite could not tell "refused for
 * the reason I meant" from "refused because the SDK has not onboarded it".
 *
 * sphere-sdk 0.16.0-dev.1 ships mainnet for real — networkId 1, a live gateway
 * and its own token registry — so the mock has been REMOVED rather than left in
 * place as a no-op that would quietly go on describing a table the SDK no
 * longer has. Every case below now runs against the real one, which is what the
 * file was written to be ready for: it pins that the SDK bump alone is not a
 * launch, and that each remaining gate is the deployment's to open.
 */

function setRuntimeConfig(config: Record<string, string>): void {
  (window as unknown as { __SPHERE_RUNTIME_CONFIG__?: unknown }).__SPHERE_RUNTIME_CONFIG__ = config;
}

async function loadNetworkModule() {
  vi.resetModules();
  return import('../../../src/config/network');
}

/** Everything a deployment needs to actually serve mainnet. */
const MAINNET_LIVE = {
  MAINNET_ROLLOUT_ENABLED: 'true',
  WALLET_API_URL_MAINNET: 'https://wallet-api.mainnet.example',
  WALLET_API_URL_TESTNET2: 'https://wallet-api.testnet2.example',
  SUBSCRIPTION_ENABLED: 'true',
  REQUIRE_WALLET_API: 'true',
};

beforeEach(() => {
  setRuntimeConfig({});
  localStorage.clear();
  vi.stubEnv('VITE_REQUIRE_WALLET_API', '');
  vi.stubEnv('VITE_WALLET_API_URL', '');
  vi.stubEnv('VITE_WALLET_API_URL_TESTNET2', '');
  vi.stubEnv('VITE_WALLET_API_URL_MAINNET', '');
  vi.stubEnv('VITE_MAINNET_ROLLOUT_ENABLED', '');
  vi.stubEnv('VITE_SUBSCRIPTION_ENABLED', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
  setRuntimeConfig({});
  localStorage.clear();
});

describe('mainnet, now that the SDK has onboarded it', () => {
  it('offers mainnet now the SDK knows it, the deployment serves it and rollout is on', async () => {
    setRuntimeConfig(MAINNET_LIVE);
    const mod = await loadNetworkModule();
    const mainnet = mod.SUPPORTED_NETWORKS.find((n) => n.id === 'mainnet');
    expect(mainnet?.available).toBe(true);
    expect(mainnet?.unavailableReason).toBeUndefined();
  });

  it('withholds it while the rollout switch is off — an SDK bump is not a launch', async () => {
    setRuntimeConfig({ ...MAINNET_LIVE, MAINNET_ROLLOUT_ENABLED: '' });
    const mod = await loadNetworkModule();
    const mainnet = mod.SUPPORTED_NETWORKS.find((n) => n.id === 'mainnet');
    expect(mainnet?.available).toBe(false);
    expect(mainnet?.unavailableReason).toBe('not-rolled-out');
  });

  it('withholds it where this deployment has no mainnet backend', async () => {
    setRuntimeConfig({ ...MAINNET_LIVE, WALLET_API_URL_MAINNET: '' });
    const mod = await loadNetworkModule();
    const mainnet = mod.SUPPORTED_NETWORKS.find((n) => n.id === 'mainnet');
    expect(mainnet?.available).toBe(false);
    expect(mainnet?.unavailableReason).toBe('not-served-here');
  });

  it('refuses it on the shared build-time aggregator key', async () => {
    // The reason the pre-bump suite could never actually observe: without
    // per-wallet subscription keys, buildProviders throws for a real-value
    // network, so the row must not be offered at all.
    setRuntimeConfig({ ...MAINNET_LIVE, SUBSCRIPTION_ENABLED: '' });
    const mod = await loadNetworkModule();
    const mainnet = mod.SUPPORTED_NETWORKS.find((n) => n.id === 'mainnet');
    expect(mainnet?.available).toBe(false);
    expect(mainnet?.unavailableReason).toBe('not-served-here');
  });

  it('lets the switch through and honours a persisted mainnet choice', async () => {
    setRuntimeConfig(MAINNET_LIVE);
    localStorage.setItem('sphere_active_network', 'mainnet');
    const mod = await loadNetworkModule();
    expect(mod.isSwitchableNetwork('mainnet')).toBe(true);
    expect(mod.resolveActiveNetwork('mainnet')).toBe('mainnet');
    expect(mod.SPHERE_NETWORK).toBe('mainnet');
    // The choice was honoured, so there is nothing to explain.
    expect(mod.NETWORK_DOWNGRADED_FROM).toBeNull();
  });

  it('invites a testnet2 wallet exactly once instead of moving it', async () => {
    setRuntimeConfig(MAINNET_LIVE);
    const mod = await loadNetworkModule();
    // Nobody is relocated: the start network is still the deployment default.
    expect(mod.SPHERE_NETWORK).toBe('testnet2');
    expect(
      mod.shouldAnnounceMainnet({
        active: mod.SPHERE_NETWORK,
        networks: mod.SUPPORTED_NETWORKS,
        announced: false,
        defaultNetwork: mod.DEFAULT_NETWORK,
      }),
    ).toBe(true);
  });
});

describe('a live mainnet still offers no Top Up or Swap', () => {
  it("keeps Sphere's OWN mint-backed features closed on mainnet once selectable", async () => {
    setRuntimeConfig(MAINNET_LIVE);
    await loadNetworkModule();
    const caps = await import('../../../src/config/networkCapabilities');
    // Availability and mint permission are independent axes: onboarding mainnet
    // must not be what turns Top Up and Swap back on.
    expect(caps.canSelfMint('mainnet')).toBe(false);
    expect(caps.allowsSharedAggregatorKey('mainnet')).toBe(false);
  });
});
