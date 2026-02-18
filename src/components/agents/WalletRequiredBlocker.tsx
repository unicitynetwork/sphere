import { type ReactNode } from 'react';
import { Wallet } from 'lucide-react';
import { motion } from 'framer-motion';
import { useWalletStatus } from '../../sdk';
import { agentRequiresWallet } from '../../config/activities';

interface WalletRequiredBlockerProps {
  children: ReactNode;
  agentId: string;
  onOpenWallet?: () => void;
}

export function WalletRequiredBlocker({ children, agentId, onOpenWallet }: WalletRequiredBlockerProps) {
  const { walletExists, isLoading } = useWalletStatus();

  if (isLoading || walletExists || !agentRequiresWallet(agentId)) {
    return <>{children}</>;
  }

  return (
    <div className="h-full flex items-center justify-center bg-white/60 dark:bg-neutral-900/90 backdrop-blur-xl rounded-none md:rounded-3xl lg:rounded-none border-0 md:border md:border-neutral-200 dark:md:border-neutral-800/50 lg:border-0">
      <div className="flex flex-col items-center gap-6 p-8 text-center max-w-sm">
        <div className="relative">
          <div className="absolute inset-0 rounded-2xl blur-xl opacity-30 bg-orange-500" />
          <div className="relative w-16 h-16 rounded-2xl bg-linear-to-br from-orange-500 to-orange-600 flex items-center justify-center shadow-xl">
            <Wallet className="w-8 h-8 text-white" />
          </div>
        </div>

        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-white">
            Wallet Required
          </h2>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            This agent requires a wallet to function. Create or import a wallet to get started.
          </p>
        </div>

        {onOpenWallet && (
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onOpenWallet}
            className="px-6 py-2.5 bg-linear-to-r from-orange-500 to-orange-600 text-white font-medium rounded-xl shadow-lg shadow-orange-500/25 hover:shadow-orange-500/40 transition-shadow"
          >
            Set Up Wallet
          </motion.button>
        )}
      </div>
    </div>
  );
}
