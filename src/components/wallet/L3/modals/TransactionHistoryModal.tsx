import { motion } from 'framer-motion';
import { ArrowUpRight, ArrowDownLeft, Loader2, Clock } from 'lucide-react';
import { useTransactionHistory } from '../hooks/useTransactionHistory';
import { RegistryService } from '../services/RegistryService';
import { useMemo } from 'react';
import { BaseModal, ModalHeader, EmptyState } from '../../ui';

const registryService = RegistryService.getInstance();

interface TransactionHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function TransactionHistoryModal({ isOpen, onClose }: TransactionHistoryModalProps) {
  const { history, isLoading } = useTransactionHistory();

  const formattedHistory = useMemo(() => {
    return history.map(entry => {
      const def = registryService.getCoinDefinition(entry.coinId);
      const decimals = def?.decimals || 0;

      // Convert amount from smallest unit to human readable
      const amountBigInt = BigInt(entry.amount);
      const divisor = BigInt(10 ** decimals);
      const integerPart = amountBigInt / divisor;
      const fractionalPart = amountBigInt % divisor;

      // Format the fractional part with leading zeros
      const fractionalStr = fractionalPart.toString().padStart(decimals, '0');
      const formattedAmount = decimals > 0
        ? `${integerPart}.${fractionalStr}`.replace(/\.?0+$/, '')
        : integerPart.toString();

      return {
        ...entry,
        formattedAmount,
        date: new Date(entry.timestamp).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        }),
        time: new Date(entry.timestamp).toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
        }),
      };
    });
  }, [history]);

  return (
    <BaseModal isOpen={isOpen} onClose={onClose}>
      <ModalHeader title="Transaction History" icon={Clock} onClose={onClose} />

      {/* Content - Scrollable */}
      <div className="relative flex-1 overflow-y-auto custom-scrollbar p-4 space-y-3 z-10 min-h-0 bg-transparent">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-orange-500" />
          </div>
        ) : history.length === 0 ? (
          <EmptyState
            icon={ArrowUpRight}
            title="No Transactions"
            description="Your transaction history will appear here"
          />
        ) : (
          <div className="space-y-2">
            {formattedHistory.map((entry, index) => (
              <motion.div
                key={entry.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                className="p-4 bg-neutral-50 dark:bg-neutral-800/50 border border-neutral-200 dark:border-neutral-700/50 rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
              >
                <div className="flex items-center gap-3">
                  {/* Icon with badge */}
                  <div className="relative shrink-0">
                    {entry.iconUrl ? (
                      <img src={entry.iconUrl} className="w-10 h-10 rounded-full" alt="" />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-neutral-200 dark:bg-neutral-700 flex items-center justify-center">
                        <span className="text-sm font-medium text-neutral-500 dark:text-neutral-400">
                          {entry.symbol.slice(0, 2)}
                        </span>
                      </div>
                    )}
                    <div className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center border-2 border-neutral-50 dark:border-neutral-800 ${
                      entry.type === 'RECEIVED'
                        ? 'bg-emerald-500'
                        : 'bg-orange-500'
                    }`}>
                      {entry.type === 'RECEIVED' ? (
                        <ArrowDownLeft className="w-3 h-3 text-white" />
                      ) : (
                        <ArrowUpRight className="w-3 h-3 text-white" />
                      )}
                    </div>
                  </div>

                  {/* Title & Subtitle */}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-neutral-900 dark:text-white">
                      {entry.type === 'RECEIVED' ? 'Received' : 'Sent'}
                      <span className="hidden sm:inline text-neutral-500 dark:text-neutral-400 font-normal ml-1">
                        {entry.type === 'RECEIVED' && entry.senderPubkey && (
                          <>from {entry.senderPubkey.slice(0, 4)}...{entry.senderPubkey.slice(-4)}</>
                        )}
                        {entry.type === 'SENT' && entry.recipientNametag && (
                          <>to @{entry.recipientNametag}</>
                        )}
                      </span>
                    </div>
                    {/* Mobile: from/to address */}
                    <div className="sm:hidden text-xs text-neutral-500 dark:text-neutral-400 truncate">
                      {entry.type === 'RECEIVED' && entry.senderPubkey && (
                        <>From {entry.senderPubkey.slice(0, 4)}...{entry.senderPubkey.slice(-4)}</>
                      )}
                      {entry.type === 'SENT' && entry.recipientNametag && (
                        <>To @{entry.recipientNametag}</>
                      )}
                    </div>
                    {/* Desktop: date & time */}
                    <div className="hidden sm:block text-[11px] text-neutral-400/70 dark:text-neutral-500/60">
                      {entry.date} • {entry.time}
                    </div>
                  </div>

                  {/* Amount */}
                  <div className={`text-sm font-semibold shrink-0 ${
                    entry.type === 'RECEIVED'
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-neutral-900 dark:text-white'
                  }`}>
                    {entry.type === 'RECEIVED' ? '+' : '-'}{entry.formattedAmount} {entry.symbol}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </BaseModal>
  );
}
