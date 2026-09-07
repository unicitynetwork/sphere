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

  // An unprompted opener may win at most once per page load.
  const autoOpenedRef = useRef(false);
  const openAutomatically = useCallback(
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
      {/* Two automatic openers, one screen. openUpgrade is setReason +
          setIsOpen, so a second automatic call would silently rewrite the
          banner under a user already reading the first. Whichever fires first
          on this page owns the screen; the user's own calls are unaffected. */}
      <PlanDowngradeWatcher openUpgrade={openAutomatically} />
      <NetworkSwitchPlanOffer openUpgrade={openAutomatically} />

      <AddressKeyPromptModal />
      {/* Same component onboarding renders — here in its dialog mode. */}
      <PlanScreen isOpen={isOpen} reason={reason} onClose={() => setIsOpen(false)} />
    </UpgradeContext.Provider>
  );
}
