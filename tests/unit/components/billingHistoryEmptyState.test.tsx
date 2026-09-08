/**
 * A pasted key, or a wallet restored in another browser, arrives on a paid plan
 * with an empty journal — the receipts stayed where the purchase was made.
 * Saying "nothing bought yet" to that person is not an empty state, it is a
 * false statement about their money.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const ctx = vi.hoisted(() => ({ planName: null as string | null }));

vi.mock('../../../src/sdk/subscription/orderHistory', () => ({
  readOrderHistory: () => [],
}));

vi.mock('../../../src/sdk/subscription/pendingOrder', () => ({
  readSettlableOrders: () => [],
}));

vi.mock('../../../src/sdk/hooks/subscription', () => ({
  useUtilization: () => ({
    data: ctx.planName === null ? null : { plan: { name: ctx.planName }, status: 'active', activeUntil: null },
    isLoading: false,
    isError: false,
  }),
}));

vi.mock('../../../src/sdk/hooks/core/useSphere', () => ({
  useSphereContext: () => ({ sphere: null, network: 'mainnet' }),
}));

import { BillingHistoryModal } from '../../../src/components/wallet/L3/modals/BillingHistoryModal';

const renderScreen = () => render(<BillingHistoryModal isOpen onClose={vi.fn()} />);

beforeEach(() => {
  ctx.planName = 'free';
});

describe('billing history with nothing recorded', () => {
  it('says nothing was bought when the wallet is on the free plan', () => {
    renderScreen();
    expect(screen.getByText(/nothing bought yet/i)).toBeDefined();
  });

  it('explains an empty journal on a PAID plan instead of denying the purchase', () => {
    ctx.planName = 'premium';
    renderScreen();
    expect(screen.queryByText(/nothing bought yet/i)).toBeNull();
    expect(screen.getByText(/premium/i)).toBeDefined();
    expect(screen.getByText(/not bought in this browser/i)).toBeDefined();
  });

  it('does not guess a plan it has not read yet', () => {
    // No utilization means no claim either way.
    ctx.planName = null;
    renderScreen();
    expect(screen.getByText(/nothing bought yet/i)).toBeDefined();
  });
});
