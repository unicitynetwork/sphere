import { useState, useCallback } from 'react';
import { X, Loader2, ArrowRight, Tag } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import { useSphereContext } from '../../../../sdk/hooks/core/useSphere';
import { SPHERE_KEYS } from '../../../../sdk/queryKeys';

interface RegisterNametagModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function RegisterNametagModal({ isOpen, onClose }: RegisterNametagModalProps) {
  const [nametagInput, setNametagInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [success, setSuccess] = useState(false);

  const { sphere } = useSphereContext();
  const queryClient = useQueryClient();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.toLowerCase();
    if (/^[a-z0-9_\-+.]*$/.test(value)) {
      setNametagInput(value);
      setError(null);
    }
  };

  const handleSubmit = useCallback(async () => {
    if (!nametagInput.trim() || !sphere || isBusy) return;

    setIsBusy(true);
    setError(null);

    try {
      const cleanTag = nametagInput.trim().replace('@', '');

      const available = await sphere.isNametagAvailable(cleanTag);
      if (!available) {
        setError(`${cleanTag} already exists.`);
        setIsBusy(false);
        return;
      }

      await sphere.registerNametag(cleanTag);

      queryClient.invalidateQueries({ queryKey: SPHERE_KEYS.identity.all });
      queryClient.invalidateQueries({ queryKey: SPHERE_KEYS.payments.all });
      window.dispatchEvent(new Event('wallet-updated'));

      setSuccess(true);
      setTimeout(() => {
        onClose();
        setSuccess(false);
        setNametagInput('');
      }, 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Registration failed');
    } finally {
      setIsBusy(false);
    }
  }, [nametagInput, sphere, isBusy, queryClient, onClose]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && nametagInput && !isBusy) {
      handleSubmit();
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
          >
            <div className="w-full max-w-sm bg-white dark:bg-neutral-900 rounded-2xl shadow-2xl border border-neutral-200 dark:border-neutral-800 overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between p-4 border-b border-neutral-200 dark:border-neutral-800">
                <div className="flex items-center gap-2">
                  <Tag className="w-5 h-5 text-orange-500" />
                  <span className="text-base font-semibold text-neutral-900 dark:text-white">Register Unicity ID</span>
                </div>
                <button
                  onClick={onClose}
                  className="p-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                >
                  <X className="w-4 h-4 text-neutral-500" />
                </button>
              </div>

              {/* Content */}
              <div className="p-4 space-y-4">
                <p className="text-sm text-neutral-500 dark:text-neutral-400">
                  Choose a unique ID to receive tokens easily without sharing long addresses.
                </p>

                {success ? (
                  <div className="text-center py-4">
                    <p className="text-emerald-500 font-medium">Registered successfully!</p>
                  </div>
                ) : (
                  <>
                    <div className="relative group">
                      <div className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 dark:text-neutral-500 group-focus-within:text-orange-500 dark:group-focus-within:text-orange-400 transition-colors z-10 text-sm font-medium">
                        @unicity
                      </div>
                      <input
                        type="text"
                        value={nametagInput}
                        onChange={handleChange}
                        onKeyDown={handleKeyDown}
                        placeholder="id"
                        autoFocus
                        className="w-full bg-neutral-100 dark:bg-neutral-800/50 border-2 border-neutral-200 dark:border-neutral-700/50 rounded-xl py-3 pl-4 pr-24 text-sm text-neutral-900 dark:text-white placeholder-neutral-400 dark:placeholder-neutral-600 focus:outline-none focus:border-orange-500 focus:bg-white dark:focus:bg-neutral-800 transition-all"
                      />
                    </div>

                    <button
                      onClick={handleSubmit}
                      disabled={!nametagInput || isBusy}
                      className="w-full py-3 px-4 rounded-xl bg-linear-to-r from-orange-500 to-orange-600 text-white text-sm font-bold shadow-lg shadow-orange-500/20 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed hover:from-orange-400 hover:to-orange-500 transition-all"
                    >
                      {isBusy ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Registering...
                        </>
                      ) : (
                        <>
                          Register
                          <ArrowRight className="w-4 h-4" />
                        </>
                      )}
                    </button>

                    {error && (
                      <p className="text-red-500 dark:text-red-400 text-xs bg-red-500/10 border border-red-500/20 p-2 rounded-lg">
                        {error}
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
