import { useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity as ActivityIconLucide, Loader2 } from 'lucide-react';
import { useRecentActivity } from '../../hooks/useRecentActivity';
import { useActivityStream } from '../../hooks/useActivityStream';
import { ActivityIcon } from './ActivityIcon';
import { getActivityTitle, getActivityDescription, formatTimeAgo } from './utils';
import type { Activity, ActivityKind } from '../../types/activity';

// Glow colors matching activity icon colors
const ACTIVITY_GLOW_COLORS: Record<ActivityKind, { bg: string; glow: string; border: string }> = {
  marketplace_post: {
    bg: 'bg-purple-500/10',
    glow: 'shadow-[0_4px_12px_-2px_rgba(168,85,247,0.35)]',
    border: 'border-purple-500/30',
  },
  marketplace_offer: {
    bg: 'bg-indigo-500/10',
    glow: 'shadow-[0_4px_12px_-2px_rgba(99,102,241,0.35)]',
    border: 'border-indigo-500/30',
  },
  token_transfer: {
    bg: 'bg-blue-500/10',
    glow: 'shadow-[0_4px_12px_-2px_rgba(59,130,246,0.35)]',
    border: 'border-blue-500/30',
  },
  wallet_created: {
    bg: 'bg-emerald-500/10',
    glow: 'shadow-[0_4px_12px_-2px_rgba(16,185,129,0.35)]',
    border: 'border-emerald-500/30',
  },
  game_started: {
    bg: 'bg-orange-500/10',
    glow: 'shadow-[0_4px_12px_-2px_rgba(249,115,22,0.35)]',
    border: 'border-orange-500/30',
  },
  bet_placed: {
    bg: 'bg-amber-500/10',
    glow: 'shadow-[0_4px_12px_-2px_rgba(245,158,11,0.35)]',
    border: 'border-amber-500/30',
  },
  otc_purchase: {
    bg: 'bg-cyan-500/10',
    glow: 'shadow-[0_4px_12px_-2px_rgba(6,182,212,0.35)]',
    border: 'border-cyan-500/30',
  },
  merch_order: {
    bg: 'bg-pink-500/10',
    glow: 'shadow-[0_4px_12px_-2px_rgba(236,72,153,0.35)]',
    border: 'border-pink-500/30',
  },
};

interface ActivityTickerProps {
  agentId?: string;
}

// Map agent IDs to their relevant activity kinds
const AGENT_ACTIVITY_MAP: Record<string, ActivityKind[]> = {
  sport: ['bet_placed'],
  p2p: ['otc_purchase'],
  merch: ['merch_order'],
  games: ['game_started'],
  trivia: ['game_started'],
  'sell-anything': ['marketplace_post', 'marketplace_offer'],
  pokemon: ['game_started'],
};

// Agents that show all activities
const SHOW_ALL_AGENTS = ['chat', 'ai'];

