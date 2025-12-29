/**
 * ProcessingScreen - Shows progress during nametag minting
 */
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";

interface ProcessingScreenProps {
  status: string;
}

export function ProcessingScreen({ status }: ProcessingScreenProps) {
  return (
    <motion.div
      key="processing"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3 }}
      className="relative z-10 text-center w-full max-w-[280px] md:max-w-[360px]"
    >
      {/* Animated Loading Spinner */}
      <div className="relative mx-auto w-24 h-24 md:w-28 md:h-28 mb-6">
        {/* Outer Ring */}
        <motion.div
          className="absolute inset-0 border-3 md:border-4 border-neutral-200 dark:border-neutral-800/50 rounded-full"
          animate={{ rotate: 360 }}
          transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
        />

        {/* Middle Ring */}
        <motion.div
          className="absolute inset-1.5 md:inset-2 border-3 md:border-4 border-orange-500/30 rounded-full border-t-orange-500 border-r-orange-500"
          animate={{ rotate: -360 }}
          transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
        />

        {/* Inner Glow */}
        <div className="absolute inset-3 md:inset-4 bg-orange-500/20 rounded-full blur-xl" />

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
            <Loader2 className="w-8 h-8 md:w-9 md:h-9 text-orange-500 dark:text-orange-400 animate-spin" />
          </motion.div>
        </div>
      </div>

      <motion.h3
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="text-xl md:text-2xl font-black text-neutral-900 dark:text-white mb-5 md:mb-6 tracking-tight"
      >
        Setting up Profile...
      </motion.h3>

      {/* Dynamic Progress Status */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="space-y-2 md:space-y-2.5 text-xs md:text-sm"
      >
        {/* Current status indicator */}
        <motion.div
          key={status}
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="flex items-center gap-2 md:gap-3 text-neutral-700 dark:text-neutral-300 bg-orange-50 dark:bg-orange-900/20 px-3 md:px-4 py-2.5 md:py-3 rounded-lg backdrop-blur-sm border border-orange-200 dark:border-orange-700/30"
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
            className="w-2 h-2 md:w-2.5 md:h-2.5 rounded-full bg-orange-500 dark:bg-orange-400 shrink-0"
          />
          <span className="text-left font-medium">
            {status || "Initializing..."}
          </span>
        </motion.div>

        {/* Step indicators */}
        <div className="flex items-center justify-center gap-2 mt-4">
          <div
            className={`w-2 h-2 rounded-full transition-colors ${
              status.includes("Minting")
                ? "bg-orange-500"
                : status.includes("Syncing") || status.includes("Verifying")
                  ? "bg-emerald-500"
                  : "bg-neutral-300 dark:bg-neutral-600"
            }`}
          />
          <div
            className={`w-2 h-2 rounded-full transition-colors ${
              status.includes("Syncing")
                ? "bg-orange-500"
                : status.includes("Verifying")
                  ? "bg-emerald-500"
                  : "bg-neutral-300 dark:bg-neutral-600"
            }`}
          />
          <div
            className={`w-2 h-2 rounded-full transition-colors ${
              status.includes("Verifying")
                ? "bg-orange-500"
                : "bg-neutral-300 dark:bg-neutral-600"
            }`}
          />
        </div>
      </motion.div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1 }}
        className="mt-4 md:mt-5 text-[10px] md:text-xs text-neutral-400 dark:text-neutral-500"
      >
        {status.includes("Verifying")
          ? "Verifying IPFS storage (up to 30 seconds)..."
          : "This may take a few moments..."}
      </motion.p>
    </motion.div>
  );
}
