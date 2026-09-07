/**
 * Offers the new network's plans on the load that follows a DELIBERATE network
 * switch, exactly once. Renders nothing.
 *
 * WHY THIS EXISTS AND WHY IT IS NOT FreePlanEntryWatcher (#500): that one read
 * "show the plan screen on entry while on free" as EVERY entry and opened a
 * full-screen offer on every page load. The rule that is actually useful is
 * narrower — a user who has just moved to another network has no way to know
 * that this one sells plans at all, because networks are isolated worlds with
 * their own catalogues. So the trigger is the switch, not the entry, and
 * network.ts consumes its marker at module load, before any component asks.
 *
 * Silence is the default. Every condition below must hold, and the fail-open
 * that hasPaidOffers applies elsewhere is deliberately inverted here: an
 * UNPROMPTED full-screen offer must never appear on a catalogue that has not
 * resolved. Fail open where the user asked for the surface, fail closed where
 * the app opens it by itself.
 */
import { useEffect, useRef } from 'react';
import { NETWORK_SWITCHED_TO } from '../../config/network';
import { PAID_PLANS_ENABLED, SUBSCRIPTION_ENABLED } from '../../config/subscription';
import { usePlans, useUtilization } from '../../sdk/hooks/subscription';
import { useSphereContext } from '../../sdk/hooks/core/useSphere';
import { hasPaidOffers, isFreePlanName } from '../subscription/planFeatures';
import type { UpgradeReason } from './UpgradeContext';

export function NetworkSwitchPlanOffer({
  openUpgrade,
}: {
  openUpgrade: (reason?: UpgradeReason) => void;
}) {
  const { subscriptionKeyStatus, walletExists, isLocked, isLoading } = useSphereContext();
  // One ref, not two: it is set false the moment the offer fires, so it is both
  // the "may this load offer" gate and the once-only latch.
  const armedRef = useRef(NETWORK_SWITCHED_TO !== null && SUBSCRIPTION_ENABLED && PAID_PLANS_ENABLED);

  const util = useUtilization();
  // Only ask the store when this load could actually act on the answer.
  const plans = usePlans(armedRef.current);

  useEffect(() => {
    if (!armedRef.current) return;

    // A boot that ever presented onboarding is disarmed for good: onboarding
    // has its own plan step, and finishing it flips walletExists true against
    // the very same free-plan snapshot this offer looks for — asking twice in a
    // row. `isLoading` is what separates "no wallet yet" from "not read yet".
    if (!isLoading && !walletExists) {
      armedRef.current = false;
      return;
    }

    // A locked boot disarms too, and not only while it is locked. The escape
    // from the unlock screen — "forgot password, restore from recovery phrase"
    // — renders onboarding INSIDE the locked branch, so walletExists is already
    // true there and the disarm above never sees it; that onboarding shows its
    // own plan step, and firing after it asks the same question twice. The cost
    // is a missed offer for someone who simply unlocks with their password, and
    // silence is the right side to err on for a screen the app opens itself.
    if (isLocked) {
      armedRef.current = false;
      return;
    }
    if (!walletExists) return;

    // PENDING is not an answer, and it is the ONLY thing that keeps the offer
    // armed. The key is per network: until the new network's own key is live,
    // the plan on screen still belongs to the network the user just left.
    if (subscriptionKeyStatus === 'provisioning') return;
    const pending = (q: { data: unknown; isError: boolean }) => q.data === undefined && !q.isError;
    if (subscriptionKeyStatus === 'ready' && (pending(util) || pending(plans))) return;

    // From here this boot HAS an answer, and it gets exactly one. Disarming at
    // the DECISION rather than at the fire is what binds the offer to the load
    // that followed the switch: every gate below used to leave it armed, so a
    // paid plan at boot, a failed provisioning, or a catalogue that resolved
    // late all left it waiting for the first later moment when the gates happen
    // to line up. The loudest version of that is an ADDRESS switch twenty
    // minutes on — it hands the wallet a different, free key, and the screen
    // would open saying "You've switched networks" to someone who did not.
    armedRef.current = false;

    if (subscriptionKeyStatus !== 'ready') return;
    const plan = util.data?.plan;
    if (!plan || !isFreePlanName(plan.name)) return;
    // Resolved catalogue required — see the fail-closed note at the top.
    if (!plans.data || !hasPaidOffers(plans.data, PAID_PLANS_ENABLED)) return;

    openUpgrade('network');
  }, [
    subscriptionKeyStatus,
    walletExists,
    isLocked,
    isLoading,
    util.data,
    util.isError,
    plans.data,
    plans.isError,
    openUpgrade,
  ]);

  return null;
}
