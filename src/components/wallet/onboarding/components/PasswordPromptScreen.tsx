/**
 * PasswordPromptScreen - Enter password for encrypted wallet files
 */
import { useState } from "react";
import { motion } from "framer-motion";
import { Lock, ArrowLeft, ArrowRight, Loader2, Eye, EyeOff } from "lucide-react";

interface PasswordPromptScreenProps {
  fileName: string;
  isBusy: boolean;
  error: string | null;
  onSubmit: (password: string) => void;
  onBack: () => void;
}

export function PasswordPromptScreen({
  fileName,
  isBusy,
  error,
  onSubmit,
  onBack,
}: PasswordPromptScreenProps) {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password.trim()) {
      onSubmit(password);
    }
  };

  return (
    <motion.div
      key="passwordPrompt"
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
        <div className="absolute inset-0 bg-amber-500/30 rounded-2xl md:rounded-3xl blur-xl" />
        <div className="relative w-full h-full rounded-2xl md:rounded-3xl bg-linear-to-br from-amber-500 to-amber-600 flex items-center justify-center shadow-2xl shadow-amber-500/30">
          <Lock className="w-8 h-8 md:w-10 md:h-10 text-white" />
        </div>
      </motion.div>

      <h2 className="text-2xl md:text-3xl font-black text-neutral-900 dark:text-white mb-2 md:mb-3 tracking-tight">
        Enter Password
      </h2>
      <p className="text-neutral-500 dark:text-neutral-400 text-xs md:text-sm mb-6 md:mb-8 mx-auto leading-relaxed">
        The file{" "}
        <span className="font-medium text-neutral-700 dark:text-neutral-300">
          {fileName}
        </span>{" "}
        is encrypted
      </p>

      <form onSubmit={handleSubmit}>
        {/* Password Input */}
        <div className="relative mb-6">
          <input
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Wallet password"
            autoFocus
            disabled={isBusy}
            className="w-full px-4 py-3 md:py-3.5 bg-neutral-100 dark:bg-neutral-800/50 border-2 border-neutral-200 dark:border-neutral-700/50 rounded-xl text-sm md:text-base text-neutral-900 dark:text-white placeholder-neutral-400 dark:placeholder-neutral-500 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 pr-12 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
          >
            {showPassword ? (
              <EyeOff className="w-5 h-5" />
            ) : (
              <Eye className="w-5 h-5" />
            )}
          </button>
        </div>

        {/* Buttons */}
        <div className="flex gap-3">
          <motion.button
            type="button"
            onClick={onBack}
            disabled={isBusy}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="flex-1 py-3 md:py-3.5 px-5 md:px-6 rounded-xl bg-neutral-100 dark:bg-neutral-800/50 text-neutral-700 dark:text-neutral-300 text-sm md:text-base font-bold border-2 border-neutral-200 dark:border-neutral-700/50 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-neutral-200 dark:hover:bg-neutral-700/50 transition-colors"
          >
            <ArrowLeft className="w-4 h-4 md:w-5 md:h-5" />
            Back
          </motion.button>

          <motion.button
            type="submit"
            disabled={isBusy || !password.trim()}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="flex-2 relative py-3 md:py-3.5 px-5 md:px-6 rounded-xl bg-linear-to-r from-amber-500 to-amber-600 text-white text-sm md:text-base font-bold shadow-xl shadow-amber-500/30 flex items-center justify-center gap-2 md:gap-3 disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden group"
          >
            <div className="absolute inset-0 bg-linear-to-r from-amber-400 to-amber-500 opacity-0 group-hover:opacity-100 transition-opacity" />
            <span className="relative z-10 flex items-center gap-2 md:gap-3">
              {isBusy ? (
                <>
                  <Loader2 className="w-4 h-4 md:w-5 md:h-5 animate-spin" />
                  Decrypting...
                </>
              ) : (
                <>
                  Unlock
                  <ArrowRight className="w-4 h-4 md:w-5 md:h-5" />
                </>
              )}
            </span>
          </motion.button>
        </div>
      </form>

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
