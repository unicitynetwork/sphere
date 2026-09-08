import { NETWORKS } from '@unicitylabs/sphere-sdk';
import { SPHERE_NETWORK } from './network';
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
 * The operator's kill switch for the store. NOT the whole answer to "can this
 * user buy something" — that is the CATALOGUE's job: every purchase surface
 * requires a loaded catalogue with at least one paid plan (see hasPaidOffers),
 * so a gateway that prices nothing sells nothing, whatever this flag says.
 *
 * It used to AND chargesRealMoney(SPHERE_NETWORK) as well (#497 item 2), so a
 * test network could never show a purchase. That has been deliberately
 * reversed: the store is per-network already — SUBSCRIPTION_API_URL derives
 * from the active network's aggregatorUrl — so an unpriced test gateway hides
 * the surfaces by itself, and where a test network DOES sell keys, refusing to
 * show them was wrong. The protection moved from hiding the store to naming the
 * network: PlanNetworkChip and the test-money notice on the plans step make the
 * network unmistakable at the moment of purchase.
 */
export const PAID_PLANS_ENABLED =
  setting(
    'PAID_PLANS_ENABLED',
    import.meta.env.VITE_PAID_PLANS_ENABLED as string | undefined,
  ) === 'true';
