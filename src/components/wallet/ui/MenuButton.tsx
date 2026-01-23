import { motion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ReactNode } from 'react';

type MenuButtonColor = 'blue' | 'green' | 'red' | 'orange' | 'purple' | 'neutral';

interface MenuButtonProps {
  /** Icon to display */
  icon: LucideIcon;
  /** Icon background color */
  color?: MenuButtonColor;
  /** Main label text */
  label: string;
  /** Optional subtitle */
  subtitle?: ReactNode;
  /** Click handler */
  onClick: () => void;
  /** Show chevron arrow */
  showChevron?: boolean;
  /** Danger variant (red text) */
  danger?: boolean;
}

const colorClasses: Record<MenuButtonColor, { bg: string; icon: string }> = {
  blue: { bg: 'bg-blue-500/10', icon: 'text-blue-500' },
  green: { bg: 'bg-green-500/10', icon: 'text-green-500' },
  red: { bg: 'bg-red-500/10', icon: 'text-red-500' },
  orange: { bg: 'bg-orange-500/10', icon: 'text-orange-500' },
  purple: { bg: 'bg-purple-500/10', icon: 'text-purple-500' },
  neutral: { bg: 'bg-neutral-500/10', icon: 'text-neutral-500' },
};

export function MenuButton({
  icon: Icon,
  color = 'blue',
  label,
  subtitle,
  onClick,
  showChevron = true,
  danger = false,
}: MenuButtonProps) {
  const colorConfig = colorClasses[color];

  return (
    <motion.button
      whileHover={{ scale: 1.01, x: 2 }}
      whileTap={{ scale: 0.99 }}
      onClick={onClick}
      className={`w-full flex items-center gap-4 p-4 bg-neutral-50 dark:bg-neutral-800/50 rounded-2xl transition-colors group ${
        danger
          ? 'hover:bg-red-50 dark:hover:bg-red-900/10'
          : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'
      }`}
    >
      <div className={`w-12 h-12 rounded-xl ${colorConfig.bg} flex items-center justify-center shrink-0`}>
        <Icon className={`w-6 h-6 ${colorConfig.icon}`} />
      </div>
      <div className="flex-1 text-left min-w-0">
        <span className={`font-semibold block ${danger ? 'text-red-500' : 'text-neutral-900 dark:text-white'}`}>
          {label}
        </span>
        {subtitle && (
          <span className="text-xs text-neutral-500 dark:text-neutral-400 truncate block">
            {subtitle}
          </span>
        )}
      </div>
      {showChevron && !danger && (
        <ChevronRight className="w-5 h-5 text-neutral-400 group-hover:text-neutral-600 dark:group-hover:text-neutral-300 transition-colors shrink-0" />
      )}
    </motion.button>
  );
}