export function ActivityTicker({ agentId }: ActivityTickerProps) {
  const [realtimeActivities, setRealtimeActivities] = useState<Activity[]>([]);
  const [newActivityIds, setNewActivityIds] = useState<Set<number>>(new Set());
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useRecentActivity({ enabled: true });

  const handleNewActivity = useCallback((activity: Activity) => {
    setRealtimeActivities((prev) => {
      if (prev.some((a) => a.id === activity.id)) {
        return prev;
      }
      return [activity, ...prev].slice(0, 20); // Keep last 20
    });

    setNewActivityIds((prev) => new Set(prev).add(activity.id));

    // Scroll to start when new activity arrives
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({ left: 0, behavior: 'smooth' });
    }

    setTimeout(() => {
      setNewActivityIds((prev) => {
        const next = new Set(prev);
        next.delete(activity.id);
        return next;
      });
    }, 5000);
  }, []);

  useActivityStream({
    onActivity: handleNewActivity,
    enabled: true,
  });

  // Combine and filter activities
  const paginatedActivities = data?.pages.flatMap((page) => page.activities) || [];
  const allActivities = [...realtimeActivities, ...paginatedActivities.filter(
    (a) => !realtimeActivities.some((r) => r.id === a.id)
  )];

  // Filter based on agent and limit to 20
  const filteredActivities = (agentId && !SHOW_ALL_AGENTS.includes(agentId)
    ? allActivities.filter((activity) => {
        const relevantKinds = AGENT_ACTIVITY_MAP[agentId];
        if (!relevantKinds) return true; // Show all if agent not mapped
        return relevantKinds.includes(activity.kind);
      })
    : allActivities
  )
    .filter((activity) => activity.kind !== 'token_transfer')
    .slice(0, 20);

  if (isLoading && filteredActivities.length === 0) {
    return (
      <div className="hidden lg:block">
        <div className="flex items-center gap-3 mb-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-orange-500/10 border border-orange-500/30">
            <div className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
            <span className="text-xs font-semibold text-orange-600 dark:text-orange-400 uppercase tracking-wide">Live</span>
          </div>
          <span className="text-sm font-medium text-neutral-600 dark:text-neutral-400">Activity Feed</span>
        </div>
        <div className="flex items-center justify-center h-[60px] rounded-2xl">
          <Loader2 className="w-5 h-5 text-orange-500 animate-spin" />
        </div>
      </div>
    );
  }

  if (filteredActivities.length === 0) {
    return (
      <div className="hidden lg:block">
        <div className="flex items-center gap-3 mb-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-neutral-500/10 border border-neutral-500/30">
            <div className="w-2 h-2 rounded-full bg-neutral-400" />
            <span className="text-xs font-semibold text-neutral-600 dark:text-neutral-400 uppercase tracking-wide">Live</span>
          </div>
          <span className="text-sm font-medium text-neutral-600 dark:text-neutral-400">Activity Feed</span>
        </div>
        <div className="flex items-center justify-center gap-2 h-[60px] rounded-2xl">
          <ActivityIconLucide className="w-5 h-5 text-neutral-400" />
          <span className="text-sm text-neutral-500 dark:text-neutral-400">No recent activity</span>
        </div>
      </div>
    );
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

      {/* Scrollable container with custom scrollbar */}
      <div
        ref={scrollContainerRef}
        className="flex items-center gap-2.5 overflow-x-auto pt-2 pb-4 px-2 -mx-2 [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar]:mt-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-neutral-300 dark:[&::-webkit-scrollbar-thumb]:bg-neutral-700 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-neutral-400 dark:hover:[&::-webkit-scrollbar-thumb]:bg-neutral-600"
      >
        <AnimatePresence initial={false} mode="popLayout">
          {filteredActivities.map((activity) => {
            const glowColors = ACTIVITY_GLOW_COLORS[activity.kind] || ACTIVITY_GLOW_COLORS.wallet_created;
            const isNew = newActivityIds.has(activity.id);

            return (
              <motion.div
                key={activity.id}
                layout
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{
                  opacity: 1,
                  scale: 1,
                  transition: {
                    duration: 0.4,
                    ease: [0.25, 0.46, 0.45, 0.94],
                  }
                }}
                exit={{
                  opacity: 0,
                  scale: 0.95,
                  transition: { duration: 0.2, ease: 'easeOut' }
                }}
                className={`
                  relative flex items-center gap-3 px-4 py-2.5 rounded-xl cursor-default shrink-0
                  ${glowColors.bg} ${glowColors.border} border backdrop-blur-sm
                  ${glowColors.glow}
                  hover:scale-[1.02] transition-all duration-200
                `}
              >
                {/* NEW label for recent activities */}
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
                <ActivityIcon kind={activity.kind} size="md" />
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-semibold text-neutral-900 dark:text-white whitespace-nowrap">
                    {getActivityTitle(activity.kind)}
                  </span>
                  <span className="text-xs text-neutral-600 dark:text-neutral-300 max-w-[120px] truncate">
                    {getActivityDescription(activity)}
                  </span>
                </div>
                <span className="text-[10px] font-medium text-neutral-500 dark:text-neutral-400 ml-1 whitespace-nowrap">
                  {formatTimeAgo(activity.createdAt)}
                </span>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
