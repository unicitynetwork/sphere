import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { vestingState } from "../sdk/vestingState";
import type { VestingMode, VestingBalances } from "../sdk/types";

interface VestingSelectorProps {
  address: string;
  onModeChange?: (mode: VestingMode) => void;
  classificationProgress?: { current: number; total: number } | null;
  showBalances?: boolean;
}

export function VestingSelector({
  address,
  onModeChange,
  classificationProgress,
  showBalances = true,
}: VestingSelectorProps) {
  const [mode, setMode] = useState<VestingMode>(vestingState.getMode());
  const [balances, setBalances] = useState<VestingBalances>({
    vested: 0n,
    unvested: 0n,
    all: 0n,
  });

  useEffect(() => {
    const newBalances = vestingState.getAllBalances(address);
    setBalances(newBalances);
  }, [address, classificationProgress]);

  const handleModeChange = (newMode: VestingMode) => {
    vestingState.setMode(newMode);
    setMode(newMode);
    onModeChange?.(newMode);
  };

  const formatBalance = (satoshis: bigint): string => {
    const alpha = Number(satoshis) / 100000000;
    return alpha.toFixed(8) + " ALPHA";
  };

  const modeOptions: { value: VestingMode; label: string; color: string }[] = [
    { value: "all", label: "All", color: "neutral" },
    { value: "vested", label: "Vested", color: "green" },
    { value: "unvested", label: "Unvested", color: "orange" },
  ];

  const getColorClasses = (
    color: string,
    isSelected: boolean
  ): { bg: string; text: string; border: string } => {
    if (color === "green") {
      return {
        bg: isSelected ? "bg-green-500/20" : "bg-neutral-800/50",
        text: "text-green-400",
        border: isSelected ? "border-green-500/50" : "border-neutral-700/50",
      };
    }
    if (color === "orange") {
      return {
        bg: isSelected ? "bg-orange-500/20" : "bg-neutral-800/50",
        text: "text-orange-400",
        border: isSelected ? "border-orange-500/50" : "border-neutral-700/50",
      };
    }
    return {
      bg: isSelected ? "bg-blue-500/20" : "bg-neutral-800/50",
      text: "text-neutral-200",
      border: isSelected ? "border-blue-500/50" : "border-neutral-700/50",
    };
  };

  return (
    <div className="rounded-xl bg-neutral-900/50 border border-neutral-800/50 p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-neutral-400">Coin Filter</span>
        {classificationProgress && (
          <span className="text-xs text-blue-400">
            Classifying {classificationProgress.current}/
            {classificationProgress.total}
          </span>
        )}
      </div>

      <div className="flex gap-2">
        {modeOptions.map((option) => {
          const isSelected = mode === option.value;
          const colors = getColorClasses(option.color, isSelected);
          const balance =
            option.value === "all"
              ? balances.all
              : option.value === "vested"
                ? balances.vested
                : balances.unvested;

          return (
            <motion.button
              key={option.value}
              onClick={() => handleModeChange(option.value)}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className={`flex-1 px-3 py-2 rounded-lg border transition-all ${colors.bg} ${colors.border}`}
            >
              <div className="flex flex-col items-center">
                <span
                  className={`text-xs font-medium ${isSelected ? colors.text : "text-neutral-400"}`}
                >
                  {option.label}
                </span>
                {showBalances && (
                  <span
                    className={`text-xs mt-1 font-mono ${isSelected ? colors.text : "text-neutral-500"}`}
                  >
                    {formatBalance(balance).split(" ")[0]}
                  </span>
                )}
              </div>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
