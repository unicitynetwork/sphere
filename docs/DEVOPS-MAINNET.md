# Mainnet deployment — DevOps handoff

Exactly which variables to set, where, and what each one does. Written against
`main` + `feat/network-switcher`, revised 2026-09-03 against the pinned SDK
(`@unicitylabs/sphere-sdk@0.16.0` — the bump that onboarded mainnet).

---

## TL;DR — what you actually add

Three new container env vars. **Nothing else changes**, and no image rebuild is
needed for them (they are read at container start, not baked at build):

| Variable | Set it to | Effect |
|---|---|---|
| `WALLET_API_URL_TESTNET2` | your testnet2 wallet-api base | Serves testnet2. **Optional today** — if unset it is seeded from the legacy `WALLET_API_URL`, so existing task definitions keep working untouched. |
| `WALLET_API_URL_MAINNET` | your mainnet wallet-api base | Serves mainnet. **Empty/unset ⇒ this deployment does not offer mainnet at all** and the Settings → Network row stays greyed out. |
| `MAINNET_ROLLOUT_ENABLED` | `true` | The deliberate go-live switch. Anything but exactly `true` keeps mainnet unselectable even when everything else is configured. |

A wallet only offers a network when **all four** are true:

```
the SDK knows the network
  AND  this deployment has its wallet-api URL
  AND  (real-value networks) SUBSCRIPTION_ENABLED=true
  AND  (mainnet only) the rollout switch is on
```

The third is the one operators miss, because nothing points at it: mainnet
refuses the shared build-time aggregator key — it ships readable to every
visitor — so with `SUBSCRIPTION_ENABLED` off the row stays greyed even when the
URL and the rollout switch are both set, and the UI gives no hint why.

**The first condition is now TRUE.** Up to `0.15.0` the pinned SDK shipped no
mainnet `networkId`, so mainnet rendered greyed out as "Coming soon" whatever
you set. `0.16.0` onboards it — `networkId: 1`, an embedded mainnet trust
base, the live `gateway.mainnet.unicity.network` and its own token registry — so
that gate opened **by itself**, with no change in this repo. Exactly the "it
disappears on its own" this section warned about; it has now happened.

What that changes for you: mainnet's greyed row no longer reads "Coming soon"
but **"Not available here"**, because the reason is now the deployment's. What
still holds it is `WALLET_API_URL_MAINNET`, `SUBSCRIPTION_ENABLED=true` (a
real-value network refuses the shared build-time aggregator key) and
`MAINNET_ROLLOUT_ENABLED`. So:

- setting `WALLET_API_URL_MAINNET` early is safe — on its own it only makes the
  deployment *capable* of serving mainnet;
- setting `MAINNET_ROLLOUT_ENABLED=true` early is **not** safe. It arms a
  go-live that an unrelated dependency bump would then trigger silently.

## Why per-network URLs at all

The wallet now lets a user switch networks at runtime, and the SDK's wallet-api
client is **bound to the active network**: it refuses a challenge naming a
different one. So a mainnet session pointed at a testnet2 backend does not
degrade — it dies at sign-in and takes the whole asset/custody path with it.
One URL per deployment cannot serve two networks.

## Where each value goes

| Variable | Where | Notes |
|---|---|---|
| `WALLET_API_URL_TESTNET2` · `WALLET_API_URL_MAINNET` · `MAINNET_ROLLOUT_ENABLED` | **ECS task definition / `docker -e`** | Read at container start into `window.__SPHERE_RUNTIME_CONFIG__`. No Dockerfile ARG, no rebuild. |
| `SPHERE_API_URL` · `WALLET_API_URL` · `REQUIRE_WALLET_API` · `DEV_PORTAL_URL` · `AGGREGATOR_API_KEY` | ECS task definition / `docker -e` | Existing contract, unchanged (sed-substituted into the built JS). |
| `SUBSCRIPTION_ENABLED` · `PAID_PLANS_ENABLED_TESTNET` · `PAID_PLANS_ENABLED_MAINNET` | ECS task definition / `docker -e` | Runtime flags. The paid-plans pair replaces the deployment-wide `PAID_PLANS_ENABLED`, which is still honoured for mainnet while `_MAINNET` is unset. |

