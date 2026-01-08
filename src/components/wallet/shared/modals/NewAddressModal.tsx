/**
 * NewAddressModal - Modal for creating a new address with optional nametag registration
 */
import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Plus, Loader2, Check, ShieldCheck, ArrowRight } from 'lucide-react';
import { useWallet } from '../../L3/hooks/useWallet';
import { IpfsStorageService } from '../../L3/services/IpfsStorageService';
import { IdentityManager } from '../../L3/services/IdentityManager';
import { fetchNametagFromIpns } from '../../L3/services/IpnsNametagFetcher';
import { WalletRepository } from '../../../../repositories/WalletRepository';
import { generateAddress, loadWalletFromStorage } from '../../L1/sdk';
import { STORAGE_KEYS } from '../../../../config/storageKeys';
import type { Wallet } from '../../L1/sdk';

type Step = 'confirm' | 'nametag' | 'processing' | 'success';

interface NewAddressModalProps {
  isOpen: boolean;
  onClose: () => void;
  wallet: Wallet;
  onSuccess: () => void;
}

const SESSION_KEY = "user-pin-1234";
const identityManager = IdentityManager.getInstance(SESSION_KEY);

export function NewAddressModal({ isOpen, onClose, wallet, onSuccess }: NewAddressModalProps) {
  const { mintNametag, checkNametagAvailability } = useWallet();

  const [step, setStep] = useState<Step>('confirm');
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nametagInput, setNametagInput] = useState('');
  const [processingStatus, setProcessingStatus] = useState('');
  const [newAddressPath, setNewAddressPath] = useState<string | null>(null);
  const [existingNametag, setExistingNametag] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStep('confirm');
    setIsBusy(false);
    setError(null);
    setNametagInput('');
    setProcessingStatus('');
    setNewAddressPath(null);
    setExistingNametag(null);
  }, []);

  const handleClose = useCallback(() => {
    if (isBusy) return;
    reset();
    onClose();
  }, [isBusy, reset, onClose]);

  // Step 1: Generate new address and check for existing nametag
  const handleCreateAddress = useCallback(async () => {
    if (!wallet || isBusy) return;

    setIsBusy(true);
    setError(null);

    try {
      // Generate new L1 address
      const addr = generateAddress(wallet);
      const updated = loadWalletFromStorage("main");

      if (!updated || !addr.path) {
        throw new Error("Failed to generate address");
      }

      setNewAddressPath(addr.path);

      // Derive L3 identity for the new address
      const l3Identity = await identityManager.deriveIdentityFromPath(addr.path);

      // Check if there's an existing nametag in local storage
      const localNametag = WalletRepository.checkNametagForAddress(l3Identity.address);
      if (localNametag) {
        console.log(`Found existing local nametag: ${localNametag.name}`);
        setExistingNametag(localNametag.name);
        setStep('success');
        setIsBusy(false);
        return;
      }

      // Check IPNS for existing nametag
      setProcessingStatus('Checking for existing Unicity ID...');
      try {
        const ipnsResult = await fetchNametagFromIpns(l3Identity.privateKey);
        if (ipnsResult.nametag && ipnsResult.nametagData) {
          console.log(`Found existing IPNS nametag: ${ipnsResult.nametag}`);
          // Save to local storage
          WalletRepository.saveNametagForAddress(l3Identity.address, {
            name: ipnsResult.nametagData.name,
            token: ipnsResult.nametagData.token,
            timestamp: ipnsResult.nametagData.timestamp || Date.now(),
            format: ipnsResult.nametagData.format || "TXF",
            version: "1.0",
          });
          setExistingNametag(ipnsResult.nametag);
          setStep('success');
          setIsBusy(false);
          return;
        }
      } catch (err) {
        console.warn("IPNS check failed, proceeding to nametag creation:", err);
      }

      // No existing nametag found, go to nametag creation step
      setProcessingStatus('');
      setStep('nametag');
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to generate address";
      setError(message);
    } finally {
      setIsBusy(false);
    }
  }, [wallet, isBusy]);

  // Step 2: Mint new nametag
  const handleMintNametag = useCallback(async () => {
    if (!nametagInput.trim() || !newAddressPath) return;

    setIsBusy(true);
    setError(null);

    try {
      const cleanTag = nametagInput.trim().replace("@", "");

      // Check availability
      const isAvailable = await checkNametagAvailability(cleanTag);
      if (!isAvailable) {
        setError(`@${cleanTag} is already taken`);
        setIsBusy(false);
        return;
      }

      setStep('processing');

      // Set the new address as selected BEFORE minting
      localStorage.setItem(STORAGE_KEYS.L3_SELECTED_ADDRESS_PATH, newAddressPath);
      identityManager.setSelectedAddressPath(newAddressPath);

      // Reset IPFS service to use new identity
      await IpfsStorageService.resetInstance();
      WalletRepository.getInstance().resetInMemoryState();

      // Re-derive identity for the new path (important for minting)
      await identityManager.deriveIdentityFromPath(newAddressPath);

      // Mint nametag
      setProcessingStatus('Minting Unicity ID on blockchain...');
      await mintNametag(cleanTag);
      console.log("Nametag minted successfully");

      // Sync to IPFS
      setProcessingStatus('Syncing to IPFS storage...');
      try {
        const ipfsService = IpfsStorageService.getInstance(identityManager);
        await ipfsService.syncNow();
        console.log("IPFS sync completed");
      } catch (syncError) {
        console.warn("IPFS sync failed, continuing:", syncError);
      }

      // Verify in IPNS
      setProcessingStatus('Verifying availability...');
      const currentIdentity = await identityManager.getCurrentIdentity();
      if (currentIdentity) {
        await verifyNametagInIpnsWithRetry(currentIdentity.privateKey, cleanTag, 15000);
      }

      setExistingNametag(cleanTag);
      setStep('success');
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to mint Unicity ID";
      setError(message);
      setStep('nametag');
    } finally {
      setIsBusy(false);
    }
  }, [nametagInput, newAddressPath, checkNametagAvailability, mintNametag]);

  // Skip nametag (create address without it)
  const handleSkipNametag = useCallback(() => {
    if (!newAddressPath) return;

    // Set the new address as selected
    localStorage.setItem(STORAGE_KEYS.L3_SELECTED_ADDRESS_PATH, newAddressPath);
    WalletRepository.getInstance().resetInMemoryState();

    setStep('success');
  }, [newAddressPath]);

  // Complete the flow
  const handleComplete = useCallback(() => {
    if (newAddressPath) {
      localStorage.setItem(STORAGE_KEYS.L3_SELECTED_ADDRESS_PATH, newAddressPath);
    }
    reset();
    onSuccess();
  }, [newAddressPath, reset, onSuccess]);

  const handleNametagChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.toLowerCase();
    if (/^[a-z0-9_\-+.]*$/.test(value)) {
      setNametagInput(value);
      setError(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && nametagInput && !isBusy) {
      handleMintNametag();
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={handleClose}
          className="absolute inset-0 bg-black/60 dark:bg-black/80 backdrop-blur-sm"
        />

        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="relative w-full max-w-sm bg-white dark:bg-[#111] border border-neutral-200 dark:border-white/10 rounded-2xl shadow-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="px-5 py-4 border-b border-neutral-200 dark:border-white/5 flex justify-between items-center">
            <h3 className="text-base font-semibold text-neutral-900 dark:text-white">
              {step === 'confirm' && 'New Address'}
              {step === 'nametag' && 'Create Unicity ID'}
              {step === 'processing' && 'Processing...'}
              {step === 'success' && 'Address Created'}
            </h3>
            <button
              onClick={handleClose}
              disabled={isBusy}
              className="p-1.5 hover:bg-neutral-100 dark:hover:bg-white/5 rounded-lg transition-colors disabled:opacity-50"
            >
              <X className="w-4 h-4 text-neutral-500" />
            </button>
          </div>

          {/* Content */}
          <div className="p-5">
            <AnimatePresence mode="wait">
              {/* Step: Confirm */}
              {step === 'confirm' && (
                <motion.div
                  key="confirm"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-4"
                >
                  <div className="flex items-center justify-center">
                    <div className="w-14 h-14 rounded-full bg-orange-500/10 flex items-center justify-center">
                      <Plus className="w-7 h-7 text-orange-500" />
                    </div>
                  </div>

                  <p className="text-sm text-neutral-600 dark:text-neutral-400 text-center">
                    Create a new address for your wallet. You can optionally register a Unicity ID for easy transfers.
                  </p>

                  {processingStatus && (
                    <div className="flex items-center justify-center gap-2 text-sm text-neutral-500">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>{processingStatus}</span>
                    </div>
                  )}

                  {error && (
                    <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                      <p className="text-sm text-red-500 dark:text-red-400">{error}</p>
                    </div>
                  )}

                  <div className="flex gap-3">
                    <button
                      onClick={handleClose}
                      disabled={isBusy}
                      className="flex-1 py-2.5 px-4 rounded-xl border border-neutral-200 dark:border-white/10 text-neutral-700 dark:text-neutral-300 text-sm font-medium hover:bg-neutral-100 dark:hover:bg-white/5 transition-colors disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleCreateAddress}
                      disabled={isBusy}
                      className="flex-1 py-2.5 px-4 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                    >
                      {isBusy ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <>
                          <Plus className="w-4 h-4" />
                          Create
                        </>
                      )}
                    </button>
                  </div>
                </motion.div>
              )}

              {/* Step: Nametag */}
              {step === 'nametag' && (
                <motion.div
                  key="nametag"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-4"
                >
                  <div className="flex items-center justify-center">
                    <div className="w-14 h-14 rounded-full bg-emerald-500/20 flex items-center justify-center">
                      <ShieldCheck className="w-7 h-7 text-emerald-500" />
                    </div>
                  </div>

                  <p className="text-sm text-neutral-600 dark:text-neutral-400 text-center">
                    Choose a unique <span className="text-orange-500 font-semibold">Unicity ID</span> to receive tokens without long addresses.
                  </p>

                  {/* Input Field */}
                  <div className="relative group">
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 dark:text-neutral-500 group-focus-within:text-orange-500 transition-colors z-10 text-xs font-medium">
                      @unicity
                    </div>
                    <input
                      type="text"
                      value={nametagInput}
                      onChange={handleNametagChange}
                      onKeyDown={handleKeyDown}
                      placeholder="id"
                      className="w-full bg-neutral-100 dark:bg-neutral-800/50 border-2 border-neutral-200 dark:border-neutral-700/50 rounded-xl py-2.5 pl-3 pr-20 text-sm text-neutral-900 dark:text-white placeholder-neutral-400 dark:placeholder-neutral-600 focus:outline-none focus:border-orange-500 focus:bg-white dark:focus:bg-neutral-800 transition-all"
                      autoFocus
                    />
                  </div>

                  {error && (
                    <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                      <p className="text-sm text-red-500 dark:text-red-400">{error}</p>
                    </div>
                  )}

                  <div className="flex gap-3">
                    <button
                      onClick={handleSkipNametag}
                      disabled={isBusy}
                      className="flex-1 py-2.5 px-4 rounded-xl border border-neutral-200 dark:border-white/10 text-neutral-700 dark:text-neutral-300 text-sm font-medium hover:bg-neutral-100 dark:hover:bg-white/5 transition-colors disabled:opacity-50"
                    >
                      Skip
                    </button>
                    <button
                      onClick={handleMintNametag}
                      disabled={!nametagInput || isBusy}
                      className="flex-1 py-2.5 px-4 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isBusy ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <>
                          Continue
                          <ArrowRight className="w-4 h-4" />
                        </>
                      )}
                    </button>
                  </div>
                </motion.div>
              )}

              {/* Step: Processing */}
              {step === 'processing' && (
                <motion.div
                  key="processing"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="py-8 text-center space-y-4"
                >
                  <div className="relative w-16 h-16 mx-auto">
                    <div className="absolute inset-0 border-4 border-neutral-200 dark:border-neutral-700 rounded-full" />
                    <div className="absolute inset-0 border-4 border-orange-500 rounded-full border-t-transparent animate-spin" />
                  </div>

                  <p className="text-sm text-neutral-600 dark:text-neutral-400">
                    {processingStatus || 'Processing...'}
                  </p>
                </motion.div>
              )}

              {/* Step: Success */}
              {step === 'success' && (
                <motion.div
                  key="success"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-4"
                >
                  <div className="flex items-center justify-center">
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: "spring", stiffness: 200, damping: 15 }}
                      className="w-14 h-14 rounded-full bg-emerald-500/20 flex items-center justify-center"
                    >
                      <Check className="w-7 h-7 text-emerald-500" />
                    </motion.div>
                  </div>

                  <div className="text-center space-y-1">
                    <p className="text-sm font-medium text-neutral-900 dark:text-white">
                      Address created successfully!
                    </p>
                    {existingNametag && (
                      <p className="text-sm text-orange-500 font-medium">
                        @{existingNametag}
                      </p>
                    )}
                  </div>

                  <button
                    onClick={handleComplete}
                    className="w-full py-2.5 px-4 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium flex items-center justify-center gap-2 transition-colors"
                  >
                    <Check className="w-4 h-4" />
                    Done
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

// Helper function
async function verifyNametagInIpnsWithRetry(
  privateKey: string,
  expectedNametag: string,
  timeoutMs: number = 15000
): Promise<boolean> {
  const startTime = Date.now();
  const retryInterval = 3000;

  while (Date.now() - startTime < timeoutMs) {
    try {
      const result = await fetchNametagFromIpns(privateKey);
      if (result.nametag === expectedNametag) {
        return true;
      }
    } catch {
      // Continue retrying
    }

    const remainingTime = timeoutMs - (Date.now() - startTime);
    if (remainingTime > retryInterval) {
      await new Promise((resolve) => setTimeout(resolve, retryInterval));
    }
  }

  return false;
}
