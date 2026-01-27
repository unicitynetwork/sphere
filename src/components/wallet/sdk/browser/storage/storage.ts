/**
 * Browser Storage Helpers
 *
 * Generic localStorage utilities for wallet data.
 * Application-specific key generators should be passed in or configured.
 */

import type { BaseWallet } from '../../types';

/**
 * Storage key configuration
 */
export interface StorageKeyConfig {
  /** Prefix for wallet keys (e.g., "unicity_wallet_") */
  walletPrefix: string;
  /** Key for main wallet (e.g., "unicity_wallet_main") */
  mainWalletKey: string;
}

/**
 * Stored wallet entry with key
 */
export interface StoredWalletEntry<T extends BaseWallet = BaseWallet> {
  key: string;
  data: T;
}

/**
 * Browser localStorage-based wallet storage
 */
export class BrowserWalletStorage<T extends BaseWallet = BaseWallet> {
  private config: StorageKeyConfig;

  constructor(config: StorageKeyConfig) {
    this.config = config;
  }

  /**
   * Save wallet to localStorage
   */
  save(key: string, wallet: T): void {
    const storageKey = this.config.walletPrefix + key;
    localStorage.setItem(storageKey, JSON.stringify(wallet));
  }

  /**
   * Load wallet from localStorage
   */
  load(key: string): T | null {
    const storageKey = this.config.walletPrefix + key;
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      console.error(`[Storage] Failed to parse wallet data for key: ${key}`);
      return null;
    }
  }

  /**
   * Delete wallet from localStorage
   */
  delete(key: string): void {
    const storageKey = this.config.walletPrefix + key;
    localStorage.removeItem(storageKey);
  }

  /**
   * Get all stored wallets
   */
  getAll(): StoredWalletEntry<T>[] {
    const wallets: StoredWalletEntry<T>[] = [];
    for (const k of Object.keys(localStorage)) {
      if (!k.startsWith(this.config.walletPrefix)) continue;
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      try {
        wallets.push({
          key: k.replace(this.config.walletPrefix, ''),
          data: JSON.parse(raw) as T,
        });
      } catch {
        console.error(`[Storage] Failed to parse wallet: ${k}`);
      }
    }
    return wallets;
  }

  /**
   * Save main wallet
   */
  saveMain(wallet: T): void {
    localStorage.setItem(this.config.mainWalletKey, JSON.stringify(wallet));
  }

  /**
   * Load main wallet
   */
  loadMain(): T | null {
    const raw = localStorage.getItem(this.config.mainWalletKey);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      console.error('[Storage] Failed to parse main wallet');
      return null;
    }
  }

  /**
   * Delete main wallet
   */
  deleteMain(): void {
    localStorage.removeItem(this.config.mainWalletKey);
  }

  /**
   * Check if main wallet exists
   */
  hasMain(): boolean {
    return localStorage.getItem(this.config.mainWalletKey) !== null;
  }
}

// ==========================================
// Helper functions for simple use cases
// ==========================================

/**
 * Save any JSON data to localStorage
 */
export function saveToStorage<T>(key: string, data: T): void {
  localStorage.setItem(key, JSON.stringify(data));
}

/**
 * Load JSON data from localStorage
 */
export function loadFromStorage<T>(key: string): T | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    console.error(`[Storage] Failed to parse data for key: ${key}`);
    return null;
  }
}

/**
 * Delete data from localStorage
 */
export function deleteFromStorage(key: string): void {
  localStorage.removeItem(key);
}

/**
 * Check if key exists in localStorage
 */
export function hasInStorage(key: string): boolean {
  return localStorage.getItem(key) !== null;
}

// ==========================================
// Default SDK Storage Instance
// ==========================================

import {
  buildWalletStorageKeys,
  buildWalletKeyGenerators,
  buildWalletKeyPrefixes,
  DEFAULT_STORAGE_PREFIX,
} from './storage-keys';

// Build default keys with SDK prefix
const DEFAULT_KEYS = buildWalletStorageKeys(DEFAULT_STORAGE_PREFIX);
const DEFAULT_GENERATORS = buildWalletKeyGenerators(DEFAULT_STORAGE_PREFIX);
const DEFAULT_PREFIXES = buildWalletKeyPrefixes(DEFAULT_STORAGE_PREFIX);

/**
 * Default wallet storage configuration
 */
export const DEFAULT_WALLET_STORAGE_CONFIG: StorageKeyConfig = {
  walletPrefix: DEFAULT_PREFIXES.L1_WALLET,
  mainWalletKey: DEFAULT_KEYS.L1_WALLET_MAIN,
};

/**
 * Create wallet storage with custom prefix
 */
export function createWalletStorage<T extends BaseWallet = BaseWallet>(
  prefix: string = DEFAULT_STORAGE_PREFIX
): BrowserWalletStorage<T> {
  const keys = buildWalletStorageKeys(prefix);
  const prefixes = buildWalletKeyPrefixes(prefix);
  return new BrowserWalletStorage<T>({
    walletPrefix: prefixes.L1_WALLET,
    mainWalletKey: keys.L1_WALLET_MAIN,
  });
}

// ==========================================
// Convenience functions with default prefix
// ==========================================

/**
 * Save L1 wallet to localStorage (uses default SDK prefix)
 */
export function saveWalletToStorage<T extends BaseWallet>(key: string, wallet: T): void {
  localStorage.setItem(DEFAULT_GENERATORS.l1WalletByKey(key), JSON.stringify(wallet));
}

/**
 * Load L1 wallet from localStorage (uses default SDK prefix)
 */
export function loadWalletFromStorage<T extends BaseWallet>(key: string): T | null {
  const raw = localStorage.getItem(DEFAULT_GENERATORS.l1WalletByKey(key));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    console.error(`[Storage] Failed to parse wallet data for key: ${key}`);
    return null;
  }
}

/**
 * Delete L1 wallet from localStorage (uses default SDK prefix)
 */
export function deleteWalletFromStorage(key: string): void {
  localStorage.removeItem(DEFAULT_GENERATORS.l1WalletByKey(key));
}

/**
 * Get all stored L1 wallets (uses default SDK prefix)
 */
export function getAllStoredWallets<T extends BaseWallet>(): StoredWalletEntry<T>[] {
  const wallets: StoredWalletEntry<T>[] = [];
  for (const k of Object.keys(localStorage)) {
    if (!k.startsWith(DEFAULT_PREFIXES.L1_WALLET)) continue;
    const raw = localStorage.getItem(k);
    if (!raw) continue;
    try {
      wallets.push({
        key: k.replace(DEFAULT_PREFIXES.L1_WALLET, ''),
        data: JSON.parse(raw) as T,
      });
    } catch {
      console.error(`[Storage] Failed to parse wallet: ${k}`);
    }
  }
  return wallets;
}
