/**
 * Per-network capability gates for the wallet UI.
 *
 * WHY: self-mint (Top Up, Swap's mint leg, the Connect `mint` intent) creates
 * fungible tokens out of thin air. The aggregator cannot police it server-side:
 * a certification_request carries no coinId, and MINTER_SECRET is public — so
 * on mainnet a self-mint would create REAL coinIds for free. The wallet is the
 * only gate, therefore it must FAIL CLOSED: minting is allowed only on the
 * explicit test-network allowlist below; 'mainnet', unknown or future network
 * names are denied by default.
 */

/**
 * Networks that carry test money only. Every capability below is granted from
 * this one allowlist, so a new network is denied everything until it is listed
 * deliberately. Exact match by design: a typo'd network unlocks nothing.
 *
 * 'testnet' stays: it is a real alias of testnet2 in the SDK table, so a wallet
 * can genuinely be asked about it. 'dev' is gone — sphere-sdk 0.16.0-dev.1
 * deleted that network, and since the parameter is a plain `string` a stale
 * entry would silently keep granting mint to a name nothing can resolve.
 */
const TEST_NETWORKS: ReadonlySet<string> = new Set(['testnet2', 'testnet']);

/** User-facing error for gated mint attempts (hook throws + Connect intent reject). */
// Top Up only. NOT a statement that the network cannot mint: a dApp intent or
// direct sphere-sdk use mints on any network with the user's own gateway key.
export const MINT_UNAVAILABLE_MESSAGE = 'Top Up is only available on test networks';

/**
 * Fail-closed allowlist: true only for known test networks. Any other value —
 * including 'mainnet', '', case variants and future network names — is false.
 */
export function canSelfMint(network: string): boolean {
  return TEST_NETWORKS.has(network);
}

/**
 * Fail-closed allowlist: true when the money on this network is play money.
 *
 * A SEPARATE question from canSelfMint, and a separate set on purpose even though
 * the two coincide today. "May the wallet mint here" and "is this real value" are
 * different: a test network could have minting switched off, and the badge would
 * then have to keep saying the tokens are worthless. Borrowing canSelfMint for the
 * badge made it lie in exactly that case. testMoneyMatchesSelfMint() below pins
 * that they agree, so any divergence has to be written down rather than drifting.
 */
const TEST_MONEY_NETWORKS: ReadonlySet<string> = new Set(['testnet2', 'testnet']);

export function isTestMoney(network: string): boolean {
  return TEST_MONEY_NETWORKS.has(network);
}

/**
 * Fail-closed allowlist: true when a purchase on this network costs REAL money.
 *
 * The subscription gateway is per-network — `SUBSCRIPTION_API_URL` derives from
 * `NETWORKS[SPHERE_NETWORK].aggregatorUrl` — but the flag that opens the store
 * was deployment-wide, and `docs/DEVOPS-MAINNET.md` explicitly permits ONE
 * deployment to serve both networks. So a user who switched to testnet could
 * still open the upgrade flow and pay real money for a key belonging to a test
 * network (#497 item 2). Every other money-shaped decision here is network-
 * derived; this makes that one match.
 */
export function chargesRealMoney(network: string): boolean {
  return !isTestMoney(network);
}

/**
 * Fail-closed allowlist: true when selling a paid plan here needs the
 * DEPLOYMENT to say so explicitly, rather than being covered by the ordinary
 * store flag.
 *
 * A THIRD question, and a third set, even though it coincides with isTestMoney
 * today — the same reason that one is separate from canSelfMint. "Is this play
 * money" and "may we sell here" are different sentences: a real-value network
 * can exist whose store is not open yet (a second mainnet, a soft launch), and
 * borrowing isTestMoney for this would leave no way to say so except switching
 * the store off everywhere at once.
 *
 * What the opt-in guards is the expensive mistake: charging real money for a
 * key that only works where tokens are worthless. Staging opts in because
 * rehearsing a purchase is what staging is for; production never does.
 */
const SALES_OPT_IN_NETWORKS: ReadonlySet<string> = new Set(['testnet2', 'testnet']);

export function requiresSalesOptIn(network: string): boolean {
  return SALES_OPT_IN_NETWORKS.has(network);
}

/** The two allowlists agree today; exported so a test can pin it. */
export function salesOptInMatchesTestMoney(network: string): boolean {
  return requiresSalesOptIn(network) === isTestMoney(network);
}

/** The two allowlists agree today; exported so a test can pin it. */
export function testMoneyMatchesSelfMint(network: string): boolean {
  return isTestMoney(network) === canSelfMint(network);
}

/**
 * Whether ONE shared, build-time aggregator key (VITE_AGGREGATOR_API_KEY) may
 * serve every wallet on this network.
 *
 * WHY: that key is compiled into the JS the browser downloads (and
 * deploy/runtime-config.sh seds it into the built bundle), so it is readable by
 * every visitor — it is not, and cannot be, a secret. On a test network that is
 * harmless: the key guards worthless money and is published on purpose. On a
 * real-value network it would hand the operator's aggregator quota to anyone
 * who opens devtools, which is exactly what per-wallet subscription keys exist
 * to prevent. Fail closed: only test networks may use the shared key.
 */
export function allowsSharedAggregatorKey(network: string): boolean {
  return TEST_NETWORKS.has(network);
}
