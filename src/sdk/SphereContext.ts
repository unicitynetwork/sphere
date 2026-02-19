import { createContext } from 'react';
import type { Sphere, PeerInfo, InitProgress } from '@unicitylabs/sphere-sdk';
import type { BrowserProviders } from '@unicitylabs/sphere-sdk/impl/browser';

export interface SphereContextValue {
  sphere: Sphere | null;
  providers: BrowserProviders | null;

  isLoading: boolean;
  isInitialized: boolean;
  walletExists: boolean;
  error: Error | null;

  /** True while background address discovery is running (post-init) */
  isDiscoveringAddresses: boolean;

  /** Current SDK initialization progress (null when idle or complete) */
  initProgress: InitProgress | null;

  /** Resolve a nametag via Nostr transport — works without a wallet */
  resolveNametag: (nametag: string) => Promise<PeerInfo | null>;
  createWallet: (options?: CreateWalletOptions) => Promise<string>;
  importWallet: (
    mnemonic: string,
    options?: ImportWalletOptions,
  ) => Promise<Sphere>;
  importFromFile: (options: ImportFromFileOptions) => Promise<ImportFromFileResult>;
  /** Mark wallet as existing — call after import flow completes (scanning, address selection, etc.).
   *  Optionally accepts a Sphere instance to set in context (for import flows where sphere
   *  is NOT set eagerly to avoid premature re-renders). */
  finalizeWallet: (importedSphere?: Sphere) => void;
  deleteWallet: () => Promise<void>;
  reinitialize: () => Promise<void>;

  /** Whether IPFS token sync is currently enabled */
  ipfsEnabled: boolean;
  /** Toggle IPFS sync on/off (persists to localStorage, triggers reinitialize) */
  toggleIpfs: () => void;
}

export interface CreateWalletOptions {
  nametag?: string;
}

export interface ImportWalletOptions {
  nametag?: string;
}

export interface ImportFromFileOptions {
  fileContent: string | Uint8Array;
  fileName: string;
  password?: string;
  nametag?: string;
}

export interface ImportFromFileResult {
  success: boolean;
  sphere?: Sphere;
  mnemonic?: string;
  needsPassword?: boolean;
  error?: string;
}

export const SphereContext = createContext<SphereContextValue | null>(null);
