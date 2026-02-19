import { useState, useCallback, useEffect } from 'react';
import { X, Loader2, ArrowRight, Tag, CheckCircle2, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import { useSphereContext } from '../../../../sdk/hooks/core/useSphere';
import { SPHERE_KEYS } from '../../../../sdk/queryKeys';

type NametagAvailability = 'idle' | 'checking' | 'available' | 'taken';

interface RegisterNametagModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function RegisterNametagModal({ isOpen, onClose }: RegisterNametagModalProps) {
  const [nametagInput, setNametagInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const [availability, setAvailability] = useState<NametagAvailability>('idle');

  const { sphere, resolveNametag } = useSphereContext();
  const queryClient = useQueryClient();

  // Debounced nametag availability check
  useEffect(() => {
    const cleanTag = nametagInput.trim().replace(/^@/, '');
    if (!cleanTag || cleanTag.length < 2) {
      setAvailability('idle');
      return;
    }

    setAvailability('checking');
    const timer = setTimeout(async () => {
      try {
        const existing = await resolveNametag(cleanTag);
        setAvailability(existing ? 'taken' : 'available');
      } catch {
        setAvailability('idle');
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [nametagInput, resolveNametag]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setNametagInput('');
      setError(null);
      setAvailability('idle');
      setSuccess(false);
    }
  }, [isOpen]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.toLowerCase();
    if (/^[a-z0-9_\-+.]*$/.test(value)) {
      setNametagInput(value);
      setError(null);
    }
  };

  const canSubmit = nametagInput.trim().length >= 2 && !isBusy && availability !== 'taken' && availability !== 'checking';

  const handleSubmit = useCallback(async () => {
    if (!nametagInput.trim() || !sphere || isBusy) return;

    setIsBusy(true);
    setError(null);

    try {
      const cleanTag = nametagInput.trim().replace('@', '');

      // Double-check availability (debounced check may be stale)
      const existing = await resolveNametag(cleanTag);
      if (existing) {
        setError(`@${cleanTag} is already taken`);
        setAvailability('taken');
        setIsBusy(false);
        return;
      }

      await sphere.registerNametag(cleanTag);

      // Write fresh identity into cache — sphere.identity should be
      // updated after registerNametag resolves.  Fall back to patching
      // the nametag onto existing cached data if identity is unavailable.
      if (sphere.identity) {
        const fresh = { ...sphere.identity };
        if (!fresh.nametag) fresh.nametag = cleanTag;
        queryClient.setQueryData(SPHERE_KEYS.identity.current, fresh);
      } else {
        queryClient.setQueryData(SPHERE_KEYS.identity.current, (old: Record<string, unknown> | null | undefined) => {
          if (!old) return old;
          return { ...old, nametag: cleanTag };
        });
      }
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
  }, [nametagInput, sphere, isBusy, resolveNametag, queryClient, onClose]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && canSubmit) {
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
                      <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 z-10">
                        {availability === 'checking' && <Loader2 className="w-3.5 h-3.5 text-neutral-400 animate-spin" />}
                        {availability === 'available' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />}
                        {availability === 'taken' && <AlertCircle className="w-3.5 h-3.5 text-red-500" />}
                        <span className="text-neutral-400 dark:text-neutral-500 group-focus-within:text-orange-500 dark:group-focus-within:text-orange-400 transition-colors text-sm font-medium">
                          @unicity
                        </span>
                      </div>
                      <input
                        type="text"
                        value={nametagInput}
                        onChange={handleChange}
                        onKeyDown={handleKeyDown}
                        placeholder="id"
                        autoFocus
                        className={`w-full bg-neutral-100 dark:bg-neutral-800/50 border-2 rounded-xl py-3 pl-4 pr-28 text-sm text-neutral-900 dark:text-white placeholder-neutral-400 dark:placeholder-neutral-600 focus:outline-none focus:bg-white dark:focus:bg-neutral-800 transition-all ${
                          availability === 'taken'
                            ? 'border-red-400 dark:border-red-500/50 focus:border-red-500'
                            : availability === 'available'
                              ? 'border-emerald-400 dark:border-emerald-500/50 focus:border-emerald-500'
                              : 'border-neutral-200 dark:border-neutral-700/50 focus:border-orange-500'
                        }`}
                      />
                    </div>

                    {/* Availability status — fixed height to prevent layout shift */}
                    <div className="h-4 -mt-2">
                      {availability === 'taken' && !error && (
                        <p className="text-red-500 dark:text-red-400 text-xs">
                          @{nametagInput} is already taken
                        </p>
                      )}
                      {availability === 'available' && (
                        <p className="text-emerald-500 dark:text-emerald-400 text-xs">
                          @{nametagInput} is available
                        </p>
                      )}
                    </div>

                    <button
                      onClick={handleSubmit}
                      disabled={!canSubmit}
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
