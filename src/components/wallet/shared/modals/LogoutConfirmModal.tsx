import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, AlertTriangle, Download, LogOut, Loader2, ShieldAlert } from 'lucide-react';
import { useGlobalSyncStatus } from '../../../../hooks/useGlobalSyncStatus';

interface LogoutConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onBackupAndLogout: () => void;
  onLogoutWithoutBackup: () => void;
}

export function LogoutConfirmModal({
  isOpen,
  onClose,
  onBackupAndLogout,
  onLogoutWithoutBackup,
}: LogoutConfirmModalProps) {
  const { isAnySyncing, statusMessage } = useGlobalSyncStatus();
  const [showSyncWarning, setShowSyncWarning] = useState(false);

  const handleLogoutClick = () => {
    if (isAnySyncing) {
      setShowSyncWarning(true);
    } else {
      onLogoutWithoutBackup();
    }
  };

  const handleForceLogout = () => {
    setShowSyncWarning(false);
    onLogoutWithoutBackup();
  };

  const handleCloseSyncWarning = () => {
    setShowSyncWarning(false);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={showSyncWarning ? handleCloseSyncWarning : onClose}
            className="fixed inset-0 z-50 bg-black/60 dark:bg-black/80 backdrop-blur-sm"
          />

          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <AnimatePresence mode="wait">
              {showSyncWarning ? (
                <motion.div
                  key="sync-warning"
                  initial={{ scale: 0.9, opacity: 0, y: 20 }}
                  animate={{ scale: 1, opacity: 1, y: 0 }}
                  exit={{ scale: 0.9, opacity: 0, y: 20 }}
                  transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                  className="relative w-full max-w-sm bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-3xl shadow-2xl pointer-events-auto overflow-hidden"
                >
                  <div className="relative px-6 py-5 flex flex-col items-center text-center">
                    <motion.button
                      whileHover={{ scale: 1.1, rotate: 90 }}
                      whileTap={{ scale: 0.9 }}
                      onClick={handleCloseSyncWarning}
                      className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-xl bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-500 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </motion.button>

                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ delay: 0.1, type: "spring" }}
                      className="w-16 h-16 rounded-full bg-amber-500/10 flex items-center justify-center mb-4"
                    >
                      {isAnySyncing ? (
                        <Loader2 className="w-8 h-8 text-amber-500 animate-spin" />
                      ) : (
                        <LogOut className="w-8 h-8 text-green-500" />
                      )}
                    </motion.div>

                    <h3 className="text-xl font-bold text-neutral-900 dark:text-white mb-2">
                      {isAnySyncing ? "Sync in Progress" : "Sync Complete"}
                    </h3>
                    <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-2">
                      {isAnySyncing
                        ? "Your data is being synchronized to IPFS."
                        : "All data has been synchronized."}
                    </p>
                    <p className={`text-sm font-medium ${isAnySyncing ? "text-amber-600 dark:text-amber-400" : "text-green-600 dark:text-green-400"}`}>
                      {statusMessage}
                    </p>
                    {isAnySyncing && (
                      <p className="text-neutral-500 text-xs mt-3">
                        Logging out now may result in data loss on other devices.
                        <br />
                        Please wait for sync to complete.
                      </p>
                    )}
                  </div>

                  <div className="px-6 pb-6 space-y-3">
                    <motion.button
                      whileHover={!isAnySyncing ? { scale: 1.02 } : {}}
                      whileTap={!isAnySyncing ? { scale: 0.98 } : {}}
                      onClick={isAnySyncing ? undefined : handleForceLogout}
                      disabled={isAnySyncing}
                      className={`w-full flex items-center justify-center gap-2 py-3.5 font-semibold rounded-xl transition-all ${
                        isAnySyncing
                          ? "bg-neutral-200 dark:bg-neutral-800 text-neutral-400 dark:text-neutral-500 cursor-not-allowed"
                          : "bg-red-600 text-white hover:bg-red-500"
                      }`}
                    >
                      {isAnySyncing ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Waiting for Sync...
                        </>
                      ) : (
                        <>
                          <LogOut className="w-4 h-4" />
                          Logout Now
                        </>
                      )}
                    </motion.button>

                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={handleForceLogout}
                      className="w-full flex items-center justify-center gap-2 py-3.5 bg-red-500/10 hover:bg-red-500 border border-red-500/30 text-red-500 hover:text-white font-semibold rounded-xl transition-all"
                    >
                      <ShieldAlert className="w-4 h-4" />
                      I Understand the Risks - Logout Now
                    </motion.button>

                    <button
                      onClick={handleCloseSyncWarning}
                      className="w-full py-3 text-sm text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="logout-confirm"
                  initial={{ scale: 0.9, opacity: 0, y: 20 }}
                  animate={{ scale: 1, opacity: 1, y: 0 }}
                  exit={{ scale: 0.9, opacity: 0, y: 20 }}
                  transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                  className="relative w-full max-w-sm bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-3xl shadow-2xl pointer-events-auto overflow-hidden"
                >
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
                      className="w-16 h-16 rounded-full bg-amber-500/10 flex items-center justify-center mb-4"
                    >
                      <AlertTriangle className="w-8 h-8 text-amber-500" />
                    </motion.div>

                    <h3 className="text-xl font-bold text-neutral-900 dark:text-white mb-2">Logout from Wallet?</h3>
                    <p className="text-sm text-neutral-500 dark:text-neutral-400">
                      All local data will be deleted. Make sure you have a backup to restore your wallet later.
                    </p>

                    {isAnySyncing && (
                      <div className="mt-3 flex items-center gap-2 text-amber-600 dark:text-amber-400">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span className="text-xs font-medium">{statusMessage}</span>
                      </div>
                    )}
                  </div>

                  <div className="px-6 pb-6 space-y-3">
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={onBackupAndLogout}
                      className="w-full flex items-center justify-center gap-2 py-3.5 bg-linear-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white font-semibold rounded-xl transition-all shadow-lg shadow-orange-500/20"
                    >
                      <Download className="w-4 h-4" />
                      Backup & Logout
                    </motion.button>

                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={handleLogoutClick}
                      className="w-full flex items-center justify-center gap-2 py-3.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-500 dark:text-red-400 font-semibold rounded-xl transition-colors"
                    >
                      <LogOut className="w-4 h-4" />
                      Logout without backup
                    </motion.button>

                    <button
                      onClick={onClose}
                      className="w-full py-3 text-sm text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
