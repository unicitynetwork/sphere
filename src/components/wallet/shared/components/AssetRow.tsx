import { motion } from 'framer-motion';
import { AggregatedAsset } from '../../L3/data/model'; // Импортируем наш класс
import { Box } from 'lucide-react';

interface AssetRowProps {
  asset: AggregatedAsset;
  showBalances: boolean;
  delay: number;
  onClick?: () => void;
}

export function AssetRow({ asset, showBalances, delay, onClick }: AssetRowProps) {
  const changeColor = asset.change24h >= 0 ? 'text-emerald-400' : 'text-red-400';
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
      whileHover={{ x: 4, backgroundColor: 'rgba(255,255,255,0.03)' }}
      onClick={onClick}
      className="p-3 rounded-xl transition-all cursor-pointer group border border-transparent hover:border-white/5"
    >
      <div className="flex items-center justify-between mb-1">
        
        <div className="flex items-center gap-3">
          <div className="relative w-10 h-10 rounded-xl flex items-center justify-center overflow-hidden">
            {asset.iconUrl ? (
                <img 
                    src={asset.iconUrl} 
                    alt={asset.symbol} 
                    className="w-full h-full object-cover" 
                />
            ) : (
                <Box className="w-5 h-5 text-neutral-500" />
            )}
          </div>
          
          <div>
            <div className="flex items-center gap-2">
                <div className="text-white font-medium text-sm">{asset.symbol}</div>
                {asset.tokenCount > 1 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400 border border-neutral-700">
                        x{asset.tokenCount}
                    </span>
                )}
            </div>
            <div className="text-xs text-neutral-500 truncate max-w-[120px]">
                {asset.name}
            </div>
          </div>
        </div>

        <div className="text-right">
          <div className="text-white font-medium text-sm">{formattedValue}</div>
          <div className={`text-xs ${changeColor} flex justify-end items-center`}>
            {changeSign}{asset.change24h.toFixed(2)}%
          </div>
        </div>
      </div>

      <div className="text-xs text-neutral-500 pl-[52px]">
        {formattedAmount}
      </div>
    </motion.div>
  );
}