**Why the new ones do not use the `__RUNTIME_*__` placeholder mechanism:** they
decide whether a network is *offered*, and an availability decision is a branch.
Rollup evaluates branch conditions against the baked placeholder at build time
and prunes the dead side — and this fold goes the **dangerous** way:
`Boolean('__RUNTIME_…__')` is `true`, so mainnet would look available in every
container regardless of your task definition. Worse, the fold *erases* the
placeholder, so the CI guard that greps for surviving `__RUNTIME_` strings
cannot see it. This was verified empirically against this repo's toolchain. A
`window` global read cannot be folded, so these values ride that instead — the
same mechanism the subscription flags already use.

## Full variable reference for a mainnet deployment

| Variable | testnet2 deployment | mainnet deployment |
|---|---|---|
| `SPHERE_API_URL` | quest-api URL | **same** — quests are network-blind (the identity address is identical on every network, so XP carries over) |
| `WALLET_API_URL_TESTNET2` | testnet2 wallet-api | set only if this deployment also offers testnet2 |
| `WALLET_API_URL_MAINNET` | *unset* (hides mainnet) | **mainnet wallet-api** |
| `MAINNET_ROLLOUT_ENABLED` | *unset* | **`true`** |
| `REQUIRE_WALLET_API` | as today | as today |
| `SUBSCRIPTION_ENABLED` | `true` | **`true` — required, see below** |
| `AGGREGATOR_API_KEY` | non-secret testnet2 key | **leave UNSET** — see below |
| `PAID_PLANS_ENABLED_MAINNET` | not `true` | **`true`** |
| `PAID_PLANS_ENABLED_TESTNET` | `false` | `false` — production never sells where the tokens are worthless |
| `DEV_PORTAL_URL` | unchanged | unchanged |

### `SUBSCRIPTION_ENABLED=true` is mandatory on mainnet
Not for convenience. `AGGREGATOR_API_KEY` is substituted **into the JS the
browser downloads**, so a static aggregator key is **not a secret on any
client** — every visitor can read it from devtools and spend the operator's
quota. With subscriptions on there is no shared key in the bundle at all: each
wallet signs a challenge for its own SGW key, metered and revocable per key.
The app now **refuses to start** on a real-value network with subscriptions off,
rather than leak the key.

### What you must NOT configure — it follows the network by itself
`NETWORKS[network]` in SDK 0.16.0 carries exactly six things: `name`,
`networkId` (now present on every network in the table), `aggregatorUrl`,
`nostrRelays`, `groupRelays`, `tokenRegistryUrl`. Two more values follow the network without
being fields in it: the **SGW base URL**, which the app derives from
`aggregatorUrl` because the SGW *is* the gateway (`src/config/subscription.ts`),
and the **trust base**, which the SDK embeds per network. None of them takes an
env var, and adding one re-breaks the switcher.

