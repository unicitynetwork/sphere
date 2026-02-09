import { createContext } from 'react';
import type { Sphere, PeerInfo } from '@unicitylabs/sphere-sdk';
import type { BrowserProviders } from '@unicitylabs/sphere-sdk/impl/browser';

export interface SphereContextValue {
  sphere: Sphere | null;
  providers: BrowserProviders | null;

  isLoading: boolean;
  isInitialized: boolean;
  walletExists: boolean;
  error: Error | null;

  /** Resolve a nametag via Nostr transport — works without a wallet */
  resolveNametag: (nametag: string) => Promise<PeerInfo | null>;
  createWallet: (options?: CreateWalletOptions) => Promise<string>;
  importWallet: (
    mnemonic: string,
    options?: ImportWalletOptions,
  ) => Promise<void>;
  deleteWallet: () => Promise<void>;
  reinitialize: () => Promise<void>;
}

export interface CreateWalletOptions {
  nametag?: string;
}

export interface ImportWalletOptions {
  nametag?: string;
}

export const SphereContext = createContext<SphereContextValue | null>(null);
