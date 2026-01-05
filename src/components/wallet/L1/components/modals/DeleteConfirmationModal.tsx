import { AlertTriangle, Download, Loader2, ShieldAlert, X, Trash2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useGlobalSyncStatus } from "../../../../../hooks/useGlobalSyncStatus";
import { useState } from "react";

interface DeleteConfirmationModalProps {
  show: boolean;
  onConfirmDelete: () => void;
  onSaveFirst: () => void;
  onCancel: () => void;
}

export function DeleteConfirmationModal({
  show,
  onConfirmDelete,
  onSaveFirst,
  onCancel,
}: DeleteConfirmationModalProps) {
  const { isAnySyncing, statusMessage } = useGlobalSyncStatus();
  const [showSyncWarning, setShowSyncWarning] = useState(false);

  if (!show) return null;

  const handleDeleteClick = () => {
    if (isAnySyncing) {
      // Show sync warning instead of deleting immediately
      setShowSyncWarning(true);
    } else {
      onConfirmDelete();
    }
  };

  const handleForceDelete = () => {
    // User acknowledged the risk
    setShowSyncWarning(false);
    onConfirmDelete();
  };

  const handleCloseSyncWarning = () => {
    setShowSyncWarning(false);
    onCancel();
  };

  // When sync completes while on sync warning screen, allow deletion
  const handleSyncCompleteDelete = () => {
    setShowSyncWarning(false);
    onConfirmDelete();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 dark:bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onCancel}
    >
      <AnimatePresence mode="wait">
        {showSyncWarning ? (
          // Sync Warning Modal
          <motion.div
            key="sync-warning"
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            transition={{ type: "spring", duration: 0.4 }}
            className="relative w-full max-w-md bg-white dark:bg-[#111] border border-neutral-200 dark:border-white/10 rounded-3xl shadow-2xl p-6 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              onClick={handleCloseSyncWarning}
              className="absolute top-4 right-4 p-1.5 rounded-full bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-500 dark:text-neutral-400 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>

            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.1 }}
              className="flex flex-col items-center text-center mb-6"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
                className="w-12 h-12 bg-amber-500/10 rounded-full flex items-center justify-center mb-4"
              >
                {isAnySyncing ? (
                  <Loader2 className="w-6 h-6 text-amber-500 animate-spin" />
                ) : (
                  <Trash2 className="w-6 h-6 text-green-500" />
                )}
              </motion.div>
              <h3 className="text-neutral-900 dark:text-white text-xl font-bold mb-2">
                {isAnySyncing ? "Sync in Progress" : "Sync Complete"}
              </h3>
              <p className="text-neutral-500 dark:text-neutral-400 text-sm mb-2">
                {isAnySyncing
                  ? "Your data is being synchronized to IPFS."
                  : "All data has been synchronized."}
              </p>
              <p className={`text-sm font-medium ${isAnySyncing ? "text-amber-600 dark:text-amber-400" : "text-green-600 dark:text-green-400"}`}>
                {statusMessage}
              </p>
              {isAnySyncing && (
                <p className="text-neutral-500 text-xs mt-3">
                  Deleting now may result in data loss on other devices.
                  <br />
                  Please wait for sync to complete.
                </p>
              )}
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="flex flex-col gap-3"
            >
              <motion.button
                whileHover={!isAnySyncing ? { scale: 1.02 } : {}}
                whileTap={!isAnySyncing ? { scale: 0.98 } : {}}
                onClick={isAnySyncing ? undefined : handleSyncCompleteDelete}
                disabled={isAnySyncing}
                className={`w-full py-3 rounded-xl font-medium flex items-center justify-center gap-2 transition-all ${
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
                    <Trash2 className="w-4 h-4" />
                    Delete Wallet
                  </>
                )}
              </motion.button>

              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleForceDelete}
                className="w-full py-3 bg-red-600/10 text-red-500 border border-red-200 dark:border-red-900/50 rounded-xl font-medium hover:bg-red-600 hover:text-white flex items-center justify-center gap-2 transition-all"
              >
                <ShieldAlert className="w-4 h-4" />
                I Understand the Risks - Delete Now
              </motion.button>
            </motion.div>
          </motion.div>
        ) : (
          // Original Delete Confirmation Modal
          <motion.div
            key="delete-confirm"
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            transition={{ type: "spring", duration: 0.4 }}
            className="relative w-full max-w-md bg-white dark:bg-[#111] border border-neutral-200 dark:border-white/10 rounded-3xl shadow-2xl p-6 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.1 }}
              className="flex flex-col items-center text-center mb-6"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
                className="w-12 h-12 bg-red-500/10 rounded-full flex items-center justify-center mb-4"
              >
                <motion.div
                  animate={{ rotate: [0, -10, 10, -10, 0] }}
                  transition={{ delay: 0.3, duration: 0.5 }}
                >
                  <AlertTriangle className="w-6 h-6 text-red-500" />
                </motion.div>
              </motion.div>
              <h3 className="text-neutral-900 dark:text-white text-xl font-bold mb-2">
                Delete Wallet?
              </h3>
              <p className="text-neutral-500 dark:text-neutral-400 text-sm">
                Are you sure you want to delete this wallet? <br />
                <span className="text-red-500 dark:text-red-400 font-semibold">
                  This action cannot be undone.
                </span>
              </p>
              <p className="text-neutral-500 text-xs mt-2">
                If you haven't saved your backup, your funds will be lost
                forever.
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="flex flex-col gap-3"
            >
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={onSaveFirst}
                className="w-full py-3 bg-neutral-100 dark:bg-neutral-800 rounded-xl text-neutral-700 dark:text-white font-medium border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-200 dark:hover:bg-neutral-700 flex items-center justify-center gap-2 transition-colors"
              >
                <Download className="w-4 h-4" />
                Save Backup First
              </motion.button>

              <div className="flex gap-3 mt-2">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={onCancel}
                  className="flex-1 py-3 bg-neutral-100 dark:bg-neutral-800 rounded-xl text-neutral-700 dark:text-white font-medium hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors"
                >
                  Cancel
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleDeleteClick}
                  className="flex-1 py-3 bg-red-600/20 text-red-500 border border-red-200 dark:border-red-900/50 rounded-xl font-medium hover:bg-red-600 hover:text-white transition-all"
                >
                  Delete Anyway
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
