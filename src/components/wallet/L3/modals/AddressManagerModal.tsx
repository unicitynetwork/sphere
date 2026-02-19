import { useState, useEffect, useCallback } from 'react';
import { MapPin, Eye, EyeOff, Plus, Loader2 } from 'lucide-react';
import { BaseModal, ModalHeader } from '../../ui';
import { useSphereContext } from '../../../../sdk/hooks/core/useSphere';
import type { TrackedAddress } from '@unicitylabs/sphere-sdk';

interface AddressManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AddressManagerModal({ isOpen, onClose }: AddressManagerModalProps) {
  const { sphere } = useSphereContext();
  const [addresses, setAddresses] = useState<TrackedAddress[]>([]);
  const [togglingIndex, setTogglingIndex] = useState<number | null>(null);
  const [isDeriving, setIsDeriving] = useState(false);

  const currentIndex = sphere?.getCurrentAddressIndex() ?? 0;

  const refreshAddresses = useCallback(() => {
    if (!sphere) return;
    try {
      const all = sphere.getAllTrackedAddresses();
      setAddresses(all.sort((a, b) => a.index - b.index));
    } catch (e) {
      console.error('[AddressManager] Failed to get addresses:', e);
    }
  }, [sphere]);

  useEffect(() => {
    if (isOpen) refreshAddresses();
  }, [isOpen, refreshAddresses]);

  const handleToggleHidden = useCallback(async (index: number, currentlyHidden: boolean) => {
    if (!sphere) return;
    setTogglingIndex(index);
    try {
      await sphere.setAddressHidden(index, !currentlyHidden);
      refreshAddresses();
    } catch (e) {
      console.error('[AddressManager] Failed to toggle address visibility:', e);
    } finally {
      setTogglingIndex(null);
    }
  }, [sphere, refreshAddresses]);

  const handleDeriveNew = useCallback(async () => {
    if (!sphere || isDeriving) return;
    setIsDeriving(true);
    try {
      const nextIndex = addresses.length > 0
        ? Math.max(...addresses.map(a => a.index)) + 1
        : 1;
      await sphere.switchToAddress(nextIndex);
      refreshAddresses();
    } catch (e) {
      console.error('[AddressManager] Failed to derive new address:', e);
    } finally {
      setIsDeriving(false);
    }
  }, [sphere, addresses, isDeriving, refreshAddresses]);

  const truncateAddr = (addr: string): string => {
    if (addr.length <= 20) return addr;
    return `${addr.slice(0, 10)}...${addr.slice(-6)}`;
  };

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} size="sm" showOrbs={false}>
      <ModalHeader title="Address Manager" icon={MapPin} iconVariant="neutral" onClose={onClose} />

      <div className="p-4 space-y-2">
        {addresses.length === 0 ? (
          <p className="text-sm text-neutral-500 dark:text-neutral-400 text-center py-4">
            No addresses found
          </p>
        ) : (
          <div className="space-y-1.5 max-h-80 overflow-y-auto custom-scrollbar">
            {addresses.map((addr) => {
              const isCurrent = addr.index === currentIndex;
              const isToggling = togglingIndex === addr.index;

              return (
                <div
                  key={addr.index}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-colors ${
                    addr.hidden
                      ? 'bg-neutral-50 dark:bg-neutral-800/30 border-neutral-200 dark:border-neutral-700/50 opacity-60'
                      : isCurrent
                        ? 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800/50'
                        : 'bg-white dark:bg-neutral-800/50 border-neutral-200 dark:border-neutral-700'
                  }`}
                >
                  {/* Index badge */}
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${
                    isCurrent
                      ? 'bg-orange-500 text-white'
                      : 'bg-neutral-100 dark:bg-neutral-700 text-neutral-500 dark:text-neutral-400'
                  }`}>
                    {addr.index}
                  </div>

                  {/* Address info */}
                  <div className="flex-1 min-w-0">
                    {addr.nametag && (
                      <span className="text-xs font-medium text-blue-600 dark:text-blue-400 block">
                        @{addr.nametag}
                      </span>
                    )}
                    <span className="text-[11px] font-mono text-neutral-500 dark:text-neutral-400 block truncate">
                      {truncateAddr(addr.l1Address)}
                    </span>
                  </div>

                  {/* Status badges */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    {isCurrent && (
                      <span className="text-[10px] font-medium text-orange-600 dark:text-orange-400 bg-orange-100 dark:bg-orange-900/30 px-1.5 py-0.5 rounded">
                        Active
                      </span>
                    )}
                    {addr.hidden && (
                      <span className="text-[10px] font-medium text-neutral-500 bg-neutral-100 dark:bg-neutral-700 px-1.5 py-0.5 rounded">
                        Hidden
                      </span>
                    )}
                  </div>

                  {/* Toggle visibility button */}
                  <button
                    onClick={() => handleToggleHidden(addr.index, addr.hidden)}
                    disabled={isCurrent || isToggling}
                    title={isCurrent ? 'Cannot hide active address' : addr.hidden ? 'Show address' : 'Hide address'}
                    className={`p-1.5 rounded-lg transition-colors shrink-0 ${
                      isCurrent
                        ? 'opacity-30 cursor-not-allowed'
                        : 'hover:bg-neutral-100 dark:hover:bg-neutral-700 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300'
                    }`}
                  >
                    {isToggling ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : addr.hidden ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Derive new address button */}
        <button
          onClick={handleDeriveNew}
          disabled={isDeriving}
          className="w-full flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-medium text-orange-600 dark:text-orange-400 bg-orange-500/10 hover:bg-orange-500/20 rounded-xl transition-colors disabled:opacity-50"
        >
          {isDeriving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Plus className="w-4 h-4" />
          )}
          Derive New Address
        </button>
      </div>
    </BaseModal>
  );
}
