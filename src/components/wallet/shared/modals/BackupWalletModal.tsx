import { motion, AnimatePresence } from 'framer-motion';
import { X, Download, Key, ShieldCheck } from 'lucide-react';

interface BackupWalletModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExportWalletFile: () => void;
  onShowRecoveryPhrase: () => void;
}

export function BackupWalletModal({
  isOpen,
  onClose,
  onExportWalletFile,
  onShowRecoveryPhrase,
}: BackupWalletModalProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-50 bg-black/60 dark:bg-black/80 backdrop-blur-sm"
          />

          {/* Modal */}
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
              className="relative w-full max-w-sm bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-3xl shadow-2xl pointer-events-auto overflow-hidden"
            >
              {/* Header */}
              <div className="relative px-6 py-5 flex flex-col items-center text-center">
                <motion.button
                  whileHover={{ scale: 1.1, rotate: 90 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={onClose}
                  className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-xl bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-500 transition-colors"
                >
                  <X className="w-4 h-4" />
                </motion.button>

                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: 0.1, type: "spring" }}
                  className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mb-4"
                >
                  <ShieldCheck className="w-8 h-8 text-green-500" />
                </motion.div>

                <h3 className="text-xl font-bold text-neutral-900 dark:text-white mb-1">Backup Wallet</h3>
                <p className="text-sm text-neutral-500 dark:text-neutral-400">
                  Choose how you want to backup your wallet
                </p>
              </div>

              {/* Options */}
              <div className="px-6 pb-6 space-y-3">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => {
                    onClose();
                    onExportWalletFile();
                  }}
                  className="w-full flex items-center gap-4 p-4 bg-neutral-100 dark:bg-neutral-800/50 hover:bg-neutral-200 dark:hover:bg-neutral-800 rounded-2xl transition-colors"
                >
                  <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center shrink-0">
                    <Download className="w-6 h-6 text-blue-500" />
                  </div>
                  <div className="text-left">
                    <span className="font-semibold text-neutral-900 dark:text-white block">Export Wallet File</span>
                    <span className="text-xs text-neutral-500 dark:text-neutral-400">Download encrypted JSON file</span>
                  </div>
                </motion.button>

                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => {
                    onClose();
                    onShowRecoveryPhrase();
                  }}
                  className="w-full flex items-center gap-4 p-4 bg-neutral-100 dark:bg-neutral-800/50 hover:bg-neutral-200 dark:hover:bg-neutral-800 rounded-2xl transition-colors"
                >
                  <div className="w-12 h-12 rounded-xl bg-amber-500/10 flex items-center justify-center shrink-0">
                    <Key className="w-6 h-6 text-amber-500" />
                  </div>
                  <div className="text-left">
                    <span className="font-semibold text-neutral-900 dark:text-white block">Show Recovery Phrase</span>
                    <span className="text-xs text-neutral-500 dark:text-neutral-400">View 12-word seed phrase</span>
                  </div>
                </motion.button>

                <button
                  onClick={onClose}
                  className="w-full py-3 text-sm text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
