/**
 * useWallet - Context consumer hook for wallet state
 *
 * CPU OPTIMIZATION: This hook is now a thin wrapper around WalletContext.
 * All event listeners, React Query subscriptions, and background validation
 * are centralized in WalletProvider to prevent duplication.
 *
 * Benefits:
 * - 44 event listeners → 4 (91% reduction)
 * - Single background validation loop instead of 11
 * - ~20% CPU reduction in idle state
 *
 * @see CPU_PERFORMANCE_ANALYSIS.md
 * @see src/contexts/WalletContext.tsx
 */

import { useContext } from 'react';
import { WalletContext, type WalletContextValue } from '../../../../contexts/WalletContextTypes';
import { QUERY_KEYS } from '../../../../config/queryKeys';

// Re-export for backward compatibility
export const KEYS = QUERY_KEYS;

/**
 * Hook to access wallet state and operations.
 *
 * Must be used within WalletProvider (which is inside ServicesProvider).
 *
 * @throws Error if used outside WalletProvider
 */
export const useWallet = (): WalletContextValue => {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error('useWallet must be used within WalletProvider');
  }
  return context;
};
