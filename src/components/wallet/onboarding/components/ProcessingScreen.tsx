/**
 * ProcessingScreen - Shows progress during wallet creation, import, and logout
 */
import { motion } from "framer-motion";
import { Loader2, CheckCircle2 } from "lucide-react";

interface ProcessingScreenProps {
  status: string;
  currentStep?: number;
  totalSteps?: number;
  title?: string;
  completeTitle?: string;
  completeButtonText?: string;
  isComplete?: boolean;
  onComplete?: () => void;
}

export function ProcessingScreen({
  status,
  currentStep = 0,
  totalSteps = 3,
  title = "Setting up Profile...",
  completeTitle = "Profile Ready!",
  completeButtonText = "Let's go!",
  isComplete = false,
  onComplete,
}: ProcessingScreenProps) {
  return (
    <motion.div
      key="processing"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.1 }}
      className="relative z-10 text-center w-full max-w-90"
    >
      {/* Animated Loading Spinner or Success Icon */}
      <div className="relative mx-auto w-22 h-22 mb-6">
        {!isComplete ? (
          <>
            {/* Outer Ring */}
            <motion.div
              className="absolute inset-0 border-3 border-neutral-200 dark:border-neutral-800/50 rounded-full"
              animate={{ rotate: 360 }}
              transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
            />

            {/* Middle Ring */}
            <motion.div
              className="absolute inset-1.5 border-3 border-orange-500/30 rounded-full border-t-orange-500 border-r-orange-500"
              animate={{ rotate: -360 }}
              transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
            />

            {/* Inner Glow */}
            <div className="absolute inset-3 bg-orange-500/20 rounded-full blur-xl" />

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
                <Loader2 className="w-8 h-8 text-orange-500 dark:text-orange-400 animate-spin" />
              </motion.div>
            </div>
          </>
        ) : (
          /* Success State */
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 200, damping: 15 }}
            className="absolute inset-0 flex items-center justify-center"
          >
            <div className="relative">
              {/* Success Glow */}
              <div className="absolute inset-0 bg-emerald-500/30 rounded-full blur-xl" />
              {/* Success Icon */}
              <CheckCircle2 className="w-22 h-22 text-emerald-500 dark:text-emerald-400" />
            </div>
          </motion.div>
        )}
      </div>

      <motion.h3
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="text-xl font-bold text-neutral-900 dark:text-white mb-5 tracking-tight"
      >
        {isComplete ? completeTitle : title}
      </motion.h3>

      {/* Dynamic Progress Status */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="space-y-2 text-xs"
      >
        {/* Current status indicator */}
        <motion.div
          key={status}
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="flex items-center gap-2 text-neutral-700 dark:text-neutral-300 bg-orange-50 dark:bg-orange-900/20 px-3 py-2.5 rounded-lg backdrop-blur-sm border border-orange-200 dark:border-orange-700/30"
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
            className="w-2 h-2 rounded-full bg-orange-500 dark:bg-orange-400 shrink-0"
          />
          <span className="text-left font-medium">
            {status || "Initializing..."}
          </span>
        </motion.div>

        {/* Step indicators */}
        <div className="flex items-center justify-center gap-2 mt-4">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div
              key={i}
              className={`w-2 h-2 rounded-full transition-colors duration-300 ${
                isComplete
                  ? 'bg-emerald-500'
                  : i < currentStep
                    ? 'bg-emerald-500'
                    : i === currentStep
                      ? 'bg-orange-500'
                      : 'bg-neutral-300 dark:bg-neutral-600'
              }`}
            />
          ))}
        </div>
      </motion.div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1 }}
        className="mt-4 text-[10px] text-neutral-400 dark:text-neutral-500"
      >
        This may take a few moments...
      </motion.p>

      {/* Complete Button */}
      {isComplete && onComplete && (
        <motion.button
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, type: "spring", stiffness: 200 }}
          onClick={onComplete}
          className="mt-6 w-full px-5 py-3.5 bg-linear-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white font-bold text-sm rounded-xl shadow-lg hover:shadow-xl transition-all duration-200 transform hover:scale-[1.02] active:scale-[0.98]"
        >
          {completeButtonText}
        </motion.button>
      )}
    </motion.div>
  );
}
