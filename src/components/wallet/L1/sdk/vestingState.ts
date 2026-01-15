/**
 * Vesting State Manager - Re-exports from SDK browser module
 *
 * This file provides backwards compatibility.
 * All implementation is now in ../../sdk/browser/VestingStateManager.ts
 */

// Re-export everything from SDK browser module
export {
  VestingStateManager,
  getVestingState,
  type VestingMode,
  type VestingBalances,
} from '../../sdk/browser';

// Create backwards-compatible singleton
import { getVestingState } from '../../sdk/browser';

/**
 * Singleton instance for backwards compatibility
 * @deprecated Use getVestingState() instead
 */
export const vestingState = getVestingState();
