import { useEffect, useState } from 'react';
import { CreditCard, Sparkles, Zap, Timer, KeyRound, Eye, EyeOff, Copy, Check, Loader2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { WalletScreen } from '../../ui/WalletScreen';
import { ModalHeader, Button, EmptyState, AlertMessage } from '../../ui';
import { usePlans, useUtilization } from '../../../../sdk/hooks/subscription';
import { PAID_PLANS_ENABLED } from '../../../../config/subscription';
import { hasPaidOffers } from '../../../subscription/planFeatures';
import { hasStoredOrders } from '../../../../sdk/subscription/pendingOrder';
import { usagePercent, formatExpiry, msUntil, formatCountdown } from '../../../../sdk/subscription/usage';
import { getStoredSubscriptionKey } from '../../../../config/subscriptionKeyCache';
import { useSphereContext } from '../../../../sdk/hooks/core/useSphere';
import { provisionOrRecoverKey } from '../../../../services/subscriptionApi';
import { SPHERE_KEYS } from '../../../../sdk/queryKeys';
import { copyToClipboard } from '../../../../utils/copyToClipboard';
import { EnterApiKeyRow } from '../../../subscription/EnterApiKeyRow';

interface SubscriptionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpgrade?: () => void;
}

export function SubscriptionModal({ isOpen, onClose, onUpgrade }: SubscriptionModalProps) {
  const util = useUtilization();
  // Only fetched while this screen is open, matching PlanScreen's own call, and
  // keyed the same so the two share one cached catalogue.
  const plans = usePlans(isOpen);
  const data = util.data;
  const plan = data?.plan ?? null;
  const apiKey = getStoredSubscriptionKey();
  const { sphere, network, applySubscriptionKey } = useSphereContext();
  // Whether an upgrade is a thing that can happen here at all. Passing
  // `plans.data` UNCHANGED is deliberate: undefined means the catalogue has not
  // resolved, and hasPaidOffers fails open on it (see its doc).
  //
  // The plan screen is not only a shop: it is the only place a paid order whose
  // key was never delivered can be resumed from. So an unfinished order keeps
  // the way in open even where there is nothing left to sell — an operator
  // pausing sales overnight must not strand a purchase already paid for.
  const canUpgrade =
    !!onUpgrade && (hasPaidOffers(plans.data, PAID_PLANS_ENABLED) || hasStoredOrders(network));
  const queryClient = useQueryClient();
  const [activating, setActivating] = useState(false);
  const [activateError, setActivateError] = useState<string | null>(null);

  // Wallets created before the subscription feature never ran the onboarding
  // provisioning — the free key is an idempotent get-or-create by identity,
  // so a single click recovers/creates it here.
  const activateFreePlan = async () => {
    if (!sphere) return;
    setActivateError(null);
    setActivating(true);
    try {
      const result = await provisionOrRecoverKey(sphere);
      // the free key is provisioned against the wallet's index-0 identity —
      // always store it as the WALLET-wide key, whatever address is active
      await applySubscriptionKey(result.apiKey, { walletWide: true });
      await queryClient.invalidateQueries({ queryKey: SPHERE_KEYS.subscription.all });
    } catch (e) {
      setActivateError(e instanceof Error ? e.message : 'Failed to activate the free plan');
    } finally {
      setActivating(false);
    }
  };

  return (
    <WalletScreen isOpen={isOpen} onClose={onClose}>
      <ModalHeader variant="screen" title="Subscription" icon={CreditCard} iconVariant="gradient" onClose={onClose} />

      <div className="px-5 py-6 space-y-5 flex-1 overflow-y-auto">
        {util.isError && (
          <AlertMessage variant="error">Couldn't load your subscription. Try again later.</AlertMessage>
        )}
        {activateError && <AlertMessage variant="error">{activateError}</AlertMessage>}

        {/* Pre-feature wallet (or failed onboarding provisioning): no key yet */}
        {!apiKey && (
          <div className="flex flex-col items-center gap-4 py-6">
            <EmptyState
              icon={Sparkles}
              title="No plan yet"
              description="Your wallet doesn't have a subscription key. Activate the free plan — it's tied to your wallet identity and takes one signature."
            />
            <Button variant="primary" icon={Sparkles} loading={activating} disabled={!sphere} onClick={activateFreePlan}>
              Activate free plan
            </Button>
          </div>
        )}

        {apiKey && util.isLoading && (
          <div className="py-10 text-center text-neutral-400">
            <Loader2 className="mx-auto h-6 w-6 animate-spin" />
          </div>
        )}

        {data?.status === 'expired' && (
          <AlertMessage variant="warning">
            Your plan expired {formatExpiry(data.activeUntil)}.{' '}
            {/* Never tell someone to renew where the button below is hidden:
                renewal is re-buying the same store card, so with no catalogue
                there is nothing to click and the sentence is a dead promise. */}
            {canUpgrade ? 'Renew to keep higher limits.' : "You're on free-tier limits until it can be renewed."}
          </AlertMessage>
        )}

        {data?.status === 'inactive' && !util.isLoading && (
          <EmptyState
            icon={Sparkles}
            title="No active plan"
            // Never point at a button that is not on screen.
            description={
              canUpgrade
                ? 'Get a plan to raise your commitment limits.'
                : 'No plans are on sale on this network right now.'
            }
          />

        )}

        {plan && (
          <>
            {/* Current plan card */}
            <div className="p-5 rounded-2xl bg-orange-500/10 border border-orange-500/20">
              <div className="flex items-center gap-2 mb-1">
                <Sparkles className="w-4 h-4 text-orange-500" />
                <span className="font-semibold font-mono capitalize">{plan.name} plan</span>
              </div>
              <div className="text-xs text-neutral-500 dark:text-white/45">
                {data?.activeUntil
                  ? `Renews / expires: ${formatExpiry(data.activeUntil)}`
                  : 'Never expires — free plan'}
              </div>
            </div>

            {/* Usage bars (limits are commitments, not transactions) */}
            <div className="space-y-4">
              <UsageBar
                icon={Zap}
                label="Daily commitments"
                used={data?.utilization.consumedPerDay ?? 0}
                limit={data?.utilization.maxPerDay ?? plan?.requestsPerDay ?? 0}
                loading={util.isLoading}
              />
              <UsageBar
                icon={Zap}
                label="Commitments / minute"
                used={data?.utilization.consumedPerMinute ?? 0}
                limit={data?.utilization.maxPerMinute ?? plan?.requestsPerMinute ?? 0}
                loading={util.isLoading}
              />
            </div>

            {/* Countdown to the daily limit reset — bucket4j refills continuously today; kept for when the gateway adds a reset time */}
            <ResetRow resetAt={null} active={isOpen} loading={util.isLoading} />
          </>
        )}

        {apiKey && <ApiKeyRow apiKey={apiKey} />}

        <EnterApiKeyRow
          label="Use a different key"
          note="Keys are transferable — you can use a key someone shared with you. Applied on your main address it becomes the wallet-wide key; on another address it applies to that address only."
        />
      </div>

      {/* The whole footer goes, not just the button: an empty padded strip
          under the content reads as a broken layout, not as a deliberate
          absence. */}
      {canUpgrade && (
        <div className="px-5 pb-6">
          <Button variant="primary" fullWidth icon={Sparkles} onClick={onUpgrade}>
            {data?.status === 'expired' ? 'Renew plan' : 'Upgrade plan'}
          </Button>
        </div>
      )}
    </WalletScreen>
  );
}

