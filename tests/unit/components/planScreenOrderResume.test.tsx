/**
 * sphere#501 / #503: a checkout the wallet can come back to.
 *
 * The plan screen used to forget an order the moment its poll gave up or the
 * dialog closed. That single gap produced both bugs: a slow crypto payment fell
 * through to an "I have a key" paste step no upgrade order can satisfy, and
 * reopening the screen minted a SECOND Paymento order for the same purchase.
 *
 * These pin the recovery contract: the record survives, it is settled by one
 * status read, it is only ever adopted by the wallet and address that bought
 * it, and a purchased key is never acknowledged unless it was durably stored.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { PlanInfo, UtilizationInfo, OrderStatusInfo } from '@/services/subscriptionApi';

const PLAN: PlanInfo = {
  planId: 7,
  name: 'premium',
  requestsPerMinute: 1200,
  requestsPerDay: 500_000,
  priceCents: 1999,
  fiatCurrency: 'USD',
};

const UTIL: UtilizationInfo = {
  status: 'active',
  activeUntil: null,
  plan: { name: 'free', requestsPerMinute: 10, requestsPerDay: 100 },
  utilization: {
    consumedPerMinute: 0, maxPerMinute: 10, availablePerMinute: 10, utilizationPercentPerMinute: 0,
    consumedPerDay: 0, maxPerDay: 100, availablePerDay: 100, utilizationPercentPerDay: 0,
  },
};

const ROOT_PRIV = '1'.repeat(64);

const h = vi.hoisted(() => ({
  checkout: vi.fn(),
  applySubscriptionKey: vi.fn(),
  orderStatus: vi.fn(),
  ack: vi.fn(),
  poll: vi.fn(),
  walletKey: vi.fn(),
  rootPubkey: '',
  activePubkey: '',
  hasSphere: true,
}));

vi.mock('../../../src/config/subscription', async (orig) => ({
  ...(await orig<typeof import('../../../src/config/subscription')>()),
  PAID_PLANS_ENABLED: true,
  SUBSCRIPTION_MOCK: false,
}));

vi.mock('../../../src/sdk/hooks/subscription', () => ({
  usePlans: () => ({ data: [PLAN], isLoading: false, isError: false }),
  useUtilization: () => ({ data: UTIL, isLoading: false, isError: false }),
  useCheckout: () => ({ mutateAsync: h.checkout, isPending: false }),
}));

vi.mock('../../../src/sdk/hooks', async (orig) => ({
  ...(await orig<typeof import('../../../src/sdk/hooks')>()),
  useSphereContext: () => ({
    sphere: h.hasSphere
      ? { deriveAddress: () => ({ privateKey: ROOT_PRIV }), identity: { chainPubkey: h.activePubkey } }
      : null,
    applySubscriptionKey: h.applySubscriptionKey,
    network: 'mainnet',
  }),
}));

vi.mock('../../../src/services/subscriptionApi', async (orig) => ({
  ...(await orig<typeof import('../../../src/services/subscriptionApi')>()),
  getOrderStatus: (id: string) => h.orderStatus(id),
  ackOrderKeyDelivery: (id: string) => h.ack(id),
}));

vi.mock('../../../src/sdk/subscription/keyVault', async (orig) => ({
  ...(await orig<typeof import('../../../src/sdk/subscription/keyVault')>()),
  loadWalletKey: () => h.walletKey(),
}));

vi.mock('../../../src/sdk/subscription/keyCheck', () => ({
  validatePastedKey: async () => ({ valid: true }),
}));

vi.mock('../../../src/sdk/subscription/pollOrder', async (orig) => {
  const actual = await orig<typeof import('../../../src/sdk/subscription/pollOrder')>();
  return { ...actual, pollOrderStatus: (...args: unknown[]) => h.poll(...args) };
});

import { PlanScreen } from '@/components/upgrade/PlanScreen';
import { savePendingOrder, readPendingOrder, type PendingOrderRecord } from '@/sdk/subscription/pendingOrder';
import { getPublicKey } from '@unicitylabs/sphere-sdk';

const ROOT_PUBKEY = getPublicKey(ROOT_PRIV);
const OTHER_PUBKEY = '02' + 'c'.repeat(64);

const pendingOrder = (over: Partial<PendingOrderRecord> = {}): PendingOrderRecord => ({
  orderId: 'ssc-1',
  redirectUrl: 'https://pay.example/ssc-1',
  plan: PLAN,
  createdAt: Date.now(),
  addressPubkey: ROOT_PUBKEY,
  walletWide: true,
  upgradeMasked: 'sk_...cbe1',
  ...over,
});

const paid = (over: Partial<OrderStatusInfo> = {}): OrderStatusInfo => ({
  orderId: 'ssc-1', status: 'paid', statusName: 'Approve', fulfilled: true, confirming: false, ...over,
});


/** The order the gateway has not settled yet. */
const stillOpen = () => ({ ...paid(), status: 'pending' as const, fulfilled: false });

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = (children: ReactNode) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return render(ui(<PlanScreen isOpen onClose={() => {}} />));
}

