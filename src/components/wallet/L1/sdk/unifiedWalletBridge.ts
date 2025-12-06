/**
 * UnifiedWalletBridge - Bridge between UnifiedKeyManager and L1 Wallet interface
 *
 * Provides functions to load/build L1 Wallet objects from the shared UnifiedKeyManager.
 * This enables L1 and L3 wallets to use the same keys.
 */

import { UnifiedKeyManager } from "../../shared/services/UnifiedKeyManager";
import type { Wallet, WalletAddress } from "./types";

// Same session key as L3 (from useWallet.ts)
const SESSION_KEY = "user-pin-1234";

// L3 selected address index storage key
const SELECTED_INDEX_KEY = "l3_selected_address_index";

/**
 * Load wallet from UnifiedKeyManager and convert to L1 Wallet interface
 * Returns null if UnifiedKeyManager is not initialized
 */
export async function loadWalletFromUnifiedKeyManager(): Promise<Wallet | null> {
  const keyManager = UnifiedKeyManager.getInstance(SESSION_KEY);
  const initialized = await keyManager.initialize();

  if (!initialized || !keyManager.isInitialized()) {
    return null;
  }

  const walletInfo = keyManager.getWalletInfo();
  const masterKey = keyManager.getMasterKeyHex();
  const chainCode = keyManager.getChainCodeHex();

  if (!masterKey) {
    return null;
  }

  // Get selected address index (same as L3 uses)
  const selectedIndex = parseInt(
    localStorage.getItem(SELECTED_INDEX_KEY) || "0",
    10
  );

  // Derive addresses up to selected index
  const addresses: WalletAddress[] = [];
  for (let i = 0; i <= selectedIndex; i++) {
    const derived = keyManager.deriveAddress(i);
    addresses.push({
      address: derived.l1Address,
      publicKey: derived.publicKey,
      privateKey: derived.privateKey,
      path: derived.path,
      index: i,
    });
  }

  // Build L1 Wallet from UnifiedKeyManager data
  const wallet: Wallet = {
    masterPrivateKey: masterKey,
    chainCode: chainCode || undefined,
    addresses,
    createdAt: Date.now(),
    isImportedAlphaWallet: walletInfo.source === "file",
    isBIP32: walletInfo.derivationMode === "bip32",
    childPrivateKey: addresses[0]?.privateKey || null,
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
