import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, AlertTriangle, Download, LogOut, Loader2, Check } from 'lucide-react';
import { useGlobalSyncStatus } from '../../../../hooks/useGlobalSyncStatus';
import { BaseModal, Button, DangerButton } from '../../ui';

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
    <BaseModal
      isOpen={isOpen}
      onClose={showSyncWarning ? handleCloseSyncWarning : onClose}
      size="sm"
      showOrbs={false}
    >
      <AnimatePresence mode="wait">
        {showSyncWarning ? (
          <motion.div
            key="sync-warning"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
          >
            {/* Close button */}
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              onClick={handleCloseSyncWarning}
              className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-xl hover:bg-neutral-200/80 dark:hover:bg-neutral-800/80 text-neutral-500 transition-colors z-20"
            >
              <X className="w-4 h-4" />
            </motion.button>

            <div className="relative px-6 py-5 flex flex-col items-center text-center">
              {/* Animated spinner */}
              {isAnySyncing ? (
                <div className="relative w-20 h-20 mb-4">
                  <motion.div
                    className="absolute inset-0 border-3 border-neutral-200 dark:border-neutral-800/50 rounded-full"
                    animate={{ rotate: 360 }}
                    transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                  />
                  <motion.div
                    className="absolute inset-1.5 border-3 border-amber-500/30 rounded-full border-t-amber-500 border-r-amber-500"
                    animate={{ rotate: -360 }}
                    transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                  />
                  <div className="absolute inset-3 bg-amber-500/20 rounded-full blur-xl" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <motion.div
                      animate={{ scale: [1, 1.1, 1], opacity: [0.5, 1, 0.5] }}
                      transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                    >
                      <Loader2 className="w-7 h-7 text-amber-500 dark:text-amber-400 animate-spin" />
                    </motion.div>
                  </div>
                </div>
              ) : (
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: 0.1, type: "spring" }}
                  className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mb-4"
                >
                  <Check className="w-8 h-8 text-green-500" />
                </motion.div>
              )}

              <h3 className="text-xl font-bold text-neutral-900 dark:text-white mb-2">
                {isAnySyncing ? "Sync in Progress" : "Sync Complete"}
              </h3>
              <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-4">
                {isAnySyncing
                  ? "Please wait while your data is being synchronized."
                  : "All data has been synchronized."}
              </p>

              {/* Status message */}
              {isAnySyncing && (
                <motion.div
                  key={statusMessage}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="flex items-center gap-3 text-neutral-700 dark:text-neutral-300 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 rounded-xl backdrop-blur-sm border border-amber-200 dark:border-amber-700/30 mb-3"
                >
                  <motion.div
                    animate={{ scale: [1, 1.2, 1], opacity: [0.5, 1, 0.5] }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                    className="w-2.5 h-2.5 rounded-full bg-amber-500 dark:bg-amber-400 shrink-0"
                  />
                  <span className="text-left text-sm font-medium">{statusMessage}</span>
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

              <DangerButton
                icon={LogOut}
                fullWidth
                disabled={!canLogout}
                onClick={canLogout ? handleForceLogout : undefined}
              >
                {isAnySyncing ? "Logout Now" : "Logout"}
              </DangerButton>

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
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, x: 20 }}
          >
            {/* Close button */}
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              onClick={onClose}
              className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-xl hover:bg-neutral-200/80 dark:hover:bg-neutral-800/80 text-neutral-500 transition-colors z-20"
            >
              <X className="w-4 h-4" />
            </motion.button>

            <div className="relative px-6 py-5 flex flex-col items-center text-center">
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

            <div className="px-6 pb-6 pt-2 space-y-3">
              <Button icon={Download} fullWidth onClick={onBackupAndLogout}>
                Save Backup First
              </Button>

              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleLogoutClick}
                className="w-full flex items-center justify-center gap-2 py-3.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-500 dark:text-red-400 text-sm font-semibold rounded-xl transition-colors"
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
    </BaseModal>
  );
}
