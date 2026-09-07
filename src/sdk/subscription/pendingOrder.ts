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
 * wallet deletion, and is scoped per network: orders belong to one gateway.
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
  /** Index-0 pubkey — the wallet that bought this. A different wallet must not adopt it. */
  walletPubkey: string;
  /** The address active at checkout, which is where an address-scoped key belongs. */
  addressPubkey: string;
  /** EFFECTIVE scope (`onRootAddress || walletWide`), never the raw checkbox. */
  walletWide: boolean;
  /** Masked key this checkout upgrades in place; null for a fresh-key purchase. */
  upgradeMasked: string | null;
  /** Set by the tab currently settling this order (see CLAIM_LEASE_MS). */
  claimedAt?: number;
}

function slot(network: string): string {
  return SLOT_PREFIX + network;
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
function parse(raw: string): PendingOrderRecord | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  const r = v as PendingOrderRecord | null;
  if (typeof r !== 'object' || r === null) return null;
  if (typeof r.orderId !== 'string' || r.orderId === '') return null;
  if (typeof r.redirectUrl !== 'string') return null;
  if (!isPlan(r.plan)) return null;
  if (typeof r.createdAt !== 'number' || !Number.isFinite(r.createdAt)) return null;
  if (typeof r.walletPubkey !== 'string' || typeof r.addressPubkey !== 'string') return null;
  if (typeof r.walletWide !== 'boolean') return null;
  if (r.upgradeMasked !== null && typeof r.upgradeMasked !== 'string') return null;
  if (r.claimedAt !== undefined && typeof r.claimedAt !== 'number') return null;
  return r;
}

export function savePendingOrder(network: string, record: PendingOrderRecord): void {
  try {
    localStorage.setItem(slot(network), JSON.stringify(record));
  } catch {
    // Storage full or blocked: the flow still works, it just cannot resume.
  }
}

export function readPendingOrder(network: string, now: number = Date.now()): PendingOrderRecord | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(slot(network));
  } catch {
    return null;
  }
  if (raw === null) return null;

  const record = parse(raw);
  if (record === null) {
    clearPendingOrder(network);
    return null;
  }
  if (now - record.createdAt >= RECORD_TTL_MS) {
    // Past the gateway's own recovery window: nothing can settle it any more.
    clearPendingOrder(network);
    return null;
  }
  return record;
}

export function clearPendingOrder(network: string): void {
  try {
    localStorage.removeItem(slot(network));
  } catch {
    // nothing to do — a stale record expires on its own at the horizon
  }
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
 * Single-flight across tabs: the winner settles the order, the losers leave it
 * alone. Without it two tabs can both read a deliverable fresh key and adopt it
 * into two different address slots, and the loser's post-ack read (paid, no
 * key) would strand it on the unsatisfiable paste step.
 */
export function claimPendingOrder(network: string, orderId: string, now: number = Date.now()): boolean {
  const record = readPendingOrder(network, now);
  if (record === null || record.orderId !== orderId) return false;
  if (record.claimedAt !== undefined && now - record.claimedAt < CLAIM_LEASE_MS) return false;
  savePendingOrder(network, { ...record, claimedAt: now });
  return true;
}
