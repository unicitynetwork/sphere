import { motion } from 'framer-motion';
import type { IAsset } from '../../../types';

interface AssetRowProps {
  asset: IAsset;
  showBalances: boolean;
  delay: number;
}

export function AssetRow({ asset, showBalances, delay }: AssetRowProps) {
  const changeColor = asset.change >= 0 ? 'text-emerald-400' : 'text-red-400';
  const formattedValue = showBalances ? `$${asset.value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '••••';
  const formattedAmount = showBalances ? `${asset.amount.toFixed(4)} ${asset.ticker}` : '••••';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: delay }}
      whileHover={{ x: 2 }}
      className="p-3 rounded-lg hover:bg-neutral-800/40 transition-all cursor-pointer group"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-lg bg-linear-to-br ${asset.color} flex items-center justify-center`}>
            <span className="text-white text-xs">{asset.ticker[0]}</span>
          </div>
          <div>
            <div className="text-white text-sm">{asset.ticker}</div>
            <div className="text-xs text-neutral-500">{asset.name}</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-white text-sm">{formattedValue}</div>
          <div className={`text-xs ${changeColor}`}>
            {asset.change >= 0 ? '+' : ''}{asset.change}%
          </div>
        </div>
      </div>
      
      <div className="text-xs text-neutral-500 pl-11">
        {formattedAmount}
      </div>
    </motion.div>
  );
}