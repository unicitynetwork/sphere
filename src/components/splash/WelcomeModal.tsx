import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Shield, ChevronRight } from 'lucide-react';

interface WelcomeModalProps {
  show: boolean;
  onAccept: () => void;
}

export function WelcomeModal({ show, onAccept }: WelcomeModalProps) {
  const [ageConfirmed, setAgeConfirmed] = useState(false);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-white/80 dark:bg-black/80 backdrop-blur-md flex items-center justify-center z-60 p-4"
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0, y: 30 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 30 }}
            transition={{ type: 'spring', duration: 0.5 }}
            className="relative w-full max-w-md bg-linear-to-b from-neutral-100 to-white dark:from-neutral-900 dark:to-black border border-orange-500/20 rounded-3xl shadow-2xl shadow-orange-500/10 overflow-hidden"
          >
            {/* Background glows */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-64 bg-orange-500/15 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute bottom-0 right-0 w-48 h-48 bg-purple-500/8 rounded-full blur-3xl pointer-events-none" />

            {/* Content */}
            <div className="relative p-8 md:p-10">
              {/* Icon + Title */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="text-center mb-8"
              >
                <div className="relative inline-flex items-center justify-center mb-5">
                  <div className="absolute inset-0 w-20 h-20 rounded-full bg-orange-500/20 blur-xl" />
                  <div className="relative w-18 h-18 rounded-full bg-linear-to-br from-orange-500 to-orange-600 flex items-center justify-center shadow-xl shadow-orange-500/30">
                    <Shield className="w-9 h-9 text-white" />
                  </div>
                </div>
                <h2 className="text-2xl md:text-3xl font-bold text-neutral-900 dark:text-white mb-2">
                  Welcome Aboard
                </h2>
                <p className="text-neutral-500 dark:text-neutral-400 text-sm">
                  Infrastructure for a free Internet
                </p>
              </motion.div>

              {/* Quote */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.2 }}
                className="text-center mb-6 px-2"
              >
                <p className="text-neutral-600 dark:text-neutral-300 text-sm md:text-base italic">
                  <span className="text-2xl leading-none text-orange-500/40 font-serif align-text-top">&ldquo;</span>
                  Privacy isn&apos;t a feature. It&apos;s the foundation of freedom.
                  <span className="text-2xl leading-none text-orange-500/40 font-serif align-text-top">&rdquo;</span>
                </p>
              </motion.div>

              {/* Age confirmation + Button group */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.35 }}
                className="space-y-4"
              >
                <label
                  className={`flex items-center gap-3 p-4 rounded-2xl cursor-pointer transition-all duration-200 border ${
                    ageConfirmed
                      ? 'bg-orange-500/5 dark:bg-orange-500/10 border-orange-500/30'
                      : 'bg-neutral-100/50 dark:bg-neutral-800/30 border-neutral-200 dark:border-neutral-700/50 hover:border-neutral-300 dark:hover:border-neutral-600'
                  }`}
                >
                  <div className="relative shrink-0">
                    <input
                      type="checkbox"
                      checked={ageConfirmed}
                      onChange={(e) => setAgeConfirmed(e.target.checked)}
                      className="sr-only"
                    />
                    <div className={`w-5 h-5 rounded-md border-2 transition-all duration-200 ${
                      ageConfirmed
                        ? 'bg-orange-500 border-orange-500 shadow-sm shadow-orange-500/30'
                        : 'border-neutral-400 dark:border-neutral-600'
                    }`}>
                      {ageConfirmed && (
                        <motion.svg
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                          className="w-full h-full text-white p-0.5"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="3"
                        >
                          <polyline points="20 6 9 17 4 12" />
                        </motion.svg>
                      )}
                    </div>
                  </div>
                  <span className={`text-sm transition-colors duration-200 ${
                    ageConfirmed
                      ? 'text-neutral-900 dark:text-white'
                      : 'text-neutral-600 dark:text-neutral-400'
                  }`}>
                    I confirm that I am at least 18 years old
                  </span>
                </label>

                <motion.button
                  whileHover={ageConfirmed ? { scale: 1.02 } : {}}
                  whileTap={ageConfirmed ? { scale: 0.98 } : {}}
                  onClick={ageConfirmed ? onAccept : undefined}
                  disabled={!ageConfirmed}
                  className={`w-full py-4 rounded-2xl font-semibold text-white flex items-center justify-center gap-2 transition-all duration-300 ${
                    ageConfirmed
                      ? 'bg-linear-to-r from-orange-500 to-orange-600 hover:from-orange-400 hover:to-orange-500 shadow-lg shadow-orange-500/25'
                      : 'bg-neutral-300 dark:bg-neutral-800 cursor-not-allowed opacity-40'
                  }`}
                >
                  <span>Enter the Sphere</span>
                  <ChevronRight className="w-5 h-5" />
                </motion.button>
              </motion.div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
