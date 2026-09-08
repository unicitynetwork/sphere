/**
 * sphere#511 item 3: after a DELIBERATE network switch, offer that network's
 * plans once — and never on any other load.
 *
 * This is the surface #500 removed for firing on every app entry, so the tests
 * are mostly about when it must stay silent.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

const ctx = vi.hoisted(() => ({
  switchedTo: 'mainnet' as string | null,
  paidPlansEnabled: true,
  keyStatus: 'ready' as string,
  walletExists: true,
  isLocked: false,
  isLoading: false,
  plan: { name: 'free', requestsPerMinute: 10, requestsPerDay: 1000 } as { name: string; requestsPerMinute: number; requestsPerDay: number } | null,
  plans: [
    { planId: 2, name: 'basic', requestsPerMinute: 300, requestsPerDay: 50000, priceCents: 500, fiatCurrency: 'USD' },
  ] as unknown,
  plansError: false,
}));

vi.mock('../../../src/config/network', async (orig) => ({
  ...(await orig<typeof import('../../../src/config/network')>()),
  get NETWORK_SWITCHED_TO() {
    return ctx.switchedTo;
  },
}));

vi.mock('../../../src/config/subscription', async (orig) => ({
  ...(await orig<typeof import('../../../src/config/subscription')>()),
  SUBSCRIPTION_ENABLED: true,
  get PAID_PLANS_ENABLED() {
    return ctx.paidPlansEnabled;
  },
}));

vi.mock('../../../src/sdk/hooks/subscription', () => ({
  usePlans: () => ({ data: ctx.plans, isLoading: false, isError: ctx.plansError }),
  useUtilization: () => ({
    data: ctx.plan === null ? null : { status: 'active', plan: ctx.plan, activeUntil: null, utilization: {} },
    isLoading: false,
    isError: false,
  }),
}));

vi.mock('../../../src/sdk/hooks/core/useSphere', () => ({
  useSphereContext: () => ({
    subscriptionKeyStatus: ctx.keyStatus,
    walletExists: ctx.walletExists,
    isLocked: ctx.isLocked,
    isLoading: ctx.isLoading,
  }),
}));

import { NetworkSwitchPlanOffer } from '../../../src/components/upgrade/NetworkSwitchPlanOffer';

beforeEach(() => {
  ctx.switchedTo = 'mainnet';
  ctx.paidPlansEnabled = true;
  ctx.keyStatus = 'ready';
  ctx.walletExists = true;
  ctx.isLocked = false;
  ctx.isLoading = false;
  ctx.plan = { name: 'free', requestsPerMinute: 10, requestsPerDay: 1000 };
  ctx.plans = [
    { planId: 2, name: 'basic', requestsPerMinute: 300, requestsPerDay: 50000, priceCents: 500, fiatCurrency: 'USD' },
  ];
  ctx.plansError = false;
});

describe('NetworkSwitchPlanOffer', () => {
  it('offers the new network plans once after a deliberate switch', () => {
    const openUpgrade = vi.fn();
    render(<NetworkSwitchPlanOffer openUpgrade={openUpgrade} />);
    expect(openUpgrade).toHaveBeenCalledTimes(1);
  });

  it('stays silent on a plain load', () => {
    ctx.switchedTo = null;
    const openUpgrade = vi.fn();
    render(<NetworkSwitchPlanOffer openUpgrade={openUpgrade} />);
    expect(openUpgrade).not.toHaveBeenCalled();
  });

  it('stays silent for a wallet already on a paid plan', () => {
    ctx.plan = { name: 'premium', requestsPerMinute: 900, requestsPerDay: 200000 };
    const openUpgrade = vi.fn();
    render(<NetworkSwitchPlanOffer openUpgrade={openUpgrade} />);
    expect(openUpgrade).not.toHaveBeenCalled();
  });

  it('stays silent where the new network sells nothing', () => {
    ctx.plans = [];
    const openUpgrade = vi.fn();
    render(<NetworkSwitchPlanOffer openUpgrade={openUpgrade} />);
    expect(openUpgrade).not.toHaveBeenCalled();
  });

  it('waits for the new network key instead of offering against a stale one', () => {
    ctx.keyStatus = 'provisioning';
    const openUpgrade = vi.fn();
    render(<NetworkSwitchPlanOffer openUpgrade={openUpgrade} />);
    expect(openUpgrade).not.toHaveBeenCalled();
  });

  it('stays silent while the wallet is locked', () => {
    ctx.isLocked = true;
    const openUpgrade = vi.fn();
    render(<NetworkSwitchPlanOffer openUpgrade={openUpgrade} />);
    expect(openUpgrade).not.toHaveBeenCalled();
  });

  it('disarms for a boot that went through onboarding', () => {
    // Onboarding shows its own plan step. Without this, finishing it flips
    // walletExists true against the same free-plan snapshot and the user is
    // asked twice in a row.
    ctx.walletExists = false;
    const openUpgrade = vi.fn();
    const { rerender } = render(<NetworkSwitchPlanOffer openUpgrade={openUpgrade} />);
    ctx.walletExists = true;
    rerender(<NetworkSwitchPlanOffer openUpgrade={openUpgrade} />);
    expect(openUpgrade).not.toHaveBeenCalled();
  });

  it('disarms for the lock-escape restore, which runs with a wallet that exists', () => {
    // "forgot password -> restore from recovery phrase" renders onboarding
    // INSIDE the locked branch, so walletExists is already true and the
    // !walletExists disarm never sees it. That onboarding shows its own plan
    // step; firing afterwards asks the same question twice in a row.
    ctx.isLocked = true;
    const openUpgrade = vi.fn();
    const { rerender } = render(<NetworkSwitchPlanOffer openUpgrade={openUpgrade} />);
    ctx.isLocked = false;
    rerender(<NetworkSwitchPlanOffer openUpgrade={openUpgrade} />);
    expect(openUpgrade).not.toHaveBeenCalled();
  });

  it('survives the first render of a boot, where nothing is read yet', () => {
    // Every boot starts with walletExists false while storage is still being
    // read. Disarming on that would kill the feature for everyone.
    ctx.isLoading = true;
    ctx.walletExists = false;
    const openUpgrade = vi.fn();
    const { rerender } = render(<NetworkSwitchPlanOffer openUpgrade={openUpgrade} />);
    expect(openUpgrade).not.toHaveBeenCalled();

    ctx.isLoading = false;
    ctx.walletExists = true;
    rerender(<NetworkSwitchPlanOffer openUpgrade={openUpgrade} />);
    expect(openUpgrade).toHaveBeenCalledTimes(1);
  });

  it('stays silent while the catalogue has not resolved', () => {
    // hasPaidOffers fails OPEN by design, and this surface deliberately
    // inverts that: an unprompted full-screen takeover must never appear over
    // a catalogue that may never load.
    ctx.plans = undefined;
    const openUpgrade = vi.fn();
    render(<NetworkSwitchPlanOffer openUpgrade={openUpgrade} />);
    expect(openUpgrade).not.toHaveBeenCalled();
  });

  it('answers once per boot: a paid plan closes the question for the session', () => {
    // The offer belongs to the load that followed the switch, not to the first
    // later moment when the gates happen to align. Twenty minutes on, an
    // address switch can hand this wallet a DIFFERENT, free key — and firing
    // then shows "You've switched networks" to someone who switched address.
    ctx.plan = { name: 'premium', requestsPerMinute: 900, requestsPerDay: 200000 };
    const openUpgrade = vi.fn();
    const { rerender } = render(<NetworkSwitchPlanOffer openUpgrade={openUpgrade} />);
    ctx.plan = { name: 'free', requestsPerMinute: 10, requestsPerDay: 1000 };
    rerender(<NetworkSwitchPlanOffer openUpgrade={openUpgrade} />);
    expect(openUpgrade).not.toHaveBeenCalled();
  });

  it('answers once per boot: an empty catalogue closes it too', () => {
    ctx.plans = [];
    const openUpgrade = vi.fn();
    const { rerender } = render(<NetworkSwitchPlanOffer openUpgrade={openUpgrade} />);
    ctx.plans = [
      { planId: 2, name: 'basic', requestsPerMinute: 300, requestsPerDay: 50000, priceCents: 500, fiatCurrency: 'USD' },
    ];
    rerender(<NetworkSwitchPlanOffer openUpgrade={openUpgrade} />);
    expect(openUpgrade).not.toHaveBeenCalled();
  });

  it('answers once per boot: failed provisioning is an answer, not a pause', () => {
    // The user may fix it later from Settings ("Activate free plan"). The screen
    // must not then slam over the Settings modal they are standing in.
    ctx.keyStatus = 'failed';
    const openUpgrade = vi.fn();
    const { rerender } = render(<NetworkSwitchPlanOffer openUpgrade={openUpgrade} />);
    ctx.keyStatus = 'ready';
    rerender(<NetworkSwitchPlanOffer openUpgrade={openUpgrade} />);
    expect(openUpgrade).not.toHaveBeenCalled();
  });

  it('keeps waiting while the catalogue is still in flight, then offers', () => {
    // The distinction that makes the above safe: PENDING is not an answer.
    ctx.plans = undefined;
    const openUpgrade = vi.fn();
    const { rerender } = render(<NetworkSwitchPlanOffer openUpgrade={openUpgrade} />);
    expect(openUpgrade).not.toHaveBeenCalled();

    ctx.plans = [
      { planId: 2, name: 'basic', requestsPerMinute: 300, requestsPerDay: 50000, priceCents: 500, fiatCurrency: 'USD' },
    ];
    rerender(<NetworkSwitchPlanOffer openUpgrade={openUpgrade} />);
    expect(openUpgrade).toHaveBeenCalledTimes(1);
  });

  it('does not re-open on a later render', () => {
    // useUtilization refetches every 30s and hands back a new object identity
    // each time; without a latch the screen would reopen after every refetch.
    const openUpgrade = vi.fn();
    const { rerender } = render(<NetworkSwitchPlanOffer openUpgrade={openUpgrade} />);
    ctx.plan = { name: 'free', requestsPerMinute: 10, requestsPerDay: 1000 };
    rerender(<NetworkSwitchPlanOffer openUpgrade={openUpgrade} />);
    rerender(<NetworkSwitchPlanOffer openUpgrade={openUpgrade} />);
    expect(openUpgrade).toHaveBeenCalledTimes(1);
  });
});
