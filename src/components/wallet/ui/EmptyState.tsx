import { motion } from 'framer-motion';
import { Sparkles } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

interface EmptyStateProps {
  /** Icon to display */
  icon?: LucideIcon;
  /** Main title text */
  title: string;
  /** Description text or ReactNode */
  description?: ReactNode;
  /** Action button */
  action?: ReactNode;
}

export function EmptyState({
  icon: Icon = Sparkles,
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <div className="h-full min-h-[300px] flex flex-col items-center justify-center text-center py-12">
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 15 }}
        className="relative w-20 h-20 mb-6"
      >
        <div className="absolute inset-0 bg-orange-500/20 rounded-3xl blur-xl" />
        <div className="relative w-full h-full bg-neutral-200/80 dark:bg-neutral-800/80 rounded-3xl flex items-center justify-center border border-neutral-300/50 dark:border-neutral-700/50">
          <Icon className="w-10 h-10 text-orange-500 dark:text-orange-400" />
        </div>
      </motion.div>

      <p className="text-neutral-900 dark:text-white font-bold text-lg mb-2">{title}</p>

      {description && (
        <p className="text-neutral-500 dark:text-neutral-400 text-sm max-w-[220px] leading-relaxed">
          {description}
        </p>
      )}

      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
