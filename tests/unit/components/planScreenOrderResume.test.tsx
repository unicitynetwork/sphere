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
const OTHER_PRIV = '2'.repeat(64);

const h = vi.hoisted(() => ({
  checkout: vi.fn(),
  applySubscriptionKey: vi.fn(),
  orderStatus: vi.fn(),
  ack: vi.fn(),
  poll: vi.fn(),
  walletKey: vi.fn(),
  rootPriv: '',
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
      ? { deriveAddress: () => ({ privateKey: h.rootPriv }), identity: { chainPubkey: h.activePubkey } }
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
import {
  savePendingOrder,
  readPendingOrder,
  readSettlableOrders,
  type PendingOrderRecord,
} from '@/sdk/subscription/pendingOrder';
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
  const result = render(ui(<PlanScreen isOpen onClose={() => {}} />));
  // A FRESH element each time: React bails out of re-rendering when handed the
  // identical element object, so reusing one would not pick up the mock change.
  return { ...result, refresh: () => result.rerender(ui(<PlanScreen isOpen onClose={() => {}} />)) };
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
  h.rootPriv = ROOT_PRIV;
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

  it('does not promise an in-place upgrade the gateway never confirmed', async () => {
    // Sending an upgrade key is a REQUEST, not an outcome: a pre-upgrade
    // gateway ignores the field and mints a fresh key whose only copy is on the
    // return page. Telling the buyer nothing else is needed invites them to
    // close that page, and the later paid-but-keyless order can then only offer
    // a paste field for a key they no longer have.
    h.orderStatus = vi.fn(async () => stillOpen());
    h.poll = vi.fn(async () => ({ outcome: 'timeout' }));
    renderDialog();
    await buy();

    await screen.findByText(/payment window/i);
    expect(screen.queryByText(/moves to the new plan/i)).toBeNull();
    // ...and it says what actually protects them.
    expect(screen.queryByText(/keep the payment page/i)).not.toBeNull();
  });

  it('still applies a delivered key when the order could not be persisted', async () => {
    // Storage at quota: the record never lands, but the buyer has still paid
    // and the gateway has still handed over the key. Requiring a storage-backed
    // claim before adopting would drop it on the floor.
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    try {
      h.orderStatus = vi.fn(async () => paid({ apiKey: 'sk_' + 'f'.repeat(32) }));
      renderDialog();
      await buy();
      await waitFor(() =>
        expect(h.applySubscriptionKey).toHaveBeenCalledWith('sk_' + 'f'.repeat(32), { walletWide: true }),
      );
    } finally {
      setItem.mockRestore();
    }
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

    expect(await screen.findByText(/on a different address of this wallet/i)).toBeTruthy();
    expect(h.applySubscriptionKey).not.toHaveBeenCalled();
  });

  it('retries settlement once the buying address is active again', async () => {
    // The screen asks the buyer to switch back, so switching back has to be
    // enough — without this they would have to close and reopen the dialog.
    h.activePubkey = OTHER_PUBKEY;
    h.orderStatus = vi.fn(async () => paid({ apiKey: 'sk_' + 'f'.repeat(32) }));
    savePendingOrder('mainnet', ROOT_PUBKEY, pendingOrder({ walletWide: false, addressPubkey: ROOT_PUBKEY, upgradeMasked: null }));
    const { refresh } = renderDialog();
    await screen.findByText(/on a different address of this wallet/i);

    h.activePubkey = ROOT_PUBKEY;
    refresh();

    await waitFor(() => expect(h.applySubscriptionKey).toHaveBeenCalled());
  });

  it('offers no way to DISCARD an order that has already been paid', async () => {
    // This screen is only ever reached from a paid order whose key this address
    // may not adopt. Cancelling refunds nothing and unsubscribes nothing — it
    // would only delete the last handle on a key the buyer owns. Switching back
    // is the way out, and that retries on its own.
    h.activePubkey = OTHER_PUBKEY;
    h.orderStatus = vi.fn(async () => paid({ apiKey: 'sk_' + 'f'.repeat(32) }));
    savePendingOrder('mainnet', ROOT_PUBKEY, pendingOrder({ walletWide: false, addressPubkey: ROOT_PUBKEY, upgradeMasked: null }));
    renderDialog();

    await screen.findByText(/on a different address of this wallet/i);
    expect(screen.queryByRole('button', { name: /cancel this payment/i })).toBeNull();
    expect(readPendingOrder('mainnet', ROOT_PUBKEY)).not.toBeNull();
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
    // Marked rather than deleted — it cancels nothing server-side — but it
    // stops blocking a fresh purchase.
    expect(readSettlableOrders('mainnet', ROOT_PUBKEY)[0].abandonedAt).toBeGreaterThan(0);
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
    // ...and the order keeps its handle: the paste check accepts any key the
    // gateway knows (and fails open on lookup errors), so this key may have
    // nothing to do with the purchase. Dropping the record on it would remove
    // the last way back to the key actually bought.
    expect(readPendingOrder('mainnet', ROOT_PUBKEY)).not.toBeNull();
  });

  it('lets the buyer dismiss the order once they have dealt with it themselves', async () => {
    // Keeping the record must not mean nagging forever: dismissing is explicit.
    h.orderStatus = vi.fn(async () => paid());
    savePendingOrder('mainnet', ROOT_PUBKEY, pendingOrder({ upgradeMasked: null }));
    renderDialog();

    await screen.findByPlaceholderText(/sk_/);
    fireEvent.click(screen.getByRole('button', { name: /dismiss this order/i }));
    expect(readSettlableOrders('mainnet', ROOT_PUBKEY)[0].abandonedAt).toBeGreaterThan(0);
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
    // Marked, NOT deleted: this cancels nothing server-side, and a payment
    // already sent can still confirm.
    expect(readSettlableOrders('mainnet', ROOT_PUBKEY)[0].abandonedAt).toBeGreaterThan(0);

    h.poll = vi.fn(async () => new Promise(() => {}));
    await buy();
    await waitFor(() => expect(h.checkout).toHaveBeenCalledTimes(1));
  });
});

describe('failures the buyer must be told about', () => {
  it('does not report plain success when the purchased key could not be saved', async () => {
    // The key exists only in this tab's plaintext boot cache; a reload can lose
    // it. Saying "upgrade complete" and moving on is how it disappears.
    h.applySubscriptionKey = vi.fn(async () => ({ durable: false }));
    h.orderStatus = vi.fn(async () => paid({ apiKey: 'sk_' + 'f'.repeat(32) }));
    savePendingOrder('mainnet', ROOT_PUBKEY, pendingOrder({ upgradeMasked: null }));
    renderDialog();

    expect(await screen.findByText(/could not be saved on this device/i)).toBeTruthy();
    // The key itself stays on screen to copy, and the order stays recoverable.
    expect(screen.queryByText('sk_' + 'f'.repeat(32))).not.toBeNull();
    expect(readPendingOrder('mainnet', ROOT_PUBKEY)).not.toBeNull();
  });

  it('does not start a second order when the first could not be persisted', async () => {
    // Storage blocked: the record is in memory only, so the storage read that
    // guards against duplicates finds nothing.
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    try {
      h.orderStatus = vi.fn(async () => stillOpen());
      h.poll = vi.fn(async () => ({ outcome: 'timeout' }));
      renderDialog();
      await buy();

      await screen.findByText(/payment window/i);
      fireEvent.click(screen.getByRole('button', { name: /back to plans/i }));
      await buy();

      await waitFor(() => expect(h.orderStatus).toHaveBeenCalled());
      expect(h.checkout).toHaveBeenCalledTimes(1);
    } finally {
      setItem.mockRestore();
    }
  });
});

describe('an order the buyer walked away from (#504 review)', () => {
  it('still hands over the key if that payment lands later', async () => {
    // "Cancel and start over" cancels nothing server-side. A payment already
    // sent can confirm minutes later, and its key must not be lost.
    h.orderStatus = vi.fn(async () => paid({ apiKey: 'sk_' + 'f'.repeat(32) }));
    savePendingOrder('mainnet', ROOT_PUBKEY, pendingOrder({ upgradeMasked: null, abandonedAt: Date.now() }));
    renderDialog();

    await waitFor(() => expect(h.applySubscriptionKey).toHaveBeenCalled());
    expect(h.ack).toHaveBeenCalledWith('ssc-1');
  });

  it('does not drag the buyer back to a waiting screen it never settles', async () => {
    h.orderStatus = vi.fn(async () => stillOpen());
    savePendingOrder('mainnet', ROOT_PUBKEY, pendingOrder({ abandonedAt: Date.now() }));
    renderDialog();

    await waitFor(() => expect(h.orderStatus).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /choose plan|get started|upgrade/i })).not.toBeNull();
    expect(screen.queryByText(/complete the payment/i)).toBeNull();
  });
});

