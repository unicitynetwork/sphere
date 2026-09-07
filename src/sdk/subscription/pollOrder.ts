/**
 * Polls a Paymento order until it settles. On 'paid':
 * - `upgrade` true means the buyer's existing key was upgraded IN PLACE — no
 *   key is ever delivered (only `maskedKey`/`planName`);
 * - otherwise `apiKey` carries the freshly issued key, which current gateways
 *   keep delivering until the caller acks receipt (ackOrderKeyDelivery). It is
 *   absent only on a pre-ack gateway whose one-time reveal was consumed by the
 *   payment return page (the UI then falls back to a paste-key claim step).
 */
import type { OrderStatusInfo } from '../../services/subscriptionApi';

/**
 * How long Paymento leaves an open order payable. The client's deadline is
 * pinned to it rather than to a number of our own: five minutes was shorter
 * than funding a wallet from a faucet takes, so the modal gave up mid-payment
 * and offered a key-paste step no upgrade order can satisfy (sphere#501).
 *
 * Reaching it ends the POLL, never the order — a payment sent at minute 59
 * confirms later, and the gateway keeps fulfilling for 24h either way.
 */
export const PAYMENT_WINDOW_MS = 60 * 60_000;

/**
 * Poll cadence by elapsed time: tight while someone is watching the modal,
 * relaxed once this is a long wait on a chain confirmation. Flat 3s over the
 * full window would be ~1200 requests per checkout; this is under 200.
 */
export function pollIntervalFor(elapsedMs: number): number {
  if (elapsedMs < 2 * 60_000) return 3000;
  if (elapsedMs < 10 * 60_000) return 10_000;
  return 30_000;
}

/**
 * The order's own verdict, or null while it is still open. Exported so a
 * resumed order can be settled by ONE status read without standing up a poll —
 * both paths must read a status the same way.
 */
export function settleOrder(order: OrderStatusInfo): OrderPollResult | null {
  if (order.status === 'paid') {
    return {
      outcome: 'paid',
      apiKey: order.apiKey,
      upgrade: order.upgrade === true,
      maskedKey: order.maskedKey,
      planName: order.planName,
    };
  }
  if (order.status === 'failed') return { outcome: 'failed' };
  return null;
}

export interface OrderPollResult {
  outcome: 'paid' | 'failed' | 'timeout' | 'cancelled';
  apiKey?: string;
  /** Set on 'paid' only: whether the order upgraded an existing key in place. */
  upgrade?: boolean;
  maskedKey?: string;
  planName?: string;
}

export async function pollOrderStatus(
  fetchStatus: () => Promise<OrderStatusInfo>,
  opts: {
    intervalMs?: number;
    timeoutMs?: number;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    /** Abort the poll (e.g. the upgrade modal closed). Resolves 'cancelled'. */
    signal?: AbortSignal;
  } = {},
): Promise<OrderPollResult> {
  const timeoutMs = opts.timeoutMs ?? PAYMENT_WINDOW_MS;
  const now = opts.now ?? (() => Date.now());
  const signal = opts.signal;
  // Default sleep resolves early on abort so a closed modal stops polling
  // within the same tick instead of after a full interval. Check `aborted`
  // synchronously first: if the signal is ALREADY aborted, the 'abort' event
  // has fired and addEventListener would never call back (leaving the full
  // timer to run).
  const sleep =
    opts.sleep ??
    ((ms) =>
      new Promise<void>((resolve) => {
        if (signal?.aborted) { resolve(); return; }
        // Remove the listener on the normal-timer path too: with only
        // `{ once: true }` it lingers on the signal every interval it does NOT
        // fire, accumulating ~one per poll over the multi-minute window.
        const onAbort = () => { clearTimeout(t); resolve(); };
        const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
        signal?.addEventListener('abort', onAbort, { once: true });
      }));

  const started = now();
  const deadline = started + timeoutMs;
  while (now() < deadline) {
    if (signal?.aborted) return { outcome: 'cancelled' };
    try {
      const verdict = settleOrder(await fetchStatus());
      if (verdict) return verdict;
    } catch {
      // transient — keep polling
    }
    await sleep(opts.intervalMs ?? pollIntervalFor(now() - started));
  }
  if (signal?.aborted) return { outcome: 'cancelled' };

  // One last read before declaring a timeout. A hidden tab's timers are
  // throttled to minutes, so the sleep above can wake well past the deadline —
  // and the order it was waiting on may have settled while it slept. Without
  // this, that wallet reports "payment not detected" on a paid order.
  try {
    const verdict = settleOrder(await fetchStatus());
    if (verdict) return verdict;
  } catch {
    // transient — the record outlives this poll and can be re-read later
  }
  return { outcome: 'timeout' };
}
