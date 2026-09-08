/**
 * The user's own record of what they bought on this network.
 *
 * WHY IT EXISTS: the wallet can sell a subscription but could never show what
 * was sold. `order-status` is keyed by a single order id and the gateway has no
 * "list my orders", so a buyer who closed the tab had nothing but Paymento's
 * email; nothing at all answered "what did I buy, and when" or "why did my
 * limits drop" (sphere#509).
 *
 * WHY LOCAL: a server-side history is possible — a normal purchase upgrades the
 * identity-bound key in place, so `paymento_orders.upgrade_api_key →
 * api_keys.owner_id → network:pubkey` already closes the loop — but it needs an
 * endpoint the gateway does not have yet (aggregator-subscription#83 item 1).
 * This journal needs nothing from anyone and works offline. Its honest cost is
 * that it lives in one browser, which the screen says out loud.
 *
 * WHY SEPARATE FROM pendingOrder.ts: opposite lifetimes. A pending record is
 * operational state — five at most, gone in 24h, deleted the moment it settles.
 * A receipt is a memory: it starts where the pending record ends.
 */
import { STORAGE_KEYS } from '../../config/storageKeys';
import { clearPendingOrder, type PendingOrderRecord } from './pendingOrder';

const SLOT_PREFIX = `${STORAGE_KEYS.SUBSCRIPTION_API_KEY}.order_history.`;

/** How an order ended, in the buyer's terms rather than the gateway's. */
export type OrderOutcome =
  | 'paid' //      a fresh key was bought and delivered
  | 'upgraded' //  an existing key moved to this plan
  | 'failed' //    the gateway reported the payment failed
  | 'abandoned'; // the buyer walked away and it never settled

/**
 * One receipt. Deliberately NOT the pending record:
 *  - no `redirectUrl` — a payment link for a closed order is an invitation to
 *    pay twice;
 *  - no key, ever. `upgradeMasked` is already only a mask.
 */
export interface OrderHistoryEntry {
  orderId: string;
  planName: string;
  priceCents: number;
  fiatCurrency: string;
  createdAt: number;
  settledAt: number;
  outcome: OrderOutcome;
  upgradeMasked: string | null;
}

/**
 * How many receipts one wallet keeps per network. A journal, not an archive:
 * enough to answer "what did I buy recently", small enough that a corrupted or
 * oversized blob can never wedge the subscription screen.
 */
export const MAX_HISTORY = 20;

function slot(network: string, walletPubkey: string): string {
  return `${SLOT_PREFIX}${network}.${walletPubkey}`;
}

function isEntry(value: unknown): value is OrderHistoryEntry {
  if (typeof value !== 'object' || value === null) return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.orderId === 'string' &&
    typeof e.planName === 'string' &&
    typeof e.priceCents === 'number' &&
    typeof e.createdAt === 'number' &&
    typeof e.settledAt === 'number' &&
    typeof e.outcome === 'string'
  );
}

/** Newest first. A journal nobody can read is worse than none, so it never throws. */
export function readOrderHistory(network: string, walletPubkey: string): OrderHistoryEntry[] {
  let raw: string | null;
  try {
    raw = localStorage.getItem(slot(network, walletPubkey));
  } catch {
    return [];
  }
  if (raw === null) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isEntry);
}

/**
 * Retire a settled order: write its receipt, then drop the pending record.
 *
 * Called at every terminal outcome in PlanScreen — which is exactly where the
 * record used to be deleted outright, so the seam is the same one, it just
 * remembers now. Takes the record rather than an id because every caller
 * already holds it, and reading it back would race the very deletion below.
 */
export function archiveOrder(
  network: string,
  walletPubkey: string,
  record: PendingOrderRecord,
  outcome: OrderOutcome,
  now: number = Date.now(),
): void {
  const entry: OrderHistoryEntry = {
    orderId: record.orderId,
    planName: record.plan.name,
    priceCents: record.plan.priceCents,
    fiatCurrency: record.plan.fiatCurrency,
    createdAt: record.createdAt,
    settledAt: now,
    outcome,
    upgradeMasked: record.upgradeMasked,
  };

  const kept = [entry, ...readOrderHistory(network, walletPubkey).filter((e) => e.orderId !== entry.orderId)];
  try {
    localStorage.setItem(slot(network, walletPubkey), JSON.stringify(kept.slice(0, MAX_HISTORY)));
  } catch {
    // Storage full or blocked: losing the receipt must not block retiring the
    // order below, which is what stops it blocking the next purchase.
  }
  clearPendingOrder(network, walletPubkey, record.orderId);
}
