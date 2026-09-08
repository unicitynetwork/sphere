/**
 * Per-environment config the container supplies at START, not at build.
 *
 * WHY THIS EXISTS AND WHEN TO USE IT — READ BEFORE ADDING A VALUE.
 * Vite inlines `import.meta.env.VITE_*` into the bundle, so the Docker image
 * bakes `__RUNTIME_*__` placeholder strings and sed-rewrites them at container
 * start (deploy/runtime-config.sh). That mechanism carries plain VALUES fine,
 * but it CANNOT carry anything a branch decides on: Rollup statically evaluates
 * branch conditions against the baked literal and prunes the dead side, so the
 * decision is frozen at build time no matter what the container substitutes.
 * That already happened once with the subscription flags.
 *
 * The fold direction is what makes this dangerous rather than merely broken:
 *   `env === 'true'`  folds to FALSE  → a feature is stuck off (annoying)
 *   `Boolean(env)`    folds to TRUE   → a capability is stuck ON (unsafe), and
 *                     the placeholder is ERASED from the file, so the CI guard
 *                     that greps for surviving `__RUNTIME_` placeholders cannot
 *                     see it either.
 *
 * A read of a `window` global is unfoldable by construction — no optimizer can
 * know a global's value. So: anything that GATES a branch (feature flags,
 * capability/availability decisions) belongs here; a value that is only ever
 * passed through may use the sed placeholders.
 *
 * Written by deploy/runtime-config.sh into /runtime-config.js, loaded as a
 * classic script in <head> BEFORE the module bundle (src/index.html) — so
 * module-scope consts may read it safely. Dev and GitHub Pages builds ship the
 * default empty object (public/runtime-config.js) and fall back to the VITE_*
 * env baked at build time.
 */

export interface SphereRuntimeConfig {
  SUBSCRIPTION_ENABLED?: string;
  PAID_PLANS_ENABLED?: string;
  /**
   * Lets THIS deployment sell paid plans while the wallet is on a network whose
   * money is play money. Off unless exactly 'true', which is production: a test
   * network's tokens are worthless, so charging real money for a key that only
   * works there is a mistake a live deployment must not make. Staging sets it,
   * because rehearsing a purchase is what staging is for.
   *
   * Named for the POLICY, not for a network: the repo's `_TESTNET2` suffix
   * already means "the value for that network id", and this is not one — there
   * is no `_MAINNET` sibling. Which networks it governs is
   * requiresSalesOptIn() in networkCapabilities.ts, its own allowlist, so a
   * future testnet needs no new variable and a real-money network can join it
   * without redefining what "test money" means.
   *
   * Real-money networks are not covered here — they keep answering to the
   * deployment-wide PAID_PLANS_ENABLED above, so no existing deployment changes.
   */
  PAID_PLANS_ON_TEST_NETWORKS?: string;

  /** Per-network wallet-api backend bases; absent/empty = not served here. */
  WALLET_API_URL_TESTNET2?: string;
  WALLET_API_URL_MAINNET?: string;
  /** Deliberate mainnet rollout switch; anything but exactly 'true' is off. */
  MAINNET_ROLLOUT_ENABLED?: string;
  /**
   * Declares wallet-api custody (#351). Here rather than on a sed placeholder
   * because it gates branches — the availability gate and the #351 throw. As a
   * placeholder it const-folded to a hardcoded `true` and vanished from the
   * bundle, arming both unconditionally and making the flag inert.
   */
  REQUIRE_WALLET_API?: string;
  /**
   * Which network a wallet with no stored choice starts on. Lets a
   * mainnet-first deployment exist without a rebuild.
   *
   * ⚠️ Changing this on a LIVE deployment moves every user who never chose a
   * network — they would open an empty balance on another network and read it
   * as lost funds. To take existing users to mainnet, ship the invitation
   * (shouldAnnounceMainnet) instead and leave this alone.
   */
  DEFAULT_NETWORK?: string;
}

/** The container-supplied config, or undefined (SSR / not yet written). */
export function readRuntimeConfig(): SphereRuntimeConfig | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as { __SPHERE_RUNTIME_CONFIG__?: SphereRuntimeConfig })
    .__SPHERE_RUNTIME_CONFIG__;
}

/**
 * Runtime value if present and non-empty, else the build-time env value.
 * Empty string means "not set on the container env" (runtime-config.sh always
 * writes every key), so it must not shadow a value baked at build time.
 */
export function runtimeSetting(
  key: keyof SphereRuntimeConfig,
  envValue: string | undefined,
): string | undefined {
  const value = readRuntimeConfig()?.[key];
  if (value === undefined || value === '') return envValue;
  return value;
}

/** A runtime flag is on only for EXACTLY 'true' (matches runtime-config.sh). */
export function runtimeFlag(key: keyof SphereRuntimeConfig, envValue: string | undefined): boolean {
  return runtimeSetting(key, envValue) === 'true';
}

/**
 * Per-wallet SGW subscription keys are in use.
 *
 * Defined in this leaf, and re-exported from src/config/subscription.ts as the
 * public name, because the network availability gate has to know it too: a
 * real-value network cannot run on the shared build-time aggregator key, so
 * offering it while subscriptions are off would offer a network that is
 * guaranteed to throw at provider composition. subscription.ts derives its base
 * URL from the active network, so network.ts cannot import from it.
 */
export const SUBSCRIPTION_ENABLED = runtimeFlag(
  'SUBSCRIPTION_ENABLED',
  import.meta.env.VITE_SUBSCRIPTION_ENABLED as string | undefined,
);
