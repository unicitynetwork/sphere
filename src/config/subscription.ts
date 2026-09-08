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
 *            | test money | real money
 *   Staging  |   sells    |   sells
 *   Prod     |   hides    |   sells
 *
 * Two questions, two flags, split by the KIND of money rather than by network
 * id. Charging real money for a key that only works where tokens are worthless
 * is the mistake worth a separate switch (#497 item 2), and only the deployment
 * knows whether it is the one allowed to do that: SUBSCRIPTION_API_URL derives
 * from NETWORKS[network].aggregatorUrl, so a prod build and a staging build on
 * the same test network talk to the SAME gateway and see the same plans.
 *
 * Keyed on requiresSalesOptIn() — its own allowlist, not a network id and not a
 * `testnet*` name match. Nothing has to be renamed the day a testnet3 appears,
 * no policy is guessed from a string, and the day a REAL-money network needs the
 * same opt-in (a second mainnet, a soft launch) it joins that set instead of
 * forcing the store off everywhere.
 *
 * And this is only half the answer. Every purchase surface ALSO requires a
 * loaded catalogue holding at least one paid plan (hasPaidOffers), so a gateway
 * that prices nothing sells nothing whatever these flags say — a real network
 * with an empty catalogue used to render an upgrade path to nothing.
 *
 * Where a test network DOES sell, the protection is not concealment but naming:
 * PlanNetworkChip, the hero subtitle and TestMoneyPurchaseNotice make the
 * network unmistakable at the moment of purchase.
 */
export function paidPlansEnabledFor(network: NetworkType): boolean {
  if (requiresSalesOptIn(network)) {
    return (
      setting(
        'PAID_PLANS_ON_TEST_NETWORKS',
        import.meta.env.VITE_PAID_PLANS_ON_TEST_NETWORKS as string | undefined,
      ) === 'true'
    );
  }
  return (
    setting('PAID_PLANS_ENABLED', import.meta.env.VITE_PAID_PLANS_ENABLED as string | undefined) === 'true'
  );
}

/** Whether PAID plans may be offered in THIS session. See paidPlansEnabledFor. */
export const PAID_PLANS_ENABLED = paidPlansEnabledFor(SPHERE_NETWORK);
