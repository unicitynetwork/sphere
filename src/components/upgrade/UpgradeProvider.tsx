import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { UpgradeContext, type UpgradeReason } from './UpgradeContext';
import { PlanScreen } from './PlanScreen';
import { PlanDowngradeWatcher } from './PlanDowngradeWatcher';
import { NetworkSwitchPlanOffer } from './NetworkSwitchPlanOffer';
import { AddressKeyPromptModal } from '../subscription/AddressKeyPromptModal';

export function UpgradeProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [reason, setReason] = useState<UpgradeReason | undefined>();

  const openUpgrade = useCallback((r?: UpgradeReason) => {
    setReason(r);
    setIsOpen(true);
  }, []);

  // Two unprompted openers, one screen — but they are not equals, so they do
  // not share one latch. A lapsed plan is a state change the user has to learn
  // about, and PlanDowngradeWatcher marks the plan as seen whether or not the
  // screen actually opened, so a swallowed notice is lost for good. The network
  // offer is a one-time courtesy and can always be the one to yield.
  const autoOpenedRef = useRef(false);

  /** Priority opener: always shows, and claims the slot so nothing overwrites it. */
  const openNotice = useCallback(
    (r?: UpgradeReason) => {
      autoOpenedRef.current = true;
      openUpgrade(r);
    },
    [openUpgrade],
  );

  /** Courtesy opener: skips if anything unprompted already used this load. */
  const openCourtesy = useCallback(
    (r?: UpgradeReason) => {
      if (autoOpenedRef.current) return;
      autoOpenedRef.current = true;
      openUpgrade(r);
    },
    [openUpgrade],
  );

  const value = useMemo(() => ({ openUpgrade }), [openUpgrade]);


  return (
    <UpgradeContext.Provider value={value}>
      {children}
      <PlanDowngradeWatcher openUpgrade={openNotice} />
      <NetworkSwitchPlanOffer openUpgrade={openCourtesy} />

      <AddressKeyPromptModal />
      {/* Same component onboarding renders — here in its dialog mode. */}
      <PlanScreen isOpen={isOpen} reason={reason} onClose={() => setIsOpen(false)} />
    </UpgradeContext.Provider>
  );
}
