import { describe, it, expect } from 'vitest';
import {
  formatPlanPrice,
  isFreePlan,
  isPopularPlan,
  isPlanSelectable,
  planFeatures,
  syntheticCurrentPlan,
  keepPlanLabel,
  continueWithPlanLabel,
  planGridList,
  isFreePlanName,
  hasPaidOffers,
} from '@/components/subscription/planFeatures';
import type { PlanInfo } from '@/services/subscriptionApi';

const basic: PlanInfo = {
  planId: 2,
  name: 'basic',
  requestsPerMinute: 300,
  requestsPerDay: 50000,
  priceCents: 500,
  fiatCurrency: 'USD',
};

describe('formatPlanPrice', () => {
  it('formats priceCents as dollars', () => {
    expect(formatPlanPrice(basic)).toBe('$5.00');
    expect(formatPlanPrice({ ...basic, priceCents: 1550 })).toBe('$15.50');
    expect(formatPlanPrice({ ...basic, priceCents: 0 })).toBe('Free');
  });
});

describe('isFreePlan / isPopularPlan', () => {
  it('detects the free plan by priceCents', () => {
    expect(isFreePlan({ ...basic, priceCents: 0 })).toBe(true);
    expect(isFreePlan(basic)).toBe(false);
  });

  it('flags only the standard plan as popular (case-insensitive)', () => {
    expect(isPopularPlan({ ...basic, name: 'Standard' })).toBe(true);
    expect(isPopularPlan({ ...basic, name: 'standard' })).toBe(true);
    expect(isPopularPlan({ ...basic, name: 'premium' })).toBe(false);
  });
});

describe('planFeatures', () => {
  it('derives per-minute feature copy', () => {
    expect(planFeatures(basic)).toEqual([
      '50,000 commitments per day',
      'Up to 300 commitments per minute',
      '30-day subscription',
    ]);
  });

  it('marks the free plan with a no-payment bullet', () => {
    expect(planFeatures({ ...basic, priceCents: 0 })[2]).toBe('Free — no payment required');
  });
});

describe('isPlanSelectable', () => {
  const active = { currentPlanName: 'basic', subscriptionStatus: 'active' as const, paidPlansEnabled: true };

  it('allows buying a different paid plan', () => {
    expect(isPlanSelectable({ ...basic, name: 'premium' }, active)).toBe(true);
  });

  it('blocks re-buying the ACTIVE current plan (nothing to gain — no time carry-over)', () => {
    expect(isPlanSelectable(basic, active)).toBe(false);
    expect(isPlanSelectable({ ...basic, name: 'Basic' }, active)).toBe(false); // case-insensitive
  });

  it('allows renewing the current plan once it is no longer active', () => {
    expect(isPlanSelectable(basic, { ...active, subscriptionStatus: 'expired' })).toBe(true);
    expect(isPlanSelectable(basic, { ...active, subscriptionStatus: 'inactive' })).toBe(true);
    expect(isPlanSelectable(basic, { ...active, subscriptionStatus: null })).toBe(true);
  });

  it('never selects the synthetic/free card (it is not a store product)', () => {
    expect(isPlanSelectable({ ...basic, priceCents: 0 }, { ...active, subscriptionStatus: 'expired' })).toBe(false);
  });

  it('blocks paid plans while purchases are disabled', () => {
    expect(isPlanSelectable({ ...basic, name: 'premium' }, { ...active, paidPlansEnabled: false })).toBe(false);
  });
});

describe('syntheticCurrentPlan', () => {
  it('synthesizes the current free card from utilization', () => {
    const util = {
      status: 'active',
      activeUntil: null,
      plan: { name: 'free', requestsPerMinute: 60, requestsPerDay: 1000 },
      utilization: {},
    } as never;
    expect(syntheticCurrentPlan(util)).toEqual({
      planId: -1,
      name: 'free',
      requestsPerMinute: 60,
      requestsPerDay: 1000,
      priceCents: 0,
      fiatCurrency: 'USD',
    });
  });

  it('returns null when utilization has no plan', () => {
    const util = { status: 'inactive', activeUntil: null, plan: null, utilization: {} } as never;
    expect(syntheticCurrentPlan(util)).toBeNull();
  });
});

