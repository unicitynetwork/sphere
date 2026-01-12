/**
 * Unified function for creating a new address and opening onboarding
 *
 * Used by:
 * - AddressSelector (header "+ New" button)
 * - L1WalletModal ("+" button inside L1 wallet)
 *
 * Flow:
 * 1. Create new address using WalletCore
 * 2. Save to L1 wallet storage
 * 3. Set selected path in localStorage
 * 4. Reset WalletRepository state
 * 5. Reload page → WalletGate shows onboarding for nametag
 */

import { UnifiedKeyManager } from '../services/UnifiedKeyManager';
import { WalletRepository } from '../../../../repositories/WalletRepository';
import { STORAGE_KEYS } from '../../../../config/storageKeys';
import {
  deriveUnifiedAddress,
  getAddressPath,
} from '../../core/WalletCore';
import {
  saveWalletToStorage,
  loadWalletFromStorage,
  type Wallet as L1Wallet,
} from '../../L1/sdk';

export interface CreateNewAddressResult {
  success: boolean;
  l1Address?: string;
  l3Address?: string;
  path?: string;
  error?: string;
}

/**
 * Create a new address and prepare for onboarding
 *
 * @param sessionKey - Session key for UnifiedKeyManager (default: "user-pin-1234")
 * @returns Result with address info or error
 */
export async function createNewAddressAndOnboard(
  sessionKey: string = "user-pin-1234"
): Promise<CreateNewAddressResult> {
  try {
    // 1. Get wallet configuration from UnifiedKeyManager
    const keyManager = UnifiedKeyManager.getInstance(sessionKey);
    const masterKey = keyManager.getMasterKeyHex();
    const chainCode = keyManager.getChainCodeHex();
    const basePath = keyManager.getBasePath();
    const mode = keyManager.getDerivationMode();

    if (!masterKey) {
      return { success: false, error: "Wallet not initialized" };
    }

    // 2. Load current L1 wallet to find next index
    const currentWallet = loadWalletFromStorage("main");
    if (!currentWallet) {
      return { success: false, error: "L1 wallet not found" };
    }

    // 3. Find next address index (count existing external addresses)
    const nextIndex = currentWallet.addresses.filter(a => !a.isChange).length;

    // 4. Derive unified address using WalletCore
    const path = getAddressPath(nextIndex, false, basePath);
    const unified = await deriveUnifiedAddress(masterKey, chainCode, path, mode);

    // 5. Add new address to L1 wallet
    const newAddress = {
      index: nextIndex,
      address: unified.l1Address,
      privateKey: unified.privateKey,
      publicKey: unified.publicKey,
      path: path,
      isChange: false,
      createdAt: new Date().toISOString(),
    };

    const updatedWallet: L1Wallet = {
      ...currentWallet,
      addresses: [...currentWallet.addresses, newAddress],
    };

    // 6. Save updated L1 wallet
    saveWalletToStorage("main", updatedWallet);

    // 7. Set selected path for L3 identity
    localStorage.setItem(STORAGE_KEYS.L3_SELECTED_ADDRESS_PATH, path);

    // 8. Reset WalletRepository to force reload with new address
    WalletRepository.getInstance().resetInMemoryState();

    // 9. Reload page - WalletGate will show onboarding since new address has no nametag
    window.location.reload();

    return {
      success: true,
      l1Address: unified.l1Address,
      l3Address: unified.l3Address,
      path: path,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create address";
    console.error("createNewAddressAndOnboard error:", err);
    return { success: false, error: message };
  }
}
