import { motion, AnimatePresence } from 'framer-motion';
import { X, Eye, EyeOff, Copy, Check, ShieldAlert } from 'lucide-react';
import { useState, useEffect } from 'react';

interface SeedPhraseModalProps {
  isOpen: boolean;
  onClose: () => void;
  seedPhrase: string[];
}

export function SeedPhraseModal({ isOpen, onClose, seedPhrase }: SeedPhraseModalProps) {
  const [isRevealed, setIsRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  // Reset revealed state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setIsRevealed(false);
      setCopied(false);
    }
  }, [isOpen]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(seedPhrase.join(' '));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy seed phrase:', err);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-100 bg-black/60 dark:bg-black/80 backdrop-blur-sm"
          />

          {/* Modal */}
          <div className="fixed inset-0 z-100 flex items-center justify-center p-4 pointer-events-none">
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
              className="relative w-full max-w-md bg-white dark:bg-[#111] border border-neutral-200 dark:border-white/10 rounded-3xl shadow-2xl pointer-events-auto overflow-hidden"
            >
              {/* Header */}
              <div className="relative px-6 py-4 border-b border-neutral-200/50 dark:border-neutral-700/50 flex justify-between items-center">
                <h3 className="text-lg font-bold text-neutral-900 dark:text-white">Recovery Phrase</h3>
                <motion.button
                  whileHover={{ scale: 1.1, rotate: 90 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={onClose}
                  className="w-9 h-9 flex items-center justify-center rounded-xl bg-neutral-200/80 dark:bg-neutral-800/80 hover:bg-neutral-300/80 dark:hover:bg-neutral-700/80 text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-white transition-colors"
                >
                  <X className="w-4 h-4" />
                </motion.button>
              </div>

              {/* Content */}
              <div className="p-6">
                {/* Warning */}
                <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-3">
                  <ShieldAlert className="w-5 h-5 text-red-500 dark:text-red-400 shrink-0 mt-0.5" />
                  <div className="text-xs text-red-600 dark:text-red-400">
                    <p className="font-bold mb-1">Never share your recovery phrase!</p>
                    <p>Anyone with these words can access your wallet and steal your funds.</p>
                  </div>
                </div>

                {/* Seed phrase grid */}
                <div className="mb-6">
                  {!isRevealed ? (
                    <div className="text-center py-12">
                      <motion.button
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => setIsRevealed(true)}
                        className="px-6 py-3 rounded-xl bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-900 dark:text-white font-medium flex items-center gap-2 mx-auto transition-colors"
                      >
                        <Eye className="w-4 h-4" />
                        Reveal Recovery Phrase
                      </motion.button>
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-3 gap-2 mb-4">
                        {seedPhrase.map((word, index) => (
                          <motion.div
                            key={index}
                            initial={{ opacity: 0, scale: 0.8 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ delay: index * 0.03 }}
                            className="relative"
                          >
                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-neutral-400 dark:text-neutral-600 font-medium z-10">
                              {index + 1}.
                            </span>
                            <div className="w-full bg-neutral-100 dark:bg-neutral-800/50 border border-neutral-200 dark:border-neutral-700/50 rounded-lg py-2 pl-7 pr-2 text-xs text-neutral-900 dark:text-white font-mono">
                              {word}
                            </div>
                          </motion.div>
                        ))}
                      </div>

                      {/* Action buttons */}
                      <div className="flex gap-3">
                        <motion.button
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          onClick={() => setIsRevealed(false)}
                          className="flex-1 px-4 py-2.5 rounded-xl bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-900 dark:text-white text-sm font-medium flex items-center justify-center gap-2 transition-colors"
                        >
                          <EyeOff className="w-4 h-4" />
                          Hide
                        </motion.button>

                        <motion.button
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          onClick={handleCopy}
                          className="flex-1 px-4 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium flex items-center justify-center gap-2 transition-colors"
                        >
                          {copied ? (
                            <>
                              <Check className="w-4 h-4" />
                              Copied!
                            </>
                          ) : (
                            <>
                              <Copy className="w-4 h-4" />
                              Copy
                            </>
                          )}
                        </motion.button>
                      </div>
                    </>
                  )}
                </div>

                {/* Info */}
                <div className="text-xs text-neutral-500 dark:text-neutral-400 text-center">
                  Write down these 12 words in order and store them safely. You'll need them to recover your wallet.
                </div>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
