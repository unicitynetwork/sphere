/**
 * AddressSelectionScreen - Multi-select address list with balances and nametags.
 * Receive addresses are selectable (checkbox). Change addresses are shown read-only.
 */
import { motion } from "framer-motion";
import {
  Wallet,
  ArrowLeft,
  ArrowRight,
  Loader2,
  Check,
  Plus,
  CheckSquare,
  Square,
} from "lucide-react";
import { truncateAddress } from "../../shared/utils/walletFileParser";
import { addrKey } from "./addrKey";

export interface DerivedAddressInfo {
  index: number;
  l1Address: string;
  l3Address: string;
  path: string;
  hasNametag: boolean;
  existingNametag?: string;
  isChange?: boolean;
  fromL1Wallet?: boolean;
  nametagData?: {
    name: string;
    token: object;
    timestamp?: number;
    format?: string;
  };
  privateKey?: string;
  ipnsName?: string;
  ipnsLoading?: boolean;
  ipnsError?: string;
  /** L1 balance in ALPHA */
  l1Balance?: number;
  /** Whether L1 balance check is in progress */
  balanceLoading?: boolean;
}

interface AddressSelectionScreenProps {
  derivedAddresses: DerivedAddressInfo[];
  selectedKeys: Set<string>;
  isBusy: boolean;
  error: string | null;
  onToggleSelect: (key: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onDeriveNewAddress: () => void;
  onContinue: () => void;
  onBack: () => void;
}

function formatBalance(balance: number): string {
  if (balance === 0) return "0";
  if (balance < 0.001) return "<0.001";
  return balance.toLocaleString(undefined, { maximumFractionDigits: 8 });
}

export function AddressSelectionScreen({
  derivedAddresses,
  selectedKeys,
  isBusy,
  error,
  onToggleSelect,
  onSelectAll,
  onDeselectAll,
  onDeriveNewAddress,
  onContinue,
  onBack,
}: AddressSelectionScreenProps) {
  const selectableAddresses = derivedAddresses.filter(a => !a.isChange);
  const selectedCount = selectedKeys.size;
  const allSelected = selectedCount === selectableAddresses.length && selectableAddresses.length > 0;

  return (
    <motion.div
      key="addressSelection"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ duration: 0.3 }}
      className="relative z-10 w-full max-w-[360px] md:max-w-[460px]"
    >
      {/* Icon */}
      <motion.div
        className="relative w-16 h-16 md:w-20 md:h-20 mx-auto mb-6"
        whileHover={{ scale: 1.05 }}
      >
        <div className="absolute inset-0 bg-purple-500/30 rounded-2xl md:rounded-3xl blur-xl" />
        <div className="relative w-full h-full rounded-2xl md:rounded-3xl bg-linear-to-br from-purple-500 to-purple-600 flex items-center justify-center shadow-2xl shadow-purple-500/30">
          <Wallet className="w-8 h-8 md:w-10 md:h-10 text-white" />
        </div>
      </motion.div>

      <h2 className="text-2xl md:text-3xl font-black text-neutral-900 dark:text-white mb-2 md:mb-3 tracking-tight">
        Select Addresses
      </h2>
      <p className="text-neutral-500 dark:text-neutral-400 text-xs md:text-sm mb-4 md:mb-6 mx-auto leading-relaxed">
        Choose which addresses to{" "}
        <span className="text-purple-500 dark:text-purple-400 font-semibold">
          publish
        </span>
      </p>

      {/* Select All / Deselect All */}
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={allSelected ? onDeselectAll : onSelectAll}
          className="text-xs font-medium text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 transition-colors"
        >
          {allSelected ? "Deselect All" : "Select All"}
        </button>
        <span className="text-xs text-neutral-400 dark:text-neutral-500">
          {selectedCount} of {selectableAddresses.length} selected
        </span>
      </div>

