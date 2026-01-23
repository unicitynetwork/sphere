/**
 * useCreateAddress - Hook for creating new wallet addresses without page reload
 *
 * This hook handles:
 * 1. Deriving new unified address (L1 + L3) using UnifiedKeyManager
 * 2. Minting nametag on blockchain
 * 3. Syncing to IPFS/IPNS with verification
 * 4. Updating TanStack Query cache
 *
 * Works for both L1 and L3 wallet views.
 */
import { useState, useCallback, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { UnifiedKeyManager } from '../services/UnifiedKeyManager';
import { IdentityManager } from '../../L3/services/IdentityManager';
import { NametagService } from '../../L3/services/NametagService';
import { NostrService } from '../../L3/services/NostrService';
import { IpfsStorageService } from '../../L3/services/IpfsStorageService';
import { fetchNametagFromIpns } from '../../L3/services/IpnsNametagFetcher';
import { KEYS } from '../../L3/hooks/useWallet';
import { L1_KEYS } from '../../L1/hooks/useL1Wallet';
import { STORAGE_KEYS } from '../../../../config/storageKeys';
import {
  saveWalletToStorage,
  loadWalletFromStorage,
  type Wallet as L1Wallet,
} from '../../L1/sdk';

const SESSION_KEY = "user-pin-1234";

export type CreateAddressStep =
  | 'idle'
  | 'deriving'
  | 'nametag_input'
  | 'checking_availability'
  | 'minting'
  | 'syncing_ipfs'
  | 'verifying_ipns'
  | 'complete'
  | 'error';

export interface CreateAddressState {
  step: CreateAddressStep;
  error: string | null;
  newAddress: {
    l1Address: string;
    l3Address: string;
    path: string;
    index: number;
    privateKey: string;
    publicKey: string;
  } | null;
  progress: string;
}

export interface ExistingAddressData {
  l1Address: string;
  l3Address: string;
  path: string;
  index: number;
  privateKey: string;
  publicKey: string;
}

export interface UseCreateAddressReturn {
  state: CreateAddressState;
  startCreateAddress: () => Promise<void>;
  setExistingAddress: (address: ExistingAddressData) => void;
  submitNametag: (nametag: string) => Promise<void>;
  reset: () => void;
  isNametagAvailable: (nametag: string) => Promise<boolean>;
}

/**
 * Verify nametag is available via IPNS with retry
 */
async function verifyNametagInIpnsWithRetry(
  privateKey: string,
  expectedNametag: string,
  timeoutMs: number = 60000,
  onStatusUpdate?: (status: string) => void
): Promise<boolean> {
  const startTime = Date.now();
  const retryInterval = 3000;
  let successCount = 0;
  const REQUIRED_SUCCESS_COUNT = 2;
  let attemptCount = 0;

  while (Date.now() - startTime < timeoutMs) {
    try {
      attemptCount++;
      const elapsed = Math.floor((Date.now() - startTime) / 1000);

      onStatusUpdate?.(`Verifying IPNS... (${elapsed}s / ${Math.floor(timeoutMs / 1000)}s)`);

      console.log(`🔄 IPNS verification attempt #${attemptCount} for "${expectedNametag}"...`);

      const result = await fetchNametagFromIpns(privateKey);

      if (result.nametag === expectedNametag && result.source === "http" && result.nametagData) {
        successCount++;
        onStatusUpdate?.(`Verifying IPNS... (${successCount}/${REQUIRED_SUCCESS_COUNT} confirmations)`);
        console.log(`✅ IPNS read successful (${successCount}/${REQUIRED_SUCCESS_COUNT})`);

        if (successCount >= REQUIRED_SUCCESS_COUNT) {
          console.log(`✅ IPNS verified with ${REQUIRED_SUCCESS_COUNT} consecutive reads`);
          return true;
        }

        await new Promise((resolve) => setTimeout(resolve, 2000));
        continue;
      }

      successCount = 0;
      console.log(`🔄 IPNS returned "${result.nametag || "null"}", expected "${expectedNametag}"`);
    } catch (error) {
      successCount = 0;
      console.log("🔄 IPNS verification attempt failed, retrying...", error);
    }

    const remainingTime = timeoutMs - (Date.now() - startTime);
    if (remainingTime > retryInterval) {
      await new Promise((resolve) => setTimeout(resolve, retryInterval));
    }
  }

  console.error(`❌ IPNS verification timeout after ${timeoutMs}ms`);
  return false;
}

export function useCreateAddress(): UseCreateAddressReturn {
  const queryClient = useQueryClient();
  const identityManager = IdentityManager.getInstance(SESSION_KEY);
  const nametagService = NametagService.getInstance(identityManager);

  const [state, setState] = useState<CreateAddressState>({
    step: 'idle',
    error: null,
    newAddress: null,
    progress: '',
  });

  // Warn user about closing during critical steps
  useEffect(() => {
    if (!['minting', 'syncing_ipfs', 'verifying_ipns'].includes(state.step)) {
      return;
    }

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "Your Unicity ID is being synced. Closing now may prevent recovery on other devices.";
      return e.returnValue;
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [state.step]);

  const reset = useCallback(() => {
    setState({
      step: 'idle',
      error: null,
      newAddress: null,
      progress: '',
    });
  }, []);

  const setStep = useCallback((step: CreateAddressStep, progress: string = '') => {
    setState(prev => ({ ...prev, step, progress, error: null }));
  }, []);

  const setProgress = useCallback((progress: string) => {
    setState(prev => ({ ...prev, progress }));
  }, []);

  const setError = useCallback((error: string) => {
    setState(prev => ({ ...prev, step: 'error', error }));
  }, []);

  /**
   * Step 1: Derive new address using UnifiedKeyManager
   */
  const startCreateAddress = useCallback(async () => {
    try {
      setStep('deriving', 'Generating new address...');

      const keyManager = UnifiedKeyManager.getInstance(SESSION_KEY);
      const basePath = keyManager.getBasePath();

      if (!keyManager.isInitialized()) {
        throw new Error("Wallet not initialized");
      }

      // Load current L1 wallet to find next index
      const currentWallet = loadWalletFromStorage("main");
      if (!currentWallet) {
        throw new Error("L1 wallet not found");
      }

      // Find next address index (count existing external addresses)
      const nextIndex = currentWallet.addresses.filter(a => !a.isChange).length;

      // Derive unified address
      const path = `${basePath}/0/${nextIndex}`;
      const derived = keyManager.deriveAddressFromPath(path);

      // Derive L3 identity for this path
      const l3Identity = await identityManager.deriveIdentityFromPath(path);

      console.log(`✅ New address derived: L1=${derived.l1Address.slice(0, 12)}... L3=${l3Identity.address.slice(0, 12)}... path=${path}`);

      setState(prev => ({
        ...prev,
        step: 'nametag_input',
        progress: '',
        newAddress: {
          l1Address: derived.l1Address,
          l3Address: l3Identity.address,
          path: path,
          index: nextIndex,
          privateKey: l3Identity.privateKey,
          publicKey: derived.publicKey,
        },
      }));

    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create address";
      console.error("createAddress error:", err);
      setError(message);
    }
  }, [setStep, setError, identityManager]);

  /**
   * Set existing address (for addresses without nametag)
   * Skips derivation step and goes straight to nametag input
   */
  const setExistingAddress = useCallback((address: ExistingAddressData) => {
    setState({
      step: 'nametag_input',
      error: null,
      progress: '',
      newAddress: {
        l1Address: address.l1Address,
        l3Address: address.l3Address,
        path: address.path,
        index: address.index,
        privateKey: address.privateKey,
        publicKey: address.publicKey,
      },
    });
  }, []);

  /**
   * Check if nametag is available
   */
  const isNametagAvailable = useCallback(async (nametag: string): Promise<boolean> => {
    return await nametagService.isNametagAvailable(nametag);
  }, [nametagService]);

  /**
   * Step 2: Submit nametag, mint on blockchain, sync to IPFS
   */
  const submitNametag = useCallback(async (nametag: string) => {
    if (!state.newAddress) {
      setError("No address to create nametag for");
      return;
    }

    const cleanTag = nametag.trim().replace("@", "").toLowerCase();

    // Store original state for rollback on error
    const originalL1Wallet = loadWalletFromStorage("main");
    const originalSelectedPath = localStorage.getItem(STORAGE_KEYS.L3_SELECTED_ADDRESS_PATH);
    let walletModified = false;

    // Rollback function to restore original state on error
    const rollback = () => {
      if (!walletModified) return;

      console.log("🔄 Rolling back address creation changes...");

      // Restore original L1 wallet (without the new address)
      if (originalL1Wallet) {
        saveWalletToStorage("main", originalL1Wallet);
        console.log("  ✓ Restored original L1 wallet");
      }

      // Restore original selected path
      if (originalSelectedPath) {
        localStorage.setItem(STORAGE_KEYS.L3_SELECTED_ADDRESS_PATH, originalSelectedPath);
        identityManager.setSelectedAddressPath(originalSelectedPath);
      } else {
        localStorage.removeItem(STORAGE_KEYS.L3_SELECTED_ADDRESS_PATH);
      }
      console.log("  ✓ Restored original address path");
    };

    try {
      // Set flag to prevent auto-sync from interfering
      localStorage.setItem(STORAGE_KEYS.ADDRESS_CREATION_IN_PROGRESS, 'true');

      // Check availability
      setStep('checking_availability', 'Checking if name is available...');
      const available = await nametagService.isNametagAvailable(cleanTag);
      if (!available) {
        localStorage.removeItem(STORAGE_KEYS.ADDRESS_CREATION_IN_PROGRESS);
        setError(`@${cleanTag} is already taken`);
        return;
      }

      // Step 1: Mint nametag
      setStep('minting', 'Minting Unicity ID on blockchain...');

      if (!originalL1Wallet) {
        throw new Error("L1 wallet not found");
      }

      // Check if address already exists in wallet (for existing address flow)
      const addressAlreadyExists = originalL1Wallet.addresses.some(
        a => a.address === state.newAddress!.l1Address
      );

      // Only save to L1 wallet if this is a new address
      if (!addressAlreadyExists) {
        const keyManager = UnifiedKeyManager.getInstance(SESSION_KEY);
        const derived = keyManager.deriveAddressFromPath(state.newAddress.path);

        const newWalletAddress = {
          index: state.newAddress.index,
          address: state.newAddress.l1Address,
          privateKey: derived.privateKey,
          publicKey: derived.publicKey,
          path: state.newAddress.path,
          isChange: false,
          createdAt: new Date().toISOString(),
        };

        const updatedWallet: L1Wallet = {
          ...originalL1Wallet,
          addresses: [...originalL1Wallet.addresses, newWalletAddress],
        };

        saveWalletToStorage("main", updatedWallet);
        walletModified = true;
        console.log(`💾 Saved new address to L1 wallet: ${state.newAddress.l1Address.slice(0, 12)}...`);
      } else {
        console.log(`📝 Address already exists in wallet, skipping save: ${state.newAddress.l1Address.slice(0, 12)}...`);
      }

      // Set selected path for L3 identity
      localStorage.setItem(STORAGE_KEYS.L3_SELECTED_ADDRESS_PATH, state.newAddress.path);
      identityManager.setSelectedAddressPath(state.newAddress.path);

      // Reset IPFS service for new identity
      console.log("🔄 Resetting IpfsStorageService for new identity...");
      await IpfsStorageService.resetInstance();

      // Reset and restart NostrService with new identity
      const nostrService = NostrService.getInstance(identityManager);
      console.log("🔄 Resetting NostrService to use new identity...");
      await nostrService.reset();
      await nostrService.start();
      console.log("✅ NostrService reconnected with new identity");

      // Mint nametag
      const mintResult = await nametagService.mintNametagAndPublish(cleanTag);

      if (mintResult.status === 'error') {
        // Check if the error is because nametag already exists (interrupted flow recovery)
        if (mintResult.message?.includes('Identity already has a nametag')) {
          console.log(`ℹ️ Nametag already exists - continuing with sync...`);
          // Extract existing nametag name from error message if different from requested
          const existingMatch = mintResult.message.match(/nametag: (\S+)/);
          const existingNametag = existingMatch?.[1];
          if (existingNametag && existingNametag !== cleanTag) {
            console.log(`⚠️ Existing nametag "${existingNametag}" differs from requested "${cleanTag}"`);
          }
        } else {
          throw new Error(mintResult.message);
        }
      } else {
        console.log(`✅ Nametag minted: @${cleanTag}`);
      }

      // Wait for localStorage write to flush
      setProgress("Preparing to sync...");
      await new Promise(resolve => setTimeout(resolve, 300));

      // Step 2: Sync to IPFS
      setStep('syncing_ipfs', 'Syncing to IPFS storage...');

      const ipfsService = IpfsStorageService.getInstance(identityManager);
      const syncResult = await ipfsService.syncNow();

      console.log("📦 IPFS sync result:", {
        success: syncResult.success,
        cid: syncResult.cid,
        ipnsPublished: syncResult.ipnsPublished,
        error: syncResult.error
      });

      if (!syncResult.success) {
        console.error("❌ IPFS sync failed:", syncResult.error);
        throw new Error(
          `Failed to sync your Unicity ID to decentralized storage. ${syncResult.error || "Unknown error"}.`
        );
      }

      // Step 3: Verify in IPNS
      if (syncResult.ipnsPublished) {
        setStep('verifying_ipns', 'Verifying IPFS availability...');

        const verified = await verifyNametagInIpnsWithRetry(
          state.newAddress.privateKey,
          cleanTag,
          60000,
          (status) => setProgress(status)
        );

        if (!verified) {
          console.warn("⚠️ IPNS verification failed after 60s - continuing anyway");
        } else {
          console.log(`✅ Verified nametag "${cleanTag}" available via IPNS`);
        }
      }

      // Step 4: Complete
      setStep('complete', 'Address created successfully!');

      // Clear flag
      localStorage.removeItem(STORAGE_KEYS.ADDRESS_CREATION_IN_PROGRESS);

      // Dispatch events to trigger UI updates
      console.log('📢 Dispatching wallet events...');
      window.dispatchEvent(new Event("wallet-loaded"));
      window.dispatchEvent(new Event("wallet-updated"));

      // Invalidate queries to refresh UI
      await queryClient.invalidateQueries({ queryKey: KEYS.IDENTITY });
      await queryClient.invalidateQueries({ queryKey: KEYS.NAMETAG });
      await queryClient.invalidateQueries({ queryKey: KEYS.TOKENS });
      await queryClient.invalidateQueries({ queryKey: L1_KEYS.WALLET });

      console.log(`🎉 Address creation complete: @${cleanTag}`);

    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create nametag";
      console.error("submitNametag error:", err);

      // Clear flag on error
      localStorage.removeItem(STORAGE_KEYS.ADDRESS_CREATION_IN_PROGRESS);

      // Rollback changes on error
      rollback();

      setError(message);
    }
  }, [state.newAddress, identityManager, nametagService, queryClient, setStep, setProgress, setError]);

  return {
    state,
    startCreateAddress,
    setExistingAddress,
    submitNametag,
    reset,
    isNametagAvailable,
  };
}
