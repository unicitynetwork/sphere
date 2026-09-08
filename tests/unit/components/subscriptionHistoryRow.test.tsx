/**
 * sphere#509: Settings → Subscription is where a buyer looks for what they
 * bought, so that is where the door to the journal goes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const ctx = vi.hoisted(() => ({ hasStoredOrders: false }));

vi.mock('../../../src/sdk/subscription/pendingOrder', () => ({
  hasStoredOrders: () => ctx.hasStoredOrders,
  readSettlableOrders: () => [],
}));

vi.mock('../../../src/sdk/subscription/orderHistory', () => ({
  readOrderHistory: () => [],
}));

vi.mock('../../../src/sdk/hooks/subscription', () => ({
  usePlans: () => ({ data: [], isLoading: false, isError: false }),
  useUtilization: () => ({
    data: {
      status: 'active',
      plan: { name: 'free', requestsPerMinute: 10, requestsPerDay: 1000 },
      activeUntil: null,
      utilization: { consumedPerDay: 1, maxPerDay: 1000, consumedPerMinute: 0, maxPerMinute: 10 },
    },
    isLoading: false,
    isError: false,
  }),
}));

vi.mock('../../../src/config/subscriptionKeyCache', () => ({
  getStoredSubscriptionKey: () => `sk_${'e'.repeat(32)}`,
}));

vi.mock('../../../src/sdk/hooks/core/useSphere', () => ({
  useSphereContext: () => ({ sphere: null, network: 'mainnet', applySubscriptionKey: vi.fn() }),
}));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { SubscriptionModal } from '../../../src/components/wallet/L3/modals/SubscriptionModal';

function Wrapper({ children }: { children: ReactNode }) {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const renderModal = () =>
  render(<SubscriptionModal isOpen onClose={vi.fn()} onUpgrade={vi.fn()} />, { wrapper: Wrapper });

beforeEach(() => {
  ctx.hasStoredOrders = false;
});

describe('Settings → Subscription → Purchase history', () => {
  it('offers a way into the journal', () => {
    renderModal();
    expect(screen.getByText('Purchase history')).toBeDefined();
  });

  it('opens the journal screen', () => {
    renderModal();
    fireEvent.click(screen.getByText('Purchase history'));
    expect(screen.getByText('Nothing bought yet')).toBeDefined();
  });

  it('says so on the row when a payment is still unfinished', () => {
    // The row is where someone who paid and closed the tab will look first.
    ctx.hasStoredOrders = true;
    renderModal();
    expect(screen.getByText(/unfinished/i)).toBeDefined();
  });
});
