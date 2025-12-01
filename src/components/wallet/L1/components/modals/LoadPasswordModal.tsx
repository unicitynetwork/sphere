import { useState } from "react";
import { motion } from "framer-motion";
import { Lock, AlertCircle } from "lucide-react";

interface LoadPasswordModalProps {
  show: boolean;
  onConfirm: (password: string) => void;
  onCancel: () => void;
}

export function LoadPasswordModal({ show, onConfirm, onCancel }: LoadPasswordModalProps) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  if (!show) return null;

  const handleConfirm = () => {
    setError("");
    if (!password) {
      setError("Please enter password");
      return;
    }
    onConfirm(password);
    setPassword("");
    setError("");
  };

  const handleCancel = () => {
    setPassword("");
    setError("");
    onCancel();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 dark:bg-black/80 backdrop-blur-sm flex items-center justify-center z-40 p-6"
      onClick={handleCancel}
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
            className="w-12 h-12 bg-blue-500/10 rounded-full flex items-center justify-center mb-4"
          >
            <Lock className="w-6 h-6 text-blue-500" />
          </motion.div>
          <h3 className="text-neutral-900 dark:text-white text-xl font-bold mb-2">Enter Password</h3>
          <p className="text-neutral-500 dark:text-neutral-400 text-sm">
            This wallet is encrypted. Please enter your password to unlock it.
          </p>
        </motion.div>

        <input
          placeholder="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              handleConfirm();
            }
          }}
          className="w-full mb-4 px-3 py-2 bg-neutral-100 dark:bg-neutral-800 rounded text-neutral-800 dark:text-neutral-200 placeholder-neutral-400 border border-neutral-200 dark:border-neutral-700 focus:border-blue-500 outline-none transition-colors"
        />

        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-4 p-3 bg-red-500/10 border border-red-900/50 rounded-lg flex items-center gap-2"
          >
            <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
            <span className="text-red-400 text-sm">{error}</span>
          </motion.div>
        )}

        <div className="flex gap-3">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleCancel}
            className="flex-1 py-2 bg-neutral-200 dark:bg-neutral-700 rounded text-neutral-700 dark:text-white hover:bg-neutral-300 dark:hover:bg-neutral-600 transition-colors"
          >
            Cancel
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleConfirm}
            className="flex-1 py-2 bg-blue-600 rounded text-white hover:bg-blue-500 transition-colors"
          >
            Unlock
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
}
