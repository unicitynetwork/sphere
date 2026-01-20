import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity as ActivityIconLucide, Loader2, ChevronDown, X } from 'lucide-react';
import { useRecentActivity } from '../../hooks/useRecentActivity';
import { useActivityStream } from '../../hooks/useActivityStream';
import { ActivityItem } from './ActivityItem';
import type { Activity } from '../../types/activity';

interface RecentActivityPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export function RecentActivityPanel({ isOpen, onClose }: RecentActivityPanelProps) {
  const [realtimeActivities, setRealtimeActivities] = useState<Activity[]>([]);
  const [newActivityIds, setNewActivityIds] = useState<Set<number>>(new Set());
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const {
    data,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useRecentActivity({ enabled: isOpen });

  const handleNewActivity = useCallback((activity: Activity) => {
    setRealtimeActivities((prev) => {
      // Avoid duplicates
      if (prev.some((a) => a.id === activity.id)) {
        return prev;
      }
      return [activity, ...prev];
    });

    // Mark as new for animation
    setNewActivityIds((prev) => new Set(prev).add(activity.id));

    // Remove "new" status after animation
    setTimeout(() => {
      setNewActivityIds((prev) => {
        const next = new Set(prev);
        next.delete(activity.id);
        return next;
      });
    }, 3000);
  }, []);

  useActivityStream({
    onActivity: handleNewActivity,
    enabled: isOpen,
  });

  // Combine realtime activities with paginated data
  const paginatedActivities = data?.pages.flatMap((page) => page.activities) || [];
  const allActivities = [...realtimeActivities, ...paginatedActivities.filter(
    (a) => !realtimeActivities.some((r) => r.id === a.id)
  )];

  // Handle scroll to load more
  const handleScroll = useCallback(() => {
    if (!scrollContainerRef.current || isFetchingNextPage || !hasNextPage) return;

    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    if (scrollHeight - scrollTop - clientHeight < 100) {
      fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (container) {
      container.addEventListener('scroll', handleScroll);
      return () => container.removeEventListener('scroll', handleScroll);
    }
  }, [handleScroll]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Mobile overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="lg:hidden fixed inset-0 bg-black/50 z-40"
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="
              fixed lg:relative right-0 top-0 bottom-0 z-50
              w-80 max-w-full
              bg-white/95 dark:bg-neutral-900/95
              lg:bg-white/80 lg:dark:bg-neutral-900/80
              backdrop-blur-xl
              border-l border-neutral-200 dark:border-neutral-800/50
              flex flex-col
            "
          >
            {/* Header */}
            <div className="p-4 border-b border-neutral-200 dark:border-neutral-800/50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-orange-500 to-orange-600 flex items-center justify-center">
                    <ActivityIconLucide className="w-4 h-4 text-white" />
                  </div>
                  <h2 className="font-medium text-neutral-900 dark:text-white">
                    Recent Activity
                  </h2>
                </div>
                <motion.button
                  onClick={onClose}
                  className="p-2 rounded-lg bg-neutral-100 dark:bg-neutral-800/50 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-200 dark:hover:bg-neutral-700/50 transition-colors"
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                >
                  <X className="w-4 h-4" />
                </motion.button>
              </div>
              {realtimeActivities.length > 0 && (
                <div className="mt-2 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-xs text-neutral-500 dark:text-neutral-400">
                    Live updates active
                  </span>
                </div>
              )}
            </div>

            {/* Activity List */}
            <div
              ref={scrollContainerRef}
              className="flex-1 overflow-y-auto p-4 space-y-2"
            >
              {isLoading && allActivities.length === 0 ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 text-orange-500 animate-spin" />
                </div>
              ) : allActivities.length === 0 ? (
                <div className="text-center py-8">
                  <ActivityIconLucide className="w-12 h-12 text-neutral-300 dark:text-neutral-600 mx-auto mb-3" />
                  <p className="text-sm text-neutral-500 dark:text-neutral-400">
                    No recent activity
                  </p>
                  <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-1">
                    Activities will appear here in real-time
                  </p>
                </div>
              ) : (
                <AnimatePresence initial={false}>
                  {allActivities.map((activity) => (
                    <ActivityItem
                      key={activity.id}
                      activity={activity}
                      isNew={newActivityIds.has(activity.id)}
                    />
                  ))}
                </AnimatePresence>
              )}

              {/* Load more indicator */}
              {isFetchingNextPage && (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="w-5 h-5 text-orange-500 animate-spin" />
                </div>
              )}

              {hasNextPage && !isFetchingNextPage && (
                <motion.button
                  onClick={() => fetchNextPage()}
                  className="w-full py-2 text-sm text-neutral-500 dark:text-neutral-400 hover:text-orange-500 dark:hover:text-orange-400 transition-colors flex items-center justify-center gap-1"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <ChevronDown className="w-4 h-4" />
                  Load more
                </motion.button>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
