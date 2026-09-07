import { NETWORKS } from '@unicitylabs/sphere-sdk';
import type { NetworkType } from '@unicitylabs/sphere-sdk';
import { STORAGE_KEYS } from './storageKeys';
import { SUBSCRIPTION_ENABLED, runtimeFlag, runtimeSetting } from './runtimeConfig';
import { FALLBACK_NETWORK, hasWalletApiUrl } from './walletApiNetworks';
import { allowsSharedAggregatorKey } from './networkCapabilities';

/** Why a network is not offered — drives honest UI copy, never a lie. */
export type UnavailableReason =
  /**
   * The SDK has not onboarded it (no trust base / networkId yet). No network
   * in SUPPORTED_NETWORKS is in this state since sphere-sdk 0.16.0-dev.1 gave
   * mainnet a networkId; it is kept as the gate a NEXT network arrives behind.
   */
  | 'not-onboarded'
  /** Live, but THIS deployment has no backend for it. */
  | 'not-served-here'
  /** Live and served, but the rollout switch is still off. */
  | 'not-rolled-out';

/** One row in the Settings → Network screen. */
export interface SupportedNetwork {
  readonly id: NetworkType;
  readonly label: string;
  readonly available: boolean;
  readonly unavailableReason?: UnavailableReason;
}

/**
 * The SDK's NetworkConfig interface is not exported from the package root
 * (only NETWORKS and NetworkType are), so type the fields we read
 * structurally.
 */
interface NetworkTableEntry {
  readonly name: string;
  readonly networkId?: number;
}

/**
 * Deliberate mainnet rollout switch, off unless EXACTLY 'true' — the
 * PAID_PLANS_ENABLED precedent. Without it, mainnet would go live the moment
 * the SDK ships a networkId AND someone sets a URL, turning a routine config
 * change into a launch while money-safety prerequisites are still open.
 */
const MAINNET_ROLLOUT_ENABLED = runtimeFlag(
  'MAINNET_ROLLOUT_ENABLED',
  import.meta.env.VITE_MAINNET_ROLLOUT_ENABLED as string | undefined,
);

/**
 * Why a network cannot be offered, or undefined when it can. Three independent
 * gates, reported in the order they must be fixed:
 *  (a) the SDK must know the network (a canonical networkId marks a live v2
 *      network — see SPHERE_NETWORKS in sphere-sdk/constants.ts);
 *  (b) THIS deployment must be able to serve it — a wallet-api deployment with
 *      no backend URL for a network cannot run it at all (the SDK client is
 *      bound to the network and its sign-in would be refused), so offering the
 *      row would only ever produce a broken wallet;
 *  (c) mainnet additionally waits for the explicit rollout switch.
 */
function unavailableReasonFor(id: NetworkType, entry: NetworkTableEntry): UnavailableReason | undefined {
  if (entry.networkId == null) return 'not-onboarded';
  // Unconditional: there is no local-custody fallback to serve a network with.
  // Sphere.init calls resolvePaymentsV2Composition() before anything else and
  // throws INVALID_CONFIG without a `walletApi` config, so a network with no URL
  // cannot boot on ANY deployment — REQUIRE_WALLET_API only decides whether the
  // #351 assert fires earlier, not whether the wallet works. Gating on the flag
  // let a rollout-on deployment offer a row that strands the user at init.
  if (!hasWalletApiUrl(id)) return 'not-served-here';
  // buildProviders REFUSES a real-value network on the shared build-time
  // aggregator key (it ships readable to every visitor). Offering a network
  // that provider composition is guaranteed to throw on would strand the user
  // on an error screen, so the gate has to know the same precondition.
  if (!allowsSharedAggregatorKey(id) && !SUBSCRIPTION_ENABLED) return 'not-served-here';
  if (id === 'mainnet' && !MAINNET_ROLLOUT_ENABLED) return 'not-rolled-out';
  return undefined;
}

