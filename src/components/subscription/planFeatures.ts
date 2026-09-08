/**
 * Pure helpers for rendering plan cards. The store's plan object only carries
 * planId/name/requestsPerMinute/requestsPerDay/priceCents/fiatCurrency — the
 * card's feature bullets are DERIVED from those fields (no hardcoded marketing
 * copy), so they never drift from admin-configured plans.
 */
import type { PlanInfo, UtilizationInfo } from '../../services/subscriptionApi';

/** Plan (matched by name, case-insensitive) that gets the "Popular" badge. */
export const POPULAR_PLAN_NAME = 'standard';

export function isPopularPlan(plan: PlanInfo): boolean {
  return plan.name.trim().toLowerCase() === POPULAR_PLAN_NAME;
}

export function isFreePlan(plan: PlanInfo): boolean {
  return plan.priceCents <= 0;
}

/**
 * The gateway's free tier, identified by NAME. Utilization carries no price,
 * so the name is the only signal available to callers holding a
 * UtilizationInfo (the store's own cards use isFreePlan instead). 'free' is
 * what /auth/verify provisions and reports.
 */
export function isFreePlanName(name: string | null | undefined): boolean {
  return (name ?? '').trim().toLowerCase() === 'free';
}

/** Card price from the store's fiat cents: 500 → "$5.00"; 0 → "Free". */
export function formatPlanPrice(plan: PlanInfo): string {
  if (plan.priceCents <= 0) return 'Free';
  return `$${(plan.priceCents / 100).toFixed(2)}`;
}

/** Store plan names arrive lowercase ('free', 'basic') — title them for prose. */
function capitalizePlan(name: string): string {
  const trimmed = name.trim();
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/**
 * Label for the action that DECLINES a purchase and keeps the plan the wallet
 * already has. Naming the plan makes the decline a real choice rather than a
 * bare dismissal — the corner X and "Back to plans" say nothing about what
 * happens to the current subscription. Falls back to plan-agnostic wording
 * while utilization hasn't resolved a plan name.
 */
export function keepPlanLabel(currentPlanName: string | null): string {
  if (!currentPlanName?.trim()) return 'Maybe later';
  return `Keep my ${capitalizePlan(currentPlanName)} plan`;
}

/**
 * Label for onboarding's footer button, which both declines the offer and
 * enters the wallet. It only frames itself as a plan choice while paid plans
 * are actually purchasable — with the store off (testnet) there is nothing to
 * decline, so the plain "Enter Wallet" wording stays.
 */
export function continueWithPlanLabel(
  currentPlanName: string | null,
  paidPlansEnabled: boolean,
): string {
  if (!paidPlansEnabled || !currentPlanName?.trim()) return 'Enter Wallet';
  return `Continue with ${capitalizePlan(currentPlanName)} plan`;
}

/**
 * The card list for a plan surface: the wallet's current plan followed by the
 * store catalogue.
 *
 * The store list only excludes the FREE plan, so a wallet already on a PAID
 * plan would otherwise get TWO cards for it — and the synthetic one would
 * misprice that plan as "Free", since syntheticCurrentPlan hardcodes
 * priceCents 0 (it was built for the free tier). When the store already
 * carries the current plan, its card wins: same name, real price, and
 * PlansGrid marks it current anyway. The synthetic card's limits come from
 * utilization rather than the catalogue, so this trades a per-wallet limit
 * readout for a correct price — the right way round for a purchase surface.
 */
export function planGridList(current: PlanInfo | null, storePlans: PlanInfo[]): PlanInfo[] {
  if (!current) return storePlans;
  const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  return storePlans.some((p) => sameName(p.name, current.name))
    ? storePlans
    : [current, ...storePlans];
}

/** Feature checklist derived purely from the plan's fields. */
export function planFeatures(plan: PlanInfo): string[] {
  return [
    `${plan.requestsPerDay.toLocaleString()} commitments per day`,
    `Up to ${plan.requestsPerMinute.toLocaleString()} commitments per minute`,
    isFreePlan(plan) ? 'Free — no payment required' : '30-day subscription',
  ];
}

/**
 * Whether a plan card is a valid purchase target right now. The synthetic
 * current card (priceCents 0) is informational only. Re-buying the current
 * plan is blocked while it's ACTIVE — the gateway resets the window to
 * now+30d with no time carry-over, so an early re-buy only loses time — but
 * allowed once the subscription lapses ('expired'/'inactive'/unknown): that
 * is the renew path (same key, fresh 30 days).
 */
export function isPlanSelectable(
  plan: PlanInfo,
  opts: {
    currentPlanName: string | null;
    subscriptionStatus: 'active' | 'expired' | 'inactive' | null;
    paidPlansEnabled: boolean;
  },
): boolean {
  if (plan.priceCents <= 0) return false;
  if (!opts.paidPlansEnabled) return false;
  const isCurrent = plan.name.toLowerCase() === (opts.currentPlanName ?? '').toLowerCase();
  return !(isCurrent && opts.subscriptionStatus === 'active');
}

/**
 * Whether this network has anything to sell right now: the store is on AND its
 * catalogue actually carries a paid plan.
 *
 * `plans` is react-query's `data` verbatim, and the undefined/`[]` distinction
 * is the whole point. `undefined` means the catalogue has NOT resolved —
 * loading, query disabled, or errored — and that FAILS OPEN, because hiding a
 * real purchase path because the gateway is slow is worse than briefly showing
 * a surface that turns out to be empty. Only a LOADED catalogue with no paid
 * plan is false. Never pass `plans.data ?? []`: that collapses the two states
 * and turns the fail-open into a fail-closed.
 *
 * The price test is not redundant with the gateway's own filter. `findPurchasable()`
 * excludes the free tier BY NAME, so a zero-priced row under another name would
 * reach the client; an offer is defined here by its price, as everywhere else.
 */
export function hasPaidOffers(
  plans: PlanInfo[] | undefined | null,
  paidPlansEnabled: boolean,
): boolean {
  if (!paidPlansEnabled) return false;
  if (!plans) return true;
  return plans.some((plan) => !isFreePlan(plan));
}

/**
 * The store list excludes the free plan, so the user's current (free) plan card
 * is synthesized from utilization data. planId -1 is never a store id.
 */
export function syntheticCurrentPlan(util: UtilizationInfo): PlanInfo | null {
  if (!util.plan) return null;
  return {
    planId: -1,
    name: util.plan.name,
    requestsPerMinute: util.plan.requestsPerMinute,
    requestsPerDay: util.plan.requestsPerDay,
    priceCents: 0,
    fiatCurrency: 'USD',
  };
}