describe('planGridList', () => {
  const free: PlanInfo = { ...basic, planId: -1, name: 'free', priceCents: 0 };
  const premiumStore: PlanInfo = { ...basic, planId: 9, name: 'premium', priceCents: 3000 };

  it('keeps the synthetic current card when the store has no card for it', () => {
    // The store excludes the free plan, so the free current card is the only one.
    expect(planGridList(free, [basic, premiumStore])).toEqual([free, basic, premiumStore]);
  });

  it('drops the synthetic card when the store already sells that plan', () => {
    // Otherwise a paid wallet gets two premium cards and the synthetic one
    // (priceCents 0 by construction) prices premium as "Free".
    const syntheticPremium: PlanInfo = { ...premiumStore, planId: -1, priceCents: 0 };
    expect(planGridList(syntheticPremium, [basic, premiumStore])).toEqual([basic, premiumStore]);
  });

  it('matches the store plan case-insensitively', () => {
    const syntheticPremium: PlanInfo = { ...premiumStore, planId: -1, name: ' Premium ', priceCents: 0 };
    expect(planGridList(syntheticPremium, [premiumStore])).toEqual([premiumStore]);
  });

  it('returns the store list untouched when there is no current plan', () => {
    expect(planGridList(null, [basic])).toEqual([basic]);
  });
});

describe('isFreePlanName', () => {
  it('recognises the gateway free tier by name, since utilization carries no price', () => {
    expect(isFreePlanName('free')).toBe(true);
    expect(isFreePlanName(' Free ')).toBe(true);
    expect(isFreePlanName('premium')).toBe(false);
    expect(isFreePlanName(null)).toBe(false);
    expect(isFreePlanName(undefined)).toBe(false);
  });
});

describe('decline labels (sphere#496)', () => {
  it('names the kept plan so the decline is a choice, not a dismissal', () => {
    expect(keepPlanLabel('free')).toBe('Keep my Free plan');
    expect(keepPlanLabel('premium')).toBe('Keep my Premium plan');
  });

  it('falls back to plan-agnostic wording when no plan name is known yet', () => {
    expect(keepPlanLabel(null)).toBe('Maybe later');
    expect(keepPlanLabel('  ')).toBe('Maybe later');
  });

  it("frames onboarding's footer as a plan choice only while paid plans are on sale", () => {
    expect(continueWithPlanLabel('free', true)).toBe('Continue with Free plan');
    // Store off (testnet): there is nothing to decline, so the wizard wording stays.
    expect(continueWithPlanLabel('free', false)).toBe('Enter Wallet');
    expect(continueWithPlanLabel(null, true)).toBe('Enter Wallet');
  });
});

describe('hasPaidOffers — is there anything to sell here at all', () => {
  it('is false where the store is off, whatever the catalogue holds', () => {
    // testnet2: PAID_PLANS_ENABLED is `flag && chargesRealMoney(network)`.
    expect(hasPaidOffers([basic], false)).toBe(false);
  });

  it('is false for a LOADED catalogue with nothing paid in it', () => {
    expect(hasPaidOffers([], true)).toBe(false);
    // A zero-priced row that slipped past the store filter is not an offer.
    expect(hasPaidOffers([{ ...basic, priceCents: 0 }], true)).toBe(false);
  });

  it('is true once the catalogue carries a paid plan', () => {
    expect(hasPaidOffers([{ ...basic, priceCents: 0 }, basic], true)).toBe(true);
  });

  it('fails OPEN while the catalogue has not resolved', () => {
    // undefined is react-query's `data` before success: loading, disabled or
    // errored. Hiding a real purchase path because the gateway is slow would be
    // worse than showing a surface that turns out to be empty.
    expect(hasPaidOffers(undefined, true)).toBe(true);
    expect(hasPaidOffers(null, true)).toBe(true);
  });

  it('lets the flag win over a fail-open unknown catalogue', () => {
    expect(hasPaidOffers(undefined, false)).toBe(false);
  });
});
