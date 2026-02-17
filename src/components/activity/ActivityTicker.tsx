import { useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useMarketFeed } from '../../hooks/useMarketFeed';
import { IntentIcon } from './ActivityIcon';
import { getIntentTitle, getIntentDescription, formatTimeAgo } from './utils';

// Glow colors per intent type
const INTENT_GLOW_COLORS: Record<string, { bg: string; glow: string; border: string }> = {
  sell: {
    bg: 'bg-purple-500/10',
    glow: 'shadow-[0_4px_12px_-2px_rgba(168,85,247,0.35)]',
    border: 'border-purple-500/30',
  },
  buy: {
    bg: 'bg-indigo-500/10',
    glow: 'shadow-[0_4px_12px_-2px_rgba(99,102,241,0.35)]',
    border: 'border-indigo-500/30',
  },
  service: {
    bg: 'bg-cyan-500/10',
    glow: 'shadow-[0_4px_12px_-2px_rgba(6,182,212,0.35)]',
    border: 'border-cyan-500/30',
  },
  announcement: {
    bg: 'bg-amber-500/10',
    glow: 'shadow-[0_4px_12px_-2px_rgba(245,158,11,0.35)]',
    border: 'border-amber-500/30',
  },
  other: {
    bg: 'bg-emerald-500/10',
    glow: 'shadow-[0_4px_12px_-2px_rgba(16,185,129,0.35)]',
    border: 'border-emerald-500/30',
  },
};

const DEFAULT_GLOW = INTENT_GLOW_COLORS.other;

export function ActivityTicker() {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const { listings, newListingIds } = useMarketFeed();

  if (listings.length === 0) {
    return null;
  }

  return (
    <div className="hidden lg:block">
      {/* Live Activity label */}
      <div className="flex items-center gap-3 mb-3">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-orange-500/10 dark:bg-orange-500/10 border border-orange-500/30">
          <div className="relative flex items-center justify-center">
            <div className="w-2 h-2 rounded-full bg-orange-500" />
            <div className="absolute w-2 h-2 rounded-full bg-orange-400 animate-ping opacity-75" />
          </div>
          <span className="text-xs font-semibold text-orange-600 dark:text-orange-400 uppercase tracking-wide">Live</span>
        </div>
        <span className="text-sm font-medium text-neutral-600 dark:text-neutral-400">Activity Feed</span>
      </div>

      {/* Scrollable container */}
      <div
        ref={scrollContainerRef}
        className="flex items-center gap-2.5 overflow-x-auto pt-2 pb-4 px-2 -mx-2 [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar]:mt-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-neutral-300 dark:[&::-webkit-scrollbar-thumb]:bg-neutral-700 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-neutral-400 dark:hover:[&::-webkit-scrollbar-thumb]:bg-neutral-600"
      >
        <AnimatePresence initial={false}>
          {listings.map((listing) => {
            const glowColors = INTENT_GLOW_COLORS[listing.type] || DEFAULT_GLOW;
            const isNew = newListingIds.has(listing.id);

            return (
              <motion.div
                key={listing.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{
                  opacity: 1,
                  x: 0,
                  transition: {
                    duration: 0.4,
                    ease: [0.25, 0.46, 0.45, 0.94],
                  }
                }}
                exit={{
                  opacity: 0,
                  x: -20,
                  transition: { duration: 0.2, ease: 'easeOut' }
                }}
                className={`
                  relative flex items-center gap-3 px-4 py-2.5 rounded-xl cursor-default shrink-0
                  ${glowColors.bg} ${glowColors.border} border backdrop-blur-sm
                  ${glowColors.glow}
                  hover:scale-[1.02] transition-all duration-200
                `}
              >
                {/* NEW label for recent listings */}
                {isNew && (
                  <motion.span
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    className="absolute -top-2 -right-2 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-orange-500 text-white rounded-md shadow-lg shadow-orange-500/30"
                  >
                    New
                  </motion.span>
                )}
                <IntentIcon intentType={listing.type} size="md" />
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-semibold text-neutral-900 dark:text-white whitespace-nowrap">
                    {getIntentTitle(listing.type)}
                  </span>
                  <span className="text-xs text-neutral-600 dark:text-neutral-300 max-w-30 truncate">
                    {getIntentDescription(listing)}
                  </span>
                </div>
                <span className="text-[10px] font-medium text-neutral-500 dark:text-neutral-400 ml-1 whitespace-nowrap">
                  {formatTimeAgo(listing.createdAt)}
                </span>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
