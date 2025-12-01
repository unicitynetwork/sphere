import { Sun, Moon } from 'lucide-react';
import { motion } from 'framer-motion';
import { useTheme } from '../../hooks/useTheme';

export function ThemeToggle() {
  const { isDark, toggleTheme } = useTheme();

  return (
    <motion.button
      onClick={toggleTheme}
      whileHover={{ scale: 1.05, y: -2 }}
      whileTap={{ scale: 0.95 }}
      transition={{ duration: 0.05 }}
      className="relative p-2 sm:p-2.5 lg:p-3 rounded-lg sm:rounded-xl transition-all group bg-transparent hover:bg-theme-bg-tertiary dark:hover:bg-neutral-800/80"
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      <div className="relative w-4 h-4 sm:w-5 sm:h-5">
        <motion.div
          initial={false}
          animate={{
            scale: isDark ? 1 : 0,
            opacity: isDark ? 1 : 0,
            rotate: isDark ? 0 : 180,
          }}
          transition={{ duration: 0.2 }}
          className="absolute inset-0 flex items-center justify-center"
        >
          <Moon className="w-4 h-4 sm:w-5 sm:h-5 text-theme-text-secondary group-hover:text-orange-400 transition-colors" />
        </motion.div>
        <motion.div
          initial={false}
          animate={{
            scale: isDark ? 0 : 1,
            opacity: isDark ? 0 : 1,
            rotate: isDark ? -180 : 0,
          }}
          transition={{ duration: 0.2 }}
          className="absolute inset-0 flex items-center justify-center"
        >
          <Sun className="w-4 h-4 sm:w-5 sm:h-5 text-theme-text-secondary group-hover:text-orange-400 transition-colors" />
        </motion.div>
      </div>

      {/* Glow on hover */}
      <div className="absolute inset-0 rounded-lg sm:rounded-xl bg-orange-500/0 group-hover:bg-orange-500/10 transition-colors" />
    </motion.button>
  );
}
