/**
 * useCreateAddress - Hook for creating new wallet addresses without page reload
 *
 * This hook handles:
 * 1. Deriving new unified address (L1 + L3) using WalletCore
 * 2. Minting nametag on blockchain
 * 3. Syncing to IPFS/IPNS with verification (same as onboarding)
 * 4. Updating TanStack Query cache
 *
 * No page reload required - uses TanStack Query invalidation for UI updates.
 */
import { useState, useCallback, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { UnifiedKeyManager } from '../services/UnifiedKeyManager';
import { WalletRepository } from '../../../../repositories/WalletRepository';
import { IdentityManager } from '../../L3/services/IdentityManager';
import { NametagService } from '../../L3/services/NametagService';
import { NostrService } from '../../L3/services/NostrService';
import { IpfsStorageService } from '../../L3/services/IpfsStorageService';
import { fetchNametagFromIpns } from '../../L3/services/IpnsNametagFetcher';
import { KEYS } from '../../L3/hooks/useWallet';
import { L1_KEYS } from '../../L1/hooks/useL1Wallet';
import { STORAGE_KEYS } from '../../../../config/storageKeys';
import {
  deriveUnifiedAddress,
  getAddressPath,
} from '../../sdk';
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
  } | null;
  progress: string;
}

export interface UseCreateAddressReturn {
  state: CreateAddressState;
  startCreateAddress: () => Promise<void>;
  submitNametag: (nametag: string) => Promise<void>;
  reset: () => void;
  isNametagAvailable: (nametag: string) => Promise<boolean>;
}

