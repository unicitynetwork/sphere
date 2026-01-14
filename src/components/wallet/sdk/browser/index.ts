/**
 * Browser-specific implementations for Unicity Wallet SDK
 *
 * Usage:
 * ```typescript
 * import { L1Wallet } from '@unicity/wallet-sdk';
 * import { BrowserWSAdapter, IndexedDBVestingCache } from '@unicity/wallet-sdk/browser';
 *
 * const wallet = new L1Wallet(
 *   new BrowserWSAdapter(),
 *   new IndexedDBVestingCache()
 * );
 * ```
 */

export { BrowserWSAdapter } from './BrowserWSAdapter';
export { IndexedDBVestingCache } from './IndexedDBVestingCache';