/**
 * Networks the wallet offers, in display order. This is the SINGLE predicate
 * behind the UI gate, isSwitchableNetwork, the boot resolve and the
 * setActiveNetwork throw — which is what makes a broken switch impossible: a
 * network this deployment cannot serve is never selectable, and a persisted
 * choice that stops being available falls back to the build default on the
 * next load rather than booting a wallet that cannot work.
 */
export const SUPPORTED_NETWORKS: readonly SupportedNetwork[] = (
  ['testnet2', 'mainnet'] as const
).map((id) => {
  const entry: NetworkTableEntry = NETWORKS[id];
  const unavailableReason = unavailableReasonFor(id, entry);
  return { id, label: entry.name, available: unavailableReason === undefined, unavailableReason };
});

/**
 * True when `id` may be activated at runtime: exactly the UI-available
 * networks, and nothing else.
 *
 * The 'dev' escape hatch that used to live here is GONE. It was justified by
 * dev being "the only other network that constructs providers today", and
 * sphere-sdk 0.16.0-dev.1 both voided that (mainnet now constructs) and deleted
 * 'dev' from NETWORKS entirely. Keeping it would have been the worst kind of
 * dead code: the parameter is a `string` behind a type predicate, so the hatch
 * handed callers a `NetworkType` that is NOT a key of NETWORKS, and the very
 * next `NETWORKS[SPHERE_NETWORK].name` (NetworkBadge, NetworkModal, the mainnet
 * announcement) throws at render — a white screen for anyone who had used the
 * hatch, with no compile error anywhere to warn about it.
 *
 * The soundness of the predicate now rests on SUPPORTED_NETWORKS being built
 * from literal NetworkType ids, so a true answer is always a real table key.
 */
export function isSwitchableNetwork(id: string): id is NetworkType {
  return SUPPORTED_NETWORKS.some((n) => n.id === id && n.available);
}

/**
 * The network a wallet with no stored choice starts on.
 *
 * Deployment-configurable (DEFAULT_NETWORK) so a mainnet-first deployment can
 * exist without a rebuild — while it was hardcoded, such a deployment could not
 * start at all. Validated through the same gate as everything else, so naming a
 * network this deployment cannot serve degrades to the fallback instead of
 * booting a wallet that cannot work.
 */
export const DEFAULT_NETWORK: NetworkType = (() => {
  const configured = runtimeSetting(
    'DEFAULT_NETWORK',
    import.meta.env.VITE_DEFAULT_NETWORK as string | undefined,
  );
  return configured != null && isSwitchableNetwork(configured) ? configured : FALLBACK_NETWORK;
})();

/**
 * Maps a persisted raw value to the network this session should run on.
 * Anything unknown or unavailable — a network the SDK dropped ('dev'), one this
 * deployment does not serve, the legacy 'testnet' alias, or a hand-edited
 * garbage value — falls back to the deployment default, so a bad localStorage
 * value can never brick the app into a network whose providers refuse to
 * construct, nor into one that is not a key of NETWORKS at all.
 */
export function resolveActiveNetwork(stored: string | null): NetworkType {
  return stored !== null && isSwitchableNetwork(stored) ? stored : DEFAULT_NETWORK;
}

function readStoredNetwork(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEYS.ACTIVE_NETWORK);
  } catch {
    return null; // storage blocked (privacy mode) → build default
  }
}

/**
 * Forget a persisted choice that names a network the SDK does not have.
 *
 * NETWORK_DOWNGRADED_FROM deliberately KEEPS an unavailable choice (see below):
 * it is the user's standing intent, and the wallet returns to it by itself once
 * the deployment can serve it again. That reasoning holds only for a network
 * that still exists. sphere-sdk 0.16.0-dev.1 deleted 'dev' from NETWORKS, so
 * every wallet that used the old console hatch holds a value that can never
 * become available: keeping it would pin a permanent "…it reopens there once it
 * is available again" notice on a promise nothing can keep, and would leave
 * every future boot reporting a downgrade from a network that no longer exists.
 *
 * Scoped to RETIRED ids, not to "unknown to this bundle". Those are different
 * things: gh-pages serves several builds at once, so an older bundle can be
 * loaded after a newer one, and a network the newer SDK added is unknown HERE
 * while being a perfectly good standing choice. Deleting it would destroy that
 * intent silently. An unknown-but-not-retired value simply falls back for this
 * session and survives for the bundle that understands it.
 */