/**
 * Verify nametag is available via IPNS with retry
 * Same logic as in useOnboardingFlow for consistency
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
      const remaining = Math.ceil((timeoutMs - (Date.now() - startTime)) / 1000);

      onStatusUpdate?.(`Verifying IPNS... (${elapsed}s / ${Math.floor(timeoutMs / 1000)}s)`);

      console.log(`🔄 IPNS verification attempt #${attemptCount} for "${expectedNametag}" (${elapsed}s elapsed, ${remaining}s remaining)...`);

      const result = await fetchNametagFromIpns(privateKey);

      console.log(`🔄 IPNS result:`, {
        nametag: result.nametag,
        expected: expectedNametag,
        source: result.source,
        hasData: !!result.nametagData
      });

      if (result.nametag === expectedNametag && result.source === "http" && result.nametagData) {
        successCount++;
        onStatusUpdate?.(`Verifying IPNS... (${successCount}/${REQUIRED_SUCCESS_COUNT} confirmations)`);
        console.log(`✅ IPNS read successful (${successCount}/${REQUIRED_SUCCESS_COUNT})`);

        if (successCount >= REQUIRED_SUCCESS_COUNT) {
          console.log(`✅ IPNS verified with ${REQUIRED_SUCCESS_COUNT} consecutive reads`);
          onStatusUpdate?.(`IPNS verified successfully!`);
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
      return "Your Unicity ID is being synced. Closing now may prevent recovery on other devices.";
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
   * Step 1: Derive new address using WalletCore
   */
  const startCreateAddress = useCallback(async () => {
    try {
      setStep('deriving', 'Generating new address...');

      const keyManager = UnifiedKeyManager.getInstance(SESSION_KEY);
      const masterKey = keyManager.getMasterKeyHex();
      const chainCode = keyManager.getChainCodeHex();
      const basePath = keyManager.getBasePath();
      const mode = keyManager.getDerivationMode();

      if (!masterKey) {
        throw new Error("Wallet not initialized");
      }

      // Load current L1 wallet to find next index
      const currentWallet = loadWalletFromStorage("main");
      if (!currentWallet) {
        throw new Error("L1 wallet not found");
      }

      // Find next address index (count existing external addresses)
      const nextIndex = currentWallet.addresses.filter(a => !a.isChange).length;

      // Derive unified address using WalletCore
      const path = getAddressPath(nextIndex, false, basePath);
      const unified = await deriveUnifiedAddress(masterKey, chainCode, path, mode);

      console.log(`✅ New address derived: L1=${unified.l1Address.slice(0, 12)}... L3=${unified.l3Address.slice(0, 12)}... path=${path}`);

      // DON'T save to L1 wallet yet - only after nametag is minted successfully
      // This prevents orphan addresses without nametags

      setState(prev => ({
        ...prev,
        step: 'nametag_input',
        progress: '',
        newAddress: {
          l1Address: unified.l1Address,
          l3Address: unified.l3Address,
          path: path,
          index: nextIndex,
          privateKey: unified.privateKey,
        },
      }));

    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create address";
      console.error("createAddress error:", err);
      setError(message);
    }
  }, [setStep, setError]);

  /**
   * Check if nametag is available
   */
  const isNametagAvailable = useCallback(async (nametag: string): Promise<boolean> => {
    return await nametagService.isNametagAvailable(nametag);
  }, [nametagService]);

  /**
   * Step 2: Submit nametag, mint on blockchain, sync to IPFS
   * Logic matches useOnboardingFlow.handleMintNametag
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

      // Reset WalletRepository to reload original wallet
      WalletRepository.getInstance().resetInMemoryState();
      console.log("  ✓ Reset WalletRepository");
    };

    try {
      // Set onboarding flag to prevent auto-sync from interfering with our sync
      // IpfsStorageService.scheduleSync() checks this flag and skips if set
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

      // First, save the address to L1 wallet and switch to it
      if (!originalL1Wallet) {
        throw new Error("L1 wallet not found");
      }

      const newWalletAddress = {
        index: state.newAddress.index,
        address: state.newAddress.l1Address,
        privateKey: state.newAddress.privateKey,
        publicKey: '', // Will be derived if needed
        path: state.newAddress.path,
        isChange: false,
        createdAt: new Date().toISOString(),
      };

      const updatedWallet: L1Wallet = {
        ...originalL1Wallet,
        addresses: [...originalL1Wallet.addresses, newWalletAddress],
      };

      // Save updated L1 wallet
      saveWalletToStorage("main", updatedWallet);
      walletModified = true; // Mark that we've modified state (rollback needed on error)
      console.log(`💾 Saved new address to L1 wallet: ${state.newAddress.l1Address.slice(0, 12)}...`);

      // Set selected path for L3 identity
      localStorage.setItem(STORAGE_KEYS.L3_SELECTED_ADDRESS_PATH, state.newAddress.path);

      // Update identity manager to use new path
      identityManager.setSelectedAddressPath(state.newAddress.path);

      // Reset WalletRepository to force reload with new address
      // Use silent=true to prevent wallet-updated event during address creation
      const walletRepo = WalletRepository.getInstance();
      walletRepo.resetInMemoryState(true);

      // Get new identity (derived from the new path)
      const identity = await identityManager.getCurrentIdentity();
      if (!identity) {
        throw new Error("Identity not found after address creation");
      }

      // Create wallet for new identity - this is a NEW address so no wallet should exist yet
      // The createWallet will create a fresh wallet with no nametag
      // Use silent=true to prevent events that would trigger useWallet re-renders
      walletRepo.createWallet(identity.address, "My Wallet", true);

      console.log(`✅ Created fresh wallet for new identity: ${identity.address.slice(0, 20)}...`);

      // CRITICAL: Reset and restart NostrService with new identity BEFORE minting
      // NostrService is a singleton that may still be connected with OLD identity's keypair.
      // NametagService.mintNametagAndPublish() calls nostr.start() which does nothing if already connected.
      // This causes the nametag to be published with wrong keypair, and faucet tokens won't arrive.
      const nostrService = NostrService.getInstance(identityManager);
      console.log("🔄 Resetting NostrService to use new identity...");
      await nostrService.reset();
      await nostrService.start();
      console.log("✅ NostrService reconnected with new identity");

      // Mint nametag - now safe because wallet has no nametag AND NostrService uses correct identity
      const mintResult = await nametagService.mintNametagAndPublish(cleanTag);

      if (mintResult.status === 'error') {
        throw new Error(mintResult.message);
      }

      console.log(`✅ Nametag minted: @${cleanTag}`);

      // Wait for localStorage write to flush
      setProgress("Preparing to sync...");
      await new Promise(resolve => setTimeout(resolve, 300));

      // Verify nametag is loaded in WalletRepository
      const wallet = walletRepo.loadWalletForAddress(identity.address);
      if (!wallet) {
        throw new Error("Wallet not found after minting");
      }
      const mintedNametag = walletRepo.getNametag();
      if (!mintedNametag || mintedNametag.name !== cleanTag) {
        throw new Error(`Nametag not loaded correctly. Expected "${cleanTag}", got "${mintedNametag?.name || "none"}"`);
      }
      console.log(`✅ Nametag loaded in WalletRepository: ${mintedNametag.name}`);

      // Step 2: Sync to IPFS (CRITICAL - prevents loss on import)
      setStep('syncing_ipfs', 'Syncing to IPFS storage...');
      await new Promise(resolve => setTimeout(resolve, 100));

      console.log("🔄 Starting IPFS sync with new nametag...");

      // Helper to wait for ongoing sync to complete
      const waitForSyncCompletion = (): Promise<void> => {
        return new Promise((resolve) => {
          const timeout = setTimeout(() => {
            console.warn(`⏰ Sync wait timed out after 60s`);
            window.removeEventListener("ipfs-storage-event", handler);
            resolve();
          }, 60000);

          const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (detail?.type === "storage:completed" || detail?.type === "storage:error") {
              clearTimeout(timeout);
              window.removeEventListener("ipfs-storage-event", handler);
              resolve();
            }
          };

          window.addEventListener("ipfs-storage-event", handler);
        });
      };

      // Check if a sync is already in progress (for old identity)
      let ipfsService = IpfsStorageService.getInstance(identityManager);
      let syncResult = await ipfsService.syncNow();

      // If sync is already in progress, wait for it to complete
      if (!syncResult.success && syncResult.error === "Sync already in progress") {
        console.log("⏳ Sync already in progress (old identity), waiting for completion...");
        setProgress("Waiting for previous sync to complete...");
        await waitForSyncCompletion();

        // Reset IPFS service instance so it re-initializes with new identity
        console.log("🔄 Resetting IPFS service for new identity...");
        await IpfsStorageService.resetInstance();

        // Get fresh instance and sync again
        ipfsService = IpfsStorageService.getInstance(identityManager);
        syncResult = await ipfsService.syncNow();
      }

      // Handle "Another tab is syncing" - also wait and retry
      if (!syncResult.success && syncResult.error === "Another tab is syncing") {
        console.log("⏳ Another tab is syncing, waiting...");
        setProgress("Waiting for other tab to finish sync...");
        await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5s
        syncResult = await ipfsService.syncNow();
      }

      console.log("📦 IPFS sync result:", {
        success: syncResult.success,
        cid: syncResult.cid,
        ipnsName: syncResult.ipnsName,
        ipnsPublished: syncResult.ipnsPublished,
        ipnsPublishPending: syncResult.ipnsPublishPending,
        tokenCount: syncResult.tokenCount,
        error: syncResult.error
      });

      if (!syncResult.success) {
        console.error("❌ IPFS sync failed:", syncResult.error);
        throw new Error(
          `Failed to sync your Unicity ID to decentralized storage. ${syncResult.error || "Unknown error"}. Your ID is saved locally but may not be recoverable on other devices.`
        );
      }

      if (syncResult.ipnsPublishPending) {
        console.error("❌ IPNS publish failed, marked as pending");
        throw new Error(
          `Your Unicity ID was saved to IPFS but IPNS publish failed. It may not be immediately recoverable on other devices.`
        );
      }

      console.log("✅ IPFS sync completed, IPNS published:", syncResult.ipnsPublished);

      if (!syncResult.ipnsPublished) {
        console.error("❌ IPNS was not published during sync");
        throw new Error(
          `Your Unicity ID was saved to IPFS but was not published to IPNS. This means it won't be recoverable on other devices.`
        );
      }

      // Step 3: Verify in IPNS (CRITICAL - ensure recovery works)
      setStep('verifying_ipns', 'Verifying IPFS availability...');

      console.log("🔍 Starting IPNS verification for nametag:", cleanTag);

      const verified = await verifyNametagInIpnsWithRetry(
        identity.privateKey,
        cleanTag,
        60000,
        (status) => setProgress(status)
      );

      console.log("🔍 IPNS verification result:", verified);

      if (!verified) {
        console.error("❌ IPNS verification failed after 60s");
        throw new Error(
          `Your Unicity ID was saved but could not be verified in decentralized storage after 60 seconds. This may be due to network issues. Your ID is saved locally.`
        );
      }

      console.log(`✅ Verified nametag "${cleanTag}" available via IPNS`);

      // Step 4: Complete - update TanStack Query cache
      setStep('complete', 'Address created successfully!');

      // Clear onboarding flag - address creation complete, auto-sync can resume
      localStorage.removeItem(STORAGE_KEYS.ADDRESS_CREATION_IN_PROGRESS);

      // Dispatch wallet-loaded event - this triggers:
      // 1. ServicesProvider: NostrService.reset() + NostrService.start() with new identity
      // 2. TanStack Query cache invalidation in useWallet
      // Same approach as onboarding flow (handleCompleteOnboarding)
      console.log('📢 Dispatching wallet-loaded event...');
      window.dispatchEvent(new Event("wallet-loaded"));
      console.log('📢 Dispatching wallet-updated event...');
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

      // Clear onboarding flag on error too
      localStorage.removeItem(STORAGE_KEYS.ADDRESS_CREATION_IN_PROGRESS);

      // CRITICAL: Rollback changes on error to restore original wallet state
      // This prevents the user from being stuck with a new address without nametag
      rollback();

      setError(message);
    }
  }, [state.newAddress, identityManager, nametagService, queryClient, setStep, setProgress, setError]);

  return {
    state,
    startCreateAddress,
    submitNametag,
    reset,
    isNametagAvailable,
  };
}
