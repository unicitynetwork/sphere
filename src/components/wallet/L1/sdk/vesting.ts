/**
 * Vesting Classification - Re-exports from SDK browser module
 *
 * This file provides backwards compatibility.
 * All implementation is now in ../../sdk/browser/BrowserVestingClassifier.ts
 */

// Re-export everything from SDK browser module
export {
  BrowserVestingClassifier,
  getVestingClassifier,
  VESTING_THRESHOLD,
  type ClassificationResult,
  type ClassifiedUTXO,
  type ClassifyUtxosResult,
} from '../../sdk/browser';

// Create backwards-compatible singleton
import { getVestingClassifier } from '../../sdk/browser';

/**
 * Singleton instance for backwards compatibility
 * @deprecated Use getVestingClassifier() instead
 */
export const vestingClassifier = getVestingClassifier();
