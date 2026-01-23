import { motion } from 'framer-motion';
import { Eye, EyeOff, Copy, Check, ShieldAlert } from 'lucide-react';
import { useState, useEffect } from 'react';
import { BaseModal, ModalHeader, AlertMessage, Button, SecondaryButton } from '../../ui';

interface SeedPhraseModalProps {
  isOpen: boolean;
  onClose: () => void;
  seedPhrase: string[];
}

export function SeedPhraseModal({ isOpen, onClose, seedPhrase }: SeedPhraseModalProps) {
  const [isRevealed, setIsRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  // Reset revealed state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setIsRevealed(false);
      setCopied(false);
    }
  }, [isOpen]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(seedPhrase.join(' '));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy seed phrase:', err);
    }
  };

  return (
    <BaseModal isOpen={isOpen} onClose={onClose}>
      <ModalHeader title="Recovery Phrase" onClose={onClose} />

      {/* Content */}
      <div className="relative flex-1 overflow-y-auto custom-scrollbar p-6 z-10 min-h-0">
        {/* Warning */}
        <div className="mb-6">
          <AlertMessage variant="error" title="Never share your recovery phrase!" icon={ShieldAlert}>
            Anyone with these words can access your wallet and steal your funds.
          </AlertMessage>
        </div>

        {/* Seed phrase grid */}
        <div className="mb-6">
          {!isRevealed ? (
            <div className="flex justify-center py-12">
              <SecondaryButton icon={Eye} onClick={() => setIsRevealed(true)}>
                Reveal Recovery Phrase
              </SecondaryButton>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
                {seedPhrase.map((word, index) => (
                  <motion.div
                    key={`seed-word-${index}`}
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: index * 0.03 }}
                    className="relative"
                  >
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-neutral-400 dark:text-neutral-600 font-medium z-10">
                      {index + 1}.
                    </span>
                    <div className="w-full bg-neutral-100 dark:bg-neutral-800/50 border border-neutral-200 dark:border-neutral-700/50 rounded-lg py-2 pl-7 pr-2 text-xs text-neutral-900 dark:text-white font-mono">
                      {word}
                    </div>
                  </motion.div>
                ))}
              </div>

              {/* Action buttons */}
              <div className="flex gap-3">
                <SecondaryButton icon={EyeOff} onClick={() => setIsRevealed(false)} className="flex-1">
                  Hide
                </SecondaryButton>

                <Button
                  icon={copied ? Check : Copy}
                  onClick={handleCopy}
                  className="flex-1"
                >
                  {copied ? 'Copied!' : 'Copy'}
                </Button>
              </div>
            </>
          )}
        </div>

        {/* Info */}
        <div className="text-xs text-neutral-500 dark:text-neutral-400 text-center">
          Write down these 12 words in order and store them safely. You'll need them to recover your wallet.
        </div>
      </div>
    </BaseModal>
  );
}
