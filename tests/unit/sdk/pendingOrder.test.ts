import { describe, it, expect, beforeEach } from 'vitest';
import {
  savePendingOrder,
  readPendingOrder,
  clearPendingOrder,
  claimPendingOrder,
  readSettlableOrders,
  isWithinPaymentWindow,
  type PendingOrderRecord,
} from '@/sdk/subscription/pendingOrder';
import type { PlanInfo } from '@/services/subscriptionApi';

const WALLET = '02' + 'a'.repeat(64);
const OTHER_WALLET = '02' + 'b'.repeat(64);

const plan: PlanInfo = {
  planId: 7,
  name: 'premium',
  requestsPerMinute: 60,
  requestsPerDay: 10_000,
  priceCents: 199,
  fiatCurrency: 'USD',
};

const record = (over: Partial<PendingOrderRecord> = {}): PendingOrderRecord => ({
  orderId: 'ssc-1',
  redirectUrl: 'https://pay.example/ssc-1',
  plan,
  createdAt: 1_000_000,
  addressPubkey: '02bb',
  walletWide: true,
  upgradeMasked: 'sk_...cbe1',
  ...over,
});

describe('pendingOrder', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips the record for the network it was saved under', () => {
    savePendingOrder('mainnet', WALLET, record());
    expect(readPendingOrder('mainnet', WALLET, 1_000_000)).toEqual(record());
  });

  it('does not leak across networks', () => {
    savePendingOrder('mainnet', WALLET, record());
    expect(readPendingOrder('testnet2', WALLET, 1_000_000)).toBeNull();
  });

  it('does not leak across wallets, and one wallet cannot overwrite another', () => {
    // Keyed by network alone, a second wallet's checkout clobbered the first
    // wallet's handle — losing its recovery and re-opening the duplicate-order
    // path this record exists to close.
    savePendingOrder('mainnet', WALLET, record());
    savePendingOrder('mainnet', OTHER_WALLET, record({ orderId: 'ssc-2' }));
    expect(readPendingOrder('mainnet', WALLET, 1_000_000)!.orderId).toBe('ssc-1');
    expect(readPendingOrder('mainnet', OTHER_WALLET, 1_000_000)!.orderId).toBe('ssc-2');
  });

  it('uses a sphere_-prefixed slot so wallet deletion wipes it', () => {
    savePendingOrder('mainnet', WALLET, record());
    expect(Object.keys(localStorage).every((k) => k.startsWith('sphere_'))).toBe(true);
  });

  it('reads null and self-clears past the 24h recovery horizon', () => {
    savePendingOrder('mainnet', WALLET, record({ createdAt: 0 }));
    expect(readPendingOrder('mainnet', WALLET, 24 * 3600_000 + 1)).toBeNull();
    expect(Object.keys(localStorage)).toHaveLength(0);
  });

  it('survives right up to the horizon', () => {
    savePendingOrder('mainnet', WALLET, record({ createdAt: 0 }));
    expect(readPendingOrder('mainnet', WALLET, 24 * 3600_000 - 1)).not.toBeNull();
  });

  it('rejects a corrupt payload instead of returning a half-record', () => {
    savePendingOrder('mainnet', WALLET, record());
    const slot = Object.keys(localStorage)[0];
    localStorage.setItem(slot, '{"orderId":"ssc-1"}'); // missing everything else
    expect(readPendingOrder('mainnet', WALLET, 1_000_000)).toBeNull();
  });

  it('rejects a non-JSON payload', () => {
    savePendingOrder('mainnet', WALLET, record());
    localStorage.setItem(Object.keys(localStorage)[0], 'not json');
    expect(readPendingOrder('mainnet', WALLET, 1_000_000)).toBeNull();
  });

  it('clears on demand', () => {
    savePendingOrder('mainnet', WALLET, record());
    clearPendingOrder('mainnet', WALLET);
    expect(readPendingOrder('mainnet', WALLET, 1_000_000)).toBeNull();
  });
});

