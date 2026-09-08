/**
 * sphere#511: onboarding must not show a plan step where nothing can be bought.
 *
 * On a network whose store is off — every test network, since PAID_PLANS_ENABLED
 * is `flag && chargesRealMoney(activeNetwork)` — the line-up degenerates to a
 * single "Enter Wallet" button over a card the user cannot act on. Skip it.
 *
 * Drives the real restore flow because the decision lives in doFinalizeWallet,
 * on the same line for a created and a restored wallet: a fresh wallet is always
 * provisioned onto free, so both reach this branch identically.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const VALID_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

const ctx = vi.hoisted(() => ({
  paidPlansEnabled: false,
  storePlans: [] as unknown[],
  importWallet: vi.fn(async () => ({
    getAllTrackedAddresses: () => [],
    identity: { nametag: null },
  })),
  createWallet: vi.fn(async () => ({ mnemonic: 'never called', sphere: {} })),
  finalizeWallet: vi.fn(),
  resolveNametag: vi.fn(async () => null),
  importFromFile: vi.fn(),
  setWalletPassword: vi.fn(async () => {}),
  provision: vi.fn(),
}));

// The one difference from restorePlanStep.test.tsx: the store is OFF.
vi.mock('../../../src/config/subscription', async (orig) => ({
  ...(await orig<typeof import('../../../src/config/subscription')>()),
  SUBSCRIPTION_ENABLED: true,
  get PAID_PLANS_ENABLED() {
    return ctx.paidPlansEnabled;
  },
}));

vi.mock('../../../src/services/subscriptionApi', async (orig) => ({
  ...(await orig<typeof import('../../../src/services/subscriptionApi')>()),
  provisionOrRecoverKey: () => ctx.provision(),
  getStorePlans: async () => ctx.storePlans,
}));

vi.mock('../../../src/sdk/hooks/subscription', () => ({
  usePlans: () => ({ data: ctx.storePlans, isLoading: false, isError: false }),
  useUtilization: () => ({ data: null, isLoading: false, isError: false }),
  useCheckout: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('../../../src/sdk/hooks/core/useSphere', () => ({
  useSphereContext: () => ({
    sphere: null,
    network: 'testnet2',
    createWallet: ctx.createWallet,
    resolveNametag: ctx.resolveNametag,
    importWallet: ctx.importWallet,
    importFromFile: ctx.importFromFile,
    finalizeWallet: ctx.finalizeWallet,
    walletExists: false,
    initProgress: null,
    setWalletPassword: ctx.setWalletPassword,
    applySubscriptionKey: vi.fn(),
  }),
}));

import { CreateWalletFlow } from '../../../src/components/wallet/onboarding/CreateWalletFlow';

function Wrapper({ children }: { children: ReactNode }) {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

async function restoreWallet() {
  render(<CreateWalletFlow initialStep="restore" />, { wrapper: Wrapper });

  const inputs = screen.getAllByPlaceholderText('word');
  VALID_MNEMONIC.split(' ').forEach((w, i) => fireEvent.change(inputs[i], { target: { value: w } }));
  fireEvent.click(screen.getByRole('button', { name: /^restore$/i }));

  await waitFor(() => expect(ctx.importWallet).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByText(/choose unicity id/i)).toBeDefined());
  fireEvent.click(screen.getByRole('button', { name: /skip for now/i }));

  await waitFor(() => expect(screen.getByText(/protect your wallet/i)).toBeDefined());
  fireEvent.click(screen.getByRole('button', { name: /^skip$/i }));
}

beforeEach(() => {
  ctx.paidPlansEnabled = false;
  ctx.storePlans = [];
  ctx.importWallet.mockClear();
  ctx.finalizeWallet.mockClear();
  ctx.setWalletPassword.mockClear();
  ctx.provision.mockReset();
});

describe('onboarding skips the plan step where nothing is purchasable', () => {
  it('walks a FREE wallet straight in when the store is off', async () => {
    ctx.provision.mockResolvedValue({ apiKey: `sk_${'c'.repeat(32)}`, plan: 'free', created: false });

    await restoreWallet();

    await waitFor(() => expect(ctx.finalizeWallet).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/subscription restored/i)).toBeNull();
    expect(screen.queryByText(/your plan is ready/i)).toBeNull();
  });

  it('skips the step when the store is ON but this gateway prices nothing', async () => {
    // The network is no longer the question — the catalogue is. A deployment
    // may run the store flag on for both networks, and the test gateway simply
    // sells nothing.
    ctx.paidPlansEnabled = true;
    ctx.storePlans = [];
    ctx.provision.mockResolvedValue({ apiKey: `sk_${'e'.repeat(32)}`, plan: 'free', created: true });

    await restoreWallet();

    await waitFor(() => expect(ctx.finalizeWallet).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/your plan is ready/i)).toBeNull();
  });

  it('shows the step on a TEST network when that gateway does sell plans', async () => {
    // The reversal of #497 item 2, stated as behaviour: a priced test gateway
    // gets a line-up, with the network named on it.
    ctx.paidPlansEnabled = true;
    ctx.storePlans = [
      { planId: 2, name: 'basic', requestsPerMinute: 300, requestsPerDay: 50000, priceCents: 500, fiatCurrency: 'USD' },
    ];
    ctx.provision.mockResolvedValue({ apiKey: `sk_${'f'.repeat(32)}`, plan: 'free', created: true });

    await restoreWallet();

    await waitFor(() => expect(screen.queryByText(/your plan is ready/i)).not.toBeNull());
    expect(ctx.finalizeWallet).not.toHaveBeenCalled();
  });

  it('still provisions the key it skipped the screen for', async () => {

    // The screen is what goes, not the provisioning. With subscriptions on, the
    // env aggregator key is NOT a fallback (oracleKey.ts), so a wallet that
    // enters without its own key cannot send at all.
    ctx.provision.mockResolvedValue({ apiKey: `sk_${'d'.repeat(32)}`, plan: 'free', created: true });

    await restoreWallet();

    await waitFor(() => expect(ctx.finalizeWallet).toHaveBeenCalledTimes(1));
    expect(ctx.provision).toHaveBeenCalledTimes(1);
  });
});