const RETIRED_NETWORK_IDS: ReadonlySet<string> = new Set([
  // Removed by sphere-sdk#765 along with the v1 cutover. It was only ever
  // reachable through the console escape hatch, which is gone with it.
  'dev',
]);

function forgetRetiredStoredNetwork(): void {
  const stored = readStoredNetwork();
  if (stored === null || !RETIRED_NETWORK_IDS.has(stored)) return;
  try {
    localStorage.removeItem(STORAGE_KEYS.ACTIVE_NETWORK);
  } catch {
    // Storage blocked — a failed read already resolves to the build default.
  }
}
forgetRetiredStoredNetwork();

/**
 * The Unicity network this SESSION runs on. Single source of truth — used by
 * SphereProvider (main.tsx) and for deriving per-network service URLs
 * (src/config/subscription.ts, src/services/subscriptionApi.ts). Resolved
 * ONCE at module load: every module-scope const derived from it stays
 * consistent for the whole page lifetime. Switching networks is persist +
 * reload (setActiveNetwork below) — never an in-place re-init.
 */
export const SPHERE_NETWORK: NetworkType = resolveActiveNetwork(readStoredNetwork());

/**
 * Set when the persisted choice could NOT be honoured and this session fell
 * back — e.g. the user picked mainnet and the deployment later stopped serving
 * it, or the rollout switch went back off.
 *
 * This MUST be surfaced. Networks are isolated worlds, so a silent fallback
 * shows the user an empty wallet on another network and reads as "my funds are
 * gone". The stored value is deliberately NOT repaired: it is the user's
 * standing intent, so the wallet returns to their network by itself once the
 * deployment can serve it again; the notice is what keeps that from being a
 * surprise in either direction. The one exception is a network the SDK no
 * longer has at all, which forgetRetiredStoredNetwork() above has already
 * dropped — there is nothing to return to, so there is nothing to explain.
 */
export const NETWORK_DOWNGRADED_FROM: string | null = (() => {
  const stored = readStoredNetwork();
  return stored !== null && stored !== SPHERE_NETWORK ? stored : null;
})();

/** BroadcastChannel name used to tell other tabs the active network changed. */
export const NETWORK_BROADCAST_CHANNEL = 'sphere-network';

/** Message posted on NETWORK_BROADCAST_CHANNEL by setActiveNetwork(). */
export interface NetworkChangedMessage {
  type: 'network-changed';
  network: NetworkType;
}

/**
 * Switch the active network: persist the choice, tell other tabs, reload.
 * Throws on a non-switchable id (a network this deployment cannot serve, or
 * mainnet before the rollout switch) so a caller bug can never persist a
 * network the app cannot boot. `opts.reload` is a test seam — jsdom cannot
 * mock window.location.reload; production callers omit it.
 */
/**
 * Whether to invite this wallet onto mainnet.
 *
 * WHY AN INVITATION AND NOT A NEW DEFAULT: almost nobody has a persisted
 * choice — they simply follow the build default — so flipping that default to
 * mainnet would move every existing wallet to a different network on its next
 * load. Networks are isolated worlds, so they would open to an empty balance
 * and reasonably conclude their funds were gone. Moving someone's wallet
 * between networks is theirs to decide; ours is to tell them it is possible.
 *
 * Pure so the "never nag" rule is testable: true only while mainnet is
 * genuinely selectable here, the wallet is not already on it, and the user has
 * not yet been asked. Answering — either way — ends it for good.
 */
