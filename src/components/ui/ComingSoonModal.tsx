import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

interface ComingSoonModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
}

export function ComingSoonModal({ isOpen, onClose, title = 'Get API Key' }: ComingSoonModalProps) {
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
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50"
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md p-4"
          >
            <div className="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 shadow-2xl overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between p-4 border-b border-neutral-200 dark:border-neutral-700">
                <h3 className="text-lg font-semibold text-neutral-900 dark:text-white">{title}</h3>
                <button
                  onClick={onClose}
                  className="p-1 hover:bg-neutral-100 dark:hover:bg-neutral-700 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5 text-neutral-500" />
                </button>
              </div>

              {/* Content */}
              <div className="p-6 text-center">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-orange-500/20 to-amber-500/20 flex items-center justify-center">
                  <span className="text-3xl">🚀</span>
                </div>
                <h4 className="text-xl font-semibold text-neutral-900 dark:text-white mb-2">Coming Soon</h4>
                <p className="text-neutral-600 dark:text-neutral-400 mb-6">
                  API keys will be available soon. Join our Discord to be notified when we launch!
                </p>
                <div className="flex gap-3 justify-center">
                  <a
                    href="https://discord.gg/S9f57ZKdt"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="bg-gradient-to-r from-orange-500 to-amber-500 text-white px-5 py-2.5 rounded-xl font-medium hover:opacity-90 transition shadow-lg shadow-orange-500/25"
                  >
                    Join Discord
                  </a>
                  <button
                    onClick={onClose}
                    className="px-5 py-2.5 rounded-xl font-medium border border-neutral-300 dark:border-neutral-600 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
