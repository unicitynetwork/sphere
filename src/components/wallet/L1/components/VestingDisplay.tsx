import { Loader2 } from "lucide-react";
import type { VestingBalances } from "../sdk/types";

interface VestingDisplayProps {
  showBalances?: boolean;
  balances?: VestingBalances;
  isClassifying?: boolean;
}

export function VestingDisplay({
  showBalances = true,
  balances,
  isClassifying = false,
}: VestingDisplayProps) {
  const formatBalance = (satoshis: bigint): string => {
    const alpha = Number(satoshis) / 100000000;
    return alpha.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 8 });
  };

  const vestedBalance = balances?.vested ?? 0n;
  const unvestedBalance = balances?.unvested ?? 0n;

  return (
    <div className="flex gap-3">
      {/* Vested */}
      <div className="flex-1 rounded-xl bg-green-500/10 border border-green-500/20 p-3">
        <span className="text-xs text-green-600 dark:text-green-400 font-medium block mb-1">
          Vested
          {isClassifying && <Loader2 className="w-3 h-3 animate-spin inline ml-1" />}
        </span>
        {showBalances ? (
          <span className="text-sm font-mono text-green-600 dark:text-green-400">
            {formatBalance(vestedBalance)}
          </span>
        ) : (
          <span className="text-sm text-green-600 dark:text-green-400">••••••</span>
        )}
      </div>

      {/* Unvested */}
      <div className="flex-1 rounded-xl bg-orange-500/10 border border-orange-500/20 p-3">
        <span className="text-xs text-orange-600 dark:text-orange-400 font-medium block mb-1">
          Unvested
          {isClassifying && <Loader2 className="w-3 h-3 animate-spin inline ml-1" />}
        </span>
        {showBalances ? (
          <span className="text-sm font-mono text-orange-600 dark:text-orange-400">
            {formatBalance(unvestedBalance)}
          </span>
        ) : (
          <span className="text-sm text-orange-600 dark:text-orange-400">••••••</span>
        )}
      </div>
    </div>
  );
}
