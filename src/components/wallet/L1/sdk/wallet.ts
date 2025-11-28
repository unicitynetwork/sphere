import { saveWalletToStorage, loadWalletFromStorage } from "./storage";
import { generateHDAddress } from "./address";
import type { Wallet } from "./types";
import CryptoJS from "crypto-js";

export function createWallet(): Wallet {
  const masterPrivateKey = CryptoJS.lib.WordArray.random(32).toString();
  const chainCode = CryptoJS.lib.WordArray.random(32).toString();

  const firstAddress = generateHDAddress(masterPrivateKey, chainCode, 0);

  const wallet: Wallet = {
    masterPrivateKey,
    chainCode,
    addresses: [firstAddress],
    createdAt: Date.now(),
  };

  saveWalletToStorage("main", wallet);
  return wallet;
}

export function deleteWallet() {
  localStorage.removeItem("wallet_main");
}

export function loadWallet(): Wallet | null {
  return loadWalletFromStorage("main");
}

export function generateAddress(wallet: Wallet) {
  const index = wallet.addresses.length;

  const addr = generateHDAddress(
    wallet.masterPrivateKey,
    wallet.chainCode,
    index
  );
  wallet.addresses.push(addr);

  saveWalletToStorage("main", wallet);
  return addr;
}