describe('isWithinPaymentWindow', () => {
  it('is true inside the hour and false past it, measured from createdAt', () => {
    const r = record({ createdAt: 0 });
    expect(isWithinPaymentWindow(r, 3599_000)).toBe(true);
    expect(isWithinPaymentWindow(r, 3600_001)).toBe(false);
  });
});

describe('claimPendingOrder', () => {
  beforeEach(() => localStorage.clear());

  it('lets the first caller take the order and holds off the second', () => {
    savePendingOrder('mainnet', WALLET, record());
    expect(claimPendingOrder('mainnet', WALLET, 'ssc-1', 1_000_000)).toBe('taken');
    expect(claimPendingOrder('mainnet', WALLET, 'ssc-1', 1_000_010)).toBe('held');
  });

  it('reports a different order than the one stored as absent, not held', () => {
    savePendingOrder('mainnet', WALLET, record());
    expect(claimPendingOrder('mainnet', WALLET, 'ssc-other', 1_000_000)).toBe('absent');
  });

  it('lets a stale lease be retaken (the holder died)', () => {
    savePendingOrder('mainnet', WALLET, record());
    expect(claimPendingOrder('mainnet', WALLET, 'ssc-1', 1_000_000)).toBe('taken');
    expect(claimPendingOrder('mainnet', WALLET, 'ssc-1', 1_000_000 + 120_000)).toBe('taken');
  });

  it('reports an unstored order as absent — nobody can be colliding with it', () => {
    // A live checkout whose record failed to persist must still be able to
    // settle: 'absent' means no rival, not "refuse".
    expect(claimPendingOrder('mainnet', WALLET, 'ssc-1', 1_000_000)).toBe('absent');
  });
});

describe('keeping more than one recoverable order', () => {
  beforeEach(() => localStorage.clear());

  it('does not lose an abandoned order when its replacement is stored', () => {
    // The buyer gave up on ssc-1 and bought again. ssc-1's payment can still
    // confirm for the rest of the day, so its handle must survive.
    savePendingOrder('mainnet', WALLET, record({ orderId: 'ssc-1', abandonedAt: 1_000_000 }), 1_000_000);
    savePendingOrder('mainnet', WALLET, record({ orderId: 'ssc-2' }), 1_000_000);

    expect(readPendingOrder('mainnet', WALLET, 1_000_000)!.orderId).toBe('ssc-2');
    expect(readSettlableOrders('mainnet', WALLET, 1_000_000).map((r) => r.orderId).sort()).toEqual(['ssc-1', 'ssc-2']);
  });

  it('hides an abandoned order from the active slot without deleting it', () => {
    savePendingOrder('mainnet', WALLET, record({ abandonedAt: 1_000_000 }), 1_000_000);
    expect(readPendingOrder('mainnet', WALLET, 1_000_000)).toBeNull();
    expect(readSettlableOrders('mainnet', WALLET, 1_000_000)).toHaveLength(1);
  });

  it('clears one order by id, leaving the others', () => {
    savePendingOrder('mainnet', WALLET, record({ orderId: 'ssc-1', abandonedAt: 1_000_000 }), 1_000_000);
    savePendingOrder('mainnet', WALLET, record({ orderId: 'ssc-2' }), 1_000_000);
    clearPendingOrder('mainnet', WALLET, 'ssc-2', 1_000_000);
    expect(readSettlableOrders('mainnet', WALLET, 1_000_000).map((r) => r.orderId)).toEqual(['ssc-1']);
  });

  it('reads a record written in the pre-list shape', () => {
    // An order in flight across the upgrade must not be dropped.
    localStorage.setItem(
      Object.keys(localStorage)[0] ?? `sphere_subscription_api_key.pending_order.mainnet.${WALLET}`,
      JSON.stringify(record()),
    );
    expect(readPendingOrder('mainnet', WALLET, 1_000_000)!.orderId).toBe('ssc-1');
  });
});