function UsageBar({ icon: Icon, label, used, limit, loading }: {
  icon: typeof Zap; label: string; used: number; limit: number; loading?: boolean;
}) {
  const pct = usagePercent(used, limit);
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5 text-sm">
        <span className="flex items-center gap-1.5 text-neutral-600 dark:text-white/60">
          <Icon className="w-3.5 h-3.5" /> {label}
        </span>
        <span className="font-mono text-xs text-neutral-500 dark:text-white/45">
          {loading ? '…' : `${used.toLocaleString()} / ${limit.toLocaleString()}`}
        </span>
      </div>
      <div className="h-2 rounded-full bg-neutral-200 dark:bg-white/8 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-orange-500' : 'bg-emerald-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/** Live countdown to the daily-limit reset; ticks only while the modal is open. */
function ResetRow({ resetAt, active, loading }: { resetAt: string | null; active: boolean; loading?: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);

  const ms = msUntil(resetAt, now);
  return (
    <div className="flex items-center justify-between rounded-2xl bg-neutral-50 dark:bg-white/4 px-4 py-3 text-sm">
      <span className="flex items-center gap-2 text-neutral-600 dark:text-white/60">
        <Timer className="w-4 h-4" /> Daily limit resets in
      </span>
      <span className="font-mono text-neutral-900 dark:text-white">
        {loading ? '…' : ms === null ? 'continuously' : ms === 0 ? 'now' : formatCountdown(ms)}
      </span>
    </div>
  );
}

function ApiKeyRow({ apiKey }: { apiKey: string }) {
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const masked = `${apiKey.slice(0, 5)}…${apiKey.slice(-4)}`;
  const copy = async () => {
    if (await copyToClipboard(apiKey)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };
  return (
    <div className="rounded-2xl bg-neutral-50 px-4 py-3 dark:bg-white/4">
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-2 text-neutral-600 dark:text-white/60">
          <KeyRound className="h-4 w-4" /> API key
        </span>
        <span className="flex items-center gap-1.5">
          <code className="font-mono text-xs">{visible ? apiKey : masked}</code>
          <button type="button" aria-label={visible ? 'Hide key' : 'Show key'} onClick={() => setVisible(!visible)}
            className="rounded p-1 text-neutral-400 hover:text-neutral-700 dark:hover:text-white">
            {visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
          <button type="button" aria-label={copied ? 'Copied' : 'Copy key'} onClick={copy}
            className="rounded p-1 text-neutral-400 hover:text-neutral-700 dark:hover:text-white">
            {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </span>
      </div>
      <p className="mt-1.5 text-[11px] text-neutral-500 dark:text-white/40">
        Your wallet's own key — including any plan bought for it — is recovered when you restore the
        wallet. Keys pasted from elsewhere aren't; keep a copy of those.
      </p>
    </div>
  );
}
