/**
 * L1 Wallet Storage - Browser localStorage implementation
 *
 * Uses application-specific storage keys from config.
 * Core storage utilities are in ../../sdk/browser/storage.ts
 */

import type { Wallet, StoredWallet } from "./types";
import { STORAGE_KEY_GENERATORS, STORAGE_KEY_PREFIXES } from "../../../../config/storageKeys";

// Re-export generic storage utilities from SDK
export {
  saveToStorage,
  loadFromStorage,
  deleteFromStorage,
  hasInStorage,
} from '../../sdk/browser/storage';

/**
 * Save L1 wallet to localStorage
 */
export function saveWalletToStorage(key: string, wallet: Wallet): void {
  localStorage.setItem(STORAGE_KEY_GENERATORS.l1WalletByKey(key), JSON.stringify(wallet));
}

/**
 * Load L1 wallet from localStorage
 */
export function loadWalletFromStorage(key: string): Wallet | null {
  const raw = localStorage.getItem(STORAGE_KEY_GENERATORS.l1WalletByKey(key));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    console.error(`[Storage] Failed to parse wallet data for key: ${key}`);
    return null;
  }
}

/**
 * Delete L1 wallet from localStorage
 */
export function deleteWalletFromStorage(key: string): void {
  localStorage.removeItem(STORAGE_KEY_GENERATORS.l1WalletByKey(key));
}

/**
 * Get all stored L1 wallets
 */
export function getAllStoredWallets(): StoredWallet[] {
  const wallets: StoredWallet[] = [];
  for (const k of Object.keys(localStorage)) {
    if (!k.startsWith(STORAGE_KEY_PREFIXES.L1_WALLET)) continue;
    const raw = localStorage.getItem(k);
    if (!raw) continue;
    try {
      wallets.push({
        key: k.replace(STORAGE_KEY_PREFIXES.L1_WALLET, ""),
        data: JSON.parse(raw)
      });
    } catch {
      console.error(`[Storage] Failed to parse wallet: ${k}`);
    }
  }
  return wallets;
}
