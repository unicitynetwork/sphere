/**
 * The rule this pins: whether a purchase surface appears is decided by the
 * CATALOGUE, never by the network.
 *
 * It deliberately reverses the client half of #497 item 2, which refused to
 * show a store on a test network at all. The protection moved from hiding the
 * store to naming the network — TestMoneyPurchaseNotice below is that guard, so
 * it is tested as one.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PlansGrid } from '@/components/subscription/PlansGrid';
import { TestMoneyPurchaseNotice } from '@/components/upgrade/PlanScreen';
import type { PlanInfo } from '@/services/subscriptionApi';

const free: PlanInfo = {
  planId: 1,
  name: 'free',
  requestsPerMinute: 10,
  requestsPerDay: 1000,
  priceCents: 0,
  fiatCurrency: 'USD',
};
const basic: PlanInfo = { ...free, planId: 2, name: 'basic', priceCents: 500 };

describe('the catalogue decides what is on sale', () => {
  it('shows the paid tiers when there is something to buy', () => {
    render(<PlansGrid plans={[free, basic]} currentPlanName="free" canBuy onSelect={vi.fn()} />);
    expect(screen.getByText(/basic/i)).toBeDefined();
  });

  it('hides the tiers behind the placeholder when there is not', () => {
    render(<PlansGrid plans={[free, basic]} currentPlanName="free" canBuy={false} onSelect={vi.fn()} />);
    expect(screen.queryByText('basic')).toBeNull();
  });
});

describe('TestMoneyPurchaseNotice', () => {
  it('names the network on test money, because a key bought here is worth nothing elsewhere', () => {
    // The suite's network is testnet2.
    render(<TestMoneyPurchaseNotice />);
    expect(screen.getByText(/these plans are for testnet/i)).toBeDefined();
    expect(screen.getByText(/works only on Testnet/i)).toBeDefined();
    expect(screen.getByText(/no real value/i)).toBeDefined();
  });
});
