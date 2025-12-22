/**
 * UnifiedWalletBridge - Bridge between UnifiedKeyManager and L1 Wallet interface
 *
 * Provides functions to load/build L1 Wallet objects from the shared UnifiedKeyManager.
 * This enables L1 and L3 wallets to use the same keys.
 */

import { UnifiedKeyManager } from "../../shared/services/UnifiedKeyManager";
import type { Wallet, WalletAddress } from "./types";
import { loadWalletFromStorage } from "./storage";

// Same session key as L3 (from useWallet.ts)
const SESSION_KEY = "user-pin-1234";

// L3 selected address path storage key - PATH is the ONLY reliable identifier
const SELECTED_PATH_KEY = "l3_selected_address_path";

/**
 * Load wallet from UnifiedKeyManager and convert to L1 Wallet interface
 * Returns null if UnifiedKeyManager is not initialized
 *
 * Priority:
 * 1. If L1 wallet exists in storage with addresses (e.g., from import/scan), use those
 * 2. Otherwise, derive addresses from UnifiedKeyManager (for new/restore wallets)
 */
export async function loadWalletFromUnifiedKeyManager(): Promise<Wallet | null> {
  const keyManager = UnifiedKeyManager.getInstance(SESSION_KEY);
  const initialized = await keyManager.initialize();

  if (!initialized || !keyManager.isInitialized()) {
    return null;
  }

  // Check if L1 wallet exists in storage with addresses (from import/scan)
  const storedWallet = loadWalletFromStorage("main");
  if (storedWallet && storedWallet.addresses && storedWallet.addresses.length > 0) {
    console.log(`📋 Loading L1 wallet from storage with ${storedWallet.addresses.length} addresses`);
    return storedWallet;
  }

  // No stored wallet with addresses - derive from UnifiedKeyManager
  const walletInfo = keyManager.getWalletInfo();
  const masterKey = keyManager.getMasterKeyHex();
  const chainCode = keyManager.getChainCodeHex();

  if (!masterKey) {
    return null;
  }

  // Get selected address path (same as L3 uses) - PATH is the ONLY reliable identifier
  const selectedPath = localStorage.getItem(SELECTED_PATH_KEY);

  // Get base path for default address derivation
  const basePath = keyManager.getBasePath();
  const defaultPath = `${basePath}/0/0`;  // First external address

  // Derive the selected address (or default if none selected)
  const targetPath = selectedPath || defaultPath;
  const derived = keyManager.deriveAddressFromPath(targetPath);

  // Build addresses array with just the selected address
  // Additional addresses will be added from storage or scanning
  const addresses: WalletAddress[] = [{
    address: derived.l1Address,
    publicKey: derived.publicKey,
    privateKey: derived.privateKey,
    path: derived.path,
    index: derived.index,
  }];

  // Build L1 Wallet from UnifiedKeyManager data
  // Use derived address directly instead of addresses[0] for clarity
  const wallet: Wallet = {
    masterPrivateKey: masterKey,
    chainCode: chainCode || undefined,
    addresses,
    createdAt: Date.now(),
    isImportedAlphaWallet: walletInfo.source === "file",
    isBIP32: walletInfo.derivationMode === "bip32",
    childPrivateKey: derived.privateKey || null,
  };

  return wallet;
}

/**
 * Get the UnifiedKeyManager instance
 * Use this when you need to call methods on the key manager directly
 */
export function getUnifiedKeyManager(): UnifiedKeyManager {
  return UnifiedKeyManager.getInstance(SESSION_KEY);
}

/**
 * Check if UnifiedKeyManager has an initialized wallet
 */
export async function isUnifiedWalletInitialized(): Promise<boolean> {
  const keyManager = UnifiedKeyManager.getInstance(SESSION_KEY);
  await keyManager.initialize();
  return keyManager.isInitialized();
}
