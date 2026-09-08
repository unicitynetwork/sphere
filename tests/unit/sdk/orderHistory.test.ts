/**
 * sphere#509: a paying user must be able to see what they bought and when.
 *
 * The pending record (#504) already holds everything a receipt needs, but it is
 * deleted the moment an order settles. These tests pin the journal that keeps
 * it — and, just as importantly, what the journal must NOT keep.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  archiveOrder,
  readOrderHistory,
  MAX_HISTORY,
  type OrderOutcome,
} from '@/sdk/subscription/orderHistory';
import { savePendingOrder, readPendingOrder, type PendingOrderRecord } from '@/sdk/subscription/pendingOrder';
import type { PlanInfo } from '@/services/subscriptionApi';

const WALLET = '02' + 'a'.repeat(64);
const OTHER_WALLET = '02' + 'b'.repeat(64);

const plan: PlanInfo = {
  planId: 7,
  name: 'premium',
  requestsPerMinute: 60,
  requestsPerDay: 10_000,
  priceCents: 1999,
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

function archive(id: string, outcome: OrderOutcome = 'paid', at = 2_000_000) {
  savePendingOrder('mainnet', WALLET, record({ orderId: id }), 1_000_000);
  archiveOrder('mainnet', WALLET, record({ orderId: id }), outcome, at);
}

beforeEach(() => localStorage.clear());

describe('order history', () => {
  it('starts empty', () => {
    expect(readOrderHistory('mainnet', WALLET)).toEqual([]);
  });

  it('turns a settled order into a receipt and retires the pending record', () => {
    savePendingOrder('mainnet', WALLET, record(), 1_000_000);
    archiveOrder('mainnet', WALLET, record(), 'upgraded', 2_000_000);

    const [entry, ...rest] = readOrderHistory('mainnet', WALLET);
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({
      orderId: 'ssc-1',
      planName: 'premium',
      priceCents: 1999,
      fiatCurrency: 'USD',
      createdAt: 1_000_000,
      settledAt: 2_000_000,
      outcome: 'upgraded',
      upgradeMasked: 'sk_...cbe1',
    });
    // The order is done: it must no longer block or resume a purchase.
    expect(readPendingOrder('mainnet', WALLET, 1_500_000)).toBeNull();
  });

  it('lists the newest purchase first', () => {
    archive('ssc-old', 'paid', 2_000_000);
    archive('ssc-new', 'paid', 3_000_000);
    expect(readOrderHistory('mainnet', WALLET).map((e) => e.orderId)).toEqual(['ssc-new', 'ssc-old']);
  });

  it('keeps a bounded journal, dropping the oldest', () => {
    for (let i = 0; i < MAX_HISTORY + 3; i++) archive(`ssc-${i}`, 'paid', 2_000_000 + i);
    const ids = readOrderHistory('mainnet', WALLET).map((e) => e.orderId);
    expect(ids).toHaveLength(MAX_HISTORY);
    expect(ids[0]).toBe(`ssc-${MAX_HISTORY + 2}`);
    expect(ids).not.toContain('ssc-0');
  });

  it('is scoped per network and per wallet', () => {
    archive('ssc-1');
    expect(readOrderHistory('testnet2', WALLET)).toEqual([]);
    expect(readOrderHistory('mainnet', OTHER_WALLET)).toEqual([]);
  });

  it('never writes the key or the payment link', () => {
    // The link would invite paying a closed order again; the key belongs in the
    // vault, and a receipt is not a place to keep bearer material.
    archive('ssc-1');
    const raw = JSON.stringify(localStorage);
    expect(raw).not.toContain('pay.example');
    expect(raw).not.toContain('redirectUrl');
    const [entry] = readOrderHistory('mainnet', WALLET);
    expect(Object.keys(entry)).not.toContain('redirectUrl');
  });

  it('survives a corrupted journal instead of taking the screen down with it', () => {
    archive('ssc-1');
    const key = Object.keys(localStorage).find((k) => k.includes('order_history'));
    localStorage.setItem(key as string, '{not json');
    expect(readOrderHistory('mainnet', WALLET)).toEqual([]);
  });
});
