/**
 * AddressSelectionScreen - Choose which derived address to use
 */
import { motion, AnimatePresence } from "framer-motion";
import {
  Wallet,
  ArrowLeft,
  ArrowRight,
  Loader2,
  ChevronDown,
  Check,
  Plus,
} from "lucide-react";
import { truncateAddress } from "../../shared/utils/walletFileParser";

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
}

interface AddressSelectionScreenProps {
  derivedAddresses: DerivedAddressInfo[];
  selectedAddressPath: string | null;
  showAddressDropdown: boolean;
  isCheckingIpns: boolean;
  isBusy: boolean;
  error: string | null;
  onSelectAddress: (path: string) => void;
  onToggleDropdown: () => void;
  onDeriveNewAddress: () => void;
  onContinue: () => void;
  onBack: () => void;
}

export function AddressSelectionScreen({
  derivedAddresses,
  selectedAddressPath,
  showAddressDropdown,
  isCheckingIpns,
  isBusy,
  error,
  onSelectAddress,
  onToggleDropdown,
  onDeriveNewAddress,
  onContinue,
  onBack,
}: AddressSelectionScreenProps) {
  // Show addresses that are: checked (IPNS done) OR from L1 wallet (e.g., .dat import)
  const visibleAddresses = derivedAddresses.filter(
    (a) => !a.ipnsLoading || a.fromL1Wallet
  );
  const selectedAddress =
    visibleAddresses.find((a) => a.path === selectedAddressPath) ||
    visibleAddresses[0];

  return (
    <motion.div
      key="addressSelection"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ duration: 0.3 }}
      className="relative z-10 w-full max-w-[320px] md:max-w-[400px]"
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
        Select Address
      </h2>
      <p className="text-neutral-500 dark:text-neutral-400 text-xs md:text-sm mb-6 md:mb-8 mx-auto leading-relaxed">
        Choose which address to use for your{" "}
        <span className="text-purple-500 dark:text-purple-400 font-semibold">
          Unicity identity
        </span>
      </p>

      {/* Address Dropdown */}
      <div className="relative mb-4">
        {/* Show loading state while checking addresses */}
        {visibleAddresses.length === 0 ? (
          <div className="w-full bg-neutral-100 dark:bg-neutral-800/50 border-2 border-neutral-200 dark:border-neutral-700/50 rounded-xl py-3 md:py-3.5 px-4 flex items-center gap-3">
            <Loader2 className="w-5 h-5 animate-spin text-purple-500" />
            <span className="text-sm text-neutral-500 dark:text-neutral-400">
              Checking for nametags...
            </span>
          </div>
        ) : (
          <button
            onClick={onToggleDropdown}
            className="w-full bg-neutral-100 dark:bg-neutral-800/50 border-2 border-neutral-200 dark:border-neutral-700/50 rounded-xl py-3 md:py-3.5 px-4 text-left flex items-center justify-between hover:border-purple-500/50 transition-all"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs text-neutral-400 dark:text-neutral-500">
                  #{selectedAddress?.index ?? 0}
                </span>
                <span className="text-sm md:text-base font-mono text-neutral-900 dark:text-white truncate">
                  {truncateAddress(selectedAddress?.l1Address || "")}
                </span>
                {selectedAddress?.isChange && (
                  <span className="px-1.5 py-0.5 bg-amber-500/20 text-amber-600 dark:text-amber-400 text-[9px] font-bold rounded shrink-0">
                    Change
                  </span>
                )}
                {selectedAddress?.ipnsLoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-neutral-400" />
                ) : selectedAddress?.hasNametag ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-medium">
                    <Check className="w-3 h-3" />
                    {selectedAddress?.existingNametag}
                  </span>
                ) : null}
              </div>
            </div>
            <motion.div
              animate={{ rotate: showAddressDropdown ? 180 : 0 }}
              transition={{ duration: 0.2 }}
            >
              <ChevronDown className="w-5 h-5 text-neutral-400 dark:text-neutral-500" />
            </motion.div>
          </button>
        )}

        {/* Dropdown Menu */}
        <AnimatePresence>
          {showAddressDropdown && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.15 }}
              className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl shadow-xl overflow-hidden z-50"
            >
              <div className="max-h-64 overflow-y-auto">
                {/* Only show addresses that have been checked or from L1 wallet */}
                {visibleAddresses.map((addr) => (
                  <button
                    key={addr.l1Address}
                    onClick={() => {
                      onSelectAddress(addr.path);
                      onToggleDropdown();
                    }}
                    className={`w-full px-4 py-3 flex items-center gap-3 hover:bg-neutral-100 dark:hover:bg-neutral-700/50 transition-colors ${
                      addr.path === selectedAddressPath
                        ? "bg-purple-50 dark:bg-purple-900/20"
                        : ""
                    }`}
                  >
                    <span className="text-xs text-neutral-400 dark:text-neutral-500 w-6">
                      #{addr.index}
                    </span>
                    <span className="flex-1 text-sm font-mono text-neutral-900 dark:text-white truncate text-left">
                      {truncateAddress(addr.l1Address)}
                    </span>
                    {addr.isChange && (
                      <span className="px-1.5 py-0.5 bg-amber-500/20 text-amber-600 dark:text-amber-400 text-[9px] font-bold rounded shrink-0">
                        Change
                      </span>
                    )}
                    {addr.ipnsLoading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-neutral-400" />
                    ) : addr.hasNametag ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-medium">
                        <Check className="w-3 h-3" />
                        {addr.existingNametag}
                      </span>
                    ) : null}
                    {addr.path === selectedAddressPath && (
                      <div className="w-2 h-2 rounded-full bg-purple-500" />
                    )}
                  </button>
                ))}
              </div>

              {/* Loading indicator while IPNS is checking, or Derive New Address button */}
              {isCheckingIpns ||
              derivedAddresses.some((a) => a.ipnsLoading) ? (
                <div className="w-full px-4 py-3 flex items-center gap-3 border-t border-neutral-200 dark:border-neutral-700 text-neutral-500 dark:text-neutral-400">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">Checking for nametags...</span>
                </div>
              ) : (
                <button
                  onClick={onDeriveNewAddress}
                  disabled={isBusy}
                  className="w-full px-4 py-3 flex items-center gap-3 border-t border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-700/50 transition-colors text-purple-600 dark:text-purple-400 disabled:opacity-50"
                >
                  <Plus className="w-4 h-4" />
                  <span className="text-sm font-medium">
                    Derive New Address
                  </span>
                  {isBusy && (
                    <Loader2 className="w-4 h-4 animate-spin ml-auto" />
                  )}
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* L3 Address Info */}
      <div className="mb-6 p-3 bg-neutral-100 dark:bg-neutral-800/50 rounded-lg border border-neutral-200 dark:border-neutral-700/50">
        <div className="text-xs text-neutral-500 dark:text-neutral-400 mb-1">
          L3 Unicity Address
        </div>
        <div className="text-xs font-mono text-neutral-700 dark:text-neutral-300 break-all">
          {selectedAddress?.l3Address || "..."}
        </div>
      </div>

      {/* Continue Button */}
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
          disabled={isBusy || derivedAddresses.length === 0}
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
            ) : selectedAddress?.hasNametag ? (
              <>
                Continue
                <ArrowRight className="w-4 h-4 md:w-5 md:h-5" />
              </>
            ) : (
              <>
                Create ID
                <ArrowRight className="w-4 h-4 md:w-5 md:h-5" />
              </>
            )}
          </span>
        </motion.button>
      </div>

      {/* Info about nametag */}
      {selectedAddress?.hasNametag && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mt-4 text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 p-3 rounded-lg"
        >
          This address already has a Unicity ID. You can continue directly.
        </motion.p>
      )}

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