(An earlier revision of this list also named *IPFS gateways*. That was wrong:
the SDK's network table has no IPFS field and the wallet makes no IPFS calls.)

## Mainnet SGW (subscription gateway)

Mainnet needs its **own SGW instance with its own Postgres**. Keys are bearer
tokens scoped to one instance — a testnet2 key is unknown to a mainnet SGW
(401/404), and free keys re-provision per network automatically.

**Critical setting:** `GATEWAY_AUTH_NETWORK=mainnet`.

The gateway embeds this string in every auth challenge, and the wallet **refuses
to sign a challenge whose network differs from its active one** (anti
cross-network key harvesting). A mainnet SGW left at the default `testnet2`
means **no wallet can provision a key** — it fails client-side with "network
mismatch", which looks like a wallet bug, not a config one.

## Fail-closed behaviour — the container refuses to start if:
- **there is no wallet-api URL for _any_ network** — unconditional, regardless
  of `REQUIRE_WALLET_API`. There is no local-custody mode left to fall back to:
  `Sphere.init` refuses to compose money without a wallet-api config
  (`INVALID_CONFIG`), so such a container would start cleanly and then fail in
  every browser;
- `REQUIRE_WALLET_API` is truthy but neither `WALLET_API_URL_TESTNET2` nor the
  legacy `WALLET_API_URL` is set (#351). Since the fallback disappeared this
  flag no longer decides *whether* such a deployment breaks, only *where*: with
  it set the failure is a named error at provider composition instead of the
  SDK's generic one a step later;
- `MAINNET_ROLLOUT_ENABLED=true` but `WALLET_API_URL_MAINNET` is empty on a
  wallet-api deployment (you would believe mainnet is live while the row stays
  greyed out);
- `AGGREGATOR_API_KEY` is empty while `SUBSCRIPTION_ENABLED` is not `true`;
- any of the runtime-config values contains a CR/LF (it would break the
  generated `runtime-config.js` and silently revert *every* flag — a trailing
  `\r` from a CRLF paste is exactly how that happens).

A **missing** `WALLET_API_URL_MAINNET` is deliberately **not** an error:
offering fewer networks is legitimate. The container logs which networks it
offers at start — grep for `wallet-api networks offered:` when a network is
unexpectedly greyed out. That log is the intended first stop for
"why can't I select mainnet".

If that line lists **no networks**, the container cannot run a wallet at all,
even though it started: every network it could offer is either missing a URL or
held by the rollout switch, and there is no custody model that works without a
wallet-api backend. The commonest way to get there is a mainnet-only task
definition with `MAINNET_ROLLOUT_ENABLED` left off.

Flags are compared against **exactly `true`**; `TRUE`, `1`, `yes` mean off (the
script warns).

### After changing any value
Filenames are content-hashed and these values are patched **inside** the hashed
JS, so filenames do not change: **invalidate the CDN/CloudFront** or clients
keep the old config.

## Traps

1. **Never pin `VITE_SUBSCRIPTION_API_URL`** in a deployed build. It is a
   local-dev override only. Pinned, it keeps calling the old network's SGW after
   a switch and key provisioning dies with "network mismatch". Unset, it follows
   the network.
2. **Never point `WALLET_API_URL_MAINNET` at a testnet backend** (or vice
   versa). It fails at sign-in, not at request time, so the whole asset path
   dies at once.
3. **Do not commit a mainnet `AGGREGATOR_API_KEY`** — and prefer not to set it
   at all on mainnet (see above).
4. **Never set `VITE_AGGREGATOR_URL` / `VITE_TRUSTBASE_URL` in a deployed
   image.** They are a local/e2e stack override. A gateway and the trust base it
   serves are one pair, so the override describes exactly one network — the
   deployment's start network, and `getEngineOverride` now ignores it on every
   other one rather than mixing trust bases across a switch. Set in a deployed
   image it would still override the start network's real gateway.
5. **Do not add a `NETWORK` variable** to the sed contract expecting it to
   work — Vite const-folds branch conditions against baked literals. Values that
   gate a branch belong on `window.__SPHERE_RUNTIME_CONFIG__` (as the new
   per-network vars do). Network *selection* itself is a persisted user choice
   (`sphere_active_network` in localStorage) plus the build default.

## Blocking prerequisites (not DevOps, but gate the rollout)

Do not flip `MAINNET_ROLLOUT_ENABLED` before these land — both are money-safety:

- ~~**Network-scoped relay cursors** (SDK)~~ — **moot, and moot because the
  mechanism was DELETED, not because it was fixed.** Tokens no longer travel
  over Nostr relays at all: the asset event kinds (31113/31115/31116) are gone
  from the SDK, and delivery is the wallet-api mailbox. Its cursor lives in the
  per-(network, address) KV under `pv2g2:{network}:{chainPubkey}:cursor:*`, so
  it is network-scoped by construction and no switch can share one. Written out
  rather than deleted so nobody re-adds the blocker: there is no relay cursor
  left to scope.
- **Self-mint gating** (wallet) — done on `feat/network-switcher`: Top Up, Swap
  and the Connect `mint` intent are refused off test networks. Without it, the
  moment a mainnet trust base ships anyone could mint real coinIds for free.

Plus the SDK/protocol side, none of which this repo can supply — each one is
observable in the pinned SDK, so check it there rather than in a plan doc.
**Four of the five landed in `0.16.0`:**

- ~~a mainnet **`networkId`** and a mainnet **trust base**~~ — shipped:
  `networkId: 1`, root trust base embedded in `assets/trustbase.ts` and pinned
  by an integrity test against the published `bft-trustbase.mainnet.json`;
- ~~a **mainnet gateway**~~ — shipped: `NETWORKS.mainnet.aggregatorUrl` is
  `https://gateway.mainnet.unicity.network` (the old
  `aggregator.unicity.network/rpc` placeholder was a v1 host that no longer
  resolves);
- **fungible definitions in the mainnet token registry** — **deliberately empty,
  and NOT a rollout blocker.** `unicity-ids.mainnet.json` holds exactly one
  entry, the non-fungible base type. Mainnet launches with no fungible assets at
  all; ids arrive with bridging, once real crypto can be brought in from other
  networks. A wallet on mainnet therefore shows an empty balance, which is the
  expected state rather than a fault.

  It becomes a prerequisite **at bridging time**, and the reason is worth
  recording now so it is not rediscovered then: `PaymentRequestIntentModal`
  reads `def?.decimals ?? 0` and formats the approval amount from it, so the
  first fungible id that exists without a registry entry would have a user
  approve a **raw base-unit number with no symbol** — `100000000` where they
  mean `1.00 UCT` — on real money. Balances and the send confirmation degrade
  the same way. Define the coins before shipping the bridge, not after;
- a **mainnet wallet-api backend** to put in `WALLET_API_URL_MAINNET` — **DONE,
  2026-09-04:** `https://wallet-api.mainnet.unicity.network`. Confirmed serving
  networkId 1, and confirmed by construction rather than by inspection:
  wallet-api#137 makes `NETWORK_ID` a required fail-closed assertion against the
  parsed trust base's `networkId` at boot, so a mismatch crash-loops instead of
  serving. A healthy task IS the proof. (`/v1/health` reports only status and
  build sha; an identical sha across environments is expected — one
  network-agnostic image, network supplied entirely by env.)

Note also that mainnet shares testnet's Nostr relay until a dedicated one is
stood up, so nametag bindings for both networks live in one namespace.

(This used to link `docs/superpowers/plans/2026-07-15-mainnet-readiness-roadmap.md`.
That pointer is dropped: `docs/superpowers/` is gitignored, so the file was never
committed and the link resolved to nothing for anyone who cloned the repo.)

## Smoke checklist for a mainnet deployment

1. Container starts; logs show `wallet-api networks offered: mainnet`.
2. `GET /runtime-config.js` shows the per-network URLs and
   `MAINNET_ROLLOUT_ENABLED`.
3. Settings → Network shows **Mainnet — Current** (a greyed row reading
   "Not available here" means this deployment cannot serve it — no
   `WALLET_API_URL_MAINNET`, or `SUBSCRIPTION_ENABLED` is not `true`;
   "Coming soon" now means only the rollout switch, since the SDK gate is open).
4. Onboard a fresh wallet → a subscription key provisions (no "network
   mismatch") → Settings → Subscription shows a plan.
5. Wallet actions show **no Top Up button** and a **disabled Swap** — their
   presence on mainnet is a release blocker.
6. Send a small amount between two wallets; confirm receipt.

