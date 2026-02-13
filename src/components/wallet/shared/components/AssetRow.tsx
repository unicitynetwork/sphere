import { motion, useMotionValue, useTransform, animate } from 'framer-motion';
import type { Asset } from '@unicitylabs/sphere-sdk';
import { Box } from 'lucide-react';
import { memo, useEffect } from 'react';

interface AssetRowProps {
  asset: Asset;
  showBalances: boolean;
  delay: number;
  onClick?: () => void;
  layer?: 'L1' | 'L3';
  /** If true, animate entrance. If false, render without animation (asset was already shown) */
  isNew?: boolean;
}

// Custom comparison: allow re-render when amount or price changes (for number animation)
function areAssetPropsEqual(prev: AssetRowProps, next: AssetRowProps): boolean {
  return (
    prev.asset.coinId === next.asset.coinId &&
    prev.asset.symbol === next.asset.symbol &&
    prev.asset.totalAmount === next.asset.totalAmount &&
    prev.asset.tokenCount === next.asset.tokenCount &&
    prev.asset.priceUsd === next.asset.priceUsd &&
    prev.asset.change24h === next.asset.change24h &&
    prev.asset.iconUrl === next.asset.iconUrl &&
    prev.showBalances === next.showBalances &&
    prev.layer === next.layer &&
    prev.isNew === next.isNew &&
    prev.delay === next.delay
  );
}

// Animated number component for fiat value
function AnimatedFiatValue({ value, showBalances }: { value: number; showBalances: boolean }) {
  const motionValue = useMotionValue(0);
  const displayed = useTransform(motionValue, (v) =>
    `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  );

  useEffect(() => {
    // Only animate if current value differs from target (handles StrictMode and prevents unnecessary animations)
    if (Math.abs(motionValue.get() - value) > 0.001) {
      const controls = animate(motionValue, value, {
        duration: 0.5,
        ease: 'easeOut',
      });
      return controls.stop;
    }
  }, [value, motionValue]);

  if (!showBalances) return <span>••••••</span>;
  return <motion.span>{displayed}</motion.span>;
}

// Animated number component for token amount
function AnimatedAmount({ value, symbol, decimals, showBalances }: {
  value: number;
  symbol: string;
  decimals: number;
  showBalances: boolean;
}) {
  const motionValue = useMotionValue(0);
  const displayed = useTransform(motionValue, (v) => {
    const formatted = v.toLocaleString('en-US', {
      minimumFractionDigits: Math.min(decimals, 4),
      maximumFractionDigits: Math.min(decimals, 4)
    });
    return `${formatted} ${symbol}`;
  });

  useEffect(() => {
    // Only animate if current value differs from target
    if (Math.abs(motionValue.get() - value) > 0.0001) {
      const controls = animate(motionValue, value, {
        duration: 0.5,
        ease: 'easeOut',
      });
      return controls.stop;
    }
  }, [value, motionValue]);

  if (!showBalances) return <span>••••</span>;
  return <motion.span>{displayed}</motion.span>;
}

export const AssetRow = memo(function AssetRow({ asset, showBalances, delay, onClick, layer, isNew = true }: AssetRowProps) {
  const change24h = asset.change24h ?? 0;
  const changeColor = change24h >= 0 ? 'text-emerald-500 dark:text-emerald-400' : 'text-red-500 dark:text-red-400';
  const changeSign = change24h >= 0 ? '+' : '';

  const fiatValue = asset.fiatValueUsd ?? 0;
  const numericAmount = Number(asset.totalAmount) / Math.pow(10, asset.decimals);

  const className = `p-3 rounded-xl transition-all group border border-transparent hover:border-neutral-200/50 dark:hover:border-white/5 ${onClick ? 'cursor-pointer hover:translate-x-1' : ''}`;

  const content = (
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
            <div className="text-xs text-neutral-500 truncate max-w-25">
              {asset.name}
            </div>
          </div>
          <div className="text-xs text-left text-neutral-500">
            <AnimatedAmount
              value={numericAmount}
              symbol={asset.symbol}
              decimals={asset.decimals}
              showBalances={showBalances}
            />
          </div>
        </div>
      </div>

      <div className="text-right">
        <div className="text-neutral-900 dark:text-white font-medium text-sm">
          <AnimatedFiatValue value={fiatValue} showBalances={showBalances} />
        </div>
        <div className={`text-xs ${changeColor} flex justify-end items-center`}>
          {changeSign}{change24h.toFixed(2)}%
        </div>
      </div>
    </div>
  );

  // For existing items, render without motion to prevent any flashing
  if (!isNew) {
    return (
      <div className={className} onClick={onClick}>
        {content}
      </div>
    );
  }

  // For new items, animate entrance
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      onClick={onClick}
      className={className}
    >
      {content}
    </motion.div>
  );
}, areAssetPropsEqual);
