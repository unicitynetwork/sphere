/**
 * The wallet's handle on a checkout it started but has not seen settle.
 *
 * Without it a closed modal, a reload or a slow payment loses the order
 * entirely: the poll cannot resume, and the plan screen happily mints a SECOND
 * Paymento order for the same purchase (sphere#503 — the gateway has no dedupe
 * of its own, so two paid links charge twice for one 30-day window).
 *
 * The record is deliberately not a cache of the order's STATE — order-status is
 * the only authority on that. It carries just enough to (a) find the order
 * again, (b) re-offer its payment link, and (c) decide whether the key it would
 * adopt still belongs to the wallet and address that bought it. The API key is
 * never stored; an upgrade keeps only the masked form, which is enough to
 * confirm the local key is still the one the order upgraded.
 *
 * Lifetime is the SERVER's, not the modal's: the gateway re-verifies active
 * orders for 24h (PAYMENTO_POLL_MAX_AGE_HOURS), so the record lives that long
 * and is cleared only by a terminal status, a durable adoption, or the horizon.
 * Anything shorter re-creates the bug — closing the dialog must not throw the
 * order away.
 *
 * Slot carries the `sphere_` prefix so `clearAllSphereData()` wipes it on
 * wallet deletion, and is scoped per (network, wallet): orders belong to one
 * gateway and to the wallet that bought them. Scoping by network alone let a
 * second wallet's checkout overwrite the first's handle, losing its recovery
 * and re-opening the duplicate-order path it exists to prevent — and the slot
 * IS the wallet binding, so a record can never be read against the wrong one.
 */
import { STORAGE_KEYS } from '../../config/storageKeys';
import { PAYMENT_WINDOW_MS } from './pollOrder';
import type { PlanInfo } from '../../services/subscriptionApi';

const SLOT_PREFIX = `${STORAGE_KEYS.SUBSCRIPTION_API_KEY}.pending_order.`;

/** The gateway's own re-verification window — the horizon for recovering an order. */
export const RECORD_TTL_MS = 24 * 60 * 60_000;

/**
 * How long one tab's claim on settling an order holds off the others. Short
 * enough that a tab which died mid-adoption does not strand the order, long
 * enough to cover a status read plus a vault write.
 */
export const CLAIM_LEASE_MS = 60_000;

export interface PendingOrderRecord {
  orderId: string;
  /** Paymento's payment page, so a resumed order can re-offer the link. */
  redirectUrl: string;
  /** The whole plan, not just its id: the success view renders its features. */
  plan: PlanInfo;
  createdAt: number;
  /** The address active at checkout, which is where an address-scoped key belongs. */
  addressPubkey: string;
  /** EFFECTIVE scope (`onRootAddress || walletWide`), never the raw checkbox. */
  walletWide: boolean;
  /** Masked key this checkout upgrades in place; null for a fresh-key purchase. */
  upgradeMasked: string | null;
  /** Set by the tab currently settling this order (see CLAIM_LEASE_MS). */
  claimedAt?: number;
  /**
   * The buyer gave up on this order and wants to start over. It stops blocking
   * a new checkout, but it is NOT deleted: a `pending` order can already be
   * funded and awaiting confirmation, and nothing here cancels or refunds the
   * server-side payment. It stays recoverable until the horizon so a late
   * settlement still hands over its key.
   */
  abandonedAt?: number;
}

/** @param walletPubkey the wallet's index-0 pubkey — its subscription identity. */
function slot(network: string, walletPubkey: string): string {
  return `${SLOT_PREFIX}${network}.${walletPubkey}`;
}

/**
 * How many orders one wallet keeps per network. A buyer who abandons an order
 * and starts over has TWO recoverable orders — the replacement, and the one
 * whose payment may still confirm — so a single slot cannot hold the promise
 * that an abandoned order is still settled. Oldest is dropped first.
 */
export const MAX_RECORDS = 5;

/**
 * Whether ANY order record exists for this network, without needing the
 * wallet's pubkey.
 *
 * Exists for one job: deciding whether a surface that leads to the plan screen
 * must stay reachable. The plan screen is the only place a paid-but-undelivered
 * order can be resumed from, so hiding the way in — because the store flag went
 * off or the catalogue came back empty — would strand a purchase someone paid
 * real money for. Deliberately coarse: it does not parse, validate or TTL-check
 * the records, because every inaccuracy it can have errs toward keeping a door
 * open rather than closing one.
 */
export function hasStoredOrders(network: string): boolean {
  const prefix = `${SLOT_PREFIX}${network}.`;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) return true;
    }
  } catch {
    // Storage blocked — nothing to resume from anyway.
  }
  return false;
}

/** All live records, newest last. Expired ones are dropped as they are read. */
function readAll(network: string, walletPubkey: string, now: number): PendingOrderRecord[] {
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
    clearPendingOrder(network, walletPubkey);
    return [];
  }
  // A single object is the pre-list shape: adopt it rather than dropping an
  // order that is still in flight across the upgrade.
  const list = Array.isArray(parsed) ? parsed : [parsed];
  const live = list
    .map((entry) => validate(entry))
    .filter((r): r is PendingOrderRecord => r !== null && now - r.createdAt < RECORD_TTL_MS);

  if (live.length !== list.length) writeAll(network, walletPubkey, live);
  return live;
}

