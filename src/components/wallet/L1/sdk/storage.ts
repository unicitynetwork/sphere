import type { StoredWallet, Wallet } from "./types";
import { STORAGE_KEY_GENERATORS, STORAGE_KEY_PREFIXES } from "../../../../config/storageKeys";

export function saveWalletToStorage(key: string, wallet: Wallet) {
  localStorage.setItem(STORAGE_KEY_GENERATORS.l1WalletByKey(key), JSON.stringify(wallet));
}

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

export function deleteWalletFromStorage(key: string) {
  localStorage.removeItem(STORAGE_KEY_GENERATORS.l1WalletByKey(key));
}

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
