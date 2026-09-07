import { createContext } from 'react';
import type { Sphere, PeerInfo, InitProgress } from '@unicitylabs/sphere-sdk';
import type { BrowserProviders } from '@unicitylabs/sphere-sdk/impl/browser';
import type { WalletApiTransportConfig } from '@unicitylabs/sphere-sdk/impl/shared/wallet-api';
import type { SubscriptionKeyStatus } from './subscription/keyStatus';
import type { AutoLockValue } from './walletLock/lockSettings';

/**
 * The app's provider bundle: the browser base, plus — when the money path
 * rides wallet-api (VITE_WALLET_API_URL set) — the plain `walletApi`
 * transport CONFIG (post-flip: createWalletApiProviders attaches config, not
 * a client; the session lifecycle is SDK-internal). The extra is additive:
 * helpers taking `BrowserProviders` keep working unchanged.
 */
export type SphereAppProviders = BrowserProviders & { walletApi?: WalletApiTransportConfig };

export interface SphereContextValue {
  sphere: Sphere | null;
  providers: SphereAppProviders | null;

  /** L3 network this provider was built for — the single source of truth (SphereProvider's `network` prop). */
  network: string;

  isLoading: boolean;
  isInitialized: boolean;
  walletExists: boolean;
  error: Error | null;

  /** True when an encrypted wallet exists on disk but hasn't been unlocked
   *  with its password this session (SDK throws a decrypt-mnemonic
   *  STORAGE_ERROR — see isDecryptionError.ts) — locked, not broken. */
  isLocked: boolean;
  /** Unlock the existing encrypted wallet with its password. Throws the
   *  decrypt-mnemonic STORAGE_ERROR on a wrong password — the caller
   *  (UnlockScreen) shows "wrong password" via isDecryptionError. */
  unlock: (password: string) => Promise<void>;
  /** Lock the wallet: destroy the live Sphere instance and require unlock() again. */
  lock: () => Promise<void>;

  /**
   * Settings → Security (#449): whether the wallet CURRENTLY has an at-rest
   * password (any wallet — including plaintext create-flow wallets that never
   * set one). Drives the Set vs Change/Remove UI. Derived from the session
   * password held in memory, OR (when no session password exists yet, e.g. a
   * cold-start locked wallet) whether the on-disk mnemonic fails to validate
   * as plaintext BIP39.
   */
  hasWalletPassword: boolean;
  /**
   * Set an at-rest password on a wallet that doesn't have one yet (including
   * existing plaintext wallets). In-place mnemonic re-encryption ONLY — never
   * Sphere.import()/Sphere.clear() (would wipe the token DB). Arms idle
   * auto-lock on success.
   */
  setWalletPassword: (newPassword: string) => Promise<void>;
  /**
   * Change the wallet's at-rest password. Verifies `currentPassword` first —
   * throws (and changes nothing) on a mismatch.
   */
  changeWalletPassword: (currentPassword: string, newPassword: string) => Promise<void>;
  /**
   * Remove the wallet's at-rest password, returning it to a plaintext
   * mnemonic. Verifies `currentPassword` first. Disarms idle auto-lock.
   */
  removeWalletPassword: (currentPassword: string) => Promise<void>;
  /**
   * In-wallet backup gate (#449): verify a candidate password against the
   * wallet's CURRENT at-rest mnemonic encryption — read-only, never mutates
   * storage and never persists the entered password anywhere. Resolves
   * `true` iff decrypting the stored mnemonic with `password` yields a valid
   * BIP39 mnemonic; resolves `false` on any mismatch or failure (never
   * throws to the caller).
   */
  verifyWalletPassword: (password: string) => Promise<boolean>;

  /** Current auto-lock timeout selection (Settings → Security). Only meaningful while a password is set. */
  autoLockMinutes: AutoLockValue;
  /** Set the auto-lock timeout; persists an encrypted blob and re-arms the idle timer. No-op without a session password. */
  setAutoLockTimeout: (value: AutoLockValue) => void;

  /** True while background address discovery is running (post-init) */
  isDiscoveringAddresses: boolean;

  /** Current SDK initialization progress (null when idle or complete) */
  initProgress: InitProgress | null;

  /** Resolve a nametag via Nostr transport — works without a wallet */
  resolveNametag: (nametag: string) => Promise<PeerInfo | null>;
  createWallet: (options?: CreateWalletOptions) => Promise<{ mnemonic: string; sphere: Sphere }>;
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


  /** Persist a per-wallet subscription API key and re-init the SDK oracle with it. */
  /**
   * Applies a key to the live session and the encrypted vault. `durable` is
   * false when the vault write failed or there was no wallet to write to (a
   * locked session leaves only the plaintext boot cache) — a caller holding a
   * PURCHASED key must not acknowledge its delivery on that, or the gateway
   * stops redelivering the only copy (sphere#501).
   */
  applySubscriptionKey: (apiKey: string, opts?: { walletWide?: boolean }) => Promise<{ durable: boolean }>;

  /**
   * Readiness of the subscription key on the LIVE oracle. When subscriptions
   * are on, the send path must refuse until this is `'ready'` — otherwise a
   * send races the async provisioning and goes out with no aggregator key
   * (→ 401). `'not-required'` when subscriptions are disabled.
   */
  subscriptionKeyStatus: SubscriptionKeyStatus;

  /** True when the asset path rides the wallet-api backend (S4 composition). */
  walletApiEnabled: boolean;
}

export interface CreateWalletOptions {
  nametag?: string;
  password?: string;
}

export interface ImportWalletOptions {
  nametag?: string;
  password?: string;
}

export interface ImportFromFileOptions {
  fileContent: string;
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
