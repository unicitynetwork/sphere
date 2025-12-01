/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Wallet, ArrowRight, Loader2, AtSign, ShieldCheck } from 'lucide-react';
import { useWallet } from '../hooks/useWallet';

export function CreateWalletFlow() {
  const { identity, createWallet, mintNametag, nametag } = useWallet();

  const [step, setStep] = useState<'start' | 'nametag' | 'processing'>('start');
  const [nametagInput, setNametagInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const handleCreateKeys = async () => {
    setIsBusy(true);
    setError(null);
    try {
      await createWallet();
      setStep('nametag');
    } catch (e: any) {
      setError("Failed to generate keys: " + e.message);
    } finally {
      setIsBusy(false);
    }
  };

  const handleMintNametag = async () => {
    if (!nametagInput.trim()) return;

    setIsBusy(true);
    setError(null);
    setStep('processing');

    try {
      const cleanTag = nametagInput.trim().replace('@', '');
      await mintNametag(cleanTag);
    } catch (e: any) {
      setError(e.message || "Minting failed");
      setStep('nametag');
    } finally {
      setIsBusy(false);
    }
  };

  if (identity && !nametag && step === 'start') {
    setStep('nametag');
  }

  return (
    <div className="flex flex-col items-center justify-center p-4 md:p-8 text-center relative">
      <AnimatePresence mode="wait">

        {step === 'start' && (
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

            <h2 className="text-2xl md:text-3xl font-black text-neutral-900 dark:text-white mb-2 md:mb-3 tracking-tight">No Wallet Found</h2>
            <p className="text-neutral-500 dark:text-neutral-400 text-xs md:text-sm mb-6 md:mb-8 mx-auto leading-relaxed">
              Create a new secure wallet to start using the <span className="text-orange-500 dark:text-orange-400 font-semibold">Unicity Network</span>
            </p>

            <motion.button
              onClick={handleCreateKeys}
              disabled={isBusy}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              transition={{duration: 0.1}}
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
        )}

        {step === 'nametag' && (
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
              Now, choose a unique <span className="text-orange-500 dark:text-orange-400 font-bold">@nametag</span> to receive tokens easily without long addresses.
            </motion.p>

            {/* Input Field */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="relative mb-4 md:mb-5 group"
            >
              <div className="absolute left-3 md:left-4 top-1/2 -translate-y-1/2 text-neutral-400 dark:text-neutral-500 group-focus-within:text-orange-500 dark:group-focus-within:text-orange-400 transition-colors z-10">
                <AtSign className="w-4 h-4 md:w-5 md:h-5" />
              </div>
              <input
                type="text"
                value={nametagInput}
                onChange={(e) => setNametagInput(e.target.value)}
                placeholder="username"
                className="w-full bg-neutral-100 dark:bg-neutral-800/50 border-2 border-neutral-200 dark:border-neutral-700/50 rounded-xl py-3 md:py-3.5 pl-10 md:pl-12 pr-3 md:pr-4 text-sm md:text-base text-neutral-900 dark:text-white placeholder-neutral-400 dark:placeholder-neutral-600 focus:outline-none focus:border-orange-500 focus:bg-white dark:focus:bg-neutral-800 transition-all backdrop-blur-sm"
                autoFocus
              />
              <div className="absolute inset-0 rounded-xl bg-linear-to-r from-orange-500/0 via-orange-500/5 to-purple-500/0 opacity-0 group-focus-within:opacity-100 transition-opacity pointer-events-none" />
            </motion.div>

            {/* Continue Button */}
            <motion.button
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              onClick={handleMintNametag}
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
        )}

        {step === 'processing' && (
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
                    opacity: [0.5, 1, 0.5]
                  }}
                  transition={{
                    duration: 2,
                    repeat: Infinity,
                    ease: "easeInOut"
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

            {/* Progress Steps */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="space-y-2 md:space-y-2.5 text-xs md:text-sm"
            >
              {[
                { text: "Minting Nametag on Blockchain", delay: 0.4 },
                { text: "Registering on Nostr Relay", delay: 0.6 },
                { text: "Finalizing Wallet", delay: 0.8 }
              ].map((step, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: step.delay }}
                  className="flex items-center gap-2 md:gap-3 text-neutral-500 dark:text-neutral-400 bg-neutral-100 dark:bg-neutral-800/30 px-3 md:px-4 py-2 md:py-2.5 rounded-lg backdrop-blur-sm border border-neutral-200 dark:border-neutral-700/30"
                >
                  <motion.div
                    animate={{
                      scale: [1, 1.2, 1],
                      opacity: [0.5, 1, 0.5]
                    }}
                    transition={{
                      duration: 1.5,
                      repeat: Infinity,
                      delay: step.delay
                    }}
                    className="w-1.5 h-1.5 md:w-2 md:h-2 rounded-full bg-orange-500 dark:bg-orange-400 shrink-0"
                  />
                  <span className="text-left">{step.text}</span>
                </motion.div>
              ))}
            </motion.div>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1 }}
              className="mt-4 md:mt-5 text-[10px] md:text-xs text-neutral-400 dark:text-neutral-500"
            >
              This may take a few moments...
            </motion.p>
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  );
}
