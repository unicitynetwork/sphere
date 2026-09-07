import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NETWORKS } from '@unicitylabs/sphere-sdk';

/**
 * SUPPORTED_NETWORKS is a module-load const, so every case re-imports the
 * module under a fresh environment (vi.resetModules + dynamic import). Stubbing
 * env after import would not re-derive it.
 */
function setRuntimeConfig(config: Record<string, string>): void {
  (window as unknown as { __SPHERE_RUNTIME_CONFIG__?: unknown }).__SPHERE_RUNTIME_CONFIG__ = config;
}

async function loadNetworkModule() {
  vi.resetModules();
  return import('../../../src/config/network');
}

beforeEach(() => {
  setRuntimeConfig({});
  localStorage.clear();
  // Isolate from the developer's local .env, which sets a wallet-api URL.
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

/**
 * Everything a deployment needs to actually offer mainnet. Since sphere-sdk
 * 0.16.0-dev.1 the SDK half is already true (NETWORKS.mainnet carries
 * networkId 1), so mainnet is the second REAL network this suite can switch
 * to — the role the deleted 'dev' hatch used to play.
 */
const MAINNET_LIVE = {
  MAINNET_ROLLOUT_ENABLED: 'true',
  WALLET_API_URL_MAINNET: 'https://wallet-api.mainnet.example',
  WALLET_API_URL_TESTNET2: 'https://wallet-api.testnet2.example',
  SUBSCRIPTION_ENABLED: 'true',
};

describe('SUPPORTED_NETWORKS — the availability gate', () => {
  it('offers exactly testnet2 and mainnet, in that order', async () => {
    const mod = await loadNetworkModule();
    expect(mod.SUPPORTED_NETWORKS.map((n) => n.id)).toEqual(['testnet2', 'mainnet']);
  });

  it('no longer blames the SDK for mainnet — it is onboarded, just not served here', async () => {
    // This asserted 'not-onboarded' until sphere-sdk 0.16.0-dev.1, which gave
    // NETWORKS.mainnet a networkId, a live gateway and its own registry. Gate
    // (a) therefore opened BY ITSELF on the bump, with no code change here —
    // which is precisely why the reason must be re-pinned: a stale expectation
    // would have hidden that the wallet's refusal now rests entirely on the
    // deployment gates.
    const mod = await loadNetworkModule();
    const mainnet = mod.SUPPORTED_NETWORKS.find((n) => n.id === 'mainnet');
    expect(mainnet?.available).toBe(false);
    expect(mainnet?.unavailableReason).toBe('not-served-here');
  });

  it('marks testnet2 available once the deployment serves it', async () => {
    setRuntimeConfig({ WALLET_API_URL_TESTNET2: 'https://wallet-api.example' });
    const mod = await loadNetworkModule();
    const testnet2 = mod.SUPPORTED_NETWORKS.find((n) => n.id === 'testnet2');
    expect(testnet2?.available).toBe(true);
    expect(testnet2?.unavailableReason).toBeUndefined();
  });

  it('gates on the wallet-api URL even when REQUIRE_WALLET_API is off', async () => {
    // This used to assert the opposite — that a missing URL must not hide a
    // network, because a local-custody deployment served every network itself.
    // There is no local-custody fallback any more: Sphere.init calls
    // resolvePaymentsV2Composition() before anything else and throws
    // INVALID_CONFIG without a `walletApi` config. So a network with no URL
    // cannot boot on ANY deployment, and offering the row only strands the user
    // at init — which is exactly what this gate exists to prevent.
    vi.stubEnv('VITE_REQUIRE_WALLET_API', '');
    setRuntimeConfig({ WALLET_API_URL_TESTNET2: '' });
    const mod = await loadNetworkModule();
    const testnet2 = mod.SUPPORTED_NETWORKS.find((n) => n.id === 'testnet2');
    expect(testnet2?.available).toBe(false);
    expect(testnet2?.unavailableReason).toBe('not-served-here');
  });

  it('reports not-served-here when a wallet-api deployment has no URL for the network', async () => {
    vi.stubEnv('VITE_REQUIRE_WALLET_API', 'true');
    setRuntimeConfig({ WALLET_API_URL_TESTNET2: '', WALLET_API_URL_MAINNET: '' });
    const mod = await loadNetworkModule();
    const testnet2 = mod.SUPPORTED_NETWORKS.find((n) => n.id === 'testnet2');
    expect(testnet2?.available).toBe(false);
    expect(testnet2?.unavailableReason).toBe('not-served-here');
  });

  it('does not offer a real-value network the shared aggregator key cannot run', async () => {
    // buildProviders refuses that combination outright, so offering the network
    // would strand the user on an init error. The gate must know the same rule.
    vi.stubEnv('VITE_SUBSCRIPTION_ENABLED', '');
    setRuntimeConfig({ WALLET_API_URL_MAINNET: 'https://mainnet.example' });
    const mod = await loadNetworkModule();
    const mainnet = mod.SUPPORTED_NETWORKS.find((n) => n.id === 'mainnet');
    expect(mainnet?.available).toBe(false);
  });

  it('never throws at module load, even when a wallet-api build has no URLs', async () => {
    // The gate must use a NON-throwing predicate: SUPPORTED_NETWORKS is a
    // module-scope const, so a #351 throw here would white-screen the app
    // before React mounts, bypassing the visible-error path.
    vi.stubEnv('VITE_REQUIRE_WALLET_API', 'true');
    setRuntimeConfig({});
    await expect(loadNetworkModule()).resolves.toBeDefined();
  });
});

describe('isSwitchableNetwork', () => {
  it('accepts an available network', async () => {
    setRuntimeConfig({ WALLET_API_URL_TESTNET2: 'https://wallet-api.example' });
    const mod = await loadNetworkModule();
    expect(mod.isSwitchableNetwork('testnet2')).toBe(true);
  });

  it('rejects mainnet while it is unavailable', async () => {
    const mod = await loadNetworkModule();
    expect(mod.isSwitchableNetwork('mainnet')).toBe(false);
  });

  it('rejects unknown values and the legacy testnet alias', async () => {
    const mod = await loadNetworkModule();
    expect(mod.isSwitchableNetwork('nope')).toBe(false);
    expect(mod.isSwitchableNetwork('')).toBe(false);
    expect(mod.isSwitchableNetwork('testnet')).toBe(false);
  });

  it("rejects 'dev' — the escape hatch is gone and the network with it", async () => {
    // The hatch used to return true unconditionally, ahead of the gate. Since
    // the parameter is a `string` behind a type predicate, removing 'dev' from
    // NetworkType raised NO compile error here: a wallet holding the documented
    // console value would have been handed a NetworkType that is not a key of
    // NETWORKS, and NETWORKS[SPHERE_NETWORK].name would throw at first render.
    // Arming REQUIRE_WALLET_API too, because that is what the hatch bypassed.
    vi.stubEnv('VITE_REQUIRE_WALLET_API', 'true');
    const mod = await loadNetworkModule();
    expect(mod.isSwitchableNetwork('dev')).toBe(false);
  });
});

describe('DEFAULT_NETWORK — a mainnet-first deployment must be possible', () => {
  it('starts on the build fallback when the deployment names none', async () => {
    const mod = await loadNetworkModule();
    expect(mod.DEFAULT_NETWORK).toBe('testnet2');
  });

  it('honours a deployment-configured start network', async () => {
    // While this was hardcoded, a mainnet-only deployment could not start.
    // Mainnet is the non-default network this can be shown with now that the
    // SDK onboarded it — and it is the case the option exists for.
    setRuntimeConfig({ ...MAINNET_LIVE, DEFAULT_NETWORK: 'mainnet' });
    const mod = await loadNetworkModule();
    expect(mod.DEFAULT_NETWORK).toBe('mainnet');
    expect(mod.resolveActiveNetwork(null)).toBe('mainnet');
  });

  it('ignores a start network this deployment cannot serve', async () => {
    // Naming an unavailable network must degrade to the fallback, not boot a
    // wallet that cannot work. Mainnet is onboarded in the SDK now, so what
    // makes it unavailable here is the deployment: no backend URL, no rollout.
    vi.stubEnv('VITE_DEFAULT_NETWORK', 'mainnet');
    const mod = await loadNetworkModule();
    expect(mod.DEFAULT_NETWORK).toBe('testnet2');
  });

  it('ignores garbage', async () => {
    vi.stubEnv('VITE_DEFAULT_NETWORK', 'nonsense');
    const mod = await loadNetworkModule();
    expect(mod.DEFAULT_NETWORK).toBe('testnet2');
  });
});

describe('resolveActiveNetwork — boot cannot brick', () => {
  it('uses a persisted switchable network', async () => {
    // Worth stating with a network that is NOT the default, or the assertion
    // would pass even if the stored value were ignored entirely.
    setRuntimeConfig(MAINNET_LIVE);
    const mod = await loadNetworkModule();
    expect(mod.DEFAULT_NETWORK).toBe('testnet2');
    expect(mod.resolveActiveNetwork('mainnet')).toBe('mainnet');
  });

  it('falls back to the build default when nothing is persisted', async () => {
    const mod = await loadNetworkModule();
    expect(mod.resolveActiveNetwork(null)).toBe('testnet2');
  });

  it('falls back for a persisted network that is no longer available', async () => {
    // The deployment dropped mainnet (or never had it): a persisted 'mainnet'
    // must not boot a wallet that cannot work.
    const mod = await loadNetworkModule();
    expect(mod.resolveActiveNetwork('mainnet')).toBe('testnet2');
  });

  it('falls back for garbage', async () => {
    const mod = await loadNetworkModule();
    expect(mod.resolveActiveNetwork('{}')).toBe('testnet2');
  });

  it("falls back for 'dev' — a network the SDK deleted", async () => {
    const mod = await loadNetworkModule();
    expect(mod.resolveActiveNetwork('dev')).toBe('testnet2');
  });

  it('falls back for a prototype key rather than treating it as a network', async () => {
    // The stored value is an arbitrary string and the SDK table is a plain
    // object, so a membership test written with `in` would answer true here.
    const mod = await loadNetworkModule();
    expect(mod.resolveActiveNetwork('constructor')).toBe('testnet2');
    expect(mod.resolveActiveNetwork('toString')).toBe('testnet2');
  });
});

describe('NETWORK_DOWNGRADED_FROM — a fallback must never be silent', () => {
  it('is null when the persisted choice was honoured', async () => {
    setRuntimeConfig(MAINNET_LIVE);
    localStorage.setItem('sphere_active_network', 'mainnet');
    const mod = await loadNetworkModule();
    expect(mod.SPHERE_NETWORK).toBe('mainnet');
    expect(mod.NETWORK_DOWNGRADED_FROM).toBeNull();
  });

  it('is null when nothing was ever persisted', async () => {
    const mod = await loadNetworkModule();
    expect(mod.NETWORK_DOWNGRADED_FROM).toBeNull();
  });

  it('reports the requested network when the session fell back', async () => {
    // The user picked mainnet; this deployment/SDK cannot serve it. Falling
    // back is right, doing it silently is not: networks are isolated worlds, so
    // an unexplained empty wallet reads as lost funds.
    localStorage.setItem('sphere_active_network', 'mainnet');
    const mod = await loadNetworkModule();
    expect(mod.SPHERE_NETWORK).toBe('testnet2');
    expect(mod.NETWORK_DOWNGRADED_FROM).toBe('mainnet');
  });

  it('leaves the stored choice intact so the wallet returns once it can', async () => {
    localStorage.setItem('sphere_active_network', 'mainnet');
    await loadNetworkModule();
    expect(localStorage.getItem('sphere_active_network')).toBe('mainnet');
  });
});

describe("a wallet left on 'dev' by the console escape hatch", () => {
  /**
   * THE bump-day migration. sphere-sdk 0.16.0-dev.1 removed 'dev' from
   * NetworkType and from NETWORKS, but isSwitchableNetwork takes a `string`
   * behind a type predicate — so deleting the network raised no compile error
   * on the hatch, and anyone who had followed the documented console
   * instruction (`localStorage.sphere_active_network = 'dev'`) would have
   * booted with SPHERE_NETWORK = 'dev' and white-screened on the first
   * NETWORKS[SPHERE_NETWORK].name — NetworkBadge, NetworkModal, the mainnet
   * announcement. A wallet must never be bricked by a value the app itself
   * told the user to set.
   */
  it('resolves to the build default instead of a network that no longer exists', async () => {
    localStorage.setItem('sphere_active_network', 'dev');
    const mod = await loadNetworkModule();

    expect(mod.SPHERE_NETWORK).toBe('testnet2');
    expect(mod.isSwitchableNetwork('dev')).toBe(false);
  });

  it('KEEPS a stored network this bundle does not know — it may be a NEWER one', async () => {
    // gh-pages serves several builds at once, so an OLDER bundle can load after a
    // newer one. A network the newer SDK added is unknown here but is a perfectly
    // good standing choice; deleting it would destroy that intent silently. Only
    // RETIRED ids are forgotten. This session still falls back — it cannot run a
    // network it has no table entry for — but the choice survives for the bundle
    // that understands it.
    localStorage.setItem('sphere_active_network', 'testnet9');
    const mod = await loadNetworkModule();

    expect(localStorage.getItem('sphere_active_network')).toBe('testnet9');
    expect(mod.SPHERE_NETWORK).toBe(mod.DEFAULT_NETWORK);
  });

  it('resolves to a network the SDK table can actually be indexed with', async () => {
    // The assertion the white screen would have failed: every module that
    // renders the network name does exactly this lookup, at module scope.
    localStorage.setItem('sphere_active_network', 'dev');
    const mod = await loadNetworkModule();

    expect(NETWORKS[mod.SPHERE_NETWORK]).toBeDefined();
    expect(NETWORKS[mod.SPHERE_NETWORK].name).toBe('Testnet');
  });

  it('forgets the stored value, so nothing is promised that cannot be kept', async () => {
    // An unavailable-but-real choice is deliberately KEPT (see the test above:
    // a persisted 'mainnet' survives so the wallet returns to it). 'dev' can
    // never come back, so keeping it would pin a permanent downgrade notice
    // offering to reopen a network that does not exist.
    localStorage.setItem('sphere_active_network', 'dev');
    const mod = await loadNetworkModule();

    expect(localStorage.getItem('sphere_active_network')).toBeNull();
    expect(mod.NETWORK_DOWNGRADED_FROM).toBeNull();
  });

  it('leaves a real network alone — only unknown ones are forgotten', async () => {
    // The repair is scoped to membership in the SDK table, NOT availability.
    localStorage.setItem('sphere_active_network', 'mainnet');
    const mod = await loadNetworkModule();

    expect(localStorage.getItem('sphere_active_network')).toBe('mainnet');
    expect(mod.NETWORK_DOWNGRADED_FROM).toBe('mainnet');
  });

  it('survives blocked storage without throwing at module load', async () => {
    // Privacy mode: removeItem throws. The module is imported before React
    // mounts, so an escaping error is the same white screen by another route.
    localStorage.setItem('sphere_active_network', 'dev');
    const removeItem = vi
      .spyOn(Storage.prototype, 'removeItem')
      .mockImplementation(() => {
        throw new Error('storage blocked');
      });
    try {
      const mod = await loadNetworkModule();
      expect(mod.SPHERE_NETWORK).toBe('testnet2');
    } finally {
      removeItem.mockRestore();
    }
  });
});

describe('shouldAnnounceMainnet — invite once, never move anyone', () => {
  const LIVE = [
    { id: 'testnet2' as const, label: 'Testnet', available: true },
    { id: 'mainnet' as const, label: 'Mainnet', available: true },
  ];
  const NOT_LIVE = [
    { id: 'testnet2' as const, label: 'Testnet', available: true },
    { id: 'mainnet' as const, label: 'Mainnet', available: false, unavailableReason: 'not-onboarded' as const },
  ];

  it('invites a test-network wallet once mainnet is live', async () => {
    const mod = await loadNetworkModule();
    expect(
      mod.shouldAnnounceMainnet({ active: 'testnet2', networks: LIVE, announced: false, defaultNetwork: 'testnet2' }),
    ).toBe(true);
  });

  it('stays quiet while mainnet is not selectable here', async () => {
    // Never advertise what this deployment cannot actually switch to.
    const mod = await loadNetworkModule();
    expect(
      mod.shouldAnnounceMainnet({ active: 'testnet2', networks: NOT_LIVE, announced: false, defaultNetwork: 'testnet2' }),
    ).toBe(false);
  });

  it('stays quiet when mainnet IS the deployment default', async () => {
    // Nobody is left to invite. A wallet with no persisted choice already boots
    // on mainnet, so the only way to be on a test network is to have chosen it
    // deliberately — and inviting someone back to the network they just left is
    // exactly the nag this function exists to prevent.
    const mod = await loadNetworkModule();
    expect(
      mod.shouldAnnounceMainnet({
        active: 'testnet2',
        networks: LIVE,
        announced: false,
        defaultNetwork: 'mainnet',
      }),
    ).toBe(false);
  });

  it('never asks a wallet already on mainnet', async () => {
    const mod = await loadNetworkModule();
    expect(mod.shouldAnnounceMainnet({ active: 'mainnet', networks: LIVE, announced: false, defaultNetwork: 'testnet2' })).toBe(
      false,
    );
  });

  it('never asks twice — declining is a real answer, not a postponement', async () => {
    const mod = await loadNetworkModule();
    expect(mod.shouldAnnounceMainnet({ active: 'testnet2', networks: LIVE, announced: true, defaultNetwork: 'testnet2' })).toBe(
      false,
    );
  });

  it('remembers the answer across loads', async () => {
    const mod = await loadNetworkModule();
    expect(mod.isMainnetAnnounced()).toBe(false);
    mod.markMainnetAnnounced();
    expect(mod.isMainnetAnnounced()).toBe(true);
  });
});

describe('resetActiveNetwork — the way out of a network that cannot start', () => {
  it('clears the choice and reloads onto the build default', async () => {
    localStorage.setItem('sphere_active_network', 'mainnet');
    const mod = await loadNetworkModule();
    const reload = vi.fn();

    mod.resetActiveNetwork({ reload });

    expect(localStorage.getItem('sphere_active_network')).toBeNull();
    expect(reload).toHaveBeenCalledOnce();
    // Nothing persisted => the next boot resolves the build default.
    expect(mod.resolveActiveNetwork(null)).toBe('testnet2');
  });

  it('never throws — a recovery action that can fail is no recovery', async () => {
    // setActiveNetwork(BUILD_DEFAULT) would throw if the gate considered the
    // default unavailable; clearing the key cannot, which is why recovery does
    // not reuse it.
    vi.stubEnv('VITE_REQUIRE_WALLET_API', 'true'); // no URLs => nothing available
    localStorage.setItem('sphere_active_network', 'mainnet');
    const mod = await loadNetworkModule();
    const reload = vi.fn();

    expect(() => mod.resetActiveNetwork({ reload })).not.toThrow();
    expect(() => mod.setActiveNetwork('testnet2', { reload })).toThrow(/not available/);
    expect(reload).toHaveBeenCalledOnce(); // only the reset one
  });
});

describe('setActiveNetwork', () => {
  it('persists, broadcasts and reloads', async () => {
    // A real switch needs a real second network: with mainnet live here the
    // wallet still starts on testnet2, so this is a genuine change of network.
    setRuntimeConfig(MAINNET_LIVE);
    const mod = await loadNetworkModule();
    const reload = vi.fn();
    expect(mod.SPHERE_NETWORK).toBe('testnet2');
    mod.setActiveNetwork('mainnet', { reload });

    expect(localStorage.getItem('sphere_active_network')).toBe('mainnet');
    expect(reload).toHaveBeenCalledOnce();
  });

  it('refuses a network that is not switchable', async () => {
    const mod = await loadNetworkModule();
    const reload = vi.fn();
    expect(() => mod.setActiveNetwork('mainnet', { reload })).toThrow(/not available/);
    expect(reload).not.toHaveBeenCalled();
    expect(localStorage.getItem('sphere_active_network')).toBeNull();
  });

  it('no-ops when the network is already active', async () => {
    setRuntimeConfig({ WALLET_API_URL_TESTNET2: 'https://wallet-api.example' });
    const mod = await loadNetworkModule();
    const reload = vi.fn();
    mod.setActiveNetwork(mod.SPHERE_NETWORK, { reload });
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('applyClearedNetworkChoice — wallet deletion must land on the default', () => {
  it('reloads when the deleted wallet was running on a non-default network', async () => {
    // The state right after clearAllSphereData(): the page still holds the
    // module-load SPHERE_NETWORK ('mainnet'), the key is already swept.
    setRuntimeConfig(MAINNET_LIVE);
    localStorage.setItem('sphere_active_network', 'mainnet');
    const mod = await loadNetworkModule();
    expect(mod.SPHERE_NETWORK).toBe('mainnet');
    localStorage.clear(); // the sweep

    const reload = vi.fn();
    expect(mod.applyClearedNetworkChoice({ reload })).toBe(true);

    expect(reload).toHaveBeenCalledOnce();
    expect(localStorage.getItem('sphere_active_network')).toBeNull();
  });

  it('does nothing when the session already runs on the default', async () => {
    // The common case — deleting a wallet on testnet2 must not cost a reload,
    // and deleteWallet()'s own re-init is left to finish the job.
    setRuntimeConfig(MAINNET_LIVE);
    const mod = await loadNetworkModule();
    expect(mod.SPHERE_NETWORK).toBe(mod.DEFAULT_NETWORK);

    const reload = vi.fn();
    expect(mod.applyClearedNetworkChoice({ reload })).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});
