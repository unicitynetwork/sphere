import { useState, useMemo, useEffect, useCallback } from 'react';
import { ChevronDown, Plus, Loader2, Check, Copy } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useIdentity } from '../../../../sdk';
import { useSphereContext } from '../../../../sdk/hooks/core/useSphere';
import { SPHERE_KEYS } from '../../../../sdk/queryKeys';
import { useQueryClient } from '@tanstack/react-query';

/** Truncate long nametags: show first 6 chars + ... + last 3 chars */
function truncateNametag(nametag: string, maxLength: number = 12): string {
  if (nametag.length <= maxLength) return nametag;
  return `${nametag.slice(0, 6)}...${nametag.slice(-3)}`;
}

interface DerivedAddr {
  index: number;
  l1Address: string;
  path: string;
  publicKey: string;
  nametag?: string;
  isChange?: boolean;
}

interface AddressSelectorProps {
  /** Current nametag to display when collapsed */
  currentNametag?: string;
  /** Compact mode - just show nametag with small dropdown trigger */
  compact?: boolean;
}

export function AddressSelector({ currentNametag, compact = true }: AddressSelectorProps) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [copied, setCopied] = useState(false);
  const [addresses, setAddresses] = useState<DerivedAddr[]>([]);
  const [isSwitching, setIsSwitching] = useState(false);

  const { sphere } = useSphereContext();
  const { l1Address, nametag } = useIdentity();
  const queryClient = useQueryClient();

  const currentAddressIndex = sphere?.getCurrentAddressIndex() ?? 0;

  // Derive addresses on mount / when sphere changes
  useEffect(() => {
    if (!sphere) return;
    try {
      const count = Math.max(3, currentAddressIndex + 1);
      const derived = sphere.deriveAddresses(count);

      const result: DerivedAddr[] = derived.map((addr) => {
        // For current address, use identity nametag
        const addrNametag = addr.index === currentAddressIndex
          ? (sphere.identity?.nametag ?? undefined)
          : undefined;

        return {
          index: addr.index,
          l1Address: addr.address,
          path: addr.path,
          publicKey: addr.publicKey,
          nametag: addrNametag,
        };
      });

      setAddresses(result);
    } catch (e) {
      console.error('[AddressSelector] Failed to derive addresses:', e);
    }
  }, [sphere, currentAddressIndex]);

  const displayNametag = currentNametag || nametag;

  const handleCopyNametag = useCallback(async () => {
    const tagToCopy = currentNametag || nametag;
    if (!tagToCopy) return;
    try {
      await navigator.clipboard.writeText(`@${tagToCopy}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy nametag:', err);
    }
  }, [currentNametag, nametag]);

  const handleSelectAddress = useCallback(async (index: number) => {
    if (!sphere || isSwitching || index === currentAddressIndex) {
      setShowDropdown(false);
      return;
    }

    setShowDropdown(false);
    setIsSwitching(true);

    try {
      await sphere.switchToAddress(index);

      // Invalidate queries so UI refreshes with new identity
      queryClient.invalidateQueries({ queryKey: SPHERE_KEYS.identity.all });
      queryClient.invalidateQueries({ queryKey: SPHERE_KEYS.payments.all });
      queryClient.invalidateQueries({ queryKey: SPHERE_KEYS.l1.all });

      window.dispatchEvent(new Event('wallet-updated'));
    } catch (e) {
      console.error('[AddressSelector] Failed to switch address:', e);
    } finally {
      setIsSwitching(false);
    }
  }, [sphere, isSwitching, currentAddressIndex, queryClient]);

  const handleDeriveNew = useCallback(() => {
    if (!sphere) return;
    setShowDropdown(false);
    try {
      const nextIndex = addresses.length;
      const newAddr = sphere.deriveAddress(nextIndex);
      setAddresses(prev => [
        ...prev,
        {
          index: newAddr.index,
          l1Address: newAddr.address,
          path: newAddr.path,
          publicKey: newAddr.publicKey,
        },
      ]);
    } catch (e) {
      console.error('[AddressSelector] Failed to derive new address:', e);
    }
  }, [sphere, addresses.length]);

  // Sort addresses by index
  const sortedAddresses = useMemo(() => {
    return [...addresses].sort((a, b) => a.index - b.index);
  }, [addresses]);

  // No sphere — show minimal nametag if available
  if (!sphere) {
    if (displayNametag && compact) {
      return (
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] sm:text-xs text-neutral-500 font-medium" title={`@${displayNametag}`}>
            @{truncateNametag(displayNametag)}
          </span>
        </div>
      );
    }
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
            {displayNametag ? (
              <span className="font-medium" title={`@${displayNametag}`}>@{truncateNametag(displayNametag)}</span>
            ) : l1Address ? (
              <span className="font-mono">{l1Address.slice(0, 8)}...</span>
            ) : (
              <span className="font-mono text-neutral-400">...</span>
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
                    {isSwitching && <Loader2 className="w-3 h-3 animate-spin" />}
                    {isSwitching ? 'Switching...' : `Addresses (${sortedAddresses.length})`}
                  </span>
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={handleDeriveNew}
                    className="flex items-center gap-1 px-2 py-1 text-xs bg-orange-500/10 hover:bg-orange-500/20 text-orange-600 dark:text-orange-400 rounded-lg transition-colors shrink-0"
                    title="Derive new address"
                  >
                    <Plus className="w-3 h-3" />
                    <span>New</span>
                  </motion.button>
                </div>

                {/* Address list */}
                <div className="max-h-64 overflow-y-auto custom-scrollbar">
                  {sortedAddresses.map((addr) => {
                    const isSelected = addr.index === currentAddressIndex;
                    const addrNametag = isSelected ? displayNametag : addr.nametag;

                    return (
                      <button
                        key={addr.index}
                        onClick={() => handleSelectAddress(addr.index)}
                        disabled={isSwitching}
                        className={`w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors disabled:opacity-50 ${
                          isSelected ? 'bg-orange-50 dark:bg-orange-900/20' : ''
                        }`}
                      >
                        {/* Selection indicator */}
                        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${isSelected ? 'bg-orange-500' : 'bg-transparent'}`} />

                        {/* Address info */}
                        <div className="flex-1 min-w-0">
                          {addrNametag ? (
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
                                @{addrNametag}
                              </span>
                              <span className="text-xs font-mono text-neutral-400 dark:text-neutral-500">
                                ({addr.l1Address.slice(0, 8)}...{addr.l1Address.slice(-6)})
                              </span>
                            </div>
                          ) : (
                            <span className="text-xs font-mono text-neutral-600 dark:text-neutral-400 truncate">
                              {addr.l1Address.slice(0, 12)}...{addr.l1Address.slice(-6)}
                            </span>
                          )}
                        </div>

                        {/* Change badge */}
                        {addr.isChange && (
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

  // Full mode
  return (
    <div className="relative">
      <button
        onClick={() => setShowDropdown(prev => !prev)}
        className="flex items-center gap-2 px-3 py-2 bg-neutral-100 dark:bg-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-200/50 dark:hover:bg-neutral-700/50 transition-colors"
      >
        {displayNametag ? (
          <span className="text-sm font-medium text-blue-600 dark:text-blue-400">@{displayNametag}</span>
        ) : l1Address ? (
          <span className="text-sm font-mono text-neutral-700 dark:text-neutral-300">
            {l1Address.slice(0, 8)}...{l1Address.slice(-6)}
          </span>
        ) : (
          <span className="text-sm font-mono text-neutral-400">...</span>
        )}
        <ChevronDown className={`w-4 h-4 text-neutral-500 transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
      </button>

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
                  onClick={handleDeriveNew}
                  className="flex items-center gap-1 px-2 py-1 text-xs bg-orange-500/10 hover:bg-orange-500/20 text-orange-600 dark:text-orange-400 rounded-lg transition-colors"
                >
                  <Plus className="w-3 h-3" />
                  <span>New Address</span>
                </motion.button>
              </div>

              <div className="max-h-64 overflow-y-auto custom-scrollbar">
                {sortedAddresses.map((addr) => {
                  const isSelected = addr.index === currentAddressIndex;
                  const addrNametag = isSelected ? displayNametag : addr.nametag;

                  return (
                    <button
                      key={addr.index}
                      onClick={() => handleSelectAddress(addr.index)}
                      disabled={isSwitching}
                      className={`w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors disabled:opacity-50 ${
                        isSelected ? 'bg-orange-50 dark:bg-orange-900/20' : ''
                      }`}
                    >
                      <div className={`w-2 h-2 rounded-full shrink-0 ${isSelected ? 'bg-orange-500' : 'bg-transparent'}`} />
                      <div className="flex-1 min-w-0">
                        {addrNametag ? (
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-blue-600 dark:text-blue-400">
                              @{addrNametag}
                            </span>
                            <span className="text-xs font-mono text-neutral-400">
                              {addr.l1Address.slice(0, 6)}...
                            </span>
                          </div>
                        ) : (
                          <span className="text-sm font-mono text-neutral-700 dark:text-neutral-300 truncate">
                            {addr.l1Address}
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
