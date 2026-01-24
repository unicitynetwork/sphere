import { motion, AnimatePresence } from 'framer-motion';
import type { ReactNode } from 'react';

type ModalSize = 'sm' | 'md' | 'lg';

interface BaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Modal max-width: sm (384px), md (448px), lg (512px) */
  size?: ModalSize;
  /** Show decorative background orbs */
  showOrbs?: boolean;
  /** Additional className for the modal container */
  className?: string;
}

const sizeClasses: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
};

export function BaseModal({
  isOpen,
  onClose,
  children,
  size = 'md',
  showOrbs = true,
  className = '',
}: BaseModalProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-100 bg-black/60 dark:bg-black/80 backdrop-blur-sm"
          />

          {/* Modal Container */}
          <div className="fixed inset-0 z-100 flex items-center justify-center p-4 sm:p-6 pointer-events-none">
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
              onClick={(e) => e.stopPropagation()}
              className={`relative w-full ${sizeClasses[size]} max-h-[70dvh] sm:max-h-[600px] bg-white dark:bg-[#111] border border-neutral-200 dark:border-white/10 rounded-3xl shadow-2xl pointer-events-auto flex flex-col overflow-hidden ${className}`}
            >
              {/* Background Orbs */}
              {showOrbs && (
                <>
                  <div className="absolute top-0 right-0 w-48 h-48 bg-orange-500/10 rounded-full blur-3xl pointer-events-none" />
                  <div className="absolute bottom-0 left-0 w-48 h-48 bg-purple-500/10 rounded-full blur-3xl pointer-events-none" />
                </>
              )}

              {children}
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
