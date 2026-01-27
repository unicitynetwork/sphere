/**
 * StartScreen - Initial onboarding screen
 * Shows options to create new wallet, restore, or continue setup
 */
import { motion } from "framer-motion";
import {
  Wallet,
  ArrowRight,
  Loader2,
  ShieldCheck,
  KeyRound,
} from "lucide-react";

interface StartScreenProps {
  identity: { address: string } | null | undefined;
  nametag: string | null | undefined;
  isBusy: boolean;
  ipnsFetchingNametag: boolean;
  error: string | null;
  onCreateWallet: () => void;
  onContinueSetup: () => void;
  onRestore: () => void;
}

export function StartScreen({
  identity,
  nametag,
  isBusy,
  ipnsFetchingNametag,
  error,
  onCreateWallet,
  onContinueSetup,
  onRestore,
}: StartScreenProps) {
  const showContinueSetup = identity && !nametag;

  return (
    <motion.div
      key="start"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ duration: 0.1 }}
      className="relative z-10 w-full max-w-[280px] md:max-w-[340px]"
    >
      {/* Icon with glow effect */}
      <motion.div
        className="relative w-16 h-16 md:w-20 md:h-20 mx-auto mb-6"
        whileHover={{ scale: 1.05 }}
      >
        <div className="absolute inset-0 bg-linear-to-br from-orange-500 to-orange-600 rounded-2xl md:rounded-3xl blur-xl opacity-50" />
        <div className="relative w-full h-full rounded-2xl md:rounded-3xl bg-linear-to-br from-orange-500 to-orange-600 flex items-center justify-center shadow-2xl shadow-orange-500/30">
          <Wallet className="w-8 h-8 md:w-10 md:h-10 text-white" />
        </div>
      </motion.div>

      <h2 className="text-2xl md:text-3xl font-black text-neutral-900 dark:text-white mb-2 md:mb-3 tracking-tight">
        {showContinueSetup ? "Complete Setup" : "No Wallet Found"}
      </h2>
      <p className="text-neutral-500 dark:text-neutral-400 text-xs md:text-sm mb-6 md:mb-8 mx-auto leading-relaxed">
        {showContinueSetup ? (
          <>
            Your wallet is ready. Create a{" "}
            <span className="text-orange-500 dark:text-orange-400 font-semibold">
              Unicity ID
            </span>{" "}
            to complete setup.
          </>
        ) : (
          <>
            Create a new secure wallet to start using the{" "}
            <span className="text-orange-500 dark:text-orange-400 font-semibold">
              Unicity Network
            </span>
          </>
        )}
      </p>

      {/* Show "Continue Setup" if identity exists but no nametag */}
      {showContinueSetup && (
        <>
          <motion.button
            onClick={onContinueSetup}
            disabled={isBusy}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            transition={{ duration: 0.1 }}
            className="relative w-full py-3 md:py-3.5 px-5 md:px-6 rounded-xl bg-linear-to-r from-emerald-500 to-emerald-600 text-white text-sm md:text-base font-bold shadow-xl shadow-emerald-500/30 flex items-center justify-center gap-2 md:gap-3 disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden group mb-3"
          >
            <div className="absolute inset-0 bg-linear-to-r from-emerald-400 to-emerald-500 opacity-0 group-hover:opacity-100 transition-opacity" />
            <span className="relative z-10 flex items-center gap-2 md:gap-3">
              <ShieldCheck className="w-4 h-4 md:w-5 md:h-5" />
              Continue Setup
            </span>
          </motion.button>

          {/* Show loading indicator while checking IPNS */}
          {ipnsFetchingNametag && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-center justify-center gap-2 text-neutral-500 dark:text-neutral-400 text-xs mb-2"
            >
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>Checking for existing Unicity ID...</span>
            </motion.div>
          )}
        </>
      )}

      {/* Divider when showing continue option */}
      {showContinueSetup && (
        <div className="flex items-center gap-3 my-4">
          <div className="flex-1 h-px bg-neutral-200 dark:bg-neutral-700" />
          <span className="text-xs text-neutral-400 dark:text-neutral-500">
            or start fresh
          </span>
          <div className="flex-1 h-px bg-neutral-200 dark:bg-neutral-700" />
        </div>
      )}

      <motion.button
        onClick={onCreateWallet}
        disabled={isBusy}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        transition={{ duration: 0.1 }}
        className="relative w-full py-3 md:py-3.5 px-5 md:px-6 rounded-xl bg-linear-to-r from-orange-500 to-orange-600 text-white text-sm md:text-base font-bold shadow-xl shadow-orange-500/30 flex items-center justify-center gap-2 md:gap-3 disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden group"
      >
        <div className="absolute inset-0 bg-linear-to-r from-orange-400 to-orange-500 opacity-0 group-hover:opacity-100 transition-opacity" />
        <span className="relative z-10 flex items-center gap-2 md:gap-3">
          {isBusy ? (
            <>
              <Loader2 className="w-4 h-4 md:w-5 md:h-5 animate-spin" />
              Creating...
            </>
          ) : (
            <>
              Create New Wallet
              <ArrowRight className="w-4 h-4 md:w-5 md:h-5" />
            </>
          )}
        </span>
      </motion.button>

      <motion.button
        onClick={onRestore}
        disabled={isBusy}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        transition={{ duration: 0.1 }}
        className="relative w-full py-3 md:py-3.5 px-5 md:px-6 rounded-xl bg-neutral-100 dark:bg-neutral-800/50 text-neutral-700 dark:text-neutral-300 text-sm md:text-base font-bold border-2 border-neutral-200 dark:border-neutral-700/50 flex items-center justify-center gap-2 md:gap-3 disabled:opacity-50 disabled:cursor-not-allowed mt-3 hover:bg-neutral-200 dark:hover:bg-neutral-700/50 transition-colors"
      >
        <KeyRound className="w-4 h-4 md:w-5 md:h-5" />
        Restore Wallet
      </motion.button>

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
