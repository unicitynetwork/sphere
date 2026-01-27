import { Download, Key, ShieldCheck } from 'lucide-react';
import { motion } from 'framer-motion';
import { BaseModal, MenuButton } from '../../ui';

interface BackupWalletModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExportWalletFile: () => void;
  onShowRecoveryPhrase: () => void;
}

export function BackupWalletModal({
  isOpen,
  onClose,
  onExportWalletFile,
  onShowRecoveryPhrase,
}: BackupWalletModalProps) {
  return (
    <BaseModal isOpen={isOpen} onClose={onClose} size="sm" showOrbs={false}>
      {/* Centered Header */}
      <div className="relative px-6 py-5 flex flex-col items-center text-center">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.1, type: "spring" }}
          className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mb-4"
        >
          <ShieldCheck className="w-8 h-8 text-green-500" />
        </motion.div>

        <h3 className="text-xl font-bold text-neutral-900 dark:text-white mb-1">Backup Wallet</h3>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Choose how you want to backup your wallet
        </p>
      </div>

      {/* Options */}
      <div className="px-6 pb-6 space-y-3">
        <MenuButton
          icon={Download}
          color="blue"
          label="Export Wallet File"
          subtitle="Download encrypted JSON file"
          showChevron={false}
          onClick={() => {
            onClose();
            onExportWalletFile();
          }}
        />

        <MenuButton
          icon={Key}
          color="orange"
          label="Show Recovery Phrase"
          subtitle="View 12-word seed phrase"
          showChevron={false}
          onClick={() => {
            onClose();
            onShowRecoveryPhrase();
          }}
        />

        <button
          onClick={onClose}
          className="w-full py-3 text-sm text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 transition-colors"
        >
          Cancel
        </button>
      </div>
    </BaseModal>
  );
}
