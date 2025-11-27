import type { StoredWallet, Wallet } from "./types";

const STORAGE_PREFIX = "wallet_";

export function saveWalletToStorage(key: string, wallet: Wallet) {
  localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(wallet));
}

export function loadWalletFromStorage(key: string): Wallet | null {
  const raw = localStorage.getItem(STORAGE_PREFIX + key);
  if (!raw) return null;
  return JSON.parse(raw);
}

export function deleteWalletFromStorage(key: string) {
  localStorage.removeItem(STORAGE_PREFIX + key);
}

export function getAllStoredWallets(): StoredWallet[] {
  return Object.keys(localStorage)
    .filter((k) => k.startsWith(STORAGE_PREFIX))
    .map((k) => ({
      key: k.replace(STORAGE_PREFIX, ""),
      data: JSON.parse(localStorage.getItem(k)!)
    }));
}
