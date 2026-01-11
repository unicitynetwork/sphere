import { motion, AnimatePresence } from 'framer-motion';
import { X, Settings, Layers, Download, LogOut, ChevronRight } from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenL1Wallet: () => void;
  onBackupWallet: () => void;
  onLogout: () => void;
  l1Balance?: string;
}

export function SettingsModal({
  isOpen,
  onClose,
  onOpenL1Wallet,
  onBackupWallet,
  onLogout,
  l1Balance,
}: SettingsModalProps) {
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
              <div className="relative px-6 py-4 border-b border-neutral-200/50 dark:border-neutral-700/50 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center">
                  <Settings className="w-5 h-5 text-neutral-600 dark:text-neutral-400" />
                </div>
                <h3 className="text-lg font-bold text-neutral-900 dark:text-white">Settings</h3>
                <motion.button
                  whileHover={{ scale: 1.1, rotate: 90 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={onClose}
                  className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-xl bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-500 transition-colors"
                >
                  <X className="w-4 h-4" />
                </motion.button>
              </div>

              {/* Menu Items */}
              <div className="p-4 space-y-2">
                {/* L1 Wallet */}
                <motion.button
                  whileHover={{ scale: 1.01, x: 2 }}
                  whileTap={{ scale: 0.99 }}
                  onClick={() => {
                    onClose();
                    onOpenL1Wallet();
                  }}
                  className="w-full flex items-center gap-4 p-4 bg-neutral-50 dark:bg-neutral-800/50 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-2xl transition-colors group"
                >
                  <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center shrink-0">
                    <Layers className="w-6 h-6 text-blue-500" />
                  </div>
                  <div className="flex-1 text-left">
                    <span className="font-semibold text-neutral-900 dark:text-white block">L1 Wallet</span>
                    {l1Balance && (
                      <span className="text-xs text-neutral-500 dark:text-neutral-400">{l1Balance} ALPHA</span>
                    )}
                  </div>
                  <ChevronRight className="w-5 h-5 text-neutral-400 group-hover:text-neutral-600 dark:group-hover:text-neutral-300 transition-colors" />
                </motion.button>

                {/* Backup Wallet */}
                <motion.button
                  whileHover={{ scale: 1.01, x: 2 }}
                  whileTap={{ scale: 0.99 }}
                  onClick={() => {
                    onClose();
                    onBackupWallet();
                  }}
                  className="w-full flex items-center gap-4 p-4 bg-neutral-50 dark:bg-neutral-800/50 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-2xl transition-colors"
                >
                  <div className="w-12 h-12 rounded-xl bg-green-500/10 flex items-center justify-center shrink-0">
                    <Download className="w-6 h-6 text-green-500" />
                  </div>
                  <div className="flex-1 text-left">
                    <span className="font-semibold text-neutral-900 dark:text-white block">Backup Wallet</span>
                  </div>
                </motion.button>

                {/* Logout */}
                <motion.button
                  whileHover={{ scale: 1.01, x: 2 }}
                  whileTap={{ scale: 0.99 }}
                  onClick={() => {
                    onClose();
                    onLogout();
                  }}
                  className="w-full flex items-center gap-4 p-4 bg-neutral-50 dark:bg-neutral-800/50 hover:bg-red-50 dark:hover:bg-red-900/10 rounded-2xl transition-colors group"
                >
                  <div className="w-12 h-12 rounded-xl bg-red-500/10 flex items-center justify-center shrink-0">
                    <LogOut className="w-6 h-6 text-red-500" />
                  </div>
                  <div className="flex-1 text-left">
                    <span className="font-semibold text-red-500 block">Logout</span>
                  </div>
                </motion.button>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