function writeAll(network: string, walletPubkey: string, records: PendingOrderRecord[]): void {
  try {
    if (records.length === 0) {
      localStorage.removeItem(slot(network, walletPubkey));
      return;
    }
    localStorage.setItem(slot(network, walletPubkey), JSON.stringify(records.slice(-MAX_RECORDS)));
  } catch {
    // Storage full or blocked: the flow still works, it just cannot resume.
  }
}

function isPlan(v: unknown): v is PlanInfo {
  const p = v as PlanInfo | null;
  return (
    typeof p === 'object' &&
    p !== null &&
    typeof p.planId === 'number' &&
    typeof p.name === 'string' &&
    typeof p.requestsPerMinute === 'number' &&
    typeof p.requestsPerDay === 'number' &&
    typeof p.priceCents === 'number' &&
    typeof p.fiatCurrency === 'string'
  );
}

/**
 * Strict: a half-parsed record would be acted on — adopting a purchased key
 * against a wallet field that decoded to `undefined` is exactly the kind of
 * miss that files the key in the wrong vault slot. Anything unrecognised is
 * treated as no record at all.
 */
function validate(v: unknown): PendingOrderRecord | null {
  const r = v as PendingOrderRecord | null;
  if (typeof r !== 'object' || r === null) return null;
  if (typeof r.orderId !== 'string' || r.orderId === '') return null;
  if (typeof r.redirectUrl !== 'string') return null;
  if (!isPlan(r.plan)) return null;
  if (typeof r.createdAt !== 'number' || !Number.isFinite(r.createdAt)) return null;
  if (typeof r.addressPubkey !== 'string') return null;
  if (typeof r.walletWide !== 'boolean') return null;
  if (r.upgradeMasked !== null && typeof r.upgradeMasked !== 'string') return null;
  if (r.claimedAt !== undefined && typeof r.claimedAt !== 'number') return null;
  if (r.abandonedAt !== undefined && typeof r.abandonedAt !== 'number') return null;
  return r;
}

/** Upsert by orderId, keeping every other live record (see MAX_RECORDS). */
export function savePendingOrder(
  network: string,
  walletPubkey: string,
  record: PendingOrderRecord,
  now: number = Date.now(),
): void {
  const others = readAll(network, walletPubkey, now).filter((r) => r.orderId !== record.orderId);
  writeAll(network, walletPubkey, [...others, record]);
}

/**
 * The order this wallet is currently buying: the newest one the buyer has not
 * abandoned. Abandoned orders stay recoverable but must not drive the UI or
 * block a new purchase — read them with `readSettlableOrders`.
 */
export function readPendingOrder(
  network: string,
  walletPubkey: string,
  now: number = Date.now(),
): PendingOrderRecord | null {
  const live = readAll(network, walletPubkey, now).filter((r) => r.abandonedAt === undefined);
  return live.length > 0 ? live[live.length - 1] : null;
}

/**
 * Every order that could still hand over a key, newest first — including the
 * abandoned ones, whose payments the gateway keeps settling for 24h.
 */
export function readSettlableOrders(
  network: string,
  walletPubkey: string,
  now: number = Date.now(),
): PendingOrderRecord[] {
  return readAll(network, walletPubkey, now).reverse();
}

/** Drop one order by id, or every order for this wallet when `orderId` is omitted. */
export function clearPendingOrder(
  network: string,
  walletPubkey: string,
  orderId?: string,
  now: number = Date.now(),
): void {
  if (orderId === undefined) {
    try {
      localStorage.removeItem(slot(network, walletPubkey));
    } catch {
      // nothing to do — stale records expire on their own at the horizon
    }
    return;
  }
  writeAll(
    network,
    walletPubkey,
    readAll(network, walletPubkey, now).filter((r) => r.orderId !== orderId),
  );
}

/**
 * True while the buyer can still pay this order. Measured from the order's own
 * `createdAt`, so reopening at minute 59 does not grant a fresh hour.
 *
 * Passing it ends the POLL, never the order: a payment sent at minute 59
 * confirms later, and the gateway keeps fulfilling for a day.
 */
export function isWithinPaymentWindow(record: PendingOrderRecord, now: number = Date.now()): boolean {
  return now - record.createdAt < PAYMENT_WINDOW_MS;
}

/**
 * Outcome of asking to settle an order:
 * - `taken`  — this caller now holds the lease;
 * - `held`   — someone else holds a fresh one, so leave the order alone;
 * - `absent` — nothing is stored for it, so there is no one to collide with.
 *
 * `absent` must not be conflated with `held`. A live checkout whose record
 * failed to persist (storage at quota, private-window quirks) has no stored
 * order, and refusing to settle there would drop a key the buyer already paid
 * for.
 */
export type OrderClaim = 'taken' | 'held' | 'absent';

/**
 * Single-flight across tabs: the winner settles the order, the losers leave it
 * alone. Without it two tabs can both read a deliverable fresh key and adopt it
 * into two different address slots, and the loser's post-ack read (paid, no
 * key) would strand it on the unsatisfiable paste step.
 */
export function claimPendingOrder(
  network: string,
  walletPubkey: string,
  orderId: string,
  now: number = Date.now(),
): OrderClaim {
  const record = readAll(network, walletPubkey, now).find((r) => r.orderId === orderId);
  if (record === undefined) return 'absent';
  if (record.claimedAt !== undefined && now - record.claimedAt < CLAIM_LEASE_MS) return 'held';
  savePendingOrder(network, walletPubkey, { ...record, claimedAt: now }, now);
  return 'taken';
}