describe('an upgrade whose target key is gone', () => {
  it('does not report success for a plan attached to a key the wallet lost', async () => {
    // The key was replaced in Settings or another tab while the order was in
    // flight, so nothing local matches the mask the order upgraded.
    h.walletKey = vi.fn(async () => 'sk_' + 'd'.repeat(28) + 'dead');
    h.orderStatus = vi.fn(async () => paid({ upgrade: true, maskedKey: 'sk_...cbe1', planName: 'premium' }));
    savePendingOrder('mainnet', ROOT_PUBKEY, pendingOrder({ upgradeMasked: 'sk_...cbe1' }));
    renderDialog();

    expect(await screen.findByText(/no longer uses/i)).toBeTruthy();
    expect(screen.queryByText(/upgrade complete/i)).toBeNull();
    expect(readPendingOrder('mainnet', ROOT_PUBKEY)).not.toBeNull();
  });
});

describe('an abandoned order settles without taking the screen (every verdict)', () => {
  const abandoned = (over = {}) => pendingOrder({ upgradeMasked: null, abandonedAt: Date.now(), ...over });
  const onPlans = () => screen.queryByRole('button', { name: /choose plan|get started|upgrade/i }) !== null;

  it('paid but keyless does NOT reopen the paste step', async () => {
    h.orderStatus = vi.fn(async () => paid()); // paid, no key, not an upgrade
    savePendingOrder('mainnet', ROOT_PUBKEY, abandoned());
    renderDialog();

    await waitFor(() => expect(h.orderStatus).toHaveBeenCalled());
    expect(screen.queryByPlaceholderText(/sk_/)).toBeNull();
    expect(onPlans()).toBe(true);
    expect(readSettlableOrders('mainnet', ROOT_PUBKEY)).toHaveLength(1); // still recoverable
  });

  it('failed clears the record without an error screen', async () => {
    h.orderStatus = vi.fn(async () => ({ ...paid(), status: 'failed' as const, fulfilled: false }));
    savePendingOrder('mainnet', ROOT_PUBKEY, abandoned());
    renderDialog();

    await waitFor(() => expect(readSettlableOrders('mainnet', ROOT_PUBKEY)).toHaveLength(0));
    expect(screen.queryByText(/payment was not completed/i)).toBeNull();
    expect(onPlans()).toBe(true);
  });

  it('a delivered key is adopted and acked, still without taking the screen', async () => {
    h.orderStatus = vi.fn(async () => paid({ apiKey: 'sk_' + 'f'.repeat(32) }));
    savePendingOrder('mainnet', ROOT_PUBKEY, abandoned());
    renderDialog();

    await waitFor(() => expect(h.ack).toHaveBeenCalledWith('ssc-1'));
    expect(onPlans()).toBe(true);
    expect(readSettlableOrders('mainnet', ROOT_PUBKEY)).toHaveLength(0);
  });

  it('a key belonging to another address is left for that address', async () => {
    h.activePubkey = OTHER_PUBKEY;
    h.orderStatus = vi.fn(async () => paid({ apiKey: 'sk_' + 'f'.repeat(32) }));
    savePendingOrder('mainnet', ROOT_PUBKEY, abandoned({ walletWide: false, addressPubkey: ROOT_PUBKEY }));
    renderDialog();

    await waitFor(() => expect(h.orderStatus).toHaveBeenCalled());
    expect(h.applySubscriptionKey).not.toHaveBeenCalled();
    expect(screen.queryByText(/different address/i)).toBeNull();
    expect(readSettlableOrders('mainnet', ROOT_PUBKEY)).toHaveLength(1);
  });
});

