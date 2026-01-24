import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, AlertTriangle, Download, LogOut, Loader2, Check } from 'lucide-react';
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
  const [acceptedRisk, setAcceptedRisk] = useState(false);

  const handleLogoutClick = () => {
    if (isAnySyncing) {
      setShowSyncWarning(true);
      setAcceptedRisk(false);
    } else {
      onLogoutWithoutBackup();
    }
  };

  const handleForceLogout = () => {
    setShowSyncWarning(false);
    setAcceptedRisk(false);
    onLogoutWithoutBackup();
  };

  const handleCloseSyncWarning = () => {
    setShowSyncWarning(false);
    setAcceptedRisk(false);
  };

  const canLogout = !isAnySyncing || acceptedRisk;

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

                    {/* Animated spinner like onboarding */}
                    {isAnySyncing ? (
                      <div className="relative w-20 h-20 mb-4">
                        {/* Outer Ring */}
                        <motion.div
                          className="absolute inset-0 border-3 border-neutral-200 dark:border-neutral-800/50 rounded-full"
                          animate={{ rotate: 360 }}
                          transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                        />
                        {/* Middle Ring */}
                        <motion.div
                          className="absolute inset-1.5 border-3 border-amber-500/30 rounded-full border-t-amber-500 border-r-amber-500"
                          animate={{ rotate: -360 }}
                          transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                        />
                        {/* Inner Glow */}
                        <div className="absolute inset-3 bg-amber-500/20 rounded-full blur-xl" />
                        {/* Center Icon */}
                        <div className="absolute inset-0 flex items-center justify-center">
                          <motion.div
                            animate={{
                              scale: [1, 1.1, 1],
                              opacity: [0.5, 1, 0.5],
                            }}
                            transition={{
                              duration: 2,
                              repeat: Infinity,
                              ease: "easeInOut",
                            }}
                          >
                            <Loader2 className="w-7 h-7 text-amber-500 dark:text-amber-400 animate-spin" />
                          </motion.div>
                        </div>
                      </div>
                    ) : (
                      <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ delay: 0.1, type: "spring", stiffness: 200, damping: 15 }}
                        className="relative w-20 h-20 mb-4"
                      >
                        {/* Success Glow */}
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className="absolute inset-0 bg-green-500/30 rounded-full blur-xl"
                        />
                        {/* Success Ring */}
                        <div className="absolute inset-0 border-3 border-green-500/30 rounded-full" />
                        {/* Success Icon */}
                        <div className="absolute inset-0 flex items-center justify-center">
                          <motion.div
                            initial={{ scale: 0, rotate: -180 }}
                            animate={{ scale: 1, rotate: 0 }}
                            transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
                          >
                            <Check className="w-10 h-10 text-green-500" strokeWidth={3} />
                          </motion.div>
                        </div>
                      </motion.div>
                    )}

                    <h3 className="text-xl font-bold text-neutral-900 dark:text-white mb-2">
                      {isAnySyncing ? "Sync in Progress" : "All Data Synced"}
                    </h3>
                    <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-4">
                      {isAnySyncing
                        ? "Please wait while your data is being synchronized."
                        : "Your wallet data has been safely backed up to decentralized storage. You can now logout."}
                    </p>

                    {/* Status message with pulsing dot - shown when syncing */}
                    {isAnySyncing && (
                      <motion.div
                        key={statusMessage}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="flex items-center gap-3 text-neutral-700 dark:text-neutral-300 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 rounded-xl backdrop-blur-sm border border-amber-200 dark:border-amber-700/30 mb-3"
                      >
                        <motion.div
                          animate={{
                            scale: [1, 1.2, 1],
                            opacity: [0.5, 1, 0.5],
                          }}
                          transition={{
                            duration: 1.5,
                            repeat: Infinity,
                          }}
                          className="w-2.5 h-2.5 rounded-full bg-amber-500 dark:bg-amber-400 shrink-0"
                        />
                        <span className="text-left text-sm font-medium">
                          {statusMessage}
                        </span>
                      </motion.div>
                    )}

                    {/* Success confirmation - shown when sync complete */}
                    {!isAnySyncing && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="flex items-center gap-3 text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-900/20 px-4 py-3 rounded-xl backdrop-blur-sm border border-green-200 dark:border-green-700/30 mb-3"
                      >
                        <Check className="w-5 h-5 text-green-500 shrink-0" />
                        <span className="text-left text-sm font-medium">
                          Safe to logout
                        </span>
                      </motion.div>
                    )}

                  </div>

                  <div className="px-6 pb-6 space-y-4">
                    {isAnySyncing && (
                      <label className="flex items-start gap-3 cursor-pointer group">
                        <div className="relative shrink-0 mt-0.5">
                          <input
                            type="checkbox"
                            checked={acceptedRisk}
                            onChange={(e) => setAcceptedRisk(e.target.checked)}
                            className="sr-only peer"
                          />
                          <div className="w-5 h-5 border-2 border-neutral-300 dark:border-neutral-600 rounded-md peer-checked:border-red-500 peer-checked:bg-red-500 transition-all flex items-center justify-center">
                            {acceptedRisk && <Check className="w-3 h-3 text-white" />}
                          </div>
                        </div>
                        <span className="text-xs text-neutral-500 dark:text-neutral-400 group-hover:text-neutral-700 dark:group-hover:text-neutral-300 transition-colors">
                          I understand that logging out now may result in data loss on other devices
                        </span>
                      </label>
                    )}

                    <motion.button
                      whileHover={canLogout ? { scale: 1.02 } : {}}
                      whileTap={canLogout ? { scale: 0.98 } : {}}
                      onClick={canLogout ? handleForceLogout : undefined}
                      disabled={!canLogout}
                      className={`w-full flex items-center justify-center gap-2 py-3.5 font-semibold rounded-xl transition-all ${
                        !isAnySyncing
                          ? "bg-green-600 text-white hover:bg-green-500"
                          : canLogout
                            ? "bg-red-600 text-white hover:bg-red-500"
                            : "bg-neutral-200 dark:bg-neutral-800 text-neutral-400 dark:text-neutral-500 cursor-not-allowed"
                      }`}
                    >
                      <LogOut className="w-4 h-4" />
                      {isAnySyncing ? "Logout Anyway" : "Logout Safely"}
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
                      Save Backup First
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
