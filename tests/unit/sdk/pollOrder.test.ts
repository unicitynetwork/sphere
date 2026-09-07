import { pollOrderStatus, pollIntervalFor, settleOrder, PAYMENT_WINDOW_MS } from '@/sdk/subscription/pollOrder';
import type { OrderStatusInfo } from '@/services/subscriptionApi';

const base: OrderStatusInfo = { orderId: 'o', status: 'pending', statusName: 'x', fulfilled: false, confirming: false };
const instant = () => ({ intervalMs: 1, timeoutMs: 50, sleep: async () => {}, now: (() => { let t = 0; return () => (t += 10); })() });

it('resolves paid with the revealed key', async () => {
  const seq: OrderStatusInfo[] = [base, { ...base, status: 'paid', fulfilled: true, apiKey: 'sk_new' }];
  // `instant()` — CALL the factory; `{ ...instant }` spreads a function (no own
  // enumerable props) so intervalMs/timeoutMs/sleep fall back to prod defaults
  // and the test silently runs on a real 3s timer.
  const res = await pollOrderStatus(async () => seq.shift() ?? seq[0], instant());
  expect(res).toEqual({ outcome: 'paid', apiKey: 'sk_new', upgrade: false });
});

it('resolves paid without a key when the reveal was consumed elsewhere (pre-ack gateway)', async () => {
  const res = await pollOrderStatus(async () => ({ ...base, status: 'paid', fulfilled: true }), instant());
  expect(res.outcome).toBe('paid');
  expect(res.apiKey).toBeUndefined();
  expect(res.upgrade).toBe(false);
});

it('passes through the in-place upgrade fields on paid', async () => {
  const res = await pollOrderStatus(
    async () => ({ ...base, status: 'paid', fulfilled: true, upgrade: true, maskedKey: 'sk_...abcd', planName: 'premium' }),
    instant(),
  );
  expect(res).toEqual({ outcome: 'paid', apiKey: undefined, upgrade: true, maskedKey: 'sk_...abcd', planName: 'premium' });
});

it('resolves failed on a failed order', async () => {
  const res = await pollOrderStatus(async () => ({ ...base, status: 'failed' }), instant());
  expect(res.outcome).toBe('failed');
});

it('times out while pending, swallowing transient errors', async () => {
  let n = 0;
  const res = await pollOrderStatus(async () => { if (n++ % 2) throw new Error('net'); return base; }, instant());
  expect(res.outcome).toBe('timeout');
});

it('resolves cancelled when the signal is already aborted (never fetches)', async () => {
  const ac = new AbortController();
  ac.abort();
  const fetchStatus = vi.fn(async () => base);
  const res = await pollOrderStatus(fetchStatus, { ...instant(), signal: ac.signal });
  expect(res.outcome).toBe('cancelled');
  expect(fetchStatus).not.toHaveBeenCalled();
});

it('resolves cancelled when aborted mid-poll', async () => {
  const ac = new AbortController();
  const res = await pollOrderStatus(
    async () => { ac.abort(); return base; }, // pending, then abort before next tick
    { ...instant(), signal: ac.signal },
  );
  expect(res.outcome).toBe('cancelled');
});

it('does not leak abort listeners across intervals (default sleep cleans up on the timer path)', async () => {
  const ac = new AbortController();
  let added = 0, removed = 0;
  const origAdd = ac.signal.addEventListener.bind(ac.signal);
  const origRemove = ac.signal.removeEventListener.bind(ac.signal);
  ac.signal.addEventListener = ((type: string, ...rest: unknown[]) => {
    if (type === 'abort') added++;
    return (origAdd as (...a: unknown[]) => void)(type, ...rest);
  }) as typeof ac.signal.addEventListener;
  ac.signal.removeEventListener = ((type: string, ...rest: unknown[]) => {
    if (type === 'abort') removed++;
    return (origRemove as (...a: unknown[]) => void)(type, ...rest);
  }) as typeof ac.signal.removeEventListener;
  // Several pending polls, never aborted → each interval's listener must be
  // removed when its timer fires. Keep the DEFAULT sleep (the real-timer path
  // under test) but fake `now` so the iteration count is deterministic: with
  // real elapsed time a loaded CI runner can stretch one 2ms sleep past the
  // whole deadline and leave only a single interval (flaked with added === 1).
  // now steps +10/call: deadline at 45, checks at 20/30/40 → exactly 3 sleeps.
  const now = (() => { let t = 0; return () => (t += 10); })();
  const res = await pollOrderStatus(async () => base, { intervalMs: 1, timeoutMs: 35, now, signal: ac.signal });
  expect(res.outcome).toBe('timeout');
  expect(added).toBe(3);       // multiple intervals elapsed, deterministically
  expect(removed).toBe(added); // every listener cleaned up
});

