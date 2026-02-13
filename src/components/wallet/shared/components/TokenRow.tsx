import { motion, useMotionValue, useTransform, animate } from 'framer-motion';
import type { Token } from '@unicitylabs/sphere-sdk';
import { TokenRegistry } from '@unicitylabs/sphere-sdk';
import { Box, Copy, CheckCircle2 } from 'lucide-react';
import { useState, memo, useEffect } from 'react';

interface TokenRowProps {
  token: Token;
  delay: number;
  /** If true, animate entrance. If false, render without animation (token was already shown) */
  isNew?: boolean;
}

// Custom comparison: allow re-render when amount changes (for number animation)
function areTokenPropsEqual(prev: TokenRowProps, next: TokenRowProps): boolean {
  return (
    prev.token.id === next.token.id &&
    prev.token.status === next.token.status &&
    prev.token.symbol === next.token.symbol &&
    prev.isNew === next.isNew &&
    prev.delay === next.delay
  );
}

// Helper to parse token amount to numeric value
function parseTokenAmount(amount: string | undefined, coinId: string | undefined): number {
  try {
    if (!amount || !coinId) return 0;
    const amountFloat = parseFloat(amount);
    const registry = TokenRegistry.getInstance();
    const def = registry.getDefinition(coinId);
    const decimals = def?.decimals ?? 6;
    const divisor = Math.pow(10, decimals);
    return amountFloat / divisor;
  } catch {
    return 0;
  }
}

// Helper to format numeric value back to display string
function formatTokenAmount(value: number, coinId: string | undefined): string {
  try {
    if (!coinId) return value.toString();
    const registry = TokenRegistry.getInstance();
    const def = registry.getDefinition(coinId);
    const decimals = def?.decimals ?? 6;
    return new Intl.NumberFormat('en-US', {
      maximumFractionDigits: Math.min(decimals, 6)
    }).format(value);
  } catch {
    return value.toString();
  }
}

// Animated token amount component
function AnimatedTokenAmount({ amount, coinId, symbol }: {
  amount: string | undefined;
  coinId: string | undefined;
  symbol: string | undefined;
}) {
  const numericAmount = parseTokenAmount(amount, coinId);
  const motionValue = useMotionValue(0);
  const displayed = useTransform(motionValue, (v) => {
    const formatted = formatTokenAmount(v, coinId);
    return `${formatted} ${symbol || ''}`;
  });

  useEffect(() => {
    // Only animate if current value differs from target
    if (Math.abs(motionValue.get() - numericAmount) > 0.0001) {
      const controls = animate(motionValue, numericAmount, {
        duration: 0.5,
        ease: 'easeOut',
      });
      return controls.stop;
    }
  }, [numericAmount, motionValue]);

  return <motion.span>{displayed}</motion.span>;
}

export const TokenRow = memo(function TokenRow({ token, delay, isNew = true }: TokenRowProps) {
  const [copied, setCopied] = useState(false);

  const handleCopyId = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(token.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const className = "p-3 rounded-xl bg-neutral-50 dark:bg-neutral-800/30 border border-neutral-200/50 dark:border-white/5 hover:border-neutral-300 dark:hover:border-white/10 transition-all group";

  const amountDisplay = (
    <AnimatedTokenAmount
      amount={token.amount}
      coinId={token.coinId}
      symbol={token.symbol}
    />
  );

  const tokenContent = (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="relative w-10 h-10 rounded-lg flex items-center justify-center overflow-hidden">
          {(token.iconUrl || TokenRegistry.getInstance().getIconUrl(token.coinId)) ? (
            <img src={token.iconUrl || TokenRegistry.getInstance().getIconUrl(token.coinId)!} alt={token.symbol} className="w-full h-full object-cover" />
          ) : (
            <Box className="w-5 h-5 text-neutral-400 dark:text-neutral-500" />
          )}
        </div>
        <div>
          <div className="text-neutral-900 dark:text-white font-medium text-sm">
            {amountDisplay}
          </div>
          <div
            className="flex items-center gap-1 text-[10px] text-neutral-500 font-mono cursor-pointer hover:text-orange-500 dark:hover:text-orange-400 transition-colors"
            onClick={handleCopyId}
          >
            <span>ID: {token.id.slice(0, 8)}...</span>
            {copied ? <CheckCircle2 className="w-3 h-3" /> : <Copy className="w-3 h-3 opacity-0 group-hover:opacity-100" />}
          </div>
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-neutral-100 dark:bg-neutral-700/50 text-neutral-500 dark:text-neutral-400 border border-neutral-200 dark:border-neutral-700">
          Token
        </span>
        <span className="text-[10px] text-neutral-400 dark:text-neutral-600">
          {new Date(token.createdAt).toLocaleDateString()}
        </span>
      </div>
    </div>
  );

  // For existing items, render without motion to prevent any flashing
  if (!isNew) {
    return (
      <div className={className}>
        {tokenContent}
      </div>
    );
  }

  // For new items, animate entrance
  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay }}
      className={className}
    >
      {tokenContent}
    </motion.div>
  );
}, areTokenPropsEqual);
