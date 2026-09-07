/**
 * sphere#511: Settings must not offer an upgrade that cannot be bought.
 *
 * "Nothing to sell" has two causes and they need different evidence: the store
 * flag is off (every test network), or the store is on but its catalogue holds
 * no paid plan. A catalogue that has not resolved is neither — it fails open.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const ctx = vi.hoisted(() => ({
  paidPlansEnabled: true,
  plans: undefined as unknown,
  status: 'active' as 'active' | 'expired' | 'inactive',
}));

vi.mock('../../../src/config/subscription', async (orig) => ({
  ...(await orig<typeof import('../../../src/config/subscription')>()),
  get PAID_PLANS_ENABLED() {
    return ctx.paidPlansEnabled;
  },
}));

vi.mock('../../../src/sdk/hooks/subscription', () => ({
  usePlans: () => ({ data: ctx.plans, isLoading: false, isError: false }),
  useUtilization: () => ({
    data: {
      status: ctx.status,
      plan: { name: 'free', requestsPerMinute: 10, requestsPerDay: 1000 },
      activeUntil: null,
      utilization: {
        consumedPerDay: 1,
        maxPerDay: 1000,
        consumedPerMinute: 0,
        maxPerMinute: 10,
      },
    },
    isLoading: false,
    isError: false,
  }),
}));

vi.mock('../../../src/config/subscriptionKeyCache', () => ({
  getStoredSubscriptionKey: () => `sk_${'e'.repeat(32)}`,
}));

vi.mock('../../../src/sdk/hooks/core/useSphere', () => ({
  useSphereContext: () => ({ sphere: {}, applySubscriptionKey: vi.fn() }),
}));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { SubscriptionModal } from '../../../src/components/wallet/L3/modals/SubscriptionModal';

const paid = {
  planId: 2,
  name: 'basic',
  requestsPerMinute: 300,
  requestsPerDay: 50000,
  priceCents: 500,
  fiatCurrency: 'USD',
};

function Wrapper({ children }: { children: ReactNode }) {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function renderModal() {
  return render(<SubscriptionModal isOpen onClose={vi.fn()} onUpgrade={vi.fn()} />, { wrapper: Wrapper });
}

const upgradeButton = () => screen.queryByRole('button', { name: /upgrade plan|renew plan/i });

beforeEach(() => {
  ctx.paidPlansEnabled = true;
  ctx.plans = [paid];
  ctx.status = 'active';
});

describe('Settings → Subscription upgrade button', () => {
  it('offers the upgrade where a paid plan is actually on sale', () => {
    renderModal();
    expect(upgradeButton()).not.toBeNull();
  });

  it('hides it where the store is off', () => {
    ctx.paidPlansEnabled = false;
    renderModal();
    expect(upgradeButton()).toBeNull();
  });

  it('hides it where the store is on but sells nothing', () => {
    ctx.plans = [];
    renderModal();
    expect(upgradeButton()).toBeNull();
  });

  it('hides "Renew plan" too — an expired user with no catalogue cannot renew', () => {
    // Renewal is re-buying the same card; with no card there is nothing to
    // click, so the button would be a promise the screen cannot keep.
    ctx.plans = [];
    ctx.status = 'expired';
    renderModal();
    expect(upgradeButton()).toBeNull();
  });

  it('keeps the button while the catalogue has not resolved', () => {
    // Fail open: a slow or broken gateway must not hide a real purchase path.
    ctx.plans = undefined;
    renderModal();
    expect(upgradeButton()).not.toBeNull();
  });
});