it('the default (real-timer) sleep unblocks immediately on abort', async () => {
  // No custom `sleep` — exercises pollOrder's abortable setTimeout branch. A
  // 60s interval would hang the test if abort did not clear/resolve the timer.
  const ac = new AbortController();
  const res = await pollOrderStatus(
    async () => { ac.abort(); return base; },
    { intervalMs: 60_000, timeoutMs: 120_000, signal: ac.signal }, // real setTimeout
  );
  expect(res.outcome).toBe('cancelled');
});

// --- sphere#501: the poll must outlive a slow crypto payment -----------------

it('gives the buyer Paymento\'s full payment window, not five minutes', () => {
  expect(PAYMENT_WINDOW_MS).toBe(60 * 60_000);
});

it('is still polling well past the old five-minute deadline', async () => {
  let t = 0;
  let calls = 0;
  const res = await pollOrderStatus(
    async () => { calls++; return calls >= 3 ? { ...base, status: 'paid' as const, fulfilled: true } : base; },
    { now: () => t, sleep: async () => { t += 6 * 60_000; } },
  );
  expect(res.outcome).toBe('paid');
  expect(calls).toBe(3); // 12 minutes in — the old default had given up
});

it('gives up once the payment window closes', async () => {
  let t = 0;
  let calls = 0;
  const res = await pollOrderStatus(
    async () => { calls++; return base; },
    { now: () => t, sleep: async () => { t += 10 * 60_000; } },
  );
  expect(res.outcome).toBe('timeout');
  expect(calls).toBeGreaterThan(5); // it polled for an hour, not for five minutes
});

it('takes one last status read when a throttled sleep wakes past the deadline', async () => {
  // A hidden tab's timers are throttled to minutes: the sleep can overshoot the
  // whole window. Without a final read the poll reports timeout on an order
  // that settled while the tab was asleep.
  let t = 0;
  let calls = 0;
  const res = await pollOrderStatus(
    async () => { calls++; return calls >= 2 ? { ...base, status: 'paid' as const, fulfilled: true } : base; },
    { now: () => t, sleep: async () => { t += 2 * 60 * 60_000; } },
  );
  expect(res.outcome).toBe('paid');
  expect(calls).toBe(2);
});

it('does not take the final read after an abort', async () => {
  const ac = new AbortController();
  let calls = 0;
  let t = 0;
  const res = await pollOrderStatus(
    async () => { calls++; ac.abort(); return base; },
    { now: () => t, sleep: async () => { t += 2 * 60 * 60_000; }, signal: ac.signal },
  );
  expect(res.outcome).toBe('cancelled');
  expect(calls).toBe(1);
});

describe('pollIntervalFor', () => {
  it('polls every 3s for the first two minutes', () => {
    expect(pollIntervalFor(0)).toBe(3000);
    expect(pollIntervalFor(119_999)).toBe(3000);
  });

  it('eases to 10s after two minutes', () => {
    expect(pollIntervalFor(120_000)).toBe(10_000);
    expect(pollIntervalFor(599_999)).toBe(10_000);
  });

  it('eases to 30s after ten minutes, keeping an hour under ~200 requests', () => {
    expect(pollIntervalFor(600_000)).toBe(30_000);
    expect(pollIntervalFor(59 * 60_000)).toBe(30_000);
  });
});

it('uses the backoff schedule when no interval is forced', async () => {
  const sleeps: number[] = [];
  let t = 0;
  await pollOrderStatus(async () => base, {
    now: () => t,
    sleep: async (ms) => { sleeps.push(ms); t += ms; },
  });
  expect(sleeps[0]).toBe(3000);
  expect(sleeps).toContain(10_000);
  expect(sleeps).toContain(30_000);
});

describe('settleOrder', () => {
  it('is null while the order is still open, so a resume keeps waiting', () => {
    expect(settleOrder(base)).toBeNull();
    expect(settleOrder({ ...base, status: 'created' as never })).toBeNull();
  });

  it('reports an in-place upgrade without a key', () => {
    expect(settleOrder({ ...base, status: 'paid', fulfilled: true, upgrade: true, maskedKey: 'sk_...abcd' }))
      .toEqual({ outcome: 'paid', apiKey: undefined, upgrade: true, maskedKey: 'sk_...abcd', planName: undefined });
  });

  it('reports a failed order', () => {
    expect(settleOrder({ ...base, status: 'failed' })).toEqual({ outcome: 'failed' });
  });
});
