import { motion } from 'framer-motion';
import { Plus, ArrowDownUp, ArrowUpRight } from 'lucide-react';
import { useSphereContext } from '../../../../sdk/hooks/core/useSphere';
import { canSelfMint } from '../../../../config/networkCapabilities';

interface WalletActionsProps {
  onTopUp: () => void;
  onSwap: () => void;
  onSend: () => void;
  sendDisabled: boolean;
}

/**
 * The wallet's primary actions. Top Up and Swap both self-mint, so they are
 * gated on the active network: on a network where minting is not allowed
 * (mainnet, or anything unknown — see networkCapabilities.ts) BOTH are hidden
 * entirely, because minting real coinIds for free is not a testnet convenience
 * there. Send is always available.
 *
 * Swap used to render disabled rather than hidden. That was worse on two
 * counts: a greyed button still advertises a swap the wallet cannot perform
 * here, and it is the only entry point to a stub swap whose receive leg is a
 * self-mint — so on mainnet the honest UI is no button at all.
 */
export function WalletActions({ onTopUp, onSwap, onSend, sendDisabled }: WalletActionsProps) {
  const { network } = useSphereContext();
  const mintAllowed = canSelfMint(network);

  return (
    <div className={`grid ${mintAllowed ? 'grid-cols-3' : 'grid-cols-1'} gap-2 sm:gap-3`}>
      {mintAllowed && (
        <motion.button
          whileHover={{ scale: 1.02, y: -2 }}
          whileTap={{ scale: 0.98 }}
          onClick={onTopUp}
          className="relative px-2 py-2.5 sm:px-3 sm:py-3 rounded-xl bg-linear-to-br from-orange-500 to-orange-600 dark:from-brand-orange dark:to-brand-orange-dark text-white text-xs sm:text-sm flex items-center justify-center gap-1.5 sm:gap-2 overflow-hidden whitespace-nowrap"
        >
          <Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          <span>Top Up</span>
        </motion.button>
      )}

      {mintAllowed && (
        <motion.button
          whileHover={{ scale: 1.02, y: -2 }}
          whileTap={{ scale: 0.98 }}
          onClick={onSwap}
          className="relative px-2 py-2.5 sm:px-3 sm:py-3 rounded-xl bg-neutral-100 dark:bg-[rgba(255,255,255,0.06)] hover:bg-neutral-200 dark:hover:bg-[rgba(255,255,255,0.1)] text-neutral-900 dark:text-white text-xs sm:text-sm flex items-center justify-center gap-1.5 sm:gap-2 whitespace-nowrap"
        >
          <ArrowDownUp className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          <span>Swap</span>
        </motion.button>
      )}

      <motion.button
        whileHover={{ scale: sendDisabled ? 1 : 1.02, y: sendDisabled ? 0 : -2 }}
        whileTap={{ scale: sendDisabled ? 1 : 0.98 }}
        onClick={onSend}
        disabled={sendDisabled}
        className="relative px-2 py-2.5 sm:px-3 sm:py-3 rounded-xl bg-neutral-100 dark:bg-[rgba(255,255,255,0.06)] hover:bg-neutral-200 dark:hover:bg-[rgba(255,255,255,0.1)] text-neutral-900 dark:text-white text-xs sm:text-sm flex items-center justify-center gap-1.5 sm:gap-2 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <ArrowUpRight className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
        <span>Send</span>
      </motion.button>
    </div>
  );
}
