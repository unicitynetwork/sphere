/**
 * CreateAddressModal - Modal for creating new wallet addresses
 *
 * Multi-step modal that allows users to create additional addresses
 * without leaving the main app (no page reload).
 *
 * Steps:
 * 1. Deriving - Generate new L1/L3 address
 * 2. Nametag Input - User enters desired nametag
 * 3. Processing - Mint nametag, sync to IPFS
 * 4. Complete - Show success
 */
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Loader2,
  ShieldCheck,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  Wallet,
} from 'lucide-react';
import { useCreateAddress, type CreateAddressStep } from '../hooks/useCreateAddress';

interface CreateAddressModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CreateAddressModal({ isOpen, onClose }: CreateAddressModalProps) {
  const { state, startCreateAddress, submitNametag, reset, isNametagAvailable } = useCreateAddress();
  const [nametagInput, setNametagInput] = useState('');
  const [isCheckingAvailability, setIsCheckingAvailability] = useState(false);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);

  // Start address creation when modal opens
  useEffect(() => {
    if (isOpen && state.step === 'idle') {
      startCreateAddress();
    }
  }, [isOpen, state.step, startCreateAddress]);

  // Reset when modal closes
  useEffect(() => {
    if (!isOpen) {
      reset();
      setNametagInput('');
      setAvailabilityError(null);
    }
  }, [isOpen, reset]);

  const handleNametagChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.toLowerCase();
    // Allow only valid nametag characters
    if (/^[a-z0-9_\-+.]*$/.test(value)) {
      setNametagInput(value);
      setAvailabilityError(null);
    }
  };

  const handleSubmitNametag = async () => {
    if (!nametagInput.trim()) return;

    setIsCheckingAvailability(true);
    setAvailabilityError(null);

    try {
      const available = await isNametagAvailable(nametagInput.trim());
      if (!available) {
        setAvailabilityError(`@${nametagInput} is already taken`);
        setIsCheckingAvailability(false);
        return;
      }

      await submitNametag(nametagInput.trim());
    } catch (err) {
      setAvailabilityError(err instanceof Error ? err.message : 'Failed to check availability');
    } finally {
      setIsCheckingAvailability(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && nametagInput && !isCheckingAvailability && state.step === 'nametag_input') {
      handleSubmitNametag();
    }
  };

  const handleClose = () => {
    // Don't allow closing during critical steps
    if (['minting', 'syncing_ipfs'].includes(state.step)) {
      return;
    }
    onClose();
  };

  const isProcessing = ['deriving', 'checking_availability', 'minting', 'syncing_ipfs', 'verifying_ipns'].includes(state.step);
  const canClose = !['minting', 'syncing_ipfs', 'verifying_ipns'].includes(state.step);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={canClose ? handleClose : undefined}
            className="fixed inset-0 z-50 bg-black/60 dark:bg-black/80 backdrop-blur-sm"
          />

          {/* Modal */}
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
              className="relative w-full max-w-sm bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-3xl shadow-2xl pointer-events-auto overflow-hidden"
            >
              {/* Close button */}
              {canClose && (
                <motion.button
                  whileHover={{ scale: 1.1, rotate: 90 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={handleClose}
                  className="absolute top-4 right-4 z-10 w-8 h-8 flex items-center justify-center rounded-xl bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-500 transition-colors"
                >
                  <X className="w-4 h-4" />
                </motion.button>
              )}

              {/* Content */}
              <div className="px-6 py-8">
                <AnimatePresence mode="wait">
                  {/* Deriving Step */}
                  {state.step === 'deriving' && (
                    <StepDeriving />
                  )}

                  {/* Nametag Input Step */}
                  {state.step === 'nametag_input' && state.newAddress && (
                    <StepNametagInput
                      newAddress={state.newAddress}
                      nametagInput={nametagInput}
                      isCheckingAvailability={isCheckingAvailability}
                      availabilityError={availabilityError}
                      onNametagChange={handleNametagChange}
                      onKeyDown={handleKeyDown}
                      onSubmit={handleSubmitNametag}
                    />
                  )}

                  {/* Processing Steps */}
                  {isProcessing && state.step !== 'deriving' && (
                    <StepProcessing step={state.step} progress={state.progress} />
                  )}

                  {/* Complete Step */}
                  {state.step === 'complete' && state.newAddress && (
                    <StepComplete
                      nametag={nametagInput}
                      onClose={onClose}
                    />
                  )}

                  {/* Error Step */}
                  {state.step === 'error' && (
                    <StepError
                      error={state.error}
                      onRetry={() => {
                        reset();
                        startCreateAddress();
                      }}
                      onClose={onClose}
                    />
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}

// Step: Deriving address
function StepDeriving() {
  return (
    <motion.div
      key="deriving"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ duration: 0.3 }}
      className="text-center"
    >
      {/* Animated Loading Spinner */}
      <div className="relative mx-auto w-20 h-20 mb-5">
        <motion.div
          className="absolute inset-0 border-3 border-neutral-200 dark:border-neutral-800/50 rounded-full"
          animate={{ rotate: 360 }}
          transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
        />
        <motion.div
          className="absolute inset-1.5 border-3 border-orange-500/30 rounded-full border-t-orange-500 border-r-orange-500"
          animate={{ rotate: -360 }}
          transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
        />
        <div className="absolute inset-3 bg-orange-500/20 rounded-full blur-xl" />
        <div className="absolute inset-0 flex items-center justify-center">
          <motion.div
            animate={{ scale: [1, 1.1, 1], opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          >
            <Loader2 className="w-7 h-7 text-orange-500 dark:text-orange-400 animate-spin" />
          </motion.div>
        </div>
      </div>

      <h3 className="text-lg font-bold text-neutral-900 dark:text-white mb-2">
        Creating New Address
      </h3>
      <p className="text-sm text-neutral-500 dark:text-neutral-400">
        Generating cryptographic keys...
      </p>
    </motion.div>
  );
}

// Step: Nametag input
function StepNametagInput({
  newAddress,
  nametagInput,
  isCheckingAvailability,
  availabilityError,
  onNametagChange,
  onKeyDown,
  onSubmit,
}: {
  newAddress: { l1Address: string; l3Address: string; path: string; index: number };
  nametagInput: string;
  isCheckingAvailability: boolean;
  availabilityError: string | null;
  onNametagChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onSubmit: () => void;
}) {
  return (
    <motion.div
      key="nametag"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
    >
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", stiffness: 200, damping: 15 }}
        className="w-16 h-16 mx-auto mb-4 rounded-full bg-emerald-500/10 border-2 border-emerald-500/30 flex items-center justify-center"
      >
        <ShieldCheck className="w-8 h-8 text-emerald-500" />
      </motion.div>

      <h3 className="text-lg font-bold text-neutral-900 dark:text-white mb-2 text-center">
        Address Created!
      </h3>

      {/* Address preview */}
      <div className="mb-4 p-3 bg-neutral-100 dark:bg-neutral-800/50 rounded-xl">
        <div className="flex items-center gap-2 mb-1">
          <Wallet className="w-4 h-4 text-neutral-400" />
          <span className="text-xs text-neutral-500">New Address #{newAddress.index + 1}</span>
        </div>
        <p className="text-xs font-mono text-neutral-600 dark:text-neutral-400 truncate">
          {newAddress.l1Address}
        </p>
      </div>

      <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-4 text-center">
        Choose a unique{' '}
        <span className="text-orange-500 font-semibold">Unicity ID</span>{' '}
        for this address.
      </p>

      {/* Input */}
      <div className="relative mb-4 group">
        <div className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 dark:text-neutral-500 group-focus-within:text-orange-500 transition-colors z-10 text-sm font-medium">
          @unicity
        </div>
        <input
          type="text"
          value={nametagInput}
          onChange={onNametagChange}
          onKeyDown={onKeyDown}
          placeholder="id"
          disabled={isCheckingAvailability}
          className="w-full bg-neutral-100 dark:bg-neutral-800/50 border-2 border-neutral-200 dark:border-neutral-700/50 rounded-xl py-3 pl-4 pr-24 text-sm text-neutral-900 dark:text-white placeholder-neutral-400 dark:placeholder-neutral-600 focus:outline-none focus:border-orange-500 focus:bg-white dark:focus:bg-neutral-800 transition-all disabled:opacity-50"
          autoFocus
        />
      </div>

      {/* Error */}
      {availabilityError && (
        <motion.p
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-4 text-red-500 text-sm bg-red-500/10 border border-red-500/20 p-2 rounded-lg text-center"
        >
          {availabilityError}
        </motion.p>
      )}

      {/* Submit button */}
      <motion.button
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        onClick={onSubmit}
        disabled={!nametagInput || isCheckingAvailability}
        className="w-full py-3 px-6 rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 text-white font-bold shadow-lg shadow-orange-500/30 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isCheckingAvailability ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Checking...</span>
          </>
        ) : (
          <>
            <span>Continue</span>
            <ArrowRight className="w-4 h-4" />
          </>
        )}
      </motion.button>
    </motion.div>
  );
}

// Step: Processing
function StepProcessing({ step, progress }: { step: CreateAddressStep; progress: string }) {
  const getStepInfo = () => {
    switch (step) {
      case 'checking_availability':
        return { title: 'Checking Availability', subtitle: 'Verifying name is unique...' };
      case 'minting':
        return { title: 'Minting Unicity ID', subtitle: progress || 'Creating on blockchain...' };
      case 'syncing_ipfs':
        return { title: 'Syncing to IPFS', subtitle: progress || 'Backing up to decentralized storage...' };
      case 'verifying_ipns':
        return { title: 'Verifying IPNS', subtitle: progress || 'Confirming availability...' };
      default:
        return { title: 'Processing', subtitle: progress || 'Please wait...' };
    }
  };

  const info = getStepInfo();
  const isCritical = ['minting', 'syncing_ipfs', 'verifying_ipns'].includes(step);
  const isMinting = step === 'minting';
  const isSyncing = step === 'syncing_ipfs';
  const isVerifying = step === 'verifying_ipns';

  return (
    <motion.div
      key="processing"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ duration: 0.3 }}
      className="text-center"
    >
      {/* Animated Loading Spinner */}
      <div className="relative mx-auto w-20 h-20 mb-5">
        <motion.div
          className="absolute inset-0 border-3 border-neutral-200 dark:border-neutral-800/50 rounded-full"
          animate={{ rotate: 360 }}
          transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
        />
        <motion.div
          className="absolute inset-1.5 border-3 border-orange-500/30 rounded-full border-t-orange-500 border-r-orange-500"
          animate={{ rotate: -360 }}
          transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
        />
        <div className="absolute inset-3 bg-orange-500/20 rounded-full blur-xl" />
        <div className="absolute inset-0 flex items-center justify-center">
          <motion.div
            animate={{ scale: [1, 1.1, 1], opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          >
            <Loader2 className="w-7 h-7 text-orange-500 dark:text-orange-400 animate-spin" />
          </motion.div>
        </div>
      </div>

      <h3 className="text-lg font-bold text-neutral-900 dark:text-white mb-4">
        {info.title}
      </h3>

      {/* Progress indicator */}
      <motion.div
        key={info.subtitle}
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        className="flex items-center gap-2 text-neutral-700 dark:text-neutral-300 bg-orange-50 dark:bg-orange-900/20 px-3 py-2.5 rounded-lg border border-orange-200 dark:border-orange-700/30"
      >
        <motion.div
          animate={{ scale: [1, 1.2, 1], opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 1.5, repeat: Infinity }}
          className="w-2 h-2 rounded-full bg-orange-500 dark:bg-orange-400 shrink-0"
        />
        <span className="text-left text-sm font-medium">{info.subtitle}</span>
      </motion.div>

      {/* Step indicators */}
      <div className="flex items-center justify-center gap-2 mt-3">
        <div className={`w-2 h-2 rounded-full transition-colors ${isMinting ? "bg-orange-500" : isSyncing || isVerifying ? "bg-emerald-500" : "bg-neutral-300 dark:bg-neutral-600"}`} />
        <div className={`w-2 h-2 rounded-full transition-colors ${isSyncing ? "bg-orange-500" : isVerifying ? "bg-emerald-500" : "bg-neutral-300 dark:bg-neutral-600"}`} />
        <div className={`w-2 h-2 rounded-full transition-colors ${isVerifying ? "bg-orange-500" : "bg-neutral-300 dark:bg-neutral-600"}`} />
      </div>

      {/* Warning for critical steps */}
      {isCritical && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1 }}
          className="mt-4 px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/30 rounded-lg"
        >
          <p className="text-xs text-amber-700 dark:text-amber-300 font-medium">
            Don't close this window
          </p>
          {isVerifying && (
            <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1">
              Verifying IPFS storage (up to 60 seconds)...
            </p>
          )}
        </motion.div>
      )}
    </motion.div>
  );
}

