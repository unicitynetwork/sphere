/**
 * Celebratory success view shown after a subscription upgrade completes:
 * a spring-popped check with a pulsing ring, a light confetti burst, the new
 * plan name, and the limits/features it unlocked.
 */
import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Copy, Sparkles } from 'lucide-react';
import { Button } from '../wallet/ui';
import type { PlanInfo } from '../../services/subscriptionApi';
import { planFeatures } from '../subscription/planFeatures';
import { copyToClipboard } from '../../utils/copyToClipboard';

const CONFETTI_COLORS = ['#f97316', '#10b981', '#a855f7', '#ec4899', '#3b82f6', '#eab308'];

function Confetti() {
  // Positions are randomized once per mount (app runtime, not a workflow).
  const pieces = useMemo(
    () =>
      Array.from({ length: 28 }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        delay: Math.random() * 0.25,
        duration: 1.8 + Math.random() * 1.4,
        rotate: (Math.random() - 0.5) * 720,
        drift: (Math.random() - 0.5) * 80,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        size: 6 + Math.random() * 6,
      })),
    [],
  );

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {pieces.map((p) => (
        <motion.span
          key={p.id}
          className="absolute top-0 rounded-sm"
          style={{ left: `${p.left}%`, width: p.size, height: p.size * 0.6, backgroundColor: p.color }}
          initial={{ y: -24, opacity: 0, rotate: 0 }}
          animate={{ y: '90vh', x: p.drift, rotate: p.rotate, opacity: [0, 1, 1, 0] }}
          transition={{ duration: p.duration, delay: p.delay, ease: 'easeIn' }}
        />
      ))}
    </div>
  );
}

interface UpgradeSuccessProps {
  plan: PlanInfo | null;
  /** Freshly issued key from a new-key checkout (or pasted via the claim step) — renders the copy-me key box when set. */
  apiKey?: string | null;
  /**
   * In-place upgrade: the existing key (masked, e.g. "sk_...abcd") that now
   * carries the new plan — renders the "same key" note instead of a key box.
   */
  upgradedMaskedKey?: string | null;
  /**
   * The key reached the live session but NOT durable storage (vault write
   * refused, or no wallet to write to). Saying "upgrade complete" over that is
   * how a purchased key disappears on the next reload — the copy has to ask the
   * buyer to save it themselves.
   */
  notDurable?: boolean;
  onDone: () => void;
}

export function UpgradeSuccess({ plan, apiKey, upgradedMaskedKey, notDurable, onDone }: UpgradeSuccessProps) {
  const [copied, setCopied] = useState(false);
  const copyKey = async () => {
    if (!apiKey) return;
    if (await copyToClipboard(apiKey)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };
  const features = plan ? planFeatures(plan) : [];

  return (
    <div className="relative flex min-h-[70vh] flex-col items-center justify-center gap-6 py-12 text-center">
      <Confetti />

      {/* Animated check with a pulsing ring */}
      <motion.div
        initial={{ scale: 0, rotate: -25 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 220, damping: 13 }}
        className="relative"
      >
        <motion.span
          className="absolute inset-0 rounded-full bg-emerald-500/25"
          initial={{ scale: 0.6, opacity: 0.7 }}
          animate={{ scale: 2.2, opacity: 0 }}
          transition={{ duration: 1.2, repeat: Infinity, repeatDelay: 0.4, ease: 'easeOut' }}
        />
        <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-lg shadow-emerald-500/30">
          <Check className="h-10 w-10 text-white" strokeWidth={3} />
        </div>
      </motion.div>

      {/* Headline */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="space-y-1.5"
      >
        <div className="flex items-center justify-center gap-1.5 text-sm font-medium text-emerald-500">
          <Sparkles className="h-4 w-4" /> Upgrade complete
        </div>
        <h2 className="text-3xl font-bold">
          You&apos;re on{' '}
          <span className="bg-gradient-to-r from-orange-500 to-pink-500 bg-clip-text capitalize text-transparent">
            {plan?.name ?? 'your new plan'}
          </span>
        </h2>
        {plan && (
          <p className="text-sm text-neutral-500 dark:text-white/50">
            {plan.requestsPerDay.toLocaleString()} commitments/day · up to {plan.requestsPerMinute.toLocaleString()}/minute
          </p>
        )}
        {upgradedMaskedKey && (
          <p className="text-sm text-neutral-500 dark:text-white/50">
            Your key <code className="font-mono">{upgradedMaskedKey}</code> stays the same — the new limits
            apply within a minute.
          </p>
        )}
      </motion.div>

      {/* What it unlocked */}
      {features.length > 0 && (
        <motion.ul
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="w-full max-w-xs space-y-2.5 rounded-2xl border border-neutral-200 bg-neutral-50 p-5 text-left dark:border-white/8 dark:bg-white/4"
        >
          {features.map((feature) => (
            <li key={feature} className="flex items-center gap-2.5 text-sm text-neutral-700 dark:text-white/70">
              <Check className="h-4 w-4 shrink-0 text-emerald-500" />
              <span>{feature}</span>
            </li>
          ))}
        </motion.ul>
      )}

      {notDurable && (
        <div className="mx-auto w-full max-w-sm rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-left text-sm">
          <p className="font-medium text-red-600 dark:text-red-400">
            This key could not be saved on this device.
          </p>
          <p className="mt-1 text-[13px] leading-snug text-red-700/80 dark:text-red-300/70">
            It is active for this session only. Copy it now and paste it back in Settings →
            Subscription — a reload can lose it otherwise.
          </p>
        </div>
      )}

      {apiKey && (
        <div className="mx-auto mt-6 w-full max-w-sm rounded-2xl border border-yellow-500/20 bg-yellow-500/10 p-4 text-left">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-yellow-600 dark:text-yellow-400">Your new API key</span>
            <button
              type="button"
              aria-label={copied ? 'Copied' : 'Copy API key'}
              onClick={copyKey}
              className="rounded p-1 text-yellow-600 hover:bg-yellow-500/15 dark:text-yellow-400"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
          <code className="block break-all font-mono text-xs">{apiKey}</code>
          <p className="mt-2 text-[11px] leading-snug text-yellow-700/80 dark:text-yellow-300/70">
            Save this key — it's tied to this purchase, not your wallet identity. Restoring the wallet
            recovers only your wallet's own identity-bound key, not this one; paste this key again in
            Settings if you switch devices.
          </p>
        </div>
      )}

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.45 }}>
        <Button variant="primary" onClick={onDone}>
          Start sending
        </Button>
      </motion.div>
    </div>
  );
}