export function shouldAnnounceMainnet(opts: {
  active: NetworkType;
  networks: readonly SupportedNetwork[];
  announced: boolean;
  defaultNetwork: NetworkType;
}): boolean {
  if (opts.announced) return false;
  // A deployment whose DEFAULT is mainnet has nobody left to invite: a wallet
  // with no persisted choice already boots there, so the only way to be on a
  // test network is to have chosen it deliberately — and inviting someone back
  // to the network they just left is precisely the nag this function exists to
  // prevent. Checked against the default rather than the active network because
  // the question is about the deployment, not this session: the two other exits
  // below stay for the deployment that still starts on a test network.
  if (opts.defaultNetwork === 'mainnet') return false;
  if (opts.active === 'mainnet') return false;
  return opts.networks.some((n) => n.id === 'mainnet' && n.available);
}

/** True once the user has answered the mainnet invitation, either way. */
export function isMainnetAnnounced(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEYS.MAINNET_ANNOUNCED) === 'true';
  } catch {
    return true; // storage blocked — never nag rather than ask on every load
  }
}

/** Record that the user has been asked, so the invitation never repeats. */
export function markMainnetAnnounced(): void {
  try {
    localStorage.setItem(STORAGE_KEYS.MAINNET_ANNOUNCED, 'true');
  } catch {
    // Storage blocked; isMainnetAnnounced() already fails to "asked".
  }
}

/** Best-effort cross-tab notify; the storage-event fallback covers a failure. */
function broadcastNetworkChange(network: NetworkType): void {
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel(NETWORK_BROADCAST_CHANNEL);
      const message: NetworkChangedMessage = { type: 'network-changed', network };
      channel.postMessage(message);
      channel.close();
    }
  } catch {
    // Cross-tab notify is best-effort — the 'storage' event listener in
    // src/sdk/networkSync.ts still reloads other tabs.
  }
}

/**
 * Drop the persisted choice and reload onto the build default.
 *
 * The recovery path for a wallet stranded on a network that cannot start —
 * which the availability gate cannot rule out entirely: it can only check what
 * the SDK advertises, while the refusal may come from deeper (a missing trust
 * base). Deliberately NOT setActiveNetwork(DEFAULT_NETWORK): that throws for a
 * network the gate considers unavailable, and a recovery action that can itself
 * fail is no recovery. Clearing the key always resolves to the deployment
 * default (resolveActiveNetwork treats null as "no choice"), so this cannot
 * throw and cannot leave the user stuck.
 */
export function resetActiveNetwork(opts: { reload?: () => void } = {}): void {
  try {
    localStorage.removeItem(STORAGE_KEYS.ACTIVE_NETWORK);
  } catch {
    // Storage blocked — the build default is what a failed read resolves to
    // anyway, so a reload still recovers.
  }
  broadcastNetworkChange(DEFAULT_NETWORK);
  (opts.reload ?? (() => window.location.reload()))();
}

/**
 * Finish the network reset that clearAllSphereData() starts.
 *
 * Wallet deletion drops the persisted choice on purpose — a deleted wallet
 * should come back on the deployment default, the way a fresh browser does.
 * But SPHERE_NETWORK is resolved ONCE at module load and deleteWallet()
 * deliberately never reloads, so the removal alone left THIS tab running on the
 * old network with nothing persisted: the next wallet was created there, was
 * offered its plans and wrote to its token DB, and only the first refresh moved
 * it to the default. Every OTHER tab meanwhile did reset, because a storage
 * event does not fire in the tab that caused it — networkSync.ts saw the
 * removal and reloaded. The reset was never wrong, it just skipped one tab.
 *
 * Returns true when it reloads, so the caller can skip work the reload undoes.
 */
export function applyClearedNetworkChoice(opts: { reload?: () => void } = {}): boolean {
  if (SPHERE_NETWORK === DEFAULT_NETWORK) return false;
  resetActiveNetwork(opts);
  return true;
}

export function setActiveNetwork(id: NetworkType, opts: { reload?: () => void } = {}): void {
  if (!isSwitchableNetwork(id)) {
    throw new Error(`Network "${id}" is not available for switching`);
  }
  if (id === SPHERE_NETWORK) return; // already active — nothing to do

  localStorage.setItem(STORAGE_KEYS.ACTIVE_NETWORK, id);
  broadcastNetworkChange(id);
  (opts.reload ?? (() => window.location.reload()))();
}
