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
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#FEFEFE] dark:bg-neutral-950 cursor-pointer"
      onClick={onEnter}
    >
      {/* Subtle background orbs */}
      <motion.div
        className="absolute top-1/4 left-1/4 w-48 h-48 md:w-96 md:h-96 bg-[#FF6F00]/8 dark:bg-[#FF6F00]/15 rounded-full blur-2xl md:blur-3xl"
        animate={{
          scale: [1, 1.2, 1],
          opacity: [0.08, 0.15, 0.08],
        }}
        transition={{
          duration: 4,
          repeat: Infinity,
          ease: "easeInOut"
        }}
      />
      <motion.div
        className="absolute bottom-1/4 right-1/4 w-48 h-48 md:w-96 md:h-96 bg-[#932D00]/6 dark:bg-[#932D00]/15 rounded-full blur-2xl md:blur-3xl"
        animate={{
          scale: [1, 1.3, 1],
          opacity: [0.06, 0.12, 0.06],
        }}
        transition={{
          duration: 5,
          repeat: Infinity,
          ease: "easeInOut",
          delay: 1
        }}
      />
      <motion.div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] md:w-[600px] md:h-[600px] bg-[#FF6F00]/4 dark:bg-[#FF6F00]/8 rounded-full blur-3xl will-change-transform"
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
          {/* Unicity Logo */}
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            className="mb-6 md:mb-8"
          >
            <img
              src="/images/unicity_logo.svg"
              alt="Unicity"
              className="h-8 md:h-10 w-auto dark:invert"
            />
          </motion.div>

          {/* Logo text container */}
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.8, ease: "easeOut", delay: 0.1 }}
            className="relative mb-4 md:mb-6"
          >
            {/* Glow effect behind logo */}
            <div
              className="absolute inset-0 bg-[#FF6F00]/8 dark:bg-[#FF6F00]/15 blur-2xl md:blur-3xl"
              style={{ animation: 'pulse-slow 3s ease-in-out infinite' }}
            />

            {/* Logo text */}
            <div className="relative flex items-center justify-center gap-0">
              {/* AGENT text */}
              <span
                className="text-4xl sm:text-5xl md:text-7xl lg:text-8xl text-[#020202] dark:text-white tracking-tight"
                style={{ fontFamily: "'Anton', sans-serif", fontWeight: 400 }}
              >
                AGENT
              </span>

              {/* SPHERE text */}
              <motion.span
                className="text-4xl sm:text-5xl md:text-7xl lg:text-8xl text-[#FF6F00] tracking-tight"
                initial={{ x: -20, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ duration: 0.8, delay: 0.3 }}
                style={{ fontFamily: "'Anton', sans-serif", fontWeight: 400 }}
              >
                SPHERE
              </motion.span>
            </div>
          </motion.div>

          {/* Tagline */}
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.5 }}
            className="text-[#020202]/50 dark:text-neutral-400 text-sm sm:text-base md:text-lg lg:text-xl tracking-wide"
            style={{ fontFamily: "'Geist', Arial, sans-serif" }}
          >
            Dive in and feel the difference
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
              className="p-3 rounded-full bg-[#020202]/5 dark:bg-white/10 hover:bg-[#020202]/10 dark:hover:bg-white/15 transition-colors group"
            >
              <Github className="w-5 h-5 md:w-6 md:h-6 text-[#020202]/50 dark:text-neutral-400 group-hover:text-[#FF6F00] transition-colors" />
            </motion.a>
            <motion.a
              href="https://discord.gg/S9f57ZKdt"
              target="_blank"
              rel="noopener noreferrer"
              whileHover={{ scale: 1.1, y: -2 }}
              whileTap={{ scale: 0.95 }}
              className="p-3 rounded-full bg-[#020202]/5 dark:bg-white/10 hover:bg-[#020202]/10 dark:hover:bg-white/15 transition-colors group"
            >
              <DiscordIcon className="w-5 h-5 md:w-6 md:h-6 text-[#020202]/50 dark:text-neutral-400 group-hover:text-[#FF6F00] transition-colors" />
            </motion.a>
          </motion.div>
        </div>

        {/* Tap to join button */}
        <motion.button
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.8 }}
          className="flex items-center gap-3 group mt-8"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          <span
            className="relative z-10 text-[#020202]/50 dark:text-neutral-400 group-hover:text-[#FF6F00] transition-colors text-sm md:text-base"
            style={{ fontFamily: "'Geist', Arial, sans-serif" }}
          >
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
            <ArrowRight className="w-4 h-4 md:w-5 md:h-5 relative z-10 text-[#FF6F00]" />
          </motion.div>
        </motion.button>
      </div>

      {/* Subtle mesh gradient overlay */}
      <div
        className="absolute inset-0 opacity-10 dark:opacity-20 pointer-events-none"
        style={{
          backgroundImage: `
            radial-gradient(at 20% 30%, rgba(255, 111, 0, 0.1) 0px, transparent 50%),
            radial-gradient(at 80% 70%, rgba(147, 45, 0, 0.08) 0px, transparent 50%)
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
