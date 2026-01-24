/**
 * Browser Wallet State Persistence (localStorage)
 *
 * Implements WalletStatePersistence using browser localStorage.
 */

import type { WalletStatePersistence } from '../storage/wallet-state-persistence';

// ==========================================
// Browser Implementation
// ==========================================

/**
 * Browser localStorage implementation of WalletStatePersistence
 */
export class BrowserWalletStatePersistence implements WalletStatePersistence {
  private readonly prefix: string;

  constructor(prefix: string = '') {
    this.prefix = prefix;
  }

  /**
   * Check if localStorage is available
   */
  private isAvailable(): boolean {
    try {
      return typeof localStorage !== 'undefined';
    } catch {
      return false;
    }
  }

  private prefixedKey(key: string): string {
    return `${this.prefix}${key}`;
  }

  getString(key: string): string | null {
    if (!this.isAvailable()) return null;
    try {
      return localStorage.getItem(this.prefixedKey(key));
    } catch (error) {
      console.warn('[WalletStatePersistence] Failed to get:', error);
      return null;
    }
  }

  setString(key: string, value: string): void {
    if (!this.isAvailable()) return;
    try {
      localStorage.setItem(this.prefixedKey(key), value);
    } catch (error) {
      console.warn('[WalletStatePersistence] Failed to set:', error);
    }
  }

  remove(key: string): void {
    if (!this.isAvailable()) return;
    try {
      localStorage.removeItem(this.prefixedKey(key));
    } catch (error) {
      console.warn('[WalletStatePersistence] Failed to remove:', error);
    }
  }

  has(key: string): boolean {
    if (!this.isAvailable()) return false;
    try {
      return localStorage.getItem(this.prefixedKey(key)) !== null;
    } catch {
      return false;
    }
  }

  getJSON<T>(key: string): T | null {
    const raw = this.getString(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      console.warn(`[WalletStatePersistence] Failed to parse JSON for key: ${key}`);
      return null;
    }
  }

  setJSON<T>(key: string, value: T): void {
    try {
      this.setString(key, JSON.stringify(value));
    } catch (error) {
      console.warn('[WalletStatePersistence] Failed to stringify JSON:', error);
    }
  }
}

// ==========================================
// Factory
// ==========================================

/**
 * Create a browser localStorage wallet state persistence
 * @param prefix - Optional prefix for all keys (e.g., 'sphere_')
 */
export function createBrowserWalletStatePersistence(prefix: string = ''): WalletStatePersistence {
  return new BrowserWalletStatePersistence(prefix);
}
