import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ReactNode } from 'react';

type IconVariant = 'gradient' | 'neutral';

interface ModalHeaderProps {
  title: string;
  onClose: () => void;
  /** Icon to display in badge */
  icon?: LucideIcon;
  /** Icon badge style: 'gradient' (orange) or 'neutral' (grey) */
  iconVariant?: IconVariant;
  /** Subtitle text or ReactNode below title */
  subtitle?: ReactNode;
  /** Disable close button */
  closeDisabled?: boolean;
}

const iconVariantClasses: Record<IconVariant, { badge: string; icon: string }> = {
  gradient: {
    badge: 'bg-linear-to-br from-orange-500 to-orange-600 shadow-lg shadow-orange-500/30',
    icon: 'text-white',
  },
  neutral: {
    badge: 'bg-neutral-100 dark:bg-neutral-800',
    icon: 'text-neutral-600 dark:text-neutral-400',
  },
};

export function ModalHeader({
  title,
  onClose,
  icon: Icon,
  iconVariant = 'gradient',
  subtitle,
  closeDisabled = false,
}: ModalHeaderProps) {
  const iconStyles = iconVariantClasses[iconVariant];

  return (
    <div className="relative z-10 px-6 py-3 border-b border-neutral-200/50 dark:border-neutral-700/50 flex justify-between items-center shrink-0">
      <div className="flex items-center gap-3">
        {Icon && (
          <motion.div
            whileHover={{ scale: 1.05 }}
            className={`relative w-11 h-11 rounded-xl flex items-center justify-center ${iconStyles.badge}`}
          >
            <Icon className={`w-5 h-5 ${iconStyles.icon}`} />
          </motion.div>
        )}
        <div>
          <h3 className="text-lg font-bold text-neutral-900 dark:text-white">{title}</h3>
          {subtitle && (
            <div className="text-xs text-neutral-500 dark:text-neutral-400">{subtitle}</div>
          )}
        </div>
      </div>

      <motion.button
        whileHover={closeDisabled ? {} : { scale: 1.1 }}
        whileTap={closeDisabled ? {} : { scale: 0.9 }}
        onClick={onClose}
        disabled={closeDisabled}
        className={`w-9 h-9 flex items-center justify-center rounded-xl transition-colors ${
          closeDisabled
            ? 'bg-neutral-200/50 dark:bg-neutral-800/50 text-neutral-400 dark:text-neutral-600 cursor-not-allowed'
            : 'hover:bg-neutral-200/80 dark:hover:bg-neutral-800/80 text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-white'
        }`}
      >
        <X className="w-4 h-4" />
      </motion.button>
    </div>
  );
}