/** Drive the plan grid → email step → "Continue to payment". */
async function buy() {
  fireEvent.click(await screen.findByRole('button', { name: /choose plan|get started|upgrade/i }));
  fireEvent.change(screen.getByPlaceholderText(/you@example.com/i), { target: { value: 'a@b.co' } });
  fireEvent.click(screen.getByRole('button', { name: /continue to payment/i }));
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  h.rootPubkey = ROOT_PUBKEY;
  h.activePubkey = ROOT_PUBKEY;
  h.hasSphere = true;
  h.walletKey = vi.fn(async () => 'sk_' + 'c'.repeat(28) + 'cbe1');
  h.applySubscriptionKey = vi.fn(async () => ({ durable: true }));
  h.checkout = vi.fn(async () => ({ orderId: 'ssc-1', redirectUrl: 'https://pay.example/ssc-1' }));
  h.orderStatus = vi.fn(async () => paid({ upgrade: true, maskedKey: 'sk_...cbe1', planName: 'premium' }));
  h.ack = vi.fn(async () => {});
  h.poll = vi.fn(async () => ({ outcome: 'timeout' }));
  vi.stubGlobal('open', vi.fn());
});

describe('a checkout that outlives the dialog (#501)', () => {
  it('records the order so a reopen can find it', async () => {
    h.orderStatus = vi.fn(async () => stillOpen());
    h.poll = vi.fn(async () => new Promise(() => {})); // the buyer is still paying
    renderDialog();
    await buy();
    await waitFor(() => expect(readPendingOrder('mainnet', ROOT_PUBKEY)).not.toBeNull());
    expect(readPendingOrder('mainnet', ROOT_PUBKEY)!.orderId).toBe('ssc-1');
    expect(readPendingOrder('mainnet', ROOT_PUBKEY)!.redirectUrl).toBe('https://pay.example/ssc-1');
  });

  it('keeps the record when the dialog is closed — closing is not abandoning', async () => {
    h.orderStatus = vi.fn(async () => stillOpen());
    h.poll = vi.fn(async () => new Promise(() => {}));
    const { unmount } = renderDialog();
    await buy();
    await waitFor(() => expect(readPendingOrder('mainnet', ROOT_PUBKEY)).not.toBeNull());
    fireEvent.click(screen.getByRole('button', { name: /^close$/i }));
    unmount();
    expect(readPendingOrder('mainnet', ROOT_PUBKEY)).not.toBeNull();
  });

  it('offers no key-paste step when the payment window closes', async () => {
    h.orderStatus = vi.fn(async () => stillOpen());
    h.poll = vi.fn(async () => ({ outcome: 'timeout' }));
    renderDialog();
    await buy();
    await screen.findByText(/payment window/i);
    expect(screen.queryByRole('button', { name: /i have a key/i })).toBeNull();
    expect(screen.queryByPlaceholderText(/sk_/)).toBeNull();
  });

  it('says an in-place upgrade needs nothing from the user when it times out', async () => {
    h.orderStatus = vi.fn(async () => stillOpen());
    h.poll = vi.fn(async () => ({ outcome: 'timeout' }));
    renderDialog();
    await buy();
    expect(await screen.findByText(/moves to the new plan on its own/i)).toBeTruthy();
  });
});

