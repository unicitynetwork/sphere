/**
 * Transaction Module (Platform-Independent)
 *
 * Provides transaction building, signing, and token split operations.
 */

// L1 Transaction Building
export {
  signTransaction,
  selectUtxos,
  buildSegWitTransaction,
  createSignatureHash,
  createWitnessData,
  broadcastTransactions,
  TX_FEE,
  DUST_THRESHOLD,
  SATS_PER_COIN,
} from './transaction';

export type {
  TxInput,
  TxOutput,
  TxPlan,
  TransactionOutput,
  PlannedTransaction,
  TransactionPlanResult,
  BuiltTransaction,
  UTXOInput,
  BroadcastResult,
} from './transaction';

// Vesting Classification
export {
  VestingClassifier,
  InMemoryCacheProvider,
  VESTING_THRESHOLD,
} from './vesting';

export type {
  ClassificationResult,
  ClassifiedUTXO,
  ClassifyUtxosResult,
  ClassificationProgressCallback,
} from './vesting';

// Re-export vesting types from types module
export type {
  VestingCacheProvider,
  VestingCacheEntry,
} from '../types';

// Token Split Calculator
export {
  TokenSplitCalculator,
  createTokenSplitCalculator,
} from './token-split';

export type {
  SplittableToken,
  TokenWithAmount,
  SplitPlan,
} from './token-split';

// Split Transfer Types
export type {
  MintedTokenInfo,
  SplitTokenResult,
  SplitPlanResult,
  SplitOutboxStatus,
  SplitTransferEntry,
  SplitGroup,
  SplitOutboxProvider,
  SplitOutboxContext,
  OnTokenBurnedCallback,
} from './split-types';

// Split Transfer Executor
export {
  TokenSplitExecutor,
  createTokenSplitExecutor,
  DefaultSha256Provider,
  DefaultUuidProvider,
} from './split-executor';

export type {
  TokenSplitExecutorConfig,
  Sha256Provider,
  UuidProvider,
} from './split-executor';
