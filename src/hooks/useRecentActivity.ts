import { useInfiniteQuery } from '@tanstack/react-query';
import { ActivityService } from '../services/ActivityService';

// Check if Activity API is explicitly configured (not using default localhost)
const isActivityApiConfigured = !!import.meta.env.VITE_ACTIVITY_API_URL;

interface UseRecentActivityOptions {
  kind?: string;
  limit?: number;
  enabled?: boolean;
}

export function useRecentActivity(options: UseRecentActivityOptions = {}) {
  const { kind, limit = 50, enabled = true } = options;

  // Don't fetch if Activity API is not configured
  const shouldFetch = enabled && isActivityApiConfigured;

  return useInfiniteQuery({
    queryKey: ['activity', 'recent', { kind, limit }],
    queryFn: async ({ pageParam }) => {
      return ActivityService.getActivities({
        kind,
        limit,
        cursor: pageParam as string | undefined,
      });
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: shouldFetch,
    staleTime: 30000,
    refetchOnWindowFocus: false,
  });
}
