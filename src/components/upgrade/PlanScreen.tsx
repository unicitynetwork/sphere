import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Sparkles, Loader2, AlertTriangle } from 'lucide-react';
import { Button } from '../wallet/ui';
import { PlansGrid } from '../subscription/PlansGrid';
import { CurrentPlanShowcase } from '../subscription/CurrentPlanShowcase';
import { UpgradeSuccess } from './UpgradeSuccess';
import { usePlans, useUtilization, useCheckout } from '../../sdk/hooks/subscription';
import { pollOrderStatus, settleOrder, PAYMENT_WINDOW_MS, type OrderPollResult } from '../../sdk/subscription/pollOrder';
import {
  savePendingOrder,
  readPendingOrder,
  readSettlableOrders,
  clearPendingOrder,
  claimPendingOrder,
  isWithinPaymentWindow,
  type PendingOrderRecord,
} from '../../sdk/subscription/pendingOrder';
import { resolveCheckoutOutcome, type CheckoutOutcomeAction } from '../../sdk/subscription/checkoutOutcome';
import { validatePastedKey } from '../../sdk/subscription/keyCheck';
import { loadWalletKey } from '../../sdk/subscription/keyVault';
import { rememberPlan } from '../../sdk/subscription/planMemory';
import { getOrderStatus, ackOrderKeyDelivery, type PlanInfo } from '../../services/subscriptionApi';
import {
  syntheticCurrentPlan,
  formatPlanPrice,
  isPlanSelectable,
  keepPlanLabel,
  continueWithPlanLabel,
  planGridList,
} from '../subscription/planFeatures';
import { EnterApiKeyRow } from '../subscription/EnterApiKeyRow';
import { getStoredSubscriptionKey } from '../../config/subscriptionKeyCache';
import { SUBSCRIPTION_MOCK, PAID_PLANS_ENABLED } from '../../config/subscription';
import { showToast } from '../ui/toast-utils';
import { useQueryClient } from '@tanstack/react-query';
import { SPHERE_KEYS } from '../../sdk/queryKeys';
import { useSphereContext } from '../../sdk/hooks';
import { getPublicKey } from '@unicitylabs/sphere-sdk';
import type { UpgradeReason } from './UpgradeContext';

/** Local mirror of the gateway's mask ("sk_...abcd") for keys we hold in full. */
function maskKey(key: string): string {
  if (key.length < 12) return '...';
  return `${key.startsWith('sk_') ? 'sk_' : ''}...${key.slice(-4)}`;
}

type Step = 'plans' | 'email' | 'awaiting' | 'claim' | 'success' | 'error';

/**
 * Onboarding turns the plan screen into a STEP of wallet creation rather than
 * a dismissible dialog: no close X (there is nothing behind it yet), the
 * header names the plan just provisioned, and the way out is entering the
 * wallet on the current plan.
 */
export interface PlanScreenOnboarding {
  /** Plan NAME from finalize — header fallback until utilization resolves. */
  planName: string | null;
  /** Fresh wallet (true) vs restored one (false) — header copy only. */
  created: boolean;
  isBusy?: boolean;
  /** Enter the wallet keeping whatever plan is current. */
  onContinue: () => void;
}

interface PlanScreenProps {
  isOpen: boolean;
  reason?: UpgradeReason;
  /** Present = onboarding mode. See PlanScreenOnboarding. */
  onboarding?: PlanScreenOnboarding;
  onClose: () => void;
}

/**
 * Banner shown above the plans grid, keyed off why the upgrade modal was
 * opened. Extracted from UpgradeModal's render body so it can be unit-tested
 * without mounting the full modal (which pulls in usePlans/useUtilization/
 * useCheckout/useSphereContext). 'settings' and undefined render nothing.
 */
export function UpgradeReasonBanner({ reason }: { reason?: UpgradeReason }) {
  if (reason === 'quota') {
    return (
      <div className="mx-auto mb-6 flex max-w-xl items-start gap-2 rounded-2xl border border-yellow-500/20 bg-yellow-500/10 p-3 text-sm">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-500" />
        <span>You've hit your plan's limit. Upgrade for more, or wait for your quota to refill.</span>
      </div>
    );
  }

  if (reason === 'expired') {
    return (
      <div className="mx-auto mb-6 flex max-w-xl items-start gap-2 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-3 text-sm">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
        <span>Your plan has expired — renew to restore your limits.</span>
      </div>
    );
  }

  return null;
}

/**
 * The quiet "no thanks" that keeps the wallet's existing plan. Styled like
 * onboarding's Skip (a full-width borderless button under the primary CTA) so
 * the decline is as reachable as the purchase without competing with it.
 */
function KeepPlanButton({ planName, onClick }: { planName: string | null; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-xl px-5 py-2.5 text-sm text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:text-white/45 dark:hover:bg-white/6 dark:hover:text-white"
    >
      {keepPlanLabel(planName)}
    </button>
  );
}

/**
 * Heading above the line-up. Onboarding confirms what was just provisioned;
 * the dialog sells the upgrade. With paid plans off the dialog has nothing to
 * pitch, so it keeps its bare header bar.
 */
