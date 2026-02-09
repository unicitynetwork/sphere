/**
 * NametagScreen - Unicity ID creation screen
 */
import { motion } from "framer-motion";
import { ShieldCheck, ArrowRight } from "lucide-react";

interface NametagScreenProps {
  nametagInput: string;
  isBusy: boolean;
  error: string | null;
  onNametagChange: (value: string) => void;
  onSubmit: () => void;
  onSkip?: () => void;
}

export function NametagScreen({
  nametagInput,
  isBusy,
  error,
  onNametagChange,
  onSubmit,
  onSkip,
}: NametagScreenProps) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.toLowerCase();
    // Allow only valid nametag characters
    if (/^[a-z0-9_\-+.]*$/.test(value)) {
      onNametagChange(value);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && nametagInput && !isBusy) {
      onSubmit();
    }
  };

  return (
    <motion.div
      key="nametag"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ duration: 0.3 }}
      className="relative z-10 w-full max-w-[280px] md:max-w-[340px]"
    >
      {/* Success Icon */}
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", stiffness: 200, damping: 15 }}
        className="relative w-16 h-16 md:w-18 md:h-18 mx-auto mb-5"
      >
        <div className="absolute inset-0 bg-emerald-500/30 rounded-full blur-xl" />
        <div className="relative w-full h-full rounded-full bg-neutral-100 dark:bg-neutral-800/80 border-2 border-emerald-500/50 flex items-center justify-center backdrop-blur-sm">
          <ShieldCheck className="w-8 h-8 md:w-9 md:h-9 text-emerald-500 dark:text-emerald-400" />
        </div>
      </motion.div>

      <motion.h2
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="text-xl md:text-2xl font-black text-neutral-900 dark:text-white mb-2 md:mb-3 tracking-tight"
      >
        Wallet Created!
      </motion.h2>

      <motion.p
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="text-neutral-500 dark:text-neutral-400 text-xs md:text-sm mb-5 md:mb-6 mx-auto leading-relaxed"
      >
        Now, choose a unique{" "}
        <span className="text-orange-500 dark:text-orange-400 font-bold">
          Unicity ID
        </span>{" "}
        to receive tokens easily without long addresses.
      </motion.p>

      {/* Input Field */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="relative mb-4 md:mb-5 group"
      >
        <div className="absolute right-3 md:right-4 top-1/2 -translate-y-1/2 text-neutral-400 dark:text-neutral-500 group-focus-within:text-orange-500 dark:group-focus-within:text-orange-400 transition-colors z-10 text-xs md:text-sm font-medium">
          @unicity
        </div>
        <input
          type="text"
          value={nametagInput}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="id"
          className="w-full bg-neutral-100 dark:bg-neutral-800/50 border-2 border-neutral-200 dark:border-neutral-700/50 rounded-xl py-3 md:py-3.5 pl-3 md:pl-4 pr-24 md:pr-28 text-sm md:text-base text-neutral-900 dark:text-white placeholder-neutral-400 dark:placeholder-neutral-600 focus:outline-none focus:border-orange-500 focus:bg-white dark:focus:bg-neutral-800 transition-all backdrop-blur-sm"
          autoFocus
        />
        <div className="absolute inset-0 rounded-xl bg-linear-to-r from-orange-500/0 via-orange-500/5 to-purple-500/0 opacity-0 group-focus-within:opacity-100 transition-opacity pointer-events-none" />
      </motion.div>

      {/* Continue Button */}
      <motion.button
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        onClick={onSubmit}
        disabled={!nametagInput || isBusy}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        className="relative w-full py-3 md:py-3.5 px-5 md:px-6 rounded-xl bg-linear-to-r from-orange-500 to-orange-600 text-white text-sm md:text-base font-bold shadow-xl shadow-orange-500/30 flex items-center justify-center gap-2 md:gap-3 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 overflow-hidden group"
      >
        <div className="absolute inset-0 bg-linear-to-r from-orange-400 to-orange-500 opacity-0 group-hover:opacity-100 transition-opacity" />
        <span className="relative z-10 flex items-center gap-2 md:gap-3">
          Continue
          <ArrowRight className="w-4 h-4 md:w-5 md:h-5" />
        </span>
      </motion.button>

      {/* Skip Button */}
      {onSkip && (
        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          onClick={onSkip}
          disabled={isBusy}
          className="w-full mt-3 py-2.5 text-xs md:text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300 transition-colors disabled:opacity-50"
        >
          Skip for now
        </motion.button>
      )}

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