describe('resuming a stored order (#501)', () => {
  it('settles a paid upgrade with one status read — no paste anywhere', async () => {
    savePendingOrder('mainnet', ROOT_PUBKEY, pendingOrder());
    renderDialog();

    expect(await screen.findByText(/upgrade complete/i)).toBeTruthy();
    expect(h.orderStatus).toHaveBeenCalledWith('ssc-1');
    expect(screen.queryByPlaceholderText(/sk_/)).toBeNull();
    expect(readPendingOrder('mainnet', ROOT_PUBKEY)).toBeNull(); // settled, so the handle goes
  });

  it('clears a failed order instead of leaving it to be resumed forever', async () => {
    h.orderStatus = vi.fn(async () => ({ ...paid(), status: 'failed' as const, fulfilled: false }));
    savePendingOrder('mainnet', ROOT_PUBKEY, pendingOrder());
    renderDialog();

    await waitFor(() => expect(readPendingOrder('mainnet', ROOT_PUBKEY)).toBeNull());
  });

  it('keeps waiting — and re-offers the payment link — while the order is still open', async () => {
    h.orderStatus = vi.fn(async () => stillOpen());
    h.poll = vi.fn(async () => new Promise(() => {})); // never settles
    savePendingOrder('mainnet', ROOT_PUBKEY, pendingOrder());
    renderDialog();

    expect(await screen.findByRole('link', { name: /open it here/i })).toHaveProperty(
      'href',
      'https://pay.example/ssc-1',
    );
    expect(readPendingOrder('mainnet', ROOT_PUBKEY)).not.toBeNull();
  });

  it('never sees — let alone adopts — a key bought by a DIFFERENT wallet', async () => {
    h.orderStatus = vi.fn(async () => paid({ apiKey: 'sk_' + 'f'.repeat(32) }));
    savePendingOrder('mainnet', OTHER_PUBKEY, pendingOrder({ upgradeMasked: null }));
    renderDialog();

    await waitFor(() => expect(screen.queryByRole('button', { name: /choose plan/i })).not.toBeNull());
    expect(h.applySubscriptionKey).not.toHaveBeenCalled();
    expect(h.orderStatus).not.toHaveBeenCalled();
    // Untouched, so its own wallet can still recover it.
    expect(readPendingOrder('mainnet', OTHER_PUBKEY)).not.toBeNull();
  });

  it('does not overwrite another wallet\'s pending order when buying here', async () => {
    savePendingOrder('mainnet', OTHER_PUBKEY, pendingOrder({ orderId: 'ssc-theirs', upgradeMasked: null }));
    h.orderStatus = vi.fn(async () => stillOpen());
    h.poll = vi.fn(async () => new Promise(() => {}));
    renderDialog();
    await buy();

    await waitFor(() => expect(readPendingOrder('mainnet', ROOT_PUBKEY)).not.toBeNull());
    expect(readPendingOrder('mainnet', OTHER_PUBKEY)!.orderId).toBe('ssc-theirs');
  });

  it('refuses to adopt an address-scoped key into a different active address', async () => {
    h.activePubkey = OTHER_PUBKEY;
    h.orderStatus = vi.fn(async () => paid({ apiKey: 'sk_' + 'f'.repeat(32) }));
    savePendingOrder('mainnet', ROOT_PUBKEY, pendingOrder({ walletWide: false, addressPubkey: ROOT_PUBKEY, upgradeMasked: null }));
    renderDialog();

    expect(await screen.findByText(/started on a different address/i)).toBeTruthy();
    expect(h.applySubscriptionKey).not.toHaveBeenCalled();
  });

  it('leaves a way out of an order the active address cannot adopt', async () => {
    // The record still blocks a new checkout, so the screen that reports it
    // must also be the screen that can abandon it — otherwise the buyer is
    // stuck until they switch addresses or the record ages out.
    h.activePubkey = OTHER_PUBKEY;
    h.orderStatus = vi.fn(async () => paid({ apiKey: 'sk_' + 'f'.repeat(32) }));
    savePendingOrder('mainnet', ROOT_PUBKEY, pendingOrder({ walletWide: false, addressPubkey: ROOT_PUBKEY, upgradeMasked: null }));
    renderDialog();

    // Wait for the explanation first: the waiting screen carries a button of
    // the same name, and clicking that one hits a node already replaced.
    await screen.findByText(/started on a different address/i);
    fireEvent.click(screen.getByRole('button', { name: /cancel this payment/i }));
    expect(readPendingOrder('mainnet', ROOT_PUBKEY)).toBeNull();
  });

  it('does not acknowledge delivery when the key could not be durably stored', async () => {
    h.applySubscriptionKey = vi.fn(async () => ({ durable: false }));
    h.orderStatus = vi.fn(async () => paid({ apiKey: 'sk_' + 'f'.repeat(32) }));
    savePendingOrder('mainnet', ROOT_PUBKEY, pendingOrder({ upgradeMasked: null }));
    renderDialog();

    await waitFor(() => expect(h.applySubscriptionKey).toHaveBeenCalled());
    expect(h.ack).not.toHaveBeenCalled();
    expect(readPendingOrder('mainnet', ROOT_PUBKEY)).not.toBeNull(); // the key is still recoverable
  });

  it('acknowledges and drops the record once the key IS durably stored', async () => {
    h.orderStatus = vi.fn(async () => paid({ apiKey: 'sk_' + 'f'.repeat(32) }));
    savePendingOrder('mainnet', ROOT_PUBKEY, pendingOrder({ upgradeMasked: null }));
    renderDialog();

    await waitFor(() => expect(h.ack).toHaveBeenCalledWith('ssc-1'));
    expect(readPendingOrder('mainnet', ROOT_PUBKEY)).toBeNull();
  });

  it('leaves a delivered key to the tab already adopting it', async () => {
    // Reading the status in both tabs is fine; filing the key twice is not.
    h.orderStatus = vi.fn(async () => paid({ apiKey: 'sk_' + 'f'.repeat(32) }));
    savePendingOrder('mainnet', ROOT_PUBKEY, pendingOrder({ upgradeMasked: null, claimedAt: Date.now() }));
    renderDialog();

    await waitFor(() => expect(h.orderStatus).toHaveBeenCalled());
    expect(h.applySubscriptionKey).not.toHaveBeenCalled();
    expect(h.ack).not.toHaveBeenCalled();
    expect(readPendingOrder('mainnet', ROOT_PUBKEY)).not.toBeNull();
  });

  it('adopts once the other tab\'s lease has expired', async () => {
    h.orderStatus = vi.fn(async () => paid({ apiKey: 'sk_' + 'f'.repeat(32) }));
    savePendingOrder('mainnet', ROOT_PUBKEY, pendingOrder({ upgradeMasked: null, claimedAt: Date.now() - 120_000 }));
    renderDialog();

    await waitFor(() => expect(h.applySubscriptionKey).toHaveBeenCalled());
  });
});

