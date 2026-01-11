import { motion } from 'framer-motion';
import { AggregatedAsset } from '../../L3/data/model'; // Импортируем наш класс
import { Box } from 'lucide-react';

interface AssetRowProps {
  asset: AggregatedAsset;
  showBalances: boolean;
  delay: number;
  onClick?: () => void;
  layer?: 'L1' | 'L3';
}

export function AssetRow({ asset, showBalances, delay, onClick, layer }: AssetRowProps) {
  const changeColor = asset.change24h >= 0 ? 'text-emerald-500 dark:text-emerald-400' : 'text-red-500 dark:text-red-400';
  const changeSign = asset.change24h >= 0 ? '+' : '';

  const formattedValue = showBalances
    ? `$${asset.getTotalFiatValue("USD").toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '••••••';

  const formattedAmount = showBalances
    ? `${asset.getFormattedAmount()} ${asset.symbol}`
    : '••••';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: delay }}
      layout
      whileHover={{ x: 4, backgroundColor: 'var(--color-surface-hover)' }}
      onClick={onClick}
      className="p-3 rounded-xl transition-all cursor-pointer group border border-transparent hover:border-neutral-200/50 dark:hover:border-white/5"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="relative w-10 h-10 rounded-xl flex items-center justify-center overflow-hidden">
            {asset.iconUrl ? (
              <img
                src={asset.iconUrl}
                alt={asset.symbol}
                className="w-full h-full object-cover"
              />
            ) : (
              <Box className="w-5 h-5 text-neutral-400 dark:text-neutral-500" />
            )}
          </div>

          <div>
            <div className="flex items-center gap-2">
              <div className="text-neutral-900 dark:text-white font-medium text-sm">{asset.symbol}</div>
              {layer && (
                <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded ${
                  layer === 'L1'
                    ? 'bg-blue-500/20 text-blue-600 dark:text-blue-400'
                    : 'bg-orange-500/20 text-orange-600 dark:text-orange-400'
                }`}>
                  {layer}
                </span>
              )}
              <div className="text-xs text-neutral-500 truncate max-w-[100px]">
                {asset.name}
              </div>
            </div>
            <div className="text-xs text-left text-neutral-500">
              {formattedAmount}
            </div>
          </div>
        </div>

        <div className="text-right">
          <div className="text-neutral-900 dark:text-white font-medium text-sm">{formattedValue}</div>
          <div className={`text-xs ${changeColor} flex justify-end items-center`}>
            {changeSign}{asset.change24h.toFixed(2)}%
          </div>
        </div>
      </div>
    </motion.div>
  );
}
