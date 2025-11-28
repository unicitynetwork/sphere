import { saveWalletToStorage, loadWalletFromStorage } from "./storage";
import {
  generateHDAddressBIP32,
  generateAddressFromMasterKey,
} from "./address";
import type { Wallet } from "./types";
import CryptoJS from "crypto-js";

/**
 * Create a new wallet matching the original index.html implementation
 * Uses 32-byte random private key with HMAC-SHA512 derivation
 */
export function createWallet(): Wallet {
  // Generate 32 random bytes (256 bits) for the private key - same as index.html
  const randomBytes = CryptoJS.lib.WordArray.random(32);
  const masterPrivateKey = randomBytes.toString();

  // Generate first address using HMAC-SHA512 derivation (matching index.html)
  const firstAddress = generateAddressFromMasterKey(masterPrivateKey, 0);

  const wallet: Wallet = {
    masterPrivateKey,
    addresses: [firstAddress],
    createdAt: Date.now(),
    childPrivateKey: firstAddress.privateKey, // Store for transactions
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

/**
 * Generate a new address for the wallet
 * For standard wallets: uses HMAC-SHA512 derivation (index.html compatible)
 * For imported BIP32 wallets: uses proper BIP32 derivation
 */
export function generateAddress(wallet: Wallet) {
  const index = wallet.addresses.length;

  // For imported BIP32 wallets with chainCode, use BIP32 derivation
  // For standard wallets created in this app, use HMAC-SHA512 derivation
  const addr = wallet.isImportedAlphaWallet && wallet.chainCode
    ? generateHDAddressBIP32(wallet.masterPrivateKey, wallet.chainCode, index)
    : generateAddressFromMasterKey(wallet.masterPrivateKey, index);

  wallet.addresses.push(addr);

  saveWalletToStorage("main", wallet);
  return addr;
}
