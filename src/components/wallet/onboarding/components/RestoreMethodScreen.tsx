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
      transition={{ duration: 0.3 }}
      className="relative z-10 w-full max-w-[320px] md:max-w-[400px]"
    >
      {/* Icon */}
      <motion.div
        className="relative w-16 h-16 md:w-20 md:h-20 mx-auto mb-6"
        whileHover={{ scale: 1.05 }}
      >
        <div className="absolute inset-0 bg-blue-500/30 rounded-2xl md:rounded-3xl blur-xl" />
        <div className="relative w-full h-full rounded-2xl md:rounded-3xl bg-linear-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-2xl shadow-blue-500/30">
          <KeyRound className="w-8 h-8 md:w-10 md:h-10 text-white" />
        </div>
      </motion.div>

      <h2 className="text-2xl md:text-3xl font-black text-neutral-900 dark:text-white mb-2 md:mb-3 tracking-tight">
        Restore Wallet
      </h2>
      <p className="text-neutral-500 dark:text-neutral-400 text-xs md:text-sm mb-6 md:mb-8 mx-auto leading-relaxed">
        Choose how you want to restore your wallet
      </p>

      <div className="space-y-3 mb-6">
        {/* Recovery Phrase Option */}
        <motion.button
          onClick={onSelectMnemonic}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="w-full p-4 rounded-xl bg-neutral-100 dark:bg-neutral-800/50 border-2 border-neutral-200 dark:border-neutral-700/50 hover:border-blue-500/50 dark:hover:border-blue-500/50 transition-all text-left group"
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-lg bg-blue-500/10 flex items-center justify-center group-hover:bg-blue-500/20 transition-colors">
              <KeyRound className="w-6 h-6 text-blue-500" />
            </div>
            <div className="flex-1">
              <div className="font-bold text-neutral-900 dark:text-white mb-1">
                Recovery Phrase
              </div>
              <div className="text-sm text-neutral-500 dark:text-neutral-400">
                Use your 12-word mnemonic phrase
              </div>
            </div>
            <ArrowRight className="w-5 h-5 text-neutral-400 group-hover:text-blue-500 transition-colors" />
          </div>
        </motion.button>

        {/* Import from File Option */}
        <motion.button
          onClick={onSelectFile}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="w-full p-4 rounded-xl bg-neutral-100 dark:bg-neutral-800/50 border-2 border-neutral-200 dark:border-neutral-700/50 hover:border-orange-500/50 dark:hover:border-orange-500/50 transition-all text-left group"
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-lg bg-orange-500/10 flex items-center justify-center group-hover:bg-orange-500/20 transition-colors">
              <Upload className="w-6 h-6 text-orange-500" />
            </div>
            <div className="flex-1">
              <div className="font-bold text-neutral-900 dark:text-white mb-1">
                Import from File
              </div>
              <div className="text-sm text-neutral-500 dark:text-neutral-400">
                Import wallet from .json, .dat or .txt file
              </div>
            </div>
            <ArrowRight className="w-5 h-5 text-neutral-400 group-hover:text-orange-500 transition-colors" />
          </div>
        </motion.button>
      </div>

      {/* Back Button */}
      <motion.button
        onClick={onBack}
        disabled={isBusy}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        className="w-full py-3 md:py-3.5 px-5 md:px-6 rounded-xl bg-neutral-100 dark:bg-neutral-800/50 text-neutral-700 dark:text-neutral-300 text-sm md:text-base font-bold border-2 border-neutral-200 dark:border-neutral-700/50 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-neutral-200 dark:hover:bg-neutral-700/50 transition-colors"
      >
        <ArrowLeft className="w-4 h-4 md:w-5 md:h-5" />
        Back
      </motion.button>

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
