import { AlertTriangle, Download } from "lucide-react";
import { motion } from "framer-motion";

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
  if (!show) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 dark:bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onCancel}
    >
      <motion.div
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
              onClick={onConfirmDelete}
              className="flex-1 py-3 bg-red-600/20 text-red-500 border border-red-200 dark:border-red-900/50 rounded-xl font-medium hover:bg-red-600 hover:text-white transition-all"
            >
              Delete Anyway
            </motion.button>
          </div>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
