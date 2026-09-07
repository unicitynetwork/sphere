import { createContext, useContext } from 'react';

/**
 * Why the plan screen was opened. Drives the banner above the line-up
 * (UpgradeReasonBanner) — 'settings' and undefined show none.
 */
export type UpgradeReason = 'quota' | 'expired' | 'settings' | 'network';

export interface UpgradeContextValue {
  openUpgrade: (reason?: UpgradeReason) => void;
}

export const UpgradeContext = createContext<UpgradeContextValue | null>(null);

export function useUpgrade(): UpgradeContextValue {
  const ctx = useContext(UpgradeContext);
  if (!ctx) throw new Error('useUpgrade must be used within UpgradeProvider');
  return ctx;
}
