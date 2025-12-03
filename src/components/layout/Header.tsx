import { Sparkles, Github } from 'lucide-react';
import { motion } from 'framer-motion';
import { isMock } from '../../hooks/useAgentChat';
import { ThemeToggle } from '../theme';

const DiscordIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
  </svg>
);

export function Header() {
  return (
    <header className="border-b border-neutral-200 dark:border-neutral-800/50 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-2xl sticky top-0 z-50 overflow-hidden theme-transition">
      {/* Background decorative elements */}
      <div className="absolute top-0 left-0 w-96 h-full bg-linear-to-r from-orange-500/5 dark:from-orange-500/10 to-transparent blur-3xl" />
      <div className="absolute top-0 right-0 w-96 h-full bg-linear-to-l from-purple-500/5 dark:from-purple-500/10 to-transparent blur-3xl" />

      {/* Animated gradient line on top */}
      <div className="absolute top-0 left-0 right-0 h-0.5 bg-linear-to-r from-transparent via-orange-500 to-transparent opacity-50" />

      <div className="max-w-[1800px] mx-auto px-3 sm:px-6 lg:px-8 h-14 sm:h-16 lg:h-20 flex items-center justify-between relative z-10">
        <div className="flex items-center gap-2 sm:gap-3 lg:gap-4">
          {/* Logo with enhanced effects */}
          <motion.div
            whileHover={{ scale: 1.05, rotate: 5 }}
            className="relative"
          >
              <img
                src="/Union.svg"
                alt="Logo"
                className="relative z-10 w-7 h-7 sm:w-9 sm:h-9 lg:w-11 lg:h-11"
              />
          </motion.div>

          <div className="relative">
            <div className="flex items-center gap-1.5 sm:gap-2">
              <h1 className="text-base sm:text-lg lg:text-xl text-neutral-900 dark:text-white bg-clip-text">AgentSphere</h1>
              <Sparkles className="w-3 h-3 sm:w-4 sm:h-4 text-orange-500 animate-pulse" />
              {isMock() && (
                <span className="px-1.5 sm:px-2 py-0.5 rounded-full text-[10px] sm:text-xs bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 border border-yellow-500/30">
                  DEMO
                </span>
              )}
            </div>
            <p className="text-[10px] sm:text-xs text-neutral-500 dark:text-neutral-400">AI-Powered Agent Platform</p>

            {/* Decorative underline */}
            <div className="absolute -bottom-1 left-0 w-16 sm:w-20 h-0.5 bg-linear-to-r from-orange-500 to-transparent rounded-full" />
          </div>
        </div>

        <div className="flex items-center gap-1 sm:gap-2 lg:gap-3">
          {/* Social Links */}
          <motion.a
            href="https://github.com/unicitynetwork"
            target="_blank"
            rel="noopener noreferrer"
            whileHover={{ scale: 1.05, y: -2 }}
            whileTap={{ scale: 0.95 }}
            transition={{ duration: 0.05 }}
            className="relative p-2 sm:p-2.5 lg:p-3 hover:bg-neutral-100 dark:hover:bg-neutral-800/80 rounded-lg sm:rounded-xl transition-all group"
          >
            <Github className="w-4 h-4 sm:w-5 sm:h-5 text-neutral-500 dark:text-neutral-400 group-hover:text-orange-400 transition-colors" />
            <div className="absolute inset-0 rounded-lg sm:rounded-xl bg-orange-500/0 group-hover:bg-orange-500/10 transition-colors" />
          </motion.a>

          <motion.a
            href="https://discord.gg/S9f57ZKdt"
            target="_blank"
            rel="noopener noreferrer"
            whileHover={{ scale: 1.05, y: -2 }}
            whileTap={{ scale: 0.95 }}
            transition={{ duration: 0.05 }}
            className="relative p-2 sm:p-2.5 lg:p-3 hover:bg-neutral-100 dark:hover:bg-neutral-800/80 rounded-lg sm:rounded-xl transition-all group"
          >
            <DiscordIcon className="w-4 h-4 sm:w-5 sm:h-5 text-neutral-500 dark:text-neutral-400 group-hover:text-orange-400 transition-colors" />
            <div className="absolute inset-0 rounded-lg sm:rounded-xl bg-orange-500/0 group-hover:bg-orange-500/10 transition-colors" />
          </motion.a>

          {/* Theme Toggle */}
          <ThemeToggle />

          {/* Notification Button */}
          {/* <motion.button
            whileHover={{ scale: 1.05, y: -2 }}
            whileTap={{ scale: 0.95 }}
            transition={{duration: 0.05}}
            className="relative p-2 sm:p-2.5 lg:p-3 hover:bg-neutral-100 dark:hover:bg-neutral-800/80 rounded-lg sm:rounded-xl transition-all group"
          >
            <Bell className="w-4 h-4 sm:w-5 sm:h-5 text-neutral-500 dark:text-neutral-400 group-hover:text-orange-400 transition-colors" />

            <span className="absolute top-1.5 sm:top-2 right-1.5 sm:right-2 w-1.5 sm:w-2 h-1.5 sm:h-2 bg-orange-500 rounded-full">
              <span className="absolute inset-0 bg-orange-500 rounded-full animate-ping" />
            </span>

            <div className="absolute inset-0 rounded-lg sm:rounded-xl bg-orange-500/0 group-hover:bg-orange-500/10 transition-colors" />
          </motion.button> */}

          {/* Settings Button */}
          {/* <motion.button
            whileHover={{ scale: 1.05, y: -2 }}
            whileTap={{ scale: 0.95 }}
            transition={{duration: 0.05}}
            className="relative p-2 sm:p-2.5 lg:p-3 hover:bg-neutral-100 dark:hover:bg-neutral-800/80 rounded-lg sm:rounded-xl transition-all group"
          >
            <Settings className="w-4 h-4 sm:w-5 sm:h-5 text-neutral-500 dark:text-neutral-400 group-hover:text-orange-400 transition-colors" />
            <div className="absolute inset-0 rounded-lg sm:rounded-xl bg-orange-500/0 group-hover:bg-orange-500/10 transition-colors" />
          </motion.button> */}

        </div>
      </div>

      {/* Bottom gradient line */}
      <div className="absolute bottom-0 left-0 right-0 h-px bg-linear-to-r from-transparent via-neutral-300 dark:via-neutral-700 to-transparent" />
    </header>
  );
}
