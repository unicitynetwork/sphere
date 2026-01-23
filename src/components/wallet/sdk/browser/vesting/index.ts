/**
 * Browser Vesting Submodule
 *
 * Browser-specific vesting classification:
 * - UTXO classification by coinbase block height
 * - Vesting state management for UI
 */

export {
  BrowserVestingClassifier,
  getVestingClassifier,
  VESTING_THRESHOLD,
  type ClassificationResult,
  type ClassifiedUTXO,
  type ClassifyUtxosResult,
} from './BrowserVestingClassifier';

export {
  VestingStateManager,
  getVestingState,
  type VestingMode,
  type VestingBalances,
} from './VestingStateManager';
