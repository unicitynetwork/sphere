import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, User, AtSign, Loader2 } from 'lucide-react';

interface NewConversationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStart: (pubkeyOrNametag: string) => Promise<boolean>;
  initialValue?: string;
  autoSubmit?: boolean;
}

export function NewConversationModal({
  isOpen,
  onClose,
  onStart,
  initialValue,
  autoSubmit,
}: NewConversationModalProps) {
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasAutoSubmitted = useRef(false);

  const handleSubmitWithValue = useCallback(async (value: string) => {
    if (!value.trim()) return;

    setIsLoading(true);
    setError(null);

    try {
      const success = await onStart(value.trim());
      if (success) {
        setInput('');
        onClose();
      } else {
        setError(`Could not start conversation with "${value}". User not found.`);
      }
    } catch {
      setError('Failed to start conversation. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [onStart, onClose]);

  // Set initial value and optionally auto-submit when modal opens
  useEffect(() => {
    if (isOpen && initialValue) {
      setInput(initialValue);
      setError(null);

      // Auto-submit if requested and haven't already
      if (autoSubmit && !hasAutoSubmitted.current) {
        hasAutoSubmitted.current = true;
        // Small delay to ensure the modal is rendered
        setTimeout(() => {
          handleSubmitWithValue(initialValue);
        }, 100);
      }
    }

    // Reset when modal closes
    if (!isOpen) {
      hasAutoSubmitted.current = false;
    }
  }, [isOpen, initialValue, autoSubmit, handleSubmitWithValue]);

  const handleSubmit = async () => {
    if (!input.trim()) return;

    setIsLoading(true);
    setError(null);

    try {
      const success = await onStart(input.trim());
      if (success) {
        setInput('');
        onClose();
      } else {
        setError(`Could not start conversation with "${input.trim()}". User not found.`);
      }
    } catch {
      setError('Failed to start conversation. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-100001"
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md z-100001"
          >
            <div className="bg-white dark:bg-neutral-900 rounded-2xl shadow-2xl border border-neutral-200 dark:border-neutral-700/50 overflow-hidden">
              {/* Header */}
              <div className="p-4 border-b border-neutral-200 dark:border-neutral-800/50 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-linear-to-br from-orange-500 to-orange-600 flex items-center justify-center shadow-lg">
                    <User className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h3 className="text-neutral-900 dark:text-white font-medium">
                      New Conversation
                    </h3>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400">
                      Start a private chat
                    </p>
                  </div>
                </div>
                <motion.button
                  onClick={onClose}
                  className="p-2 rounded-lg bg-neutral-100 dark:bg-neutral-800/50 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-200 dark:hover:bg-neutral-700/50 transition-colors"
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                >
                  <X className="w-5 h-5" />
                </motion.button>
              </div>

              {/* Content */}
              <div className="p-4 space-y-4">
                <div>
                  <label className="block text-sm text-neutral-600 dark:text-neutral-400 mb-2">
                    Enter nametag or direct address
                  </label>
                  <div className="relative">
                    <AtSign className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-neutral-400" />
                    <input
                      type="text"
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder="e.g., alice or DIRECT://..."
                      className="w-full pl-10 pr-4 py-3 bg-neutral-100 dark:bg-neutral-800/50 text-neutral-900 dark:text-white placeholder-neutral-400 rounded-xl border border-neutral-200 dark:border-neutral-700/50 focus:outline-none focus:border-orange-500 transition-colors"
                      autoFocus
                    />
                  </div>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-2">
                    You can enter a nametag (without @) or a direct address
                  </p>
                </div>

                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-3 rounded-xl bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-sm"
                  >
                    {error}
                  </motion.div>
                )}
              </div>

              {/* Footer */}
              <div className="p-4 border-t border-neutral-200 dark:border-neutral-800/50 flex gap-3">
                <motion.button
                  onClick={onClose}
                  className="flex-1 py-3 rounded-xl bg-neutral-100 dark:bg-neutral-800/50 text-neutral-700 dark:text-neutral-300 font-medium border border-neutral-200 dark:border-neutral-700/50 hover:bg-neutral-200 dark:hover:bg-neutral-700/50 transition-colors"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  Cancel
                </motion.button>
                <motion.button
                  onClick={handleSubmit}
                  disabled={!input.trim() || isLoading}
                  className="flex-1 py-3 rounded-xl bg-linear-to-r from-orange-500 to-orange-600 text-white font-medium disabled:opacity-50 flex items-center justify-center gap-2"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Starting...</span>
                    </>
                  ) : (
                    <span>Start Chat</span>
                  )}
                </motion.button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
