/**
 * L1 Wallet Operations - Re-exports from SDK browser module
 *
 * This file provides backwards compatibility.
 * All implementation is now in ../../sdk/browser/wallet.ts
 */

// Re-export wallet functions from SDK
export {
  // Factory class
  BrowserWalletFactory,
  getDefaultWalletFactory,
  // Functions with default storage (backwards compatible names)
  createAndSaveWallet as createWallet,
  loadWallet,
  deleteWallet,
  generateAndSaveAddress as generateAddress,
  // Types
  type BrowserWallet,
} from '../../sdk/browser/wallet';

// Re-export Wallet type for backwards compatibility
export type { Wallet } from './types';
