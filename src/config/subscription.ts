import { NETWORKS } from '@unicitylabs/sphere-sdk';
import { SPHERE_NETWORK } from './network';
import { requiresSalesOptIn } from './networkCapabilities';
import type { NetworkType } from '@unicitylabs/sphere-sdk';
import { SUBSCRIPTION_ENABLED, runtimeSetting as setting } from './runtimeConfig';

/**
 * Subscription gateway (SGW) config. When SUBSCRIPTION_ENABLED is false the
 * app keeps using the static VITE_AGGREGATOR_API_KEY and no subscription
 * calls are made.
 *
 * The SGW *is* the aggregator gateway (it fronts the aggregator's write
 * path), so its base URL is derived from the SDK's per-network config — no
 * env var needed, and it follows the network automatically like every other
 * backend URL. All SGW endpoints serve CORS for browser calls
 * (unicitynetwork/aggregator-subscription#57), so the wallet talks to it
 * directly. VITE_SUBSCRIPTION_API_URL remains as a dev override: the local
 * SGW compose stack is reached via the same-origin `/sgw` vite proxy
 * (SGW_PROXY_TARGET, see vite.config.ts).
 *
 * The flags come from window.__SPHERE_RUNTIME_CONFIG__ rather than a
 * `__RUNTIME_*__` sed placeholder because a placeholder cannot carry a value a
 * branch decides on — every `if (SUBSCRIPTION_ENABLED)` would be pruned against
 * the baked literal at build time (this actually happened). The rule, the fold
 * directions and the mechanism now live in src/config/runtimeConfig.ts; read
 * that before adding a value here.
 */

function resolveSubscriptionApiUrl(): string {
  const raw = import.meta.env.VITE_SUBSCRIPTION_API_URL as string | undefined;
  if (raw !== undefined && raw !== '') return raw;
  return NETWORKS[SPHERE_NETWORK].aggregatorUrl;
}
export const SUBSCRIPTION_API_URL = resolveSubscriptionApiUrl();

/**
 * Exactly 'true' enables; anything else (including 'TRUE', '1') is off.
 * Defined in runtimeConfig.ts (a leaf) because the network availability gate
 * needs it too and cannot import this module — see the note there.
 */
export { SUBSCRIPTION_ENABLED };

/**
 * When true, the SGW client returns canned data instead of hitting the
 * network — lets the UI be built before the backend is live. Deliberately
 * NOT runtime-swappable (not part of the runtime config): mock mode is
 * dev-only, and with the env unset at build time the comparison folds to
 * `false` so production builds tree-shake the canned data. Never wire this
 * into the Docker runtime-config mechanism.
 */
export const SUBSCRIPTION_MOCK =
  import.meta.env.VITE_SUBSCRIPTION_MOCK === 'true';

/**
 * Whether this deployment sells paid plans while the wallet is on `network`.
 *
 *              | testnet | mainnet
 *   staging    |  sells  |  sells
 *   production |  hides  |  sells
 *
 * One flag per kind of network, because only the deployment can answer this:
 * SUBSCRIPTION_API_URL derives from NETWORKS[network].aggregatorUrl, so a prod
 * build and a staging build on the same test network talk to the SAME gateway
 * and see the same plans. Neither the catalogue nor the network id can tell the
 * two deployments apart.
 *
 * Which flag a network answers to is requiresSalesOptIn() — its own allowlist in
 * networkCapabilities.ts, so a future testnet needs no new variable, no policy
 * is guessed from a name, and a real-money network whose store is not open yet
 * can join it without being called play money.
 *
 * PAID_PLANS_ENABLED_MAINNET falls back to the legacy deployment-wide
 * PAID_PLANS_ENABLED, so shipping this code before renaming the env cannot turn
 * mainnet sales off. There is deliberately NO such fallback for test networks:
 * an unconfigured deployment must not start selling worthless keys.
 *
 * And this is only half the answer. Every purchase surface ALSO requires a
 * loaded catalogue holding at least one paid plan (hasPaidOffers), so a gateway
 * that prices nothing sells nothing whatever these flags say.
 *
 * Where a test network DOES sell, the protection is not concealment but naming:
 * PlanNetworkChip, the hero subtitle and TestMoneyPurchaseNotice make the
 * network unmistakable at the moment of purchase.
 */
export function paidPlansEnabledFor(network: NetworkType): boolean {
  if (requiresSalesOptIn(network)) {
    return (
      setting(
        'PAID_PLANS_ENABLED_TESTNET',
        import.meta.env.VITE_PAID_PLANS_ENABLED_TESTNET as string | undefined,
      ) === 'true'
    );
  }

  const mainnet = setting(
    'PAID_PLANS_ENABLED_MAINNET',
    import.meta.env.VITE_PAID_PLANS_ENABLED_MAINNET as string | undefined,
  );
  if (mainnet !== undefined && mainnet !== '') return mainnet === 'true';

  return (
    setting('PAID_PLANS_ENABLED', import.meta.env.VITE_PAID_PLANS_ENABLED as string | undefined) === 'true'
  );
}

/** Whether PAID plans may be offered in THIS session. See paidPlansEnabledFor. */
export const PAID_PLANS_ENABLED = paidPlansEnabledFor(SPHERE_NETWORK);
