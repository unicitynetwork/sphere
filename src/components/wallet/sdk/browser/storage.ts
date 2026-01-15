/**
 * Browser Storage Helpers
 *
 * Generic localStorage utilities for wallet data.
 * Application-specific key generators should be passed in or configured.
 */

import type { BaseWallet } from '../types';

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
