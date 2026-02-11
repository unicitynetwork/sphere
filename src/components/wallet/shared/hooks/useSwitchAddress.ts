/**
 * useSwitchAddress - Hook for switching between wallet addresses without page reload
 *
 * This hook handles:
 * 1. Updating localStorage with new selected path
 * 2. Updating IdentityManager with new path
 * 3. Resetting WalletRepository in-memory state
 * 4. Resetting IpfsStorageService for new identity
 * 5. Dispatching wallet-loaded/wallet-updated events
 * 6. Invalidating TanStack Query cache
 */
import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { WalletRepository } from '../../../../repositories/WalletRepository';
import { IdentityManager } from '../../L3/services/IdentityManager';
import { IpfsStorageService } from '../../L3/services/IpfsStorageService';
import { QUERY_KEYS as KEYS } from '../../../../config/queryKeys';
import { L1_KEYS } from '../../L1/hooks/useL1Wallet';
import { STORAGE_KEYS } from '../../../../config/storageKeys';

const SESSION_KEY = "user-pin-1234";

export interface UseSwitchAddressReturn {
  switchToAddress: (l1Address: string, path: string | null) => Promise<void>;
  isSwitching: boolean;
}

export function useSwitchAddress(): UseSwitchAddressReturn {
  const queryClient = useQueryClient();
  const [isSwitching, setIsSwitching] = useState(false);

  const switchToAddress = useCallback(async (l1Address: string, path: string | null) => {
    if (isSwitching) return;

    setIsSwitching(true);

    try {
      console.log(`🔄 Switching to address: ${l1Address.slice(0, 12)}... path=${path}`);

      // 1. Update localStorage with new selected path
      if (path) {
        localStorage.setItem(STORAGE_KEYS.L3_SELECTED_ADDRESS_PATH, path);
      } else {
        localStorage.removeItem(STORAGE_KEYS.L3_SELECTED_ADDRESS_PATH);
      }

      // 2. Update IdentityManager with new path
      const identityManager = IdentityManager.getInstance(SESSION_KEY);
      identityManager.setSelectedAddressPath(path || "m/84'/1'/0'/0/0");

      // 3. Reset WalletRepository in-memory state
      const walletRepo = WalletRepository.getInstance();
      walletRepo.resetInMemoryState();

      // 4. Reset IpfsStorageService for new identity
      // This ensures IPFS sync uses the new identity's IPNS keys
      await IpfsStorageService.resetInstance();

      // 5. Get new identity and pre-load wallet BEFORE invalidating queries
      // This prevents race conditions in useWallet's queryFn
      const newIdentity = await identityManager.getCurrentIdentity();
      if (newIdentity) {
        console.log(`📦 Pre-loading wallet for new identity: ${newIdentity.address.slice(0, 20)}...`);
        walletRepo.loadWalletForAddress(newIdentity.address);
      }

      // 6. Dispatch wallet-loaded event for services (NostrService reset)
      console.log('📢 Dispatching wallet-loaded event...');
      window.dispatchEvent(new Event("wallet-loaded"));

      // 7. Invalidate queries to refresh UI
      // Identity first, then others - the pre-loaded wallet will be used
      await queryClient.invalidateQueries({ queryKey: KEYS.IDENTITY });
      await queryClient.invalidateQueries({ queryKey: KEYS.NAMETAG });
      await queryClient.invalidateQueries({ queryKey: KEYS.TOKENS });
      await queryClient.invalidateQueries({ queryKey: KEYS.AGGREGATED });
      await queryClient.invalidateQueries({ queryKey: L1_KEYS.WALLET });

      console.log(`✅ Switched to address: ${l1Address.slice(0, 12)}...`);

    } catch (err) {
      console.error('Failed to switch address:', err);
      throw err;
    } finally {
      setIsSwitching(false);
    }
  }, [isSwitching, queryClient]);

  return {
    switchToAddress,
    isSwitching,
  };
}
