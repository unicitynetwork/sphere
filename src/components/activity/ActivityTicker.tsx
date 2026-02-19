import { useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useMarketFeed } from '../../hooks/useMarketFeed';
import { IntentIcon } from './ActivityIcon';
import { getIntentTitle, getIntentDescription, formatTimeAgo } from './utils';

const INTENT_DOT: Record<string, string> = {
  sell: 'bg-purple-500',
  buy: 'bg-indigo-500',
  service: 'bg-cyan-500',
  announcement: 'bg-amber-500',
  other: 'bg-emerald-500',
};

export function ActivityTicker() {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const { listings: liveListings, newListingIds } = useMarketFeed();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const frozenRef = useRef<typeof liveListings | null>(null);

  // Freeze listings while an item is expanded so the ticker doesn't shift
  if (expandedId && !frozenRef.current) {
    frozenRef.current = liveListings;
  } else if (!expandedId) {
    frozenRef.current = null;
  }

  const listings = frozenRef.current ?? liveListings;

  if (listings.length === 0) {
    return (
      <div className="flex items-center gap-2 px-2 sm:px-3 py-1 bg-neutral-50/80 dark:bg-neutral-900/40 border-b border-neutral-200/50 dark:border-neutral-800/30 shrink-0 overflow-hidden">
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="relative flex items-center justify-center">
            <div className="w-1.5 h-1.5 rounded-full bg-orange-500" />
            <div className="absolute w-1.5 h-1.5 rounded-full bg-orange-400 animate-ping opacity-75" />
          </div>
          <span className="text-[10px] font-semibold text-orange-600 dark:text-orange-400 uppercase tracking-wider">Live</span>
        </div>
        <div className="h-3 w-px bg-neutral-300 dark:bg-neutral-700 shrink-0" />
        <div className="flex items-center gap-1.5">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-5 w-24 rounded-full bg-neutral-200/60 dark:bg-neutral-700/40 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  return (
    <div className="flex items-center gap-2 px-2 sm:px-3 py-1 bg-neutral-50/80 dark:bg-neutral-900/40 border-b border-neutral-200/50 dark:border-neutral-800/30 shrink-0 overflow-hidden">
      {/* Live / Paused badge */}
      <div className="flex items-center gap-1.5 shrink-0">
        <div className="relative flex items-center justify-center">
          <div className={`w-1.5 h-1.5 rounded-full ${expandedId ? 'bg-neutral-400' : 'bg-orange-500'}`} />
          {!expandedId && (
            <div className="absolute w-1.5 h-1.5 rounded-full bg-orange-400 animate-ping opacity-75" />
          )}
        </div>
        <span className={`text-[10px] font-semibold uppercase tracking-wider ${expandedId ? 'text-neutral-500 dark:text-neutral-400' : 'text-orange-600 dark:text-orange-400'}`}>
          {expandedId ? 'Paused' : 'Live'}
        </span>
      </div>

      <div className="h-3 w-px bg-neutral-300 dark:bg-neutral-700 shrink-0" />

      {/* Scrollable items */}
      <div
        ref={scrollContainerRef}
        className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide"
      >
        <AnimatePresence initial={false}>
          {listings.map((listing) => {
            const isNew = newListingIds.has(listing.id);
            const dotColor = INTENT_DOT[listing.type] || INTENT_DOT.other;
            const isExpanded = expandedId === listing.id;

            return (
              <motion.div
                key={listing.id}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.25 }}
                onClick={() => toggleExpand(listing.id)}
                className="flex items-center gap-1.5 px-2 py-0.5 rounded-full cursor-pointer shrink-0 bg-white/60 dark:bg-neutral-800/50 border border-neutral-200/60 dark:border-neutral-700/40 hover:border-neutral-300 dark:hover:border-neutral-600 transition-colors select-none"
              >
                <IntentIcon intentType={listing.type} size="sm" />
                <span className="text-[11px] font-medium text-neutral-700 dark:text-neutral-300 whitespace-nowrap">
                  {getIntentTitle(listing.type)}
                </span>
                <span
                  className={`text-[11px] text-neutral-500 dark:text-neutral-400 ${isExpanded ? '' : 'max-w-28 truncate'}`}
                >
                  {getIntentDescription(listing)}
                </span>
                <span className="text-[9px] text-neutral-400 dark:text-neutral-500 whitespace-nowrap">
                  {formatTimeAgo(listing.createdAt)}
                </span>
                {isNew && (
                  <span className={`w-1.5 h-1.5 rounded-full ${dotColor} shrink-0`} />
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