describe('one order at a time (#503)', () => {
  it('does not mint a second order while one is live', async () => {
    savePendingOrder('mainnet', ROOT_PUBKEY, pendingOrder());
    h.orderStatus = vi.fn(async () => stillOpen());
    h.poll = vi.fn(async () => new Promise(() => {}));
    renderDialog();

    await screen.findByRole('link', { name: /open it here/i });
    expect(h.checkout).not.toHaveBeenCalled();
  });

  it('lets the buyer abandon the pending order and start over', async () => {
    savePendingOrder('mainnet', ROOT_PUBKEY, pendingOrder());
    h.orderStatus = vi.fn(async () => stillOpen());
    h.poll = vi.fn(async () => new Promise(() => {}));
    renderDialog();

    fireEvent.click(await screen.findByRole('button', { name: /cancel this payment/i }));
    expect(readPendingOrder('mainnet', ROOT_PUBKEY)).toBeNull();
    expect(await screen.findByRole('button', { name: /choose plan|get started|upgrade/i })).toBeTruthy();
  });
});

describe('failure modes the happy path hides', () => {
  it('mints ONE order when the buy button is double-clicked', async () => {
    // The mutation's own isPending disables the button only once it is in
    // flight; the key resolution before it is the window a second click slips
    // through — and a second order is a second payable link (#503).
    h.orderStatus = vi.fn(async () => stillOpen());
    h.poll = vi.fn(async () => new Promise(() => {}));
    renderDialog();

    fireEvent.click(await screen.findByRole('button', { name: /choose plan|get started|upgrade/i }));
    fireEvent.change(screen.getByPlaceholderText(/you@example.com/i), { target: { value: 'a@b.co' } });
    const go = screen.getByRole('button', { name: /continue to payment/i });
    fireEvent.click(go);
    fireEvent.click(go);

    await waitFor(() => expect(readPendingOrder('mainnet', ROOT_PUBKEY)).not.toBeNull());
    expect(h.checkout).toHaveBeenCalledTimes(1);
  });

  it('surfaces a resume that throws instead of spinning forever', async () => {
    // A resume runs from an effect, where a rejection is swallowed — the
    // dialog would sit on the awaiting spinner with nothing to click.
    h.orderStatus = vi.fn(async () => paid({ apiKey: 'sk_' + 'f'.repeat(32) }));
    h.applySubscriptionKey = vi.fn(async () => { throw new Error('storage blocked'); });
    savePendingOrder('mainnet', ROOT_PUBKEY, pendingOrder({ upgradeMasked: null }));
    renderDialog();

    expect(await screen.findByText(/storage blocked/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /back to plans/i })).not.toBeNull();
  });
});