function PlansHero({ onboarding, currentName }: { onboarding?: PlanScreenOnboarding; currentName: string | null }) {
  if (!onboarding) {
    if (!PAID_PLANS_ENABLED) return null;
    return (
      <div className="mb-8 text-center">
        <h2 className="text-2xl font-bold sm:text-3xl">Unlock more commitments</h2>
        <p className="mt-1.5 text-sm text-neutral-500 dark:text-white/45">
          Pick the plan that fits how much you transact.
        </p>
      </div>
    );
  }

  // No icon tile here: the shared header bar already carries the mark, and a
  // second one made onboarding look like a different screen.
  return (
    <div className="mb-8 text-center">
      <h2 className="text-2xl font-bold sm:text-3xl">
        {onboarding.created ? 'Your plan is ready' : 'Subscription restored'}
      </h2>
      <p className="mt-1.5 text-sm text-neutral-500 dark:text-white/45">
        {!currentName
          ? 'Your subscription is active.'
          : PAID_PLANS_ENABLED
            ? `You're on the ${currentName} plan — upgrade now, or any time from Settings.`
            : `You're all set on the ${currentName} plan.`}
      </p>
    </div>
  );
}

/**
 * Below the line-up: onboarding's way into the wallet (which is also its
 * decline — see continueWithPlanLabel) plus the paste-a-key affordance, or the
 * dialog's named decline. Nothing when the dialog has no offer to decline.
 */
function PlansFooter({
  onboarding,
  currentName,
  onDecline,
}: {
  onboarding?: PlanScreenOnboarding;
  currentName: string | null;
  onDecline: () => void;
}) {
  if (!onboarding) {
    if (!PAID_PLANS_ENABLED) return null;
    return (
      <div className="mx-auto mt-10 w-full max-w-xs">
        <KeepPlanButton planName={currentName} onClick={onDecline} />
      </div>
    );
  }

  return (
    <div className="mx-auto mt-10 w-full max-w-xs">
      <Button variant="primary" fullWidth loading={onboarding.isBusy} onClick={onboarding.onContinue}>
        {continueWithPlanLabel(currentName, PAID_PLANS_ENABLED)}
      </Button>
      <EnterApiKeyRow
        tone="quiet"
        walletWide
        label="Already have a key? Paste it now"
        note="Applied to this wallet, so every address uses it. You can swap it later in Settings → Subscription."
        appliedNote="Key applied — your plan above reflects it."
      />
    </div>
  );
}

/**
 * THE plan surface. One component serves every entry point — onboarding's
 * post-creation step, Settings → Subscription's "Upgrade plan", the quota /
 * expiry prompts, and the free-plan offer on wallet entry — so the line-up,
 * the purchase steps and the decline are written once (sphere#496).
 */
