import { saveWalletToStorage, loadWalletFromStorage } from "./storage";
import {
  generateMasterKeyFromSeed,
  generateHDAddressBIP32,
  generateHDAddress,
} from "./address";
import type { Wallet } from "./types";
import CryptoJS from "crypto-js";

/**
 * Create a new wallet using standard BIP32 derivation
 * Generates a 64-byte seed and derives master key per BIP32 spec
 */
export function createWallet(): Wallet {
  // Generate 64-byte seed (512 bits) for BIP32
  const seed = CryptoJS.lib.WordArray.random(64).toString();

  // Derive master key and chain code per BIP32 standard
  const { masterPrivateKey, masterChainCode } = generateMasterKeyFromSeed(seed);

  // Generate first address using BIP32 path m/44'/0'/0'/0/0
  const firstAddress = generateHDAddressBIP32(
    masterPrivateKey,
    masterChainCode,
    0
  );

  const wallet: Wallet = {
    masterPrivateKey,
    chainCode: masterChainCode,
    addresses: [firstAddress],
    createdAt: Date.now(),
    isBIP32: true, // Mark as BIP32 wallet
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
 * Uses BIP32 for new wallets, legacy derivation for old wallets
 */
export function generateAddress(wallet: Wallet) {
  const index = wallet.addresses.length;

  // Use BIP32 for new wallets, legacy for backward compatibility
  const addr = wallet.isBIP32
    ? generateHDAddressBIP32(wallet.masterPrivateKey, wallet.chainCode!, index)
    : generateHDAddress(wallet.masterPrivateKey, wallet.chainCode!, index);

  wallet.addresses.push(addr);

  saveWalletToStorage("main", wallet);
  return addr;
}
