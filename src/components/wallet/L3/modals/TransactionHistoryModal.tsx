import { motion, AnimatePresence } from 'framer-motion';
import { X, ArrowUpRight, ArrowDownLeft, Loader2, Clock } from 'lucide-react';
import { useTransactionHistory } from '../hooks/useTransactionHistory';
import { RegistryService } from '../services/RegistryService';
import { useMemo } from 'react';

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
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop with Blur */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-100 bg-black/60 dark:bg-black/80 backdrop-blur-sm"
          />

          {/* Modal Container */}
          <div className="fixed inset-0 z-100 flex items-center justify-center p-4 sm:p-6 pointer-events-none">
            {/* Modal */}
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
              className="relative w-full max-w-md max-h-[600px] bg-white dark:bg-[#111] border border-neutral-200 dark:border-white/10 rounded-3xl shadow-2xl pointer-events-auto flex flex-col overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-6 py-5 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                  <motion.div
                    whileHover={{ scale: 1.05 }}
                    className="relative w-11 h-11 rounded-xl bg-linear-to-br from-orange-500 to-orange-600 flex items-center justify-center shadow-lg shadow-orange-500/30"
                  >
                    <Clock className="w-5 h-5 text-white" />
                  </motion.div>
                  <div>
                    <h3 className="text-lg font-bold text-neutral-900 dark:text-white leading-tight">Transaction History</h3>
                    
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-xl transition-colors"
                >
                  <X className="w-5 h-5 text-neutral-500 dark:text-neutral-400" />
                </button>
              </div>

              {/* Content - Scrollable */}
              <div className="relative flex-1 overflow-y-auto custom-scrollbar p-4 space-y-3 z-10 min-h-0">
                {isLoading ? (
                  <div className="flex items-center justify-center py-20">
                    <Loader2 className="w-6 h-6 animate-spin text-orange-500" />
                  </div>
                ) : history.length === 0 ? (
                  <div className="h-full min-h-[300px] flex flex-col items-center justify-center text-center py-12">
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: "spring", stiffness: 200, damping: 15 }}
                      className="relative w-20 h-20 mb-6"
                    >
                      <div className="absolute inset-0 bg-orange-500/20 rounded-3xl blur-xl" />
                      <div className="relative w-full h-full bg-neutral-200/80 dark:bg-neutral-800/80 rounded-3xl flex items-center justify-center border border-neutral-300/50 dark:border-neutral-700/50">
                        <ArrowUpRight className="w-10 h-10 text-orange-500 dark:text-orange-400" />
                      </div>
                    </motion.div>
                    <p className="text-neutral-900 dark:text-white font-bold text-lg mb-2">No Transactions</p>
                    <p className="text-neutral-500 dark:text-neutral-400 text-sm max-w-[220px] leading-relaxed">
                      Your transaction history will appear here
                    </p>
                  </div>
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
                          {/* Icon */}
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${entry.type === 'RECEIVED'
                            ? 'bg-emerald-500/10 dark:bg-emerald-500/20'
                            : 'bg-orange-500/10 dark:bg-orange-500/20'
                            }`}>
                            {entry.type === 'RECEIVED' ? (
                              <ArrowDownLeft className="w-5 h-5 text-emerald-500" />
                            ) : (
                              <ArrowUpRight className="w-5 h-5 text-orange-500" />
                            )}
                          </div>

                          {/* Main Info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-baseline gap-2 mb-1">
                              <span className="text-sm font-medium text-neutral-900 dark:text-white">
                                {entry.type === 'RECEIVED' ? 'Received' : 'Sent'}
                              </span>
                              {entry.recipientNametag && (
                                <span className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
                                  to @{entry.recipientNametag}
                                </span>
                              )}
                              {entry.senderPubkey && (
                                <span className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
                                  from {entry.senderPubkey.slice(0, 8)}...{entry.senderPubkey.slice(-4)}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
                              <span>{entry.date}</span>
                              <span>•</span>
                              <span>{entry.time}</span>
                            </div>
                          </div>

                          {/* Amount */}
                          <div className="text-right">
                            <div className={`text-sm font-semibold ${entry.type === 'RECEIVED'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-neutral-900 dark:text-white'
                              }`}>
                              {entry.type === 'RECEIVED' ? '+' : '-'}{entry.formattedAmount}
                            </div>
                            <div className="text-xs text-neutral-500 dark:text-neutral-400 flex items-center gap-1.5 justify-end mt-0.5">
                              {entry.iconUrl && (
                                <img src={entry.iconUrl} className="w-3 h-3 rounded-full" alt="" />
                              )}
                              <span>{entry.symbol}</span>
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