describe('the paste step, when a paid order delivered no key', () => {
  it('adopts a hand-pasted key WITHOUT acknowledging a delivery that never happened', async () => {
    // Any valid key passes the paste check — it is not proof the key belongs to
    // this order. Acking on it would end the gateway's redelivery of the key
    // the buyer actually paid for.
    h.orderStatus = vi.fn(async () => paid()); // paid, not an upgrade, no key
    savePendingOrder('mainnet', ROOT_PUBKEY, pendingOrder({ upgradeMasked: null }));
    renderDialog();

    fireEvent.change(await screen.findByPlaceholderText(/sk_/), {
      target: { value: 'sk_' + 'a'.repeat(32) },
    });
    fireEvent.click(screen.getByRole('button', { name: /activate/i }));

    await waitFor(() => expect(h.applySubscriptionKey).toHaveBeenCalledWith('sk_' + 'a'.repeat(32), { walletWide: true }));
    expect(h.ack).not.toHaveBeenCalled();
    // The order is still settled from the buyer's side — otherwise every
    // reopen drops them back on the same paste step.
    expect(readPendingOrder('mainnet', ROOT_PUBKEY)).toBeNull();
  });
});

describe('an order whose payment window closed but which can still settle', () => {
  const expired = () => pendingOrder({ orderId: 'ssc-old', createdAt: Date.now() - 2 * 60 * 60_000 });

  it('is not silently replaced by a new purchase', async () => {
    // The gateway keeps settling for 24h, so a payment sent near expiry can
    // still confirm. Overwriting the handle here loses that key AND charges the
    // buyer a second time.
    h.orderStatus = vi.fn(async () => stillOpen());
    savePendingOrder('mainnet', ROOT_PUBKEY, expired());
    renderDialog();

    await screen.findByText(/payment window/i);
    fireEvent.click(screen.getByRole('button', { name: /back to plans/i }));
    await buy();

    // It goes back to watching the old order rather than starting another.
    await waitFor(() => expect(h.orderStatus).toHaveBeenCalledTimes(2));
    expect(h.orderStatus).toHaveBeenLastCalledWith('ssc-old');
    expect(h.checkout).not.toHaveBeenCalled();
    expect(readPendingOrder('mainnet', ROOT_PUBKEY)!.orderId).toBe('ssc-old');
  });

  it('can be abandoned deliberately, which frees a new purchase', async () => {
    h.orderStatus = vi.fn(async () => stillOpen());
    savePendingOrder('mainnet', ROOT_PUBKEY, expired());
    renderDialog();

    await screen.findByText(/payment window/i);
    fireEvent.click(screen.getByRole('button', { name: /cancel this payment/i }));
    expect(readPendingOrder('mainnet', ROOT_PUBKEY)).toBeNull();

    h.poll = vi.fn(async () => new Promise(() => {}));
    await buy();
    await waitFor(() => expect(h.checkout).toHaveBeenCalledTimes(1));
  });
});