describe('the in-memory fallback is scoped to its wallet', () => {
  it('does not let one wallet\'s unpersisted order block another\'s checkout', async () => {
    // Storage blocked, so the order lives only in component state — which
    // survives a wallet swap under a mounted dialog unless it is cleared.
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    try {
      h.orderStatus = vi.fn(async () => stillOpen());
      h.poll = vi.fn(async () => new Promise(() => {}));
      const { refresh } = renderDialog();
      await buy();
      await waitFor(() => expect(h.checkout).toHaveBeenCalledTimes(1));

      // A different wallet is now loaded in the same mounted screen.
      h.rootPriv = OTHER_PRIV;
      h.activePubkey = getPublicKey(OTHER_PRIV);
      refresh();
      await buy();

      await waitFor(() => expect(h.checkout).toHaveBeenCalledTimes(2));
    } finally {
      setItem.mockRestore();
    }
  });
});

describe('orders that exist server-side before the wallet knows it', () => {
  it('records an order whose creation finished after the dialog closed', async () => {
    // Paymento has emailed the payable link by then. A wallet with no record of
    // that order cannot resume the key it buys.
    let release: (v: { orderId: string; redirectUrl: string }) => void = () => {};
    h.checkout = vi.fn(() => new Promise((resolve) => { release = resolve; }));
    h.orderStatus = vi.fn(async () => stillOpen());
    h.poll = vi.fn(async () => new Promise(() => {}));
    renderDialog();
    await buy();
    // The key resolution runs before the checkout call, so wait for the call
    // itself — releasing earlier would resolve nothing.
    await waitFor(() => expect(h.checkout).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /^close$/i }));
    release({ orderId: 'ssc-late', redirectUrl: 'https://pay.example/ssc-late' });

    await waitFor(() => expect(readPendingOrder('mainnet', ROOT_PUBKEY)?.orderId).toBe('ssc-late'));
  });

  it('keeps an abandoned upgrade whose key the wallet no longer has', async () => {
    h.walletKey = vi.fn(async () => 'sk_' + 'd'.repeat(28) + 'dead');
    h.orderStatus = vi.fn(async () => paid({ upgrade: true, maskedKey: 'sk_...cbe1', planName: 'premium' }));
    savePendingOrder('mainnet', ROOT_PUBKEY, pendingOrder({ upgradeMasked: 'sk_...cbe1', abandonedAt: Date.now() }));
    renderDialog();

    await waitFor(() => expect(h.orderStatus).toHaveBeenCalled());
    // Not cleared: the record carries the mask that says which key to restore.
    await waitFor(() => expect(readSettlableOrders('mainnet', ROOT_PUBKEY)).toHaveLength(1));
  });
});