export function PlanScreen({ isOpen, reason, onboarding, onClose }: PlanScreenProps) {
  const plans = usePlans(isOpen);
  const util = useUtilization();
  const checkout = useCheckout();
  const queryClient = useQueryClient();
  const { sphere, applySubscriptionKey, network } = useSphereContext();

  const [step, setStep] = useState<Step>('plans');
  const [error, setError] = useState<string | null>(null);
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<PlanInfo | null>(null);
  const [email, setEmail] = useState('');
  const [claimKey, setClaimKey] = useState('');
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [newApiKey, setNewApiKey] = useState<string | null>(null);
  const [walletWide, setWalletWide] = useState(false);
  /** Success came from an in-place upgrade — render the "same key" variant. */
  const [upgradedMaskedKey, setUpgradedMaskedKey] = useState<string | null>(null);
  /** Checkout failed while carrying an upgrade key — offer buying a new key instead. */
  const [upgradeRejected, setUpgradeRejected] = useState(false);
  /**
   * Masked form of the key this checkout upgrades — the only form a RESUMED
   * order has, so all upgrade copy reads this rather than the full key.
   */
  const [upgradeMasked, setUpgradeMasked] = useState<string | null>(null);
  /** The order being watched, live or resumed. Null once it settles. */
  const [pending, setPending] = useState<PendingOrderRecord | null>(null);
  /** The payment window closed on this order (distinct from "not detected yet"). */
  const [windowClosed, setWindowClosed] = useState(false);
  /**
   * The order is PAID and its key is waiting for the address that bought it.
   * Nothing here may discard it: cancelling refunds nothing and unsubscribes
   * nothing, it only deletes the last handle on a key the buyer owns.
   */
  const [awaitingBuyingAddress, setAwaitingBuyingAddress] = useState(false);
  /** The adopted key reached the live session but not durable storage. */
  const [notDurable, setNotDurable] = useState(false);

  // Cancels the in-flight checkout poll when the modal closes (or a newer
  // checkout starts). Without this the poll outlives the modal and can
  // "ghost-adopt" a key onto whatever address is active minutes later.
  const checkoutAbortRef = useRef<AbortController | null>(null);
  useEffect(() => () => checkoutAbortRef.current?.abort(), []);

  /** True while an order is being created — see startCheckout. */
  const creatingRef = useRef(false);

  /**
   * Index-0 pubkey — the wallet's subscription identity. Null when there is no
   * wallet to ask (locked, or not initialised). Kept separate from
   * `onRootAddress` on purpose: that one defaults to "root" when the wallet is
   * absent, which is a fine default for a checkbox but would misfile a
   * purchased key, so the pending-order record uses this instead.
   */
  const rootPubkey = useMemo(() => {
    if (!sphere) return null;
    try {
      return getPublicKey(sphere.deriveAddress(0).privateKey);
    } catch {
      return null;
    }
  }, [sphere]);

  // Buying while on the root address is wallet-wide by definition; on any
  // other address the email step offers a "make it wallet-wide" checkbox.
  const onRootAddress = useMemo(() => {
    if (!sphere || rootPubkey === null) return true;
    return sphere.identity?.chainPubkey === rootPubkey;
  }, [sphere, rootPubkey]);

  /**
   * Whether this ADDRESS may adopt what the record bought. The wallet dimension
   * is already settled — a record is stored under its buying wallet's own slot,
   * so one can never be read against another wallet. What remains is the
   * address: an address-scoped key is filed against whatever identity is active
   * at adoption, so it must only be adopted back on the address that bought it.
   */
  const canAdoptFor = (record: PendingOrderRecord): boolean =>
    record.walletWide || sphere?.identity?.chainPubkey === record.addressPubkey;

  const currentPlanName = util.data?.plan?.name ?? null;
  // Onboarding can render before utilization resolves — fall back to the plan
  // name finalize just provisioned so the copy is never plan-less.
  const currentName = currentPlanName ?? onboarding?.planName ?? null;

  // plans step: grid gets [synthetic current card, ...store plans]
  const freePlan = useMemo(() => (util.data ? syntheticCurrentPlan(util.data) : null), [util.data]);
  const gridPlans = useMemo(() => planGridList(freePlan, plans.data ?? []), [plans.data, freePlan]);

  const subscriptionStatus = util.data?.status ?? null;
  // A lapsed plan's own store card becomes the renew path (same key, fresh 30 days).
  const renewableCurrent = subscriptionStatus !== null && subscriptionStatus !== 'active';

  const handleSelect = (plan: PlanInfo) => {
    if (!isPlanSelectable(plan, { currentPlanName, subscriptionStatus, paidPlansEnabled: PAID_PLANS_ENABLED })) return;
    setSelectedPlan(plan);
    setStep('email');
  };

  /**
   * Persists a key (cache + scoped vault), re-inits the oracle and shows the
   * success view. `record` is the order it came from, if any: its scope wins
   * over the live checkbox (a resumed order was bought under the scope stored
   * with it), and the gateway's delivery is acknowledged ONLY once the vault
   * write is confirmed durable — an ack ends redelivery, so acking on a failed
   * write would leave the purchased key in a plaintext boot cache and nowhere
   * else.
   */
  const adoptKey = async (
    key: string,
    record?: PendingOrderRecord | null,
    /**
     * True only when the GATEWAY delivered this key for `record`. A key typed
     * in by hand proves nothing about which order it belongs to — the paste
     * check only asks whether the gateway knows it — and acknowledging on one
     * would end redelivery of the key the buyer actually paid for.
     */
    delivered = false,
  ) => {
    const scope = record ? record.walletWide : onRootAddress || walletWide;
    const { durable } = await applySubscriptionKey(key, { walletWide: scope });
    await queryClient.invalidateQueries({ queryKey: SPHERE_KEYS.subscription.all });
    if (record && durable && delivered && rootPubkey !== null) {
      // Fire-and-forget: an unsent ack only leaves the key deliverable.
      void ackOrderKeyDelivery(record.orderId);
      clearPendingOrder(network, rootPubkey, record.orderId);
      setPending(null);
    }
    // A key that was NOT delivered for this order (a hand-paste) settles
    // nothing: the paste check accepts any key the gateway knows and fails open
    // on lookup errors, so it may be unrelated to the purchase. The record is
    // the last handle on the key actually bought — the buyer dismisses it
    // deliberately instead.
    setNotDurable(!durable);
    setNewApiKey(key);
    setStep('success');
    // Only name the plan when this key IS the purchase; a pasted key may be any
    // key the buyer happened to have.
    showToast(
      delivered ? `Upgraded to ${record?.plan.name ?? selectedPlan?.name ?? 'new plan'}` : 'API key applied',
      'success',
      4000,
    );
  };

  // Claim-step activation: the pasted key is first sanity-checked against the
  // gateway (definitive unknown/revoked rejects inline; a failed lookup fails
  // open). adoptKey can still reject (e.g. storage blocked while persisting) —
  // surface that on the error step. claimKey is kept so "I have a key" lets
  // them retry.
  const activateClaimKey = async () => {
    setClaiming(true);
    setError(null);
    setClaimError(null);
    try {
      const verdict = await validatePastedKey(claimKey);
      if (!verdict.valid) {
        setClaimError(verdict.message ?? 'This key is not valid.');
        return;
      }
      await adoptKey(claimKey, pending && canAdoptFor(pending) ? pending : null);
    } catch (e) {
      setStep('error');
      setError(e instanceof Error ? e.message : 'Failed to activate the key');
    } finally {
      setClaiming(false);
    }
  };

  /**
   * The key this purchase should upgrade in place: the wallet key when the
   * purchase is wallet-wide (root address or the checkbox), otherwise whatever
   * key the active address currently uses. Null (no key yet, or the user chose
   * "buy a new key instead") turns the checkout into a fresh-key purchase.
   */
  const resolveUpgradeKey = async (): Promise<string | null> => {
    try {
      if ((onRootAddress || walletWide) && sphere) {
        return (await loadWalletKey(sphere, network)) ?? getStoredSubscriptionKey();
      }
    } catch {
      // fall through to the boot cache
    }
    return getStoredSubscriptionKey();
  };

  /**
   * The gateway caches key→plan for ~60s, so the read right after an upgrade
   * can still report the previous plan. Refresh again once that has expired,
   * otherwise Settings shows the old plan until something else invalidates.
   */
  const refreshSubscriptionThroughCache = async () => {
    await queryClient.invalidateQueries({ queryKey: SPHERE_KEYS.subscription.all });
    setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: SPHERE_KEYS.subscription.all });
    }, 60_000);
  };

  /**
   * Acts on a settled order. Shared by the live checkout and by a resumed one
   * so both reach the same conclusions from the same verdict — `record` is the
   * stored order when there is one, and carries the scope and plan a resume
   * cannot recover from component state.
   */
  const applyOutcome = async (action: CheckoutOutcomeAction, record: PendingOrderRecord | null, fullUpgradeKey: string | null) => {
    switch (action.kind) {
      case 'cancelled':
        return;
      case 'upgraded': {
        // Same key, new plan — nothing to adopt or re-init; refresh the read
        // models and remember the plan for the downgrade watcher.
        await refreshSubscriptionThroughCache();
        const planName = action.planName ?? record?.plan.name ?? selectedPlan?.name ?? 'new plan';
        // rememberPlan is keyed by the FULL key, which a resumed order does not
        // store — re-resolve it locally and use it only if it is still the key
        // the order upgraded (the mask is what the record keeps).
        const key = fullUpgradeKey ?? (record ? await resolveMatchingUpgradeKey(record.upgradeMasked) : null);
        if (record && record.upgradeMasked !== null && key === null) {
          // The plan was applied to a key this wallet can no longer produce —
          // it was replaced in Settings or another tab while the order was in
          // flight. Reporting success would hide a paid plan sitting on a key
          // that is gone, so say so and keep the record.
          setPending(record);
          setWindowClosed(false);
          setAwaitingBuyingAddress(true); // no discard control on this screen either
          setError(
            `The plan was applied to key ${record.upgradeMasked}, which this wallet no longer uses — it was replaced while the payment was in progress. Paste that key back in Settings → Subscription to use the plan you paid for.`,
          );
          setStep('error');
          return;
        }
        if (key) rememberPlan(key, planName);
        setUpgradedMaskedKey(action.maskedKey ?? record?.upgradeMasked ?? (fullUpgradeKey ? maskKey(fullUpgradeKey) : null));
        if (record && rootPubkey !== null) {
          clearPendingOrder(network, rootPubkey, record.orderId);
          setPending(null);
        }
        setStep('success');
        showToast(`Upgraded to ${planName}`, 'success', 4000);
        return;
      }
      case 'adopt': {
        // A purchased key is filed against whoever is active NOW, so a record
        // this wallet/address cannot own is left for the one that can.
        if (record && !canAdoptFor(record)) {
          // Keep the record ON SCREEN rather than dropping to the plan grid: it
          // still blocks a new checkout, and hiding it left no way out but
          // waiting the record out. The way out is switching back, which
          // retries settlement on its own — NOT cancelling, which would discard
          // a key that has already been paid for.
          setPending(record);
          setWindowClosed(false);
          setAwaitingBuyingAddress(true);
          setError(
            'This payment was made on a different address of this wallet, and its key belongs there. Switch back to that address and it will finish on its own.',
          );
          setStep('error');
          return;
        }
        // Single-flight the ONE dangerous step. Two tabs can each read a
        // deliverable key; if both adopt, it lands in two different slots and
        // the loser's post-ack read (paid, no key) strands it on the paste
        // step. Reads themselves are idempotent and stay unclaimed, so a reopen
        // is never left watching an order it may not touch.
        // Only an order ANOTHER tab is actively settling is left alone. An
        // absent record is not a refusal: a live checkout whose record failed to
        // persist (storage at quota) still has a paid order and a delivered key,
        // and dropping it here would lose what the buyer just paid for.
        //
        // The claim is a read-modify-write on shared storage with no CAS, so two
        // tabs could in principle both win it. Harmless by construction:
        // canAdoptFor above already requires both to be the same wallet AND (for
        // an address-scoped key) the same active address, so a double adoption
        // writes the same slot with the same key, and the gateway treats a
        // repeated ack as a 200.
        if (
          record &&
          rootPubkey !== null &&
          claimPendingOrder(network, rootPubkey, record.orderId) === 'held'
        ) {
          setStep('plans');
          return;
        }
        await adoptKey(action.apiKey, record, true);
        return;
      }
      case 'claim':
        // Paid, no key delivered, not an upgrade: the return page held the only
        // copy. The record stays — pasting is the recovery, and it can be done
        // on a later visit.
        setStep('claim');
        return;
      case 'failed':
        if (record && rootPubkey !== null) {
          clearPendingOrder(network, rootPubkey, record.orderId);
          setPending(null);
        }
        setStep('error');
        setError('The payment was not completed. No charge was made — you can try again.');
        return;
      case 'timeout':
        // The payment window closed; the ORDER has not. The gateway keeps
        // fulfilling for 24h and the record outlives this dialog, so say that
        // instead of implying the purchase is lost.
        setWindowClosed(true);
        setStep('error');
        setError(null);
        return;
    }
  };

  /** The current key for this record's scope, but only if it is still the one the order upgraded. */
  const resolveMatchingUpgradeKey = async (masked: string | null): Promise<string | null> => {
    if (masked === null) return null;
    const key = await resolveUpgradeKey();
    return key !== null && maskKey(key) === masked ? key : null;
  };

  /** Watch an order to settlement, from wherever it currently stands. */
  const watchOrder = async (record: PendingOrderRecord, abort: AbortController, fullUpgradeKey: string | null) => {
    // One status read first: a resumed order is usually already settled, and
    // asking once is cheaper and faster than standing up a poll to find out.
    let verdict: OrderPollResult | null = null;
    try {
      verdict = settleOrder(await getOrderStatus(record.orderId));
    } catch {
      // Transient — fall through to the poll, which tolerates failures.
    }
    if (abort.signal.aborted) return;

    if (verdict === null) {
      // Still open. Poll for what is LEFT of the payment window, measured from
      // the order's own creation — reopening at minute 59 must not grant
      // another hour.
      if (!isWithinPaymentWindow(record)) {
        setWindowClosed(true);
        setStep('error');
        setError(null);
        return;
      }
      const remaining = record.createdAt + PAYMENT_WINDOW_MS - Date.now();
      verdict = await pollOrderStatus(() => getOrderStatus(record.orderId), {
        signal: abort.signal,
        timeoutMs: remaining,
      });
    }
    if (abort.signal.aborted) return;
    await applyOutcome(resolveCheckoutOutcome(verdict), record, fullUpgradeKey);
  };

  /**
   * Pick up an order this wallet started earlier — after a reload, a closed
   * dialog, or a payment that outran the poll.
   */
  const resumeOrder = async (record: PendingOrderRecord) => {
    setPending(record);
    setSelectedPlan(record.plan);
    setPaymentUrl(record.redirectUrl);
    setUpgradeMasked(record.upgradeMasked);
    setWindowClosed(false);
    setStep('awaiting');

    checkoutAbortRef.current?.abort();
    const abort = new AbortController();
    checkoutAbortRef.current = abort;
    try {
      await watchOrder(record, abort, null);
    } catch (e) {
      // The live path has startCheckout's catch; a resume is called from an
      // effect, where a rejection would be swallowed by the runtime and leave
      // the dialog on a spinner that never resolves.
      if (abort.signal.aborted) return;
      setStep('error');
      setError(e instanceof Error ? e.message : 'Could not check the payment');
    }
  };

  /**
   * Settle an abandoned order without claiming the screen: read its status once
   * and act only on a verdict. A late-confirming payment still hands over its
   * key; an order that never landed stays quiet.
   */
  const settleQuietly = async (record: PendingOrderRecord) => {
    if (rootPubkey === null) return;
    try {
      const verdict = settleOrder(await getOrderStatus(record.orderId));
      if (!verdict) return; // still open — nothing to do until it settles
      const action = resolveCheckoutOutcome(verdict);

      if (action.kind === 'failed') {
        clearPendingOrder(network, rootPubkey, record.orderId);
        return;
      }

      if (action.kind === 'upgraded') {
        await refreshSubscriptionThroughCache();
        const key = await resolveMatchingUpgradeKey(record.upgradeMasked);
        const planName = action.planName ?? record.plan.name;
        if (record.upgradeMasked !== null && key === null) {
          // Same as the foreground path: the plan is on a key this wallet can
          // no longer produce. Keep the record — it holds the mask that
          // explains which key to restore — and do not call it a success.
          showToast(
            `A plan you paid for was applied to key ${record.upgradeMasked}, which this wallet no longer uses — restore it in Settings → Subscription.`,
            'error',
            8000,
          );
          return;
        }
        if (key) rememberPlan(key, planName);
        clearPendingOrder(network, rootPubkey, record.orderId);
        showToast(`Upgraded to ${planName}`, 'success', 4000);
        return;
      }

      if (action.kind === 'adopt') {
        // Its own address will settle it; adopting here files the key wrong.
        if (!canAdoptFor(record)) return;
        if (claimPendingOrder(network, rootPubkey, record.orderId) === 'held') return;
        const { durable } = await applySubscriptionKey(action.apiKey, { walletWide: record.walletWide });
        await queryClient.invalidateQueries({ queryKey: SPHERE_KEYS.subscription.all });
        if (durable) {
          void ackOrderKeyDelivery(record.orderId);
          clearPendingOrder(network, rootPubkey, record.orderId);
        }
        showToast(
          durable ? `Upgraded to ${record.plan.name}` : 'Key applied — save it from Settings → Subscription',
          'success',
          5000,
        );
        return;
      }

      // 'claim' (paid, no key delivered) and 'timeout' need the buyer, and this
      // order is one they walked away from. The record survives to its horizon;
      // nothing here takes the screen.
    } catch {
      // Transient — the record outlives this attempt and is retried on reopen.
    }
  };

  const startCheckout = async (opts?: { forceNewKey?: boolean }) => {
    if (!selectedPlan) return;
    // `checkout.isPending` disables the button, but only once the mutation is
    // in flight — the key resolution before it leaves a window where a second
    // click starts a second order for the same purchase.
    if (creatingRef.current) return;
    creatingRef.current = true;
    try {
      await createOrResumeOrder(opts);
    } finally {
      creatingRef.current = false;
    }
  };

  const createOrResumeOrder = async (opts?: { forceNewKey?: boolean }) => {
    if (!selectedPlan) return;
    setError(null);
    setUpgradeRejected(false);
    setWindowClosed(false);

    // One order at a time (#503). The gateway mints a fresh Paymento request on
    // every checkout call and dedupes nothing, so a second one here is a second
    // payable link for the same purchase — pay both and the buyer is charged
    // twice for one 30-day window. Continue the stored one instead.
    //
    // ANY stored order blocks, not just one inside its payment window: past the
    // window the order is not dead, only unpayable, and a payment sent near
    // expiry can still confirm for the rest of the day. Replacing it here would
    // discard the handle to a key that is about to exist. The way out is
    // deliberate — "cancel this payment and start over" — never implicit.
    // `pending` as well as storage: a record that failed to persist (quota,
    // blocked storage) exists only in memory, and consulting storage alone
    // would mint a second payable order for the same purchase.
    const live = (rootPubkey === null ? null : readPendingOrder(network, rootPubkey)) ?? pending;
    if (live && live.abandonedAt === undefined) {
      await resumeOrder(live);
      return;
    }

    // Supersede any prior in-flight poll, then track this one so close/unmount
    // can abort it.
    checkoutAbortRef.current?.abort();
    const abort = new AbortController();
    checkoutAbortRef.current = abort;
    // Always ask for an in-place upgrade of the existing key (same key, new
    // plan, fresh 30 days). Pre-upgrade gateways ignore the field and mint a
    // new key — the order's `upgrade` flag tells us which flow ran.
    // The full key stays a local — it is handed to the settle path directly.
    // Only its MASK is state, because that is all a resumed order can restore.
    const upgradeApiKey = opts?.forceNewKey ? null : await resolveUpgradeKey();
    setUpgradeMasked(upgradeApiKey ? maskKey(upgradeApiKey) : null);
    try {
      const { orderId, redirectUrl } = await checkout.mutateAsync({
        planId: selectedPlan.planId,
        email,
        upgradeApiKey: upgradeApiKey ?? undefined,
      });
      // Record the order BEFORE anything can go wrong with watching it: from
      // here on, closing the dialog, reloading or a payment slower than the
      // window must all be recoverable. This happens even if the dialog was
      // closed mid-creation: the order exists on the server and Paymento has
      // emailed its payable link, so a wallet with no record of it could not
      // resume the key that link buys.
      const record: PendingOrderRecord = {
        orderId,
        redirectUrl,
        plan: selectedPlan,
        createdAt: Date.now(),
        addressPubkey: sphere?.identity?.chainPubkey ?? rootPubkey ?? '',
        // The EFFECTIVE scope, not the checkbox: a root-address purchase is
        // wallet-wide whether or not the box was ticked.
        walletWide: onRootAddress || walletWide,
        upgradeMasked: upgradeApiKey ? maskKey(upgradeApiKey) : null,
      };
      // rootPubkey is non-null here: a checkout needs a wallet to resolve its
      // upgrade key and its scope from.
      if (rootPubkey !== null) savePendingOrder(network, rootPubkey, record);

      // Closed (or superseded) during creation — the order is now recorded, so
      // only the UI work is suppressed: no payment tab, no 'awaiting' screen on
      // a dialog the user cancelled, no poll.
      if (abort.signal.aborted) return;

      setPending(record);
      setPaymentUrl(redirectUrl);
      window.open(redirectUrl, '_blank', 'noopener,noreferrer');
      setStep('awaiting');
      // Creation is done — the guard covers minting an order, NOT watching it.
      // Held across the watch it would outlive an hour-long poll and lock this
      // tab out of ever starting another checkout.
      creatingRef.current = false;

      if (SUBSCRIPTION_MOCK) {
        // demoable without a backend — mirror the live gateway's two shapes
        const mocked: OrderPollResult = upgradeApiKey
          ? { outcome: 'paid', upgrade: true, maskedKey: maskKey(upgradeApiKey), planName: selectedPlan.name }
          : { outcome: 'paid', upgrade: false, apiKey: 'sk_mock_upgraded' };
        await applyOutcome(resolveCheckoutOutcome(mocked), record, upgradeApiKey);
        return;
      }
      await watchOrder(record, abort, upgradeApiKey);
    } catch (e) {
      if (abort.signal.aborted) return; // torn down mid-checkout — stay silent
      setStep('error');
      setError(e instanceof Error ? e.message : 'Checkout failed');
      // The gateway validates the upgrade key up front (unknown/revoked → 400):
      // give the user a way to buy a fresh key instead of the upgrade.
      setUpgradeRejected(!!upgradeApiKey);
    }
  };

  /**
   * Give up on the pending order deliberately. The unpaid Paymento order simply
   * expires; what matters is that the buyer is not held behind a link they no
   * longer want (switching plans mid-flight) for the rest of the hour.
   */
  const abandonOrder = () => {
    checkoutAbortRef.current?.abort();
    if (rootPubkey !== null && pending) {
      // MARK, don't delete. A pending order may already be funded and waiting
      // on confirmation, and this cancels nothing server-side — deleting the
      // record would strand a key the buyer paid for. Marked orders stop
      // blocking a new checkout and are still settled if they land.
      savePendingOrder(network, rootPubkey, { ...pending, abandonedAt: Date.now() });
    }
    setPending(null);
    resetPurchase();
  };

  /**
   * Resets the SCREEN, never the order. Closing the dialog runs through here,
   * and an order the buyer may still be paying must survive that — dropping the
   * record on close is what left a slow payment unrecoverable and let the next
   * visit mint a second one (#501/#503). `abandonOrder` is the deliberate exit.
   */
  const resetPurchase = () => {
    checkoutAbortRef.current?.abort(); // stop any in-flight checkout poll
    checkoutAbortRef.current = null;
    setStep('plans');
    setError(null);
    setPaymentUrl(null);
    setSelectedPlan(null);
    setEmail('');
    setClaimKey('');
    setClaimError(null);
    setClaiming(false);
    setNewApiKey(null);
    setWalletWide(false);
    setUpgradeMasked(null);
    setUpgradedMaskedKey(null);
    setUpgradeRejected(false);
    setWindowClosed(false);
    setAwaitingBuyingAddress(false);
    setNotDurable(false);
  };

  const handleClose = () => {
    resetPurchase();
    onClose();
  };

  /**
   * "No thanks". In a dialog that means closing it; during onboarding there is
   * nothing to close — declining is entering the wallet on the current plan.
   */
  const decline = onboarding ? onboarding.onContinue : handleClose;

  /**
   * An order this wallet started and never saw settle is picked up on open —
   * the whole point of recording it. Attempts are keyed by (order, active
   * address), which does two things: StrictMode's double-invoke does not race a
   * status read against itself, and an order refused because the wrong address
   * was active retries the moment the buyer does what the screen asked and
   * switches back.
   */
  const activePubkey = sphere?.identity?.chainPubkey ?? null;
  const resumedRef = useRef<string | null>(null);

  /**
   * The in-memory fallback belongs to ONE (network, wallet). A stored record is
   * scoped by its slot, but `pending` is just component state and would survive
   * a wallet swap or network change under a mounted dialog — enough for the
   * duplicate guard to block a legitimate checkout, or for a wallet-wide record
   * to pass canAdoptFor and file a purchased key into the wrong wallet.
   */
  useEffect(() => {
    // The whole purchase belongs to that context, not just the record: leaving
    // the screen mid-flow would show the previous wallet's order to the new one.
    resetPurchase();
    setPending(null);
    resumedRef.current = null;
  }, [network, rootPubkey]);
  useEffect(() => {
    if (!isOpen) {
      resumedRef.current = null;
      return;
    }
    // No wallet, no slot to look in: a record lives under its buying wallet's
    // own key, so a locked or uninitialised session simply has nothing to read.
    if (rootPubkey === null) return;
    // Abandoned orders are settled in the background — their payment may have
    // landed after the buyer gave up — but they never drive the screen.
    // Serialized: several settling at once would race each other's storage
    // read-modify-writes and toasts.
    void (async () => {
      for (const stale of readSettlableOrders(network, rootPubkey)) {
        if (stale.abandonedAt !== undefined) await settleQuietly(stale);
      }
    })();
    const record = readPendingOrder(network, rootPubkey);
    if (!record) return;
    const attempt = `${record.orderId}:${activePubkey ?? ''}`;
    if (resumedRef.current === attempt) return;
    resumedRef.current = attempt;
    void resumeOrder(record);
    // resumeOrder closes over state setters and the wallet; re-running this on
    // every render would restart the read it just started.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, network, rootPubkey, activePubkey]);

  /** Post-purchase exit: into the wallet during onboarding, else close. */
  const finishSuccess = onboarding ? onboarding.onContinue : handleClose;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          // Onboarding renders this inside the wallet-creation panel, so it
          // sits just below the app-root dialog layer rather than on it.
          className={`fixed inset-0 overflow-y-auto backdrop-blur-sm ${
            onboarding
              ? 'z-90 bg-white/97 dark:bg-neutral-950/95'
              : 'z-100 bg-white/95 dark:bg-neutral-950/92'
          }`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          {/*
            Same chrome in both modes — the screen must not read as two
            different designs. Only the corner button's MEANING changes: a
            dialog closes, onboarding has nothing behind it, so it does what
            its footer does and goes into the wallet (the free plan is already
            active, so nothing is lost either way). It is labelled for what it
            does rather than "Close".
          */}
          <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 sm:px-8">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-orange-500" />
              <span className="text-lg font-semibold">{PAID_PLANS_ENABLED ? 'Choose your plan' : 'Your plan'}</span>
            </div>
            <button
              type="button"
              onClick={onboarding ? onboarding.onContinue : handleClose}
              aria-label={onboarding ? 'Enter wallet' : 'Close'}
              className="rounded-full p-2 text-neutral-400 transition-colors hover:bg-black/5 hover:text-neutral-700 dark:hover:bg-white/10 dark:hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <motion.div
            className="mx-auto w-full max-w-6xl px-4 pb-20 sm:px-8"
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          >
            {step === 'plans' && !PAID_PLANS_ENABLED && (
              <>
                <PlansHero onboarding={onboarding} currentName={currentName} />
                <UpgradeReasonBanner reason={reason} />
                {util.isLoading ? (
                  <div className="py-20 text-center text-neutral-400">
                    <Loader2 className="mx-auto h-6 w-6 animate-spin" />
                  </div>
                ) : (
                  <CurrentPlanShowcase util={util.data ?? null} />
                )}
                <PlansFooter onboarding={onboarding} currentName={currentName} onDecline={decline} />
              </>
            )}

            {step === 'plans' && PAID_PLANS_ENABLED && (
              <>
                <PlansHero onboarding={onboarding} currentName={currentName} />

                <UpgradeReasonBanner reason={reason} />

                {plans.isLoading && (
                  <div className="py-20 text-center text-neutral-400">
                    <Loader2 className="mx-auto h-6 w-6 animate-spin" />
                  </div>
                )}
                {plans.isError && (
                  <div className="py-20 text-center text-sm text-neutral-500 dark:text-white/45">
                    Couldn't load plans. Please try again later.
                  </div>
                )}
                {!plans.isLoading && !plans.isError && (
                  <PlansGrid
                    plans={gridPlans}
                    currentPlanName={currentName}
                    renewableCurrent={renewableCurrent}
                    onSelect={handleSelect}
                  />
                )}

                <PlansFooter onboarding={onboarding} currentName={currentName} onDecline={decline} />
              </>
            )}

            {step === 'email' && selectedPlan && (
              <div className="mx-auto flex max-w-md flex-col gap-4 py-16">
                <div className="text-center">
                  <h3 className="text-xl font-semibold capitalize">
                    {selectedPlan.name} — {formatPlanPrice(selectedPlan)} / 30 days
                  </h3>
                  <p className="mt-1.5 text-sm text-neutral-500 dark:text-white/45">
                    Paymento will send the payment link and receipt to this email.
                  </p>
                </div>
                {subscriptionStatus === 'active' && util.data?.activeUntil && (
                  <p className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-neutral-600 dark:text-white/60">
                    Your current plan is replaced as soon as the payment confirms — remaining time doesn't
                    carry over. The new plan runs 30 days from payment.
                  </p>
                )}
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-orange-500 dark:border-white/10 dark:bg-white/5"
                />
                {!onRootAddress && (
                  <label className="flex cursor-pointer items-start gap-2.5 text-sm text-neutral-600 dark:text-white/60">
                    <input
                      type="checkbox"
                      checked={walletWide}
                      onChange={(e) => setWalletWide(e.target.checked)}
                      className="mt-0.5 accent-orange-500"
                    />
                    <span>Make this the wallet-wide key (all addresses)</span>
                  </label>
                )}
                <Button
                  variant="primary"
                  fullWidth
                  disabled={!/\S+@\S+\.\S+/.test(email)}
                  loading={checkout.isPending}
                  onClick={() => void startCheckout()}
                >
                  Continue to payment
                </Button>
                {/*
                  Declining has to be a named action, not just the corner X —
                  onboarding drops the user straight onto this step, so "no
                  thanks" must say what they keep (sphere#496).
                */}
                <KeepPlanButton planName={currentName} onClick={decline} />
                <button
                  type="button"
                  className="text-sm text-neutral-500 underline dark:text-white/45"
                  onClick={() => setStep('plans')}
                >
                  ← Back to plans
                </button>
              </div>
            )}

            {step === 'awaiting' && (
              <div className="flex flex-col items-center gap-3 py-24 text-center">
                <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
                <p className="text-sm">
                  {/*
                    States what was REQUESTED, not what will happen: the gateway
                    decides whether the existing key is upgraded or a fresh one
                    is minted, and a fresh one is shown on the payment page only
                    once — hence "keep it open".
                  */}
                  {upgradeMasked
                    ? `Complete the payment in the new tab — we've asked for your key ${upgradeMasked} to move to the new plan, and we'll pick up the result automatically.`
                    : "Complete the payment in the new tab — we'll pick up your new API key automatically."}
                </p>
                <p className="max-w-sm text-xs text-neutral-500 dark:text-white/45">
                  Keep the payment page open until this finishes — if a new key is issued, that page
                  shows it once.
                </p>
                {paymentUrl && (
                  <a href={paymentUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-orange-500 underline">
                    Payment page didn't open? Open it here
                  </a>
                )}
                <p className="max-w-sm text-xs text-neutral-500 dark:text-white/45">
                  You can close this — the payment is kept for a day, and reopening this dialog picks
                  it up.
                </p>
                {pending && (
                  // Not a hard block: someone who started one plan and wants
                  // another must be able to get out of the link they are holding.
                  <button
                    type="button"
                    className="text-sm text-neutral-500 underline dark:text-white/45"
                    onClick={abandonOrder}
                  >
                    Cancel this payment and start over
                  </button>
                )}
              </div>
            )}

            {step === 'claim' && (
              <div className="mx-auto flex max-w-md flex-col gap-4 py-16 text-center">
                <h3 className="text-xl font-semibold">Payment confirmed 🎉</h3>
                <p className="text-sm text-neutral-500 dark:text-white/45">
                  Your API key was shown on the payment return page. Paste it here to activate it in this wallet.
                </p>
                <input
                  value={claimKey}
                  onChange={(e) => {
                    setClaimKey(e.target.value.trim());
                    setClaimError(null);
                  }}
                  placeholder="sk_…"
                  className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-2.5 font-mono text-sm outline-none focus:border-orange-500 dark:border-white/10 dark:bg-white/5"
                />
                {claimError && <p className="text-sm text-red-500">{claimError}</p>}
                <Button
                  variant="primary"
                  fullWidth
                  disabled={!/^sk_[0-9a-f]{32}$/.test(claimKey)}
                  loading={claiming}
                  onClick={activateClaimKey}
                >
                  Activate
                </Button>
                {pending && (
                  // Pasting a key does not settle this order (it cannot be tied
                  // to it), so the record stays until the buyer says they are
                  // done with it. Without this they would meet this step again
                  // on every visit.
                  <button
                    type="button"
                    className="text-sm text-neutral-500 underline dark:text-white/45"
                    onClick={abandonOrder}
                  >
                    Dismiss this order
                  </button>
                )}
              </div>
            )}

            {step === 'success' && (
              <UpgradeSuccess
                plan={selectedPlan}
                apiKey={newApiKey}
                upgradedMaskedKey={upgradedMaskedKey}
                notDurable={notDurable}
                onDone={finishSuccess}
              />
            )}

            {step === 'error' && (
              <div className="flex flex-col items-center gap-4 py-24 text-center">
                <AlertTriangle className="h-8 w-8 text-yellow-500" />
                <p className="max-w-md text-sm">
                  {/*
                    Deliberately says nothing about an in-place upgrade. Sending
                    an upgrade key is a REQUEST: a pre-upgrade gateway ignores it
                    and mints a fresh key whose only copy is on the return page.
                    Nothing here has observed `order-status.upgrade`, so telling
                    the buyer their existing key is being upgraded — that nothing
                    else is needed — is what would get that page closed.
                  */}
                  {windowClosed
                    ? "The payment window for this order has closed. If you did pay, the order can still be settled — reopen this dialog and we'll check again. Keep the payment page until then: some gateways show a new key there once, and that copy is the only one."
                    : error}
                </p>
                {/*
                  No "I have a key" here. An order that has not been seen PAID
                  has no key to paste, and an in-place upgrade never mints one at
                  all — offering the paste is what stranded buyers on an
                  unsatisfiable field (#501). Pasting a key bought elsewhere
                  lives in Settings → Subscription, where it belongs.
                */}
                <div className="flex flex-wrap justify-center gap-3">
                  <Button variant="secondary" onClick={() => setStep('plans')}>
                    Back to plans
                  </Button>
                  {upgradeRejected && (
                    <Button variant="secondary" onClick={() => void startCheckout({ forceNewKey: true })}>
                      Buy a new key instead
                    </Button>
                  )}
                </div>
                {pending && !awaitingBuyingAddress && (
                  // A stored order blocks a new purchase until it settles, so
                  // giving up on it has to be possible from here, not only from
                  // the waiting screen. NOT while a paid order waits for its
                  // buying address though — there the record is the last handle
                  // on a key the buyer already owns.
                  <button
                    type="button"
                    className="text-sm text-neutral-500 underline dark:text-white/45"
                    onClick={abandonOrder}
                  >
                    Cancel this payment and start over
                  </button>
                )}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
