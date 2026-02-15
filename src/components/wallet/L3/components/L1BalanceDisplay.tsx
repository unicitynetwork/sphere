import { Loader2, ChevronRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { useL1Balance } from '../../../../sdk/hooks/l1/useL1Balance';
import { useSphereContext } from '../../../../sdk/hooks/core/useSphere';

interface L1BalanceDisplayProps {
  showBalances: boolean;
  onClick: () => void;
}

export function L1BalanceDisplay({ showBalances, onClick }: L1BalanceDisplayProps) {
  const { isInitialized } = useSphereContext();
  const { balance, isLoading } = useL1Balance();

  // Don't render if wallet not initialized
  if (!isInitialized) {
    return null;
  }

  const totalAlpha = balance ? Number(balance.total) / 1e8 : 0;

  const formatBalance = (val: number) => {
    return val.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 8,
    });
  };

  return (
    <motion.button
      onClick={onClick}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 transition-colors group"
    >
      <div className="flex items-center gap-1.5">
        <div className="w-2 h-2 rounded-full bg-blue-500" />
        <span className="text-xs font-medium text-blue-600 dark:text-blue-400">L1:</span>
      </div>

      {isLoading ? (
        <Loader2 className="w-3 h-3 animate-spin text-blue-500" />
      ) : (
        <span className="text-xs font-semibold text-blue-700 dark:text-blue-300">
          {showBalances ? `${formatBalance(totalAlpha)} ALPHA` : '••••••'}
        </span>
      )}

      <ChevronRight className="w-3 h-3 text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity" />
    </motion.button>
  );
}
