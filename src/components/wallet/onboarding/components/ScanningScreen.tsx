/**
 * ScanningScreen - Modal overlay showing blockchain scanning progress.
 * Rendered OUTSIDE AnimatePresence to avoid step-transition timing issues.
 */
import { motion, AnimatePresence } from "framer-motion";
import { Search, X } from "lucide-react";
import type { ScanAddressProgress } from "@unicitylabs/sphere-sdk";

interface ScanningScreenProps {
  open: boolean;
  progress: ScanAddressProgress | null;
  onCancel: () => void;
}

export function ScanningScreen({
  open,
  progress,
  onCancel,
}: ScanningScreenProps) {
  const scanned = progress?.scanned ?? 0;
  const total = progress?.total ?? 1;
  const foundCount = progress?.foundCount ?? 0;
  const percentage = Math.round((scanned / total) * 100);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="scan-modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
        >
          <motion.div
            key="scan-modal-content"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.3 }}
            className="w-full max-w-[360px] md:max-w-[420px] bg-white dark:bg-neutral-900 rounded-2xl p-6 md:p-8 shadow-2xl"
          >
            {/* Icon */}
            <motion.div
              className="relative w-16 h-16 md:w-20 md:h-20 mx-auto mb-6"
              animate={{ rotate: [0, 360] }}
              transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
            >
              <div className="absolute inset-0 bg-cyan-500/30 rounded-2xl md:rounded-3xl blur-xl" />
              <div className="relative w-full h-full rounded-2xl md:rounded-3xl bg-linear-to-br from-cyan-500 to-cyan-600 flex items-center justify-center shadow-2xl shadow-cyan-500/30">
                <Search className="w-8 h-8 md:w-10 md:h-10 text-white" />
              </div>
            </motion.div>

            <h2 className="text-2xl md:text-3xl font-black text-neutral-900 dark:text-white mb-2 md:mb-3 tracking-tight text-center">
              Scanning Blockchain
            </h2>
            <p className="text-neutral-500 dark:text-neutral-400 text-xs md:text-sm mb-6 md:mb-8 mx-auto leading-relaxed text-center">
              Searching for addresses with balance
            </p>

            {/* Progress Bar */}
            <div className="mb-4">
              <div className="flex justify-between text-xs text-neutral-500 dark:text-neutral-400 mb-2">
                <span>{scanned} / {total} addresses</span>
                <span>{percentage}%</span>
              </div>
              <div className="w-full h-2 bg-neutral-200 dark:bg-neutral-700 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-linear-to-r from-cyan-500 to-cyan-400 rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${percentage}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
            </div>

            {/* Stats */}
            <div className="p-4 bg-neutral-100 dark:bg-neutral-800/50 border border-neutral-200 dark:border-neutral-700 rounded-xl mb-6">
              <div className="flex items-center justify-between">
                <span className="text-sm text-neutral-500 dark:text-neutral-400">
                  Addresses found
                </span>
                <span className="text-lg font-bold text-neutral-900 dark:text-white">
                  {foundCount}
                </span>
              </div>
              {(progress?.nametagsFoundCount ?? 0) > 0 && (
                <div className="flex items-center justify-between mt-2">
                  <span className="text-sm text-neutral-500 dark:text-neutral-400">
                    With Unicity IDs
                  </span>
                  <span className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                    {progress!.nametagsFoundCount}
                  </span>
                </div>
              )}
              {progress?.currentAddress && (
                <div className="mt-2 text-xs text-neutral-400 dark:text-neutral-500 font-mono truncate">
                  {progress.currentAddress}
                </div>
              )}
            </div>

            {/* Cancel Button */}
            <motion.button
              onClick={onCancel}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="w-full py-3 md:py-3.5 px-5 md:px-6 rounded-xl bg-neutral-100 dark:bg-neutral-800/50 text-neutral-700 dark:text-neutral-300 text-sm md:text-base font-bold border-2 border-neutral-200 dark:border-neutral-700/50 flex items-center justify-center gap-2 hover:bg-neutral-200 dark:hover:bg-neutral-700/50 transition-colors"
            >
              <X className="w-4 h-4 md:w-5 md:h-5" />
              Skip Scanning
            </motion.button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
