import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';

interface SplashScreenProps {
  onEnter: () => void;
}

export function SplashScreen({ onEnter }: SplashScreenProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-linear-to-br from-neutral-100 via-white to-neutral-100 dark:from-neutral-950 dark:via-neutral-900 dark:to-neutral-950 cursor-pointer"
      onClick={onEnter}
    >
      {/* Simplified background orbs - reduced blur and size on mobile */}
      <motion.div
        className="absolute top-1/4 left-1/4 w-48 h-48 md:w-96 md:h-96 bg-orange-500/10 dark:bg-orange-500/20 rounded-full blur-2xl md:blur-3xl"
        animate={{
          scale: [1, 1.2, 1],
          opacity: [0.1, 0.2, 0.1],
        }}
        transition={{
          duration: 4,
          repeat: Infinity,
          ease: "easeInOut"
        }}
      />
      <motion.div
        className="absolute bottom-1/4 right-1/4 w-48 h-48 md:w-96 md:h-96 bg-purple-500/10 dark:bg-purple-500/20 rounded-full blur-2xl md:blur-3xl "
        animate={{
          scale: [1, 1.3, 1],
          opacity: [0.1, 0.2, 0.1],
        }}
        transition={{
          duration: 5,
          repeat: Infinity,
          ease: "easeInOut",
          delay: 1
        }}
      />
      <motion.div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] md:w-[600px] md:h-[600px] bg-orange-500/5 dark:bg-orange-500/10 rounded-full blur-3xl will-change-transform"
        animate={{
          scale: [1, 1.2, 1],
          rotate: [0, 180, 360],
        }}
        transition={{
          duration: 20,
          repeat: Infinity,
          ease: "easeInOut"
        }}
        style={{ backfaceVisibility: 'hidden', perspective: 1000 }}
      />

      {/* Main content container */}
      <div className="relative z-10 text-center px-4 md:px-8 flex flex-col items-center justify-between h-full py-12 md:py-20">
        <div className="flex-1 flex flex-col items-center justify-center">
          {/* Logo container */}
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="relative mb-6 md:mb-12"
          >
            {/* Glow effect behind logo - simplified */}
            <div
              className="absolute inset-0 bg-linear-to-r from-orange-500/10 dark:from-orange-500/20 to-orange-600/10 dark:to-orange-600/20 blur-2xl md:blur-3xl"
              style={{ animation: 'pulse-slow 3s ease-in-out infinite' }}
            />

            {/* Logo text */}
            <div className="relative flex items-center justify-center gap-0 flex-wrap">
              <motion.div
                className="relative"
                animate={{
                  textShadow: [
                    "0 0 20px rgba(0, 0, 0, 0.1)",
                    "0 0 30px rgba(0, 0, 0, 0.15)",
                    "0 0 20px rgba(0, 0, 0, 0.1)",
                  ],
                }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  ease: "easeInOut"
                }}
              >
                {/* AGENT text */}
                <span
                  className="text-4xl sm:text-5xl md:text-7xl lg:text-8xl text-neutral-900 dark:text-white tracking-tight"
                  style={{ fontFamily: 'system-ui, -apple-system, sans-serif', fontWeight: 900 }}
                >
                  AGENT
                </span>
              </motion.div>


              {/* SPHERE text with gradient */}
              <motion.div
                className="relative"
                initial={{ x: -20, opacity: 0 }}
                animate={{
                  x: 0,
                  opacity: 1,
                }}
                transition={{ duration: 0.8, delay: 0.3 }}
              >
                <motion.span
                  className="text-4xl sm:text-5xl md:text-7xl lg:text-8xl bg-linear-to-r from-orange-500 via-orange-400 to-orange-600 bg-clip-text text-transparent tracking-tight"
                  style={{
                    fontFamily: 'system-ui, -apple-system, sans-serif',
                    fontWeight: 900,
                  }}
                  animate={{
                    backgroundPosition: ['0% 50%', '100% 50%', '0% 50%'],
                  }}
                  transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}

                >
                  SPHERE
                </motion.span>
              </motion.div>

            </div>
          </motion.div>

          {/* Tagline */}
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.5 }}
            className="text-neutral-500 dark:text-neutral-400 text-sm sm:text-base md:text-lg lg:text-xl tracking-wide"
          >
            Dive in and feel the difference
          </motion.p>
        </div>

        {/* Tap to join button */}
        <motion.button
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.8 }}
          className="text-neutral-500 dark:text-neutral-400 flex items-center gap-3 group mt-8"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          <span className="relative z-10 group-hover:text-orange-500 dark:group-hover:text-orange-400 transition-colors text-sm md:text-base">
            Tap to join
          </span>
          <motion.div
            animate={{ x: [0, 5, 0] }}
            transition={{
              duration: 1.5,
              repeat: Infinity,
              ease: "easeInOut"
            }}
          >
            <ArrowRight className="w-4 h-4 md:w-5 md:h-5 relative z-10 text-orange-500 dark:text-orange-400" />
          </motion.div>
        </motion.button>
      </div>

      {/* Simplified mesh gradient overlay */}
      <div
        className="absolute inset-0 opacity-10 dark:opacity-20 md:opacity-15 md:dark:opacity-30 pointer-events-none"
        style={{
          backgroundImage: `
            radial-gradient(at 20% 30%, rgba(251, 146, 60, 0.15) 0px, transparent 50%),
            radial-gradient(at 80% 70%, rgba(168, 85, 247, 0.15) 0px, transparent 50%)
          `,
        }}
      />

      {/* CSS animation for performance */}
      <style>{`
        @keyframes pulse-slow {
          0%, 100% { transform: scale(1); opacity: 0.2; }
          50% { transform: scale(1.15); opacity: 0.3; }
        }
        @media (prefers-reduced-motion: reduce) {
          .will-change-transform {
            animation: none !important;
          }
        }
      `}</style>
    </motion.div>
  );
}
