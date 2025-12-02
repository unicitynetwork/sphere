import { Sparkles } from 'lucide-react';
import { motion } from 'framer-motion';
import { isMock } from '../../hooks/useAgentChat';
import { ThemeToggle } from '../theme';

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
