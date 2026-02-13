/**
 * RestoreMethodScreen - Choose restore method (mnemonic or file)
 */
import { motion } from "framer-motion";
import { KeyRound, Upload, ArrowRight, ArrowLeft } from "lucide-react";

interface RestoreMethodScreenProps {
  isBusy: boolean;
  error: string | null;
  onSelectMnemonic: () => void;
  onSelectFile: () => void;
  onBack: () => void;
}

export function RestoreMethodScreen({
  isBusy,
  error,
  onSelectMnemonic,
  onSelectFile,
  onBack,
}: RestoreMethodScreenProps) {
  return (
    <motion.div
      key="restoreMethod"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ duration: 0.1 }}
      className="relative z-10 w-full max-w-[360px]"
    >
      {/* Icon */}
      <motion.div
        className="relative w-18 h-18 mx-auto mb-6"
        whileHover={{ scale: 1.05 }}
      >
        <div className="absolute inset-0 bg-blue-500/30 rounded-2xl blur-xl" />
        <div className="relative w-full h-full rounded-2xl bg-linear-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-xl shadow-blue-500/25">
          <KeyRound className="w-9 h-9 text-white" />
        </div>
      </motion.div>

      <h2 className="text-2xl font-bold text-neutral-900 dark:text-white mb-2 tracking-tight">
        Restore Wallet
      </h2>
      <p className="text-neutral-500 dark:text-neutral-400 text-sm mb-7 mx-auto leading-relaxed">
        Choose how you want to restore your wallet
      </p>

      <div className="space-y-3 mb-5">
        {/* Recovery Phrase Option */}
        <motion.button
          onClick={onSelectMnemonic}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="w-full p-4 rounded-xl bg-neutral-100 dark:bg-neutral-800/50 border border-neutral-200 dark:border-neutral-700/50 hover:border-blue-500/50 dark:hover:border-blue-500/50 transition-all text-left group"
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center group-hover:bg-blue-500/20 transition-colors">
              <KeyRound className="w-6 h-6 text-blue-500" />
            </div>
            <div className="flex-1">
              <div className="text-sm font-bold text-neutral-900 dark:text-white mb-0.5">
                Recovery Phrase
              </div>
              <div className="text-xs text-neutral-500 dark:text-neutral-400">
                Use your 12-word mnemonic phrase
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-neutral-400 group-hover:text-blue-500 transition-colors" />
          </div>
        </motion.button>

        {/* Import from File Option */}
        <motion.button
          onClick={onSelectFile}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="w-full p-4 rounded-xl bg-neutral-100 dark:bg-neutral-800/50 border border-neutral-200 dark:border-neutral-700/50 hover:border-orange-500/50 dark:hover:border-orange-500/50 transition-all text-left group"
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-orange-500/10 flex items-center justify-center group-hover:bg-orange-500/20 transition-colors">
              <Upload className="w-6 h-6 text-orange-500" />
            </div>
            <div className="flex-1">
              <div className="text-sm font-bold text-neutral-900 dark:text-white mb-0.5">
                Import from File
              </div>
              <div className="text-xs text-neutral-500 dark:text-neutral-400">
                Import wallet from .json, .dat or .txt file
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-neutral-400 group-hover:text-orange-500 transition-colors" />
          </div>
        </motion.button>
      </div>

      {/* Back Button */}
      <motion.button
        onClick={onBack}
        disabled={isBusy}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        className="w-full py-3.5 px-5 rounded-xl bg-neutral-100 dark:bg-neutral-800/50 text-neutral-700 dark:text-neutral-300 text-sm font-bold border border-neutral-200 dark:border-neutral-700/50 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-neutral-200 dark:hover:bg-neutral-700/50 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back
      </motion.button>

      {error && (
        <motion.p
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-3 text-red-500 dark:text-red-400 text-xs bg-red-500/10 border border-red-500/20 p-2 rounded-lg"
        >
          {error}
        </motion.p>
      )}
    </motion.div>
  );
}
