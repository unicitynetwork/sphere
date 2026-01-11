import { useState, useMemo } from 'react';
import { ChevronDown, Plus, Loader2, Check, Copy } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useL1Wallet } from '../../L1/hooks/useL1Wallet';
import { useAddressNametags } from '../../L1/hooks/useAddressNametags';
import { generateAddress, loadWalletFromStorage } from '../../L1/sdk';
import { WalletRepository } from '../../../../repositories/WalletRepository';
import { STORAGE_KEYS } from '../../../../config/storageKeys';

interface AddressSelectorProps {
  /** Current nametag to display when collapsed */
  currentNametag?: string;
  /** Compact mode - just show nametag with small dropdown trigger */
  compact?: boolean;
}

export function AddressSelector({ currentNametag, compact = true }: AddressSelectorProps) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  const { wallet, invalidateWallet } = useL1Wallet();
  const { nametagState, addressesWithNametags } = useAddressNametags(wallet?.addresses);

  // Check if any address is still loading nametag from IPNS
  const isAnyAddressLoading = useMemo(() => {
    return addressesWithNametags.some(addr => addr.ipnsLoading);
  }, [addressesWithNametags]);

  // Get current selected path from localStorage
  const selectedPath = localStorage.getItem(STORAGE_KEYS.L3_SELECTED_ADDRESS_PATH);

  // Find current address info
  const currentAddress = useMemo(() => {
    if (!wallet?.addresses) return null;
    if (selectedPath) {
      return wallet.addresses.find(a => a.path === selectedPath) || wallet.addresses[0];
    }
    return wallet.addresses[0];
  }, [wallet?.addresses, selectedPath]);

  // Sort addresses: external first (by index), then change (by index)
  const sortedAddresses = useMemo(() => {
    if (!wallet?.addresses) return [];
    return [...wallet.addresses].sort((a, b) => {
      const aIsChange = a.isChange ? 1 : 0;
      const bIsChange = b.isChange ? 1 : 0;
      if (aIsChange !== bIsChange) return aIsChange - bIsChange;
      return (a.index ?? 0) - (b.index ?? 0);
    });
  }, [wallet?.addresses]);

  const handleSelectAddress = (address: string) => {
    const selectedAddr = wallet?.addresses.find(a => a.address === address);
    if (selectedAddr?.path) {
      localStorage.setItem(STORAGE_KEYS.L3_SELECTED_ADDRESS_PATH, selectedAddr.path);
    } else {
      localStorage.removeItem(STORAGE_KEYS.L3_SELECTED_ADDRESS_PATH);
    }
    WalletRepository.getInstance().resetInMemoryState();
    setShowDropdown(false);
    window.location.reload();
  };

  const handleNewAddress = async () => {
    if (!wallet || isGenerating || isAnyAddressLoading) return;
    setIsGenerating(true);

    try {
      const addr = generateAddress(wallet);
      const updated = loadWalletFromStorage("main");

      if (updated && addr.path) {
        invalidateWallet();
        localStorage.setItem(STORAGE_KEYS.L3_SELECTED_ADDRESS_PATH, addr.path);
        WalletRepository.getInstance().resetInMemoryState();
        setShowDropdown(false);
        window.location.reload();
      }
    } catch (err) {
      console.error('Failed to generate address:', err);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopyNametag = async () => {
    if (!currentNametag) return;
    try {
      await navigator.clipboard.writeText(`@${currentNametag}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy nametag:', err);
    }
  };

  // Get display info for current address
  const currentNametagInfo = currentAddress ? nametagState[currentAddress.address] : null;
  const displayNametag = currentNametag || currentNametagInfo?.nametag;
  const isLoading = currentNametagInfo?.ipnsLoading;

  if (!wallet?.addresses || wallet.addresses.length === 0) {
    return null;
  }

  if (compact) {
    return (
      <div className="relative">
        <div className="flex items-center gap-1.5">
          {/* Nametag display with dropdown trigger */}
          <button
            onClick={() => setShowDropdown(prev => !prev)}
            className="flex items-center gap-1 text-[10px] sm:text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 transition-colors"
          >
            {isLoading ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : displayNametag ? (
              <span className="font-medium">@{displayNametag}</span>
            ) : (
              <span className="font-mono">{currentAddress?.address.slice(0, 8)}...</span>
            )}
            <ChevronDown className={`w-3 h-3 transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
          </button>

          {/* Copy button */}
          {displayNametag && (
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              onClick={handleCopyNametag}
              className="p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800/80 rounded transition-colors"
              title="Copy nametag"
            >
              {copied ? (
                <Check className="w-3 h-3 text-emerald-500" />
              ) : (
                <Copy className="w-3 h-3 text-neutral-500" />
              )}
            </motion.button>
          )}
        </div>

        {/* Dropdown */}
        <AnimatePresence>
          {showDropdown && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-40 bg-black/10"
                onClick={() => setShowDropdown(false)}
              />
              <motion.div
                initial={{ opacity: 0, y: -10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.95 }}
                transition={{ duration: 0.15 }}
                className="absolute left-0 top-full mt-2 z-50 min-w-[280px] bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl shadow-xl overflow-hidden"
              >
                {/* Header */}
                <div className="px-3 py-2 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400 flex items-center gap-1.5">
                    {isAnyAddressLoading && (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    )}
                    {isAnyAddressLoading ? 'Checking nametags...' : `Addresses (${sortedAddresses.length})`}
                  </span>
                  <motion.button
                    whileHover={{ scale: (isGenerating || isAnyAddressLoading) ? 1 : 1.05 }}
                    whileTap={{ scale: (isGenerating || isAnyAddressLoading) ? 1 : 0.95 }}
                    onClick={handleNewAddress}
                    disabled={isGenerating || isAnyAddressLoading}
                    className="flex items-center gap-1 px-2 py-1 text-xs bg-orange-500/10 hover:bg-orange-500/20 text-orange-600 dark:text-orange-400 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                    title={isAnyAddressLoading ? 'Wait for nametag check to complete' : 'Create new address'}
                  >
                    {isGenerating ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Plus className="w-3 h-3" />
                    )}
                    <span>New</span>
                  </motion.button>
                </div>

                {/* Address list */}
                <div className="max-h-64 overflow-y-auto custom-scrollbar">
                  {sortedAddresses.map((addr) => {
                    const nametagInfo = nametagState[addr.address];
                    const isSelected = addr.address === currentAddress?.address;
                    const isChange = addr.isChange;

                    return (
                      <button
                        key={addr.address}
                        onClick={() => handleSelectAddress(addr.address)}
                        className={`w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors ${
                          isSelected ? 'bg-orange-50 dark:bg-orange-900/20' : ''
                        }`}
                      >
                        {/* Selection indicator */}
                        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${isSelected ? 'bg-orange-500' : 'bg-transparent'}`} />

                        {/* Address info */}
                        <div className="flex-1 min-w-0">
                          {!nametagInfo || nametagInfo.ipnsLoading ? (
                            <div className="flex items-center gap-1.5">
                              <Loader2 className="w-3 h-3 animate-spin text-neutral-400" />
                              <span className="text-xs font-mono text-neutral-600 dark:text-neutral-400 truncate">
                                {addr.address.slice(0, 12)}...{addr.address.slice(-6)}
                              </span>
                            </div>
                          ) : nametagInfo.nametag ? (
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
                                @{nametagInfo.nametag}
                              </span>
                              <span className="text-xs font-mono text-neutral-400 dark:text-neutral-500">
                                ({addr.address.slice(0, 8)}...{addr.address.slice(-6)})
                              </span>
                            </div>
                          ) : nametagInfo.hasL3Inventory ? (
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-mono text-neutral-700 dark:text-neutral-300 truncate">
                                {addr.address.slice(0, 12)}...{addr.address.slice(-6)}
                              </span>
                              <span className="px-1 py-0.5 bg-purple-500/20 text-purple-600 dark:text-purple-400 text-[9px] font-bold rounded shrink-0">
                                L3
                              </span>
                            </div>
                          ) : (
                            <span className="text-xs font-mono text-neutral-600 dark:text-neutral-400 truncate">
                              {addr.address.slice(0, 12)}...{addr.address.slice(-6)}
                            </span>
                          )}
                        </div>

                        {/* Change badge */}
                        {isChange && (
                          <span className="px-1.5 py-0.5 bg-amber-500/20 text-amber-600 dark:text-amber-400 text-[9px] font-bold rounded shrink-0">
                            Change
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>
    );
  }

  // Full mode (not used currently, but available for future)
  return (
    <div className="relative">
      <button
        onClick={() => setShowDropdown(prev => !prev)}
        className="flex items-center gap-2 px-3 py-2 bg-neutral-100 dark:bg-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-200/50 dark:hover:bg-neutral-700/50 transition-colors"
      >
        {isLoading ? (
          <Loader2 className="w-4 h-4 animate-spin text-neutral-400" />
        ) : displayNametag ? (
          <span className="text-sm font-medium text-blue-600 dark:text-blue-400">@{displayNametag}</span>
        ) : (
          <span className="text-sm font-mono text-neutral-700 dark:text-neutral-300">
            {currentAddress?.address.slice(0, 8)}...{currentAddress?.address.slice(-6)}
          </span>
        )}
        <ChevronDown className={`w-4 h-4 text-neutral-500 transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
      </button>

      {/* Same dropdown as compact mode */}
      <AnimatePresence>
        {showDropdown && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40"
              onClick={() => setShowDropdown(false)}
            />
            <motion.div
              initial={{ opacity: 0, y: -10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              className="absolute left-0 top-full mt-2 z-50 min-w-[300px] bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl shadow-xl overflow-hidden"
            >
              <div className="px-3 py-2 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
                <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
                  Select Address
                </span>
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={handleNewAddress}
                  disabled={isGenerating}
                  className="flex items-center gap-1 px-2 py-1 text-xs bg-orange-500/10 hover:bg-orange-500/20 text-orange-600 dark:text-orange-400 rounded-lg transition-colors disabled:opacity-50"
                >
                  {isGenerating ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Plus className="w-3 h-3" />
                  )}
                  <span>New Address</span>
                </motion.button>
              </div>

              <div className="max-h-64 overflow-y-auto custom-scrollbar">
                {sortedAddresses.map((addr) => {
                  const nametagInfo = nametagState[addr.address];
                  const isSelected = addr.address === currentAddress?.address;

                  return (
                    <button
                      key={addr.address}
                      onClick={() => handleSelectAddress(addr.address)}
                      className={`w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors ${
                        isSelected ? 'bg-orange-50 dark:bg-orange-900/20' : ''
                      }`}
                    >
                      <div className={`w-2 h-2 rounded-full shrink-0 ${isSelected ? 'bg-orange-500' : 'bg-transparent'}`} />
                      <div className="flex-1 min-w-0">
                        {nametagInfo?.nametag ? (
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-blue-600 dark:text-blue-400">
                              @{nametagInfo.nametag}
                            </span>
                            <span className="text-xs font-mono text-neutral-400">
                              {addr.address.slice(0, 6)}...
                            </span>
                          </div>
                        ) : (
                          <span className="text-sm font-mono text-neutral-700 dark:text-neutral-300 truncate">
                            {addr.address}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
