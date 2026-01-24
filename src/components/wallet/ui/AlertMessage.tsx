import { motion } from 'framer-motion';
import { XCircle, AlertTriangle, CheckCircle, Info, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ReactNode } from 'react';

type AlertVariant = 'error' | 'warning' | 'success' | 'info';

interface AlertMessageProps {
  variant: AlertVariant;
  children: ReactNode;
  /** Optional title for multi-line alerts */
  title?: string;
  /** Show dismiss button */
  onDismiss?: () => void;
  /** Custom icon override */
  icon?: LucideIcon;
}

const variantConfig: Record<AlertVariant, {
  icon: LucideIcon;
  bgClass: string;
  borderClass: string;
  textClass: string;
  iconClass: string;
}> = {
  error: {
    icon: XCircle,
    bgClass: 'bg-red-500/10',
    borderClass: 'border-red-500/20',
    textClass: 'text-red-600 dark:text-red-400',
    iconClass: 'text-red-500 dark:text-red-400',
  },
  warning: {
    icon: AlertTriangle,
    bgClass: 'bg-amber-500/10',
    borderClass: 'border-amber-500/20',
    textClass: 'text-amber-600 dark:text-amber-400',
    iconClass: 'text-amber-500 dark:text-amber-400',
  },
  success: {
    icon: CheckCircle,
    bgClass: 'bg-green-500/10',
    borderClass: 'border-green-500/20',
    textClass: 'text-green-600 dark:text-green-400',
    iconClass: 'text-green-500 dark:text-green-400',
  },
  info: {
    icon: Info,
    bgClass: 'bg-blue-500/10',
    borderClass: 'border-blue-500/20',
    textClass: 'text-blue-600 dark:text-blue-400',
    iconClass: 'text-blue-500 dark:text-blue-400',
  },
};

export function AlertMessage({
  variant,
  children,
  title,
  onDismiss,
  icon: CustomIcon,
}: AlertMessageProps) {
  const config = variantConfig[variant];
  const Icon = CustomIcon || config.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className={`p-4 ${config.bgClass} border ${config.borderClass} rounded-xl`}
    >
      {title ? (
        // Layout with title: icon centered with title, description below
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <Icon className={`w-5 h-5 ${config.iconClass} shrink-0`} />
            <p className={`text-sm font-bold ${config.textClass}`}>{title}</p>
            {onDismiss && (
              <button
                onClick={onDismiss}
                className={`${config.iconClass} hover:opacity-70 transition-opacity shrink-0 ml-auto`}
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <div className={`text-xs ${config.textClass} opacity-80 pl-8`}>
            {children}
          </div>
        </div>
      ) : (
        // Simple layout without title
        <div className="flex items-start gap-2">
          <Icon className={`w-4 h-4 ${config.iconClass} shrink-0 mt-0.5`} />
          <div className={`flex-1 min-w-0 text-xs ${config.textClass}`}>
            {children}
          </div>
          {onDismiss && (
            <button
              onClick={onDismiss}
              className={`${config.iconClass} hover:opacity-70 transition-opacity shrink-0`}
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      )}
    </motion.div>
  );
}
