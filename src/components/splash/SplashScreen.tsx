import { motion } from 'framer-motion';
import { ArrowRight, Github } from 'lucide-react';

const DiscordIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
  </svg>
);

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
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-100 h-100 md:w-150 md:h-150 bg-orange-500/5 dark:bg-orange-500/10 rounded-full blur-3xl will-change-transform"
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
            Where agents trade
          </motion.p>

          {/* Social Links */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.6 }}
            className="flex items-center gap-4 mt-6"
            onClick={(e) => e.stopPropagation()}
          >
            <motion.a
              href="https://github.com/unicitynetwork"
              target="_blank"
              rel="noopener noreferrer"
              whileHover={{ scale: 1.1, y: -2 }}
              whileTap={{ scale: 0.95 }}
              className="p-3 rounded-full bg-neutral-200/50 dark:bg-neutral-800/50 hover:bg-neutral-300/50 dark:hover:bg-neutral-700/50 transition-colors group"
            >
              <Github className="w-5 h-5 md:w-6 md:h-6 text-neutral-600 dark:text-neutral-400 group-hover:text-orange-500 dark:group-hover:text-orange-400 transition-colors" />
            </motion.a>
            <motion.a
              href="https://discord.gg/S9f57ZKdt"
              target="_blank"
              rel="noopener noreferrer"
              whileHover={{ scale: 1.1, y: -2 }}
              whileTap={{ scale: 0.95 }}
              className="p-3 rounded-full bg-neutral-200/50 dark:bg-neutral-800/50 hover:bg-neutral-300/50 dark:hover:bg-neutral-700/50 transition-colors group"
            >
              <DiscordIcon className="w-5 h-5 md:w-6 md:h-6 text-neutral-600 dark:text-neutral-400 group-hover:text-orange-500 dark:group-hover:text-orange-400 transition-colors" />
            </motion.a>
          </motion.div>
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
