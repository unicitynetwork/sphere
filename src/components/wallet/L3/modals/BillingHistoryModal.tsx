import { useMemo } from 'react';
import { Receipt, ArrowUpCircle, CheckCircle, XCircle, Clock } from 'lucide-react';
import { getPublicKey } from '@unicitylabs/sphere-sdk';
import { ModalHeader, EmptyState } from '../../ui';
import { WalletScreen } from '../../ui/WalletScreen';
import { useSphereContext } from '../../../../sdk/hooks/core/useSphere';
import {
  readOrderHistory,
  type OrderHistoryEntry,
  type OrderOutcome,
} from '../../../../sdk/subscription/orderHistory';
import { readSettlableOrders } from '../../../../sdk/subscription/pendingOrder';

/**
 * What this wallet bought on this network, and what became of it.
 *
 * Answers the three questions the wallet could not (sphere#509): what did I
 * buy and when, where is the order I paid for, and why did my limits drop. The
 * journal is written where an order used to be deleted — see orderHistory.ts.
 *
 * Read-only on purpose. Recovering a key that a settled order still owes is a
 * separate decision (sphere#508 proposes removing that machinery outright), and
 * a receipt list is the wrong place to prejudge it.
 */
interface BillingHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const OUTCOME: Record<OrderOutcome, { label: string; icon: typeof Receipt; tone: string }> = {
  paid: { label: 'Paid', icon: CheckCircle, tone: 'text-emerald-600 dark:text-emerald-400' },
  upgraded: { label: 'Upgraded', icon: ArrowUpCircle, tone: 'text-emerald-600 dark:text-emerald-400' },
  failed: { label: 'Failed', icon: XCircle, tone: 'text-red-500' },
  abandoned: { label: 'Abandoned', icon: XCircle, tone: 'text-neutral-400' },
};

function formatPrice(entry: OrderHistoryEntry): string {
  if (entry.priceCents <= 0) return 'Free';
  const amount = (entry.priceCents / 100).toFixed(2);
  return entry.fiatCurrency === 'USD' ? `$${amount}` : `${amount} ${entry.fiatCurrency}`;
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function BillingHistoryModal({ isOpen, onClose }: BillingHistoryModalProps) {
  const { sphere, network } = useSphereContext();

  // The journal is scoped per (network, wallet), so it needs the wallet's
  // subscription identity — its index-0 key, the same one the gateway binds.
  const rootPubkey = useMemo(() => {
    if (!sphere) return null;
    try {
      return getPublicKey(sphere.deriveAddress(0).privateKey);
    } catch {
      return null;
    }
  }, [sphere]);

  // Read during render rather than memoised: the journal is at most a few
  // entries in localStorage, and it must reflect what the last purchase wrote
  // every time this screen is opened. Memoising it would need `isOpen` as a
  // dependency it does not actually use — a lie to the linter and to the reader.
  const entries = rootPubkey === null ? [] : readOrderHistory(network, rootPubkey);
  const openOrders = rootPubkey === null ? [] : readSettlableOrders(network, rootPubkey);

  return (
    <WalletScreen isOpen={isOpen} onClose={onClose}>
      <ModalHeader variant="screen" title="Purchase history" icon={Receipt} iconVariant="gradient" onClose={onClose} />

      <div className="px-5 py-6 space-y-3 flex-1 overflow-y-auto">
        {openOrders.length > 0 && (
          <div className="p-4 rounded-2xl bg-orange-500/10 border border-orange-500/20 flex items-start gap-3">
            <Clock className="w-4 h-4 mt-0.5 shrink-0 text-orange-500" />
            <div className="text-sm">
              <div className="font-semibold">
                {openOrders.length === 1 ? 'A payment is still open' : `${openOrders.length} payments are still open`}
              </div>
              <div className="text-neutral-500 dark:text-white/45">
                Open Subscription → Upgrade plan to pick it up. A payment can confirm long after the page was closed.
              </div>
            </div>
          </div>
        )}

        {entries.length === 0 && openOrders.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title="Nothing bought yet"
            description="Purchases you make on this network will be listed here."
          />
        ) : (
          entries.map((entry) => {
            const outcome = OUTCOME[entry.outcome];
            const Icon = outcome.icon;
            return (
              <div key={entry.orderId} className="p-4 rounded-2xl bg-neutral-50 dark:bg-white/3 space-y-1.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold capitalize">{entry.planName}</span>
                  <span className="font-mono text-sm">{formatPrice(entry)}</span>
                </div>
                <div className="flex items-center justify-between gap-3 text-xs text-neutral-500 dark:text-white/45">
                  <span className="inline-flex items-center gap-1.5">
                    <Icon className={`w-3.5 h-3.5 ${outcome.tone}`} />
                    <span className={outcome.tone}>{outcome.label}</span>
                    {entry.upgradeMasked && <span className="font-mono">· {entry.upgradeMasked}</span>}
                  </span>
                  <span>{formatDate(entry.settledAt)}</span>
                </div>
              </div>
            );
          })
        )}

        {/* The honest cost of a local journal — say it rather than let someone
            discover it on a new device. */}
        <p className="pt-2 text-xs text-neutral-400 dark:text-white/35">
          Kept in this browser only. Paymento emails a receipt for every payment.
        </p>
      </div>
    </WalletScreen>
  );
}
