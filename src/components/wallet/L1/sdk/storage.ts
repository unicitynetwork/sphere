import type { StoredWallet, Wallet } from "./types";
import { STORAGE_KEY_GENERATORS, STORAGE_KEY_PREFIXES } from "../../../../config/storageKeys";

export function saveWalletToStorage(key: string, wallet: Wallet) {
  localStorage.setItem(STORAGE_KEY_GENERATORS.l1WalletByKey(key), JSON.stringify(wallet));
}

export function loadWalletFromStorage(key: string): Wallet | null {
  const raw = localStorage.getItem(STORAGE_KEY_GENERATORS.l1WalletByKey(key));
  if (!raw) return null;
  return JSON.parse(raw);
}

export function deleteWalletFromStorage(key: string) {
  localStorage.removeItem(STORAGE_KEY_GENERATORS.l1WalletByKey(key));
}

export function getAllStoredWallets(): StoredWallet[] {
  return Object.keys(localStorage)
    .filter((k) => k.startsWith(STORAGE_KEY_PREFIXES.L1_WALLET))
    .map((k) => ({
      key: k.replace(STORAGE_KEY_PREFIXES.L1_WALLET, ""),
      data: JSON.parse(localStorage.getItem(k)!)
    }));
}
