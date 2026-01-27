import { saveWalletToStorage, loadWalletFromStorage } from "./storage";
import {
  generateHDAddressBIP32,
  generateAddressFromMasterKey,
} from "./address";
import type { Wallet } from "./types";
import CryptoJS from "crypto-js";
import { STORAGE_KEYS } from "../../../../config/storageKeys";

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
  localStorage.removeItem(STORAGE_KEYS.WALLET_MAIN);
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
  // Find the next external address index
  // This accounts for wallets that have change addresses mixed in
  // External addresses have isChange=false or undefined
  const externalAddresses = wallet.addresses.filter(addr => !addr.isChange);
  const maxExternalIndex = externalAddresses.length > 0
    ? Math.max(...externalAddresses.map(addr => addr.index ?? 0))
    : -1;
  const index = maxExternalIndex + 1;

  // For imported BIP32 wallets with chainCode, use BIP32 derivation (external chain=0)
  // For standard wallets created in this app, use HMAC-SHA512 derivation
  const addr = wallet.isImportedAlphaWallet && wallet.chainCode
    ? generateHDAddressBIP32(
        wallet.masterPrivateKey,
        wallet.chainCode,
        index,
        wallet.descriptorPath ? `m/${wallet.descriptorPath}` : undefined,
        false  // isChange=false - always generate external addresses
      )
    : generateAddressFromMasterKey(wallet.masterPrivateKey, index);

  wallet.addresses.push(addr);

  saveWalletToStorage("main", wallet);
  return addr;
}
