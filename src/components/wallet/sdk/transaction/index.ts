/**
 * Transaction Module (Platform-Independent)
 *
 * Provides transaction building, signing, and token split operations.
 */

// L1 Transaction Building
export {
  buildTransaction,
  signTransaction,
  serializeTransaction,
  calculateFee,
  createRawTransaction,
} from './transaction';

export type {
  TransactionInput,
  TransactionOutput,
  TransactionOptions,
  BuiltTransaction,
} from './transaction';

// Vesting Classification
export {
  VestingClassifier,
  createVestingClassifier,
} from './vesting';

export type {
  VestingResult,
  VestingCacheProvider,
  VestingCacheEntry,
  VestingClassifierOptions,
} from './vesting';

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
