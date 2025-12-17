import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Shield, Rocket, MessageCircle, Coins, AlertTriangle, ChevronRight } from 'lucide-react';

interface WelcomeModalProps {
  show: boolean;
  onAccept: () => void;
}

export function WelcomeModal({ show, onAccept }: WelcomeModalProps) {
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);

  const canProceed = ageConfirmed && termsAccepted;

  const features = [
    {
      icon: Coins,
      title: 'Buy & Trade',
      description: 'Access decentralized markets',
    },
    {
      icon: Rocket,
      title: 'Bet & Win',
      description: 'Prediction markets & games',
    },
    {
      icon: MessageCircle,
      title: 'Chat & Connect',
      description: 'Private, encrypted messaging',
    },
  ];

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-60 p-4"
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0, y: 30 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 30 }}
            transition={{ type: 'spring', duration: 0.5 }}
            className="relative w-full max-w-lg bg-linear-to-b from-neutral-900 to-black border border-orange-500/20 rounded-3xl shadow-2xl shadow-orange-500/10 overflow-hidden"
          >
            {/* Glow effect */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3/4 h-32 bg-orange-500/20 blur-3xl pointer-events-none" />

            {/* Content */}
            <div className="relative p-6 md:p-8">
              {/* Header */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="text-center mb-6"
              >
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-linear-to-br from-orange-500 to-orange-600 mb-4">
                  <Shield className="w-8 h-8 text-white" />
                </div>
                <h2 className="text-2xl md:text-3xl font-bold text-white mb-2">
                  Welcome Aboard
                </h2>
                <p className="text-neutral-400 text-sm md:text-base">
                  Infrastructure for a free Internet
                </p>
              </motion.div>

              {/* Manifesto */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="bg-neutral-800/50 border border-neutral-700/50 rounded-2xl p-4 mb-6"
              >
                <p className="text-neutral-300 text-sm md:text-base text-center italic">
                  "Privacy isn't a feature. It's the foundation of freedom."
                </p>
              </motion.div>

              {/* Features */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="grid grid-cols-3 gap-3 mb-6"
              >
                {features.map((feature, index) => (
                  <motion.div
                    key={feature.title}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.4 + index * 0.1 }}
                    className="flex flex-col items-center text-center p-3 rounded-xl bg-neutral-800/30 border border-neutral-700/30"
                  >
                    <feature.icon className="w-6 h-6 text-orange-400 mb-2" />
                    <span className="text-white text-xs font-medium">{feature.title}</span>
                    <span className="text-neutral-500 text-[10px] mt-0.5">{feature.description}</span>
                  </motion.div>
                ))}
              </motion.div>

              {/* Disclaimer */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
                className="space-y-3 mb-6"
              >
                <div className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl">
                  <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-amber-200/80 text-xs">
                    This platform involves financial transactions and prediction markets.
                    You are solely responsible for your actions.
                  </p>
                </div>

                {/* Age verification */}
                <label className="flex items-center gap-3 p-3 bg-neutral-800/50 rounded-xl cursor-pointer group">
                  <div className="relative">
                    <input
                      type="checkbox"
                      checked={ageConfirmed}
                      onChange={(e) => setAgeConfirmed(e.target.checked)}
                      className="sr-only"
                    />
                    <div className={`w-5 h-5 rounded border-2 transition-colors ${
                      ageConfirmed
                        ? 'bg-orange-500 border-orange-500'
                        : 'border-neutral-600 group-hover:border-neutral-500'
                    }`}>
                      {ageConfirmed && (
                        <motion.svg
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
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
                  <span className="text-neutral-300 text-sm">
                    I confirm that I am at least 18 years old
                  </span>
                </label>

                {/* Terms acceptance */}
                <label className="flex items-center gap-3 p-3 bg-neutral-800/50 rounded-xl cursor-pointer group">
                  <div className="relative">
                    <input
                      type="checkbox"
                      checked={termsAccepted}
                      onChange={(e) => setTermsAccepted(e.target.checked)}
                      className="sr-only"
                    />
                    <div className={`w-5 h-5 rounded border-2 transition-colors ${
                      termsAccepted
                        ? 'bg-orange-500 border-orange-500'
                        : 'border-neutral-600 group-hover:border-neutral-500'
                    }`}>
                      {termsAccepted && (
                        <motion.svg
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
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
                  <span className="text-neutral-300 text-sm">
                    I understand that I use this platform at my own risk
                  </span>
                </label>
              </motion.div>

              {/* Enter button */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.6 }}
              >
                <motion.button
                  whileHover={canProceed ? { scale: 1.02 } : {}}
                  whileTap={canProceed ? { scale: 0.98 } : {}}
                  onClick={canProceed ? onAccept : undefined}
                  disabled={!canProceed}
                  className={`w-full py-4 rounded-xl font-semibold text-white flex items-center justify-center gap-2 transition-all ${
                    canProceed
                      ? 'bg-linear-to-r from-orange-500 to-orange-600 hover:from-orange-400 hover:to-orange-500 shadow-lg shadow-orange-500/25'
                      : 'bg-neutral-700 cursor-not-allowed opacity-50'
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
