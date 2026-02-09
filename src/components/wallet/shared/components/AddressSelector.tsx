import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { ChevronDown, Plus, Loader2, Check, Copy, X, AlertCircle, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useIdentity } from '../../../../sdk';
import { useSphereContext } from '../../../../sdk/hooks/core/useSphere';
import { SPHERE_KEYS } from '../../../../sdk/queryKeys';
import { useQueryClient } from '@tanstack/react-query';
import type { TrackedAddress } from '@unicitylabs/sphere-sdk';

/** Truncate long nametags: show first 6 chars + ... + last 3 chars */
function truncateNametag(nametag: string, maxLength: number = 12): string {
  if (nametag.length <= maxLength) return nametag;
  return `${nametag.slice(0, 6)}...${nametag.slice(-3)}`;
}

interface AddressSelectorProps {
  /** Current nametag to display when collapsed */
  currentNametag?: string;
  /** Compact mode - just show nametag with small dropdown trigger */
  compact?: boolean;
  /** Which address format to display: 'direct' for DIRECT://, 'l1' for alpha1... */
  addressFormat?: 'direct' | 'l1';
}

export function AddressSelector({ currentNametag, compact = true, addressFormat = 'direct' }: AddressSelectorProps) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [copied, setCopied] = useState<'nametag' | 'address' | false>(false);
  const [isSwitching, setIsSwitching] = useState(false);

  // Nametag modal state
  const [showNametagModal, setShowNametagModal] = useState(false);
  const [newNametag, setNewNametag] = useState('');
  const [nametagError, setNametagError] = useState<string | null>(null);
  const [nametagAvailability, setNametagAvailability] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
  const nametagInputRef = useRef<HTMLInputElement>(null);

  const { sphere, resolveNametag } = useSphereContext();
  const { l1Address, nametag, directAddress } = useIdentity();
  const queryClient = useQueryClient();

  const currentAddressIndex = sphere?.getCurrentAddressIndex() ?? 0;

  // Get tracked addresses from SDK — no network calls needed
  const [addresses, setAddresses] = useState<TrackedAddress[]>([]);

  useEffect(() => {
    if (!sphere) return;
    try {
      setAddresses(sphere.getActiveAddresses());
    } catch (e) {
      console.error('[AddressSelector] Failed to get addresses:', e);
    }
  }, [sphere, currentAddressIndex]);

  // Focus nametag input when modal opens
  useEffect(() => {
    if (showNametagModal) {
      setTimeout(() => nametagInputRef.current?.focus(), 100);
    }
  }, [showNametagModal]);

  // Debounced nametag availability check
  useEffect(() => {
    const cleanTag = newNametag.trim().replace(/^@/, '');
    if (!cleanTag || cleanTag.length < 2) {
      setNametagAvailability('idle');
      return;
    }

    setNametagAvailability('checking');
    const timer = setTimeout(async () => {
      try {
        const existing = await resolveNametag(cleanTag);
        setNametagAvailability(existing ? 'taken' : 'available');
      } catch {
        setNametagAvailability('idle');
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [newNametag, resolveNametag]);

  const displayNametag = currentNametag || nametag;

  const refreshAfterSwitch = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: SPHERE_KEYS.identity.all });
    queryClient.invalidateQueries({ queryKey: SPHERE_KEYS.payments.all });
    queryClient.invalidateQueries({ queryKey: SPHERE_KEYS.l1.all });
    window.dispatchEvent(new Event('wallet-updated'));
    if (sphere) setAddresses(sphere.getActiveAddresses());
  }, [queryClient, sphere]);

  const handleCopyNametag = useCallback(async () => {
    const tagToCopy = currentNametag || nametag;
    if (!tagToCopy) return;
    try {
      await navigator.clipboard.writeText(`@${tagToCopy}`);
      setCopied('nametag');
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy nametag:', err);
    }
  }, [currentNametag, nametag]);

  const handleCopyDirectAddress = useCallback(async () => {
    if (!directAddress) return;
    try {
      await navigator.clipboard.writeText(directAddress);
      setCopied('address');
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy direct address:', err);
    }
  }, [directAddress]);

  const handleSelectAddress = useCallback(async (index: number) => {
    if (!sphere || isSwitching || index === currentAddressIndex) {
      setShowDropdown(false);
      return;
    }

    setShowDropdown(false);
    setIsSwitching(true);

    try {
      await sphere.switchToAddress(index);
      refreshAfterSwitch();
    } catch (e) {
      console.error('[AddressSelector] Failed to switch address:', e);
    } finally {
      setIsSwitching(false);
    }
  }, [sphere, isSwitching, currentAddressIndex, refreshAfterSwitch]);

  // Step 1: "New" button opens the nametag modal
  const handleNewClick = useCallback(() => {
    setShowDropdown(false);
    setNewNametag('');
    setNametagError(null);
    setShowNametagModal(true);
  }, []);

  // Step 2a: Create address WITH nametag
  const handleCreateWithNametag = useCallback(async () => {
    if (!sphere || isSwitching) return;
    const cleanTag = newNametag.trim().replace(/^@/, '');
    if (!cleanTag) return;

    setIsSwitching(true);
    setNametagError(null);

    try {
      // Check availability via Nostr transport
      const existing = await resolveNametag(cleanTag);
      if (existing) {
        setNametagError(`@${cleanTag} is already taken`);
        setIsSwitching(false);
        return;
      }

      const nextIndex = addresses.length > 0
        ? Math.max(...addresses.map(a => a.index)) + 1
        : 1;
      await sphere.switchToAddress(nextIndex, { nametag: cleanTag });
      setShowNametagModal(false);
      refreshAfterSwitch();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to create address';
      console.error('[AddressSelector] Failed to create address with nametag:', e);
      setNametagError(msg);
    } finally {
      setIsSwitching(false);
    }
  }, [sphere, isSwitching, newNametag, addresses, resolveNametag, refreshAfterSwitch]);

  // Step 2b: Create address WITHOUT nametag (skip)
  const handleCreateWithoutNametag = useCallback(async () => {
    if (!sphere || isSwitching) return;

    setIsSwitching(true);
    setNametagError(null);

    try {
      const nextIndex = addresses.length > 0
        ? Math.max(...addresses.map(a => a.index)) + 1
        : 1;
      await sphere.switchToAddress(nextIndex);
      setShowNametagModal(false);
      refreshAfterSwitch();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to create address';
      console.error('[AddressSelector] Failed to create address:', e);
      setNametagError(msg);
    } finally {
      setIsSwitching(false);
    }
  }, [sphere, isSwitching, addresses, refreshAfterSwitch]);

  const sortedAddresses = useMemo(() => {
    return [...addresses].sort((a, b) => a.index - b.index);
  }, [addresses]);

  /** Get display address based on addressFormat prop */
  const getDisplayAddr = useCallback((addr: TrackedAddress): string => {
    if (addressFormat === 'direct') {
      return addr.directAddress || addr.l1Address;
    }
    return addr.l1Address;
  }, [addressFormat]);

  /** Truncate address for display */
  const truncateAddr = useCallback((addr: string): string => {
    if (addr.length <= 20) return addr;
    return `${addr.slice(0, 12)}...${addr.slice(-6)}`;
  }, []);

  // =========================================================================
  // Nametag Modal (shared between compact and full modes)
  // =========================================================================
  const nametagModal = (
    <AnimatePresence>
      {showNametagModal && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/40"
            onClick={() => !isSwitching && setShowNametagModal(false)}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
          >
            <div className="bg-white dark:bg-neutral-900 rounded-2xl shadow-2xl border border-neutral-200 dark:border-neutral-700 w-full max-w-sm p-5">
              {/* Header */}
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                  New Address
                </h3>
                <button
                  onClick={() => !isSwitching && setShowNametagModal(false)}
                  className="p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg transition-colors"
                >
                  <X className="w-4 h-4 text-neutral-500" />
                </button>
              </div>

              {/* Description */}
              <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-4">
                Choose a Unicity ID for this address, or skip to create without one.
              </p>

              {/* Nametag input */}
              <div className="relative mb-3">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-neutral-400">@</span>
                <input
                  ref={nametagInputRef}
                  type="text"
                  value={newNametag}
                  onChange={e => {
                    setNewNametag(e.target.value.toLowerCase());
                    setNametagError(null);
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && newNametag.trim() && nametagAvailability === 'available') handleCreateWithNametag();
                  }}
                  placeholder="nametag"
                  disabled={isSwitching}
                  className="w-full pl-7 pr-8 py-2.5 text-sm bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500 disabled:opacity-50 transition-colors"
                />
                {/* Availability indicator */}
                <span className="absolute right-3 top-1/2 -translate-y-1/2">
                  {nametagAvailability === 'checking' && <Loader2 className="w-4 h-4 text-neutral-400 animate-spin" />}
                  {nametagAvailability === 'available' && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                  {nametagAvailability === 'taken' && <AlertCircle className="w-4 h-4 text-red-500" />}
                </span>
              </div>

              {/* Availability / Error — fixed height to prevent layout shift */}
              <div className="h-4 mb-2">
                {nametagAvailability === 'taken' && !nametagError && (
                  <p className="text-xs text-red-500">@{newNametag.trim().replace(/^@/, '')} is already taken</p>
                )}
                {nametagError && (
                  <p className="text-xs text-red-500">{nametagError}</p>
                )}
                {nametagAvailability === 'available' && (
                  <p className="text-xs text-emerald-500">@{newNametag.trim().replace(/^@/, '')} is available</p>
                )}
              </div>

              {/* Buttons */}
              <div className="flex gap-2">
                <button
                  onClick={handleCreateWithoutNametag}
                  disabled={isSwitching}
                  className="flex-1 px-3 py-2.5 text-sm font-medium text-neutral-600 dark:text-neutral-400 bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded-xl transition-colors disabled:opacity-50"
                >
                  {isSwitching && !newNametag.trim() ? (
                    <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                  ) : 'Skip'}
                </button>
                <button
                  onClick={handleCreateWithNametag}
                  disabled={isSwitching || !newNametag.trim() || nametagAvailability === 'taken' || nametagAvailability === 'checking'}
                  className="flex-1 px-3 py-2.5 text-sm font-medium text-white bg-orange-500 hover:bg-orange-600 rounded-xl transition-colors disabled:opacity-50"
                >
                  {isSwitching && newNametag.trim() ? (
                    <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                  ) : 'Create'}
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );

  // No sphere — show minimal nametag if available
  if (!sphere) {
    if ((displayNametag || directAddress) && compact) {
      return (
        <div className="flex items-center gap-1.5">
          {displayNametag && (
            <span className="text-[10px] sm:text-xs text-neutral-500 font-medium" title={`@${displayNametag}`}>
              @{truncateNametag(displayNametag)}
            </span>
          )}
          {directAddress && (
            <span className="text-[10px] sm:text-xs font-mono text-neutral-400">
              {directAddress.slice(0, 8)}...{directAddress.slice(-4)}
            </span>
          )}
        </div>
      );
    }
    return null;
  }

  if (compact) {
    return (
      <div className="relative">
        {nametagModal}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowDropdown(prev => !prev)}
            className="flex items-center gap-1 text-[10px] sm:text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 transition-colors"
          >
            {displayNametag && (
              <span className="font-medium" title={`@${displayNametag}`}>@{truncateNametag(displayNametag)}</span>
            )}
            {directAddress ? (
              <span className={`font-mono ${displayNametag ? 'text-neutral-400 dark:text-neutral-500' : ''}`}>
                {directAddress.slice(0, 8)}...{directAddress.slice(-4)}
              </span>
            ) : !displayNametag ? (
              <span className="font-mono text-neutral-400">...</span>
            ) : null}
            <ChevronDown className={`w-3 h-3 transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
          </button>

          {displayNametag && (
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              onClick={handleCopyNametag}
              className="p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800/80 rounded transition-colors"
              title="Copy nametag"
            >
              {copied === 'nametag' ? (
                <Check className="w-3 h-3 text-emerald-500" />
              ) : (
                <Copy className="w-3 h-3 text-neutral-500" />
              )}
            </motion.button>
          )}

          {directAddress && (
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              onClick={handleCopyDirectAddress}
              className="p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800/80 rounded transition-colors"
              title={`Copy direct address: ${directAddress}`}
            >
              {copied === 'address' ? (
                <Check className="w-3 h-3 text-emerald-500" />
              ) : (
                <Copy className="w-3 h-3 text-neutral-400" />
              )}
            </motion.button>
          )}
        </div>

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
                <div className="px-3 py-2 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400 flex items-center gap-1.5">
                    {isSwitching && <Loader2 className="w-3 h-3 animate-spin" />}
                    {isSwitching ? 'Switching...' : `Addresses (${sortedAddresses.length})`}
                  </span>
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={handleNewClick}
                    disabled={isSwitching}
                    className="flex items-center gap-1 px-2 py-1 text-xs bg-orange-500/10 hover:bg-orange-500/20 text-orange-600 dark:text-orange-400 rounded-lg transition-colors shrink-0 disabled:opacity-50"
                    title="Derive new address"
                  >
                    <Plus className="w-3 h-3" />
                    <span>New</span>
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
                        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${isSelected ? 'bg-orange-500' : 'bg-transparent'}`} />
                        <div className="flex-1 min-w-0">
                          {addrNametag && (
                            <span className="text-xs font-medium text-blue-600 dark:text-blue-400 block">
                              @{addrNametag}
                            </span>
                          )}
                          <span className="text-xs font-mono text-neutral-500 dark:text-neutral-400 truncate block">
                            {truncateAddr(getDisplayAddr(addr))}
                          </span>
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

  // Full mode
  return (
    <div className="relative">
      {nametagModal}
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
                  onClick={handleNewClick}
                  disabled={isSwitching}
                  className="flex items-center gap-1 px-2 py-1 text-xs bg-orange-500/10 hover:bg-orange-500/20 text-orange-600 dark:text-orange-400 rounded-lg transition-colors disabled:opacity-50"
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
                              {getDisplayAddr(addr).slice(0, 10)}...
                            </span>
                          </div>
                        ) : (
                          <span className="text-sm font-mono text-neutral-700 dark:text-neutral-300 truncate">
                            {truncateAddr(getDisplayAddr(addr))}
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
