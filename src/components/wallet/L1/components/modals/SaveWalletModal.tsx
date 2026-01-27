import { useState } from "react";
import { motion } from "framer-motion";
import { Shield, AlertCircle, FileJson } from "lucide-react";

interface SaveWalletModalProps {
  show: boolean;
  onConfirm: (filename: string, password?: string) => void;
  onCancel: () => void;
  /** Whether mnemonic is available (shows indicator) */
  hasMnemonic?: boolean;
}

export function SaveWalletModal({ show, onConfirm, onCancel, hasMnemonic }: SaveWalletModalProps) {
  const [filename, setFilename] = useState("alpha_wallet_backup");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [error, setError] = useState("");

  if (!show) return null;

  const handleConfirm = () => {
    setError("");
    if (password) {
      if (password !== passwordConfirm) {
        setError("Passwords do not match!");
        return;
      }
      if (password.length < 4) {
        setError("Password must be at least 4 characters");
        return;
      }
    }

    onConfirm(filename, password || undefined);

    // Reset state
    setFilename("alpha_wallet_backup");
    setPassword("");
    setPasswordConfirm("");
    setError("");
  };

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
            className="w-12 h-12 bg-blue-500/10 rounded-full flex items-center justify-center mb-4"
          >
            <motion.div
              animate={{ y: [0, -2, 0] }}
              transition={{ delay: 0.3, duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
            >
              <Shield className="w-6 h-6 text-blue-500" />
            </motion.div>
          </motion.div>
          <h3 className="text-neutral-900 dark:text-white text-xl font-bold mb-2">Backup Wallet</h3>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Export your wallet keys to a JSON file. Keep this safe!
          </p>
        </motion.div>

        {/* Format indicator */}
        <div className="flex items-center justify-center gap-2 mb-4 p-2 bg-blue-500/10 border border-blue-500/20 rounded-lg">
          <FileJson className="w-4 h-4 text-blue-500" />
          <span className="text-sm text-blue-500 font-medium">JSON Format</span>
          {hasMnemonic && (
            <span className="text-[10px] bg-green-500/20 text-green-500 px-1.5 py-0.5 rounded">
              +mnemonic
            </span>
          )}
        </div>

        <p className="text-[10px] text-neutral-400 mb-4 text-center">
          Includes verification address{hasMnemonic ? " and recovery phrase" : ""}
        </p>

        <label className="text-xs text-neutral-500 mb-1 block">
          Filename
        </label>
        <input
          placeholder="Filename"
          value={filename}
          onChange={(e) => setFilename(e.target.value)}
          className="w-full mb-3 px-3 py-2 bg-neutral-100 dark:bg-neutral-800 rounded text-neutral-800 dark:text-neutral-200 placeholder-neutral-400 border border-neutral-200 dark:border-neutral-700 focus:border-blue-500 outline-none transition-colors"
        />

        <label className="text-xs text-neutral-500 mb-1 block">
          Encryption Password (Optional)
        </label>
        <input
          placeholder="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full mb-3 px-3 py-2 bg-neutral-100 dark:bg-neutral-800 rounded text-neutral-800 dark:text-neutral-200 placeholder-neutral-400 border border-neutral-200 dark:border-neutral-700 focus:border-blue-500 outline-none transition-colors"
        />

        <input
          placeholder="Confirm Password"
          type="password"
          value={passwordConfirm}
          onChange={(e) => setPasswordConfirm(e.target.value)}
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
            onClick={onCancel}
            className="flex-1 py-2 bg-neutral-200 dark:bg-neutral-700 rounded text-neutral-700 dark:text-white hover:bg-neutral-300 dark:hover:bg-neutral-600 transition-colors"
          >
            Cancel
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleConfirm}
            className="flex-1 py-2 bg-linear-to-br from-blue-600 to-blue-700 rounded text-white hover:from-blue-500 hover:to-blue-600 transition-all shadow-lg shadow-blue-500/20"
          >
            Save
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
}
