/**
 * Plan cards laid out as a centered wrap: on a wide modal the plans sit in one
 * row; when they wrap, the trailing row stays centered (no orphaned card
 * hugging the left). Cards reveal in an orchestrated left-to-right stagger.
 *
 * While paid plans aren't purchasable — the operator's store flag is off, or
 * this network's gateway prices nothing — the concrete paid tiers are hidden
 * behind a single "Paid plans" placeholder. The caller decides that: the grid
 * renders the answer rather than recomputing it, so every surface agrees.
 */
import { motion, useReducedMotion, type Variants } from 'framer-motion';
import { PlanCard } from './PlanCard';
import { PaidPlansComingSoonCard } from './PaidPlansComingSoonCard';
import { isPopularPlan, isFreePlan } from './planFeatures';
import type { PlanInfo } from '../../services/subscriptionApi';

interface PlansGridProps {
  plans: PlanInfo[];
  /** Name of the wallet's current plan (matched case-insensitively) — utilization exposes no plan id. */
  currentPlanName: string | null;
  /** Provide to make cards selectable (upgrade flow). Omit for an info-only grid. */
  onSelect?: (plan: PlanInfo) => void;
  /** Lapsed subscription: the current plan's store card offers a "Renew" CTA. */
  renewableCurrent?: boolean;
  /** planId currently being processed (shows a spinner on that card's CTA). */
  loadingPlanId?: number | null;
  /** Disable all CTAs (e.g. while another checkout is pending). */
  disabled?: boolean;
  /** Whether anything here can actually be bought — see hasPaidOffers. */
  canBuy: boolean;
}

export function PlansGrid({ plans, currentPlanName, onSelect, renewableCurrent, loadingPlanId, disabled, canBuy }: PlansGridProps) {
  const reduce = useReducedMotion();

  const container: Variants = {
    hidden: {},
    show: { transition: { staggerChildren: reduce ? 0 : 0.07, delayChildren: reduce ? 0 : 0.05 } },
  };
  const item: Variants = {
    hidden: reduce ? { opacity: 0 } : { opacity: 0, y: 20, scale: 0.97 },
    show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] } },
  };

  const freePlans = plans.filter(isFreePlan);
  const paidPlans = plans.filter((p) => !isFreePlan(p));

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="flex flex-wrap justify-center gap-5"
    >
      {freePlans.map((plan) => (
        <PlanCard
          key={plan.planId}
          plan={plan}
          current={plan.name.toLowerCase() === (currentPlanName ?? '').toLowerCase()}
          popular={isPopularPlan(plan)}
          onSelect={onSelect}
          loading={loadingPlanId === plan.planId}
          disabled={disabled}
          variants={item}
        />
      ))}

      {canBuy
        ? paidPlans.map((plan) => (
            <PlanCard
              key={plan.planId}
              plan={plan}
              current={plan.name.toLowerCase() === (currentPlanName ?? '').toLowerCase()}
              popular={isPopularPlan(plan)}
              onSelect={onSelect}
              renewable={renewableCurrent}
              loading={loadingPlanId === plan.planId}
              disabled={disabled}
              variants={item}
            />
          ))
        : paidPlans.length > 0 && <PaidPlansComingSoonCard variants={item} />}
    </motion.div>
  );
}