      {/* Address List */}
      <div className="max-h-[320px] overflow-y-auto rounded-xl border border-neutral-200 dark:border-neutral-700 mb-4">
        {derivedAddresses.length === 0 ? (
          <div className="py-8 flex items-center justify-center gap-3">
            <Loader2 className="w-5 h-5 animate-spin text-purple-500" />
            <span className="text-sm text-neutral-500 dark:text-neutral-400">
              Loading addresses...
            </span>
          </div>
        ) : (
          derivedAddresses.map((addr) => {
            const key = addrKey(addr.index, addr.isChange);
            const isChange = !!addr.isChange;
            const isSelected = selectedKeys.has(key);
            const hasBalance = (addr.l1Balance ?? 0) > 0;

            return (
              <div
                key={key}
                className={`flex items-center gap-2 px-3 py-2.5 border-b last:border-b-0 border-neutral-100 dark:border-neutral-800 transition-colors ${
                  isChange
                    ? "bg-neutral-50 dark:bg-neutral-900/50"
                    : isSelected
                      ? "bg-purple-50/50 dark:bg-purple-900/10"
                      : "bg-white dark:bg-neutral-900"
                }`}
              >
                {/* Checkbox (receive only) or spacer for CHG */}
                {isChange ? (
                  <div className="shrink-0 w-4.5" />
                ) : (
                  <button
                    onClick={() => onToggleSelect(key)}
                    className="shrink-0 text-purple-500 dark:text-purple-400 hover:text-purple-600 dark:hover:text-purple-300 transition-colors"
                  >
                    {isSelected ? (
                      <CheckSquare className="w-4.5 h-4.5" />
                    ) : (
                      <Square className="w-4.5 h-4.5 text-neutral-300 dark:text-neutral-600" />
                    )}
                  </button>
                )}

                {/* Address info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-neutral-400 dark:text-neutral-500 font-medium">
                      #{addr.index}
                    </span>
                    <span className={`text-xs font-mono truncate ${isChange ? "text-neutral-500 dark:text-neutral-400" : "text-neutral-900 dark:text-white"}`}>
                      {truncateAddress(addr.l1Address)}
                    </span>
                    {isChange && (
                      <span className="px-1 py-0.5 bg-amber-500/20 text-amber-600 dark:text-amber-400 text-[8px] font-bold rounded shrink-0">
                        CHG
                      </span>
                    )}
                  </div>

                  {/* Balance + Nametag row */}
                  <div className="flex items-center gap-2 mt-0.5">
                    {hasBalance && (
                      <span className={`text-[11px] font-medium ${isChange ? "text-neutral-500 dark:text-neutral-400" : "text-neutral-600 dark:text-neutral-300"}`}>
                        {formatBalance(addr.l1Balance!)} ALPHA
                      </span>
                    )}
                    {addr.hasNametag && addr.existingNametag && (
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-medium">
                        <Check className="w-2.5 h-2.5" />
                        @{addr.existingNametag}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Derive New Address */}
      <button
        onClick={onDeriveNewAddress}
        disabled={isBusy}
        className="w-full mb-4 px-4 py-2.5 flex items-center justify-center gap-2 text-sm font-medium text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20 rounded-xl border border-dashed border-purple-300 dark:border-purple-700 transition-colors disabled:opacity-50"
      >
        <Plus className="w-4 h-4" />
        Derive New Address
        {isBusy && <Loader2 className="w-4 h-4 animate-spin ml-1" />}
      </button>

      {/* Footer Buttons */}
      <div className="flex gap-3">
        <motion.button
          onClick={onBack}
          disabled={isBusy}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="flex-1 py-3 md:py-3.5 px-5 md:px-6 rounded-xl bg-neutral-100 dark:bg-neutral-800/50 text-neutral-700 dark:text-neutral-300 text-sm md:text-base font-bold border-2 border-neutral-200 dark:border-neutral-700/50 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-neutral-200 dark:hover:bg-neutral-700/50 transition-colors"
        >
          <ArrowLeft className="w-4 h-4 md:w-5 md:h-5" />
          Back
        </motion.button>

        <motion.button
          onClick={onContinue}
          disabled={isBusy || selectedCount === 0}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="flex-2 relative py-3 md:py-3.5 px-5 md:px-6 rounded-xl bg-linear-to-r from-purple-500 to-purple-600 text-white text-sm md:text-base font-bold shadow-xl shadow-purple-500/30 flex items-center justify-center gap-2 md:gap-3 disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden group"
        >
          <div className="absolute inset-0 bg-linear-to-r from-purple-400 to-purple-500 opacity-0 group-hover:opacity-100 transition-opacity" />
          <span className="relative z-10 flex items-center gap-2 md:gap-3">
            {isBusy ? (
              <>
                <Loader2 className="w-4 h-4 md:w-5 md:h-5 animate-spin" />
                Loading...
              </>
            ) : (
              <>
                Continue ({selectedCount})
                <ArrowRight className="w-4 h-4 md:w-5 md:h-5" />
              </>
            )}
          </span>
        </motion.button>
      </div>

      {error && (
        <motion.p
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-3 md:mt-4 text-red-500 dark:text-red-400 text-xs md:text-sm bg-red-500/10 border border-red-500/20 p-2 md:p-3 rounded-lg"
        >
          {error}
        </motion.p>
      )}
    </motion.div>
  );
}