// Step: Complete
function StepComplete({ nametag, onClose }: { nametag: string; onClose: () => void }) {
  return (
    <motion.div
      key="complete"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="text-center"
    >
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", stiffness: 200, damping: 15 }}
        className="w-16 h-16 mx-auto mb-4 rounded-full bg-emerald-500/10 border-2 border-emerald-500/30 flex items-center justify-center"
      >
        <CheckCircle2 className="w-8 h-8 text-emerald-500" />
      </motion.div>

      <h3 className="text-lg font-bold text-neutral-900 dark:text-white mb-2">
        Address Created!
      </h3>

      <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-2">
        Your new Unicity ID is ready:
      </p>

      <p className="text-lg font-bold text-orange-500 mb-6">
        @{nametag}
      </p>

      <motion.button
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        onClick={onClose}
        className="w-full py-3 px-6 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 text-white font-bold shadow-lg shadow-emerald-500/30"
      >
        Done
      </motion.button>
    </motion.div>
  );
}

// Step: Error
function StepError({
  error,
  onRetry,
  onClose,
}: {
  error: string | null;
  onRetry: () => void;
  onClose: () => void;
}) {
  return (
    <motion.div
      key="error"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="text-center"
    >
      <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-500/10 flex items-center justify-center">
        <AlertCircle className="w-8 h-8 text-red-500" />
      </div>

      <h3 className="text-lg font-bold text-neutral-900 dark:text-white mb-2">
        Something Went Wrong
      </h3>

      <p className="text-sm text-red-500 dark:text-red-400 mb-6 bg-red-500/10 p-3 rounded-lg">
        {error || 'An unknown error occurred'}
      </p>

      <div className="flex gap-3">
        <button
          onClick={onClose}
          className="flex-1 py-3 px-4 rounded-xl bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 font-medium hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors"
        >
          Cancel
        </button>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={onRetry}
          className="flex-1 py-3 px-4 rounded-xl bg-orange-500 text-white font-bold shadow-lg shadow-orange-500/30"
        >
          Try Again
        </motion.button>
      </div>
    </motion.div>
  );
}
