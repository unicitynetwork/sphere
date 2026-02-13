/**
 * RestoreScreen - Mnemonic recovery phrase input screen
 */
import { motion } from "framer-motion";
import { KeyRound, ArrowLeft, ArrowRight, Loader2 } from "lucide-react";

interface RestoreScreenProps {
  seedWords: string[];
  isBusy: boolean;
  error: string | null;
  onSeedWordsChange: (words: string[]) => void;
  onRestore: () => void;
  onBack: () => void;
}

export function RestoreScreen({
  seedWords,
  isBusy,
  error,
  onSeedWordsChange,
  onRestore,
  onBack,
}: RestoreScreenProps) {
  const handleWordChange = (index: number, value: string) => {
    const newWords = [...seedWords];
    newWords[index] = value;
    onSeedWordsChange(newWords);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const pastedText = e.clipboardData.getData("text").trim();
    const words = pastedText.split(/\s+/).filter((w) => w.length > 0);
    // If pasted text contains multiple words, fill all fields
    if (words.length > 1) {
      e.preventDefault();
      const newWords = Array(12).fill("");
      words.slice(0, 12).forEach((word, i) => {
        newWords[i] = word.toLowerCase();
      });
      onSeedWordsChange(newWords);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key === "Enter" && index < 11) {
      const nextInput = (e.currentTarget as HTMLElement).parentElement
        ?.nextElementSibling?.querySelector("input");
      nextInput?.focus();
    } else if (e.key === "Enter" && index === 11) {
      onRestore();
    }
  };

  const isComplete = seedWords.every((w) => w.trim());

  return (
    <motion.div
      key="restore"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ duration: 0.1 }}
      className="relative z-10 w-full max-w-[380px]"
    >
      {/* Icon */}
      <motion.div
        className="relative w-18 h-18 mx-auto mb-6"
        whileHover={{ scale: 1.05 }}
      >
        <div className="absolute inset-0 bg-blue-500/30 rounded-2xl blur-xl" />
        <div className="relative w-full h-full rounded-2xl bg-linear-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-xl shadow-blue-500/25">
          <KeyRound className="w-9 h-9 text-white" />
        </div>
      </motion.div>

      <h2 className="text-2xl font-bold text-neutral-900 dark:text-white mb-2 tracking-tight">
        Restore Wallet
      </h2>
      <p className="text-neutral-500 dark:text-neutral-400 text-sm mb-6 mx-auto leading-relaxed">
        Enter your 12-word recovery phrase to restore your wallet
      </p>

      {/* 12-word grid */}
      <div className="grid grid-cols-3 gap-2 mb-5">
        {Array.from({ length: 12 }).map((_, index) => (
          <div key={`seed-input-${index}`} className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-neutral-400 dark:text-neutral-600 font-medium z-10">
              {index + 1}.
            </span>
            <input
              type="text"
              value={seedWords[index]}
              onChange={(e) => handleWordChange(index, e.target.value)}
              onPaste={handlePaste}
              onKeyDown={(e) => handleKeyDown(e, index)}
              placeholder="word"
              className="w-full bg-neutral-100 dark:bg-neutral-800/50 border border-neutral-200 dark:border-neutral-700/50 rounded-lg py-2.5 pl-8 pr-2 text-sm text-neutral-900 dark:text-white placeholder-neutral-400 dark:placeholder-neutral-600 focus:outline-none focus:border-blue-500 focus:bg-white dark:focus:bg-neutral-800 transition-all"
              autoFocus={index === 0}
            />
          </div>
        ))}
      </div>

      {/* Buttons */}
      <div className="flex gap-3">
        <motion.button
          onClick={onBack}
          disabled={isBusy}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="flex-1 py-3.5 px-5 rounded-xl bg-neutral-100 dark:bg-neutral-800/50 text-neutral-700 dark:text-neutral-300 text-sm font-bold border border-neutral-200 dark:border-neutral-700/50 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-neutral-200 dark:hover:bg-neutral-700/50 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </motion.button>

        <motion.button
          onClick={onRestore}
          disabled={isBusy || !isComplete}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="flex-2 relative py-3.5 px-5 rounded-xl bg-linear-to-r from-blue-500 to-blue-600 text-white text-sm font-bold shadow-xl shadow-blue-500/25 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden group"
        >
          <div className="absolute inset-0 bg-linear-to-r from-blue-400 to-blue-500 opacity-0 group-hover:opacity-100 transition-opacity" />
          <span className="relative z-10 flex items-center gap-2">
            {isBusy ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Restoring...
              </>
            ) : (
              <>
                Restore
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </span>
        </motion.button>
      </div>

      {error && (
        <motion.p
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-3 text-red-500 dark:text-red-400 text-xs bg-red-500/10 border border-red-500/20 p-2 rounded-lg"
        >
          {error}
        </motion.p>
      )}
    </motion.div>
  );
}
