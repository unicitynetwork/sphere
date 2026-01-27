import { useInfiniteQuery } from '@tanstack/react-query';
import { ActivityService } from '../services/ActivityService';

interface UseRecentActivityOptions {
  kind?: string;
  limit?: number;
  enabled?: boolean;
}

export function useRecentActivity(options: UseRecentActivityOptions = {}) {
  const { kind, limit = 50, enabled = true } = options;

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
    enabled,
    staleTime: 30000,
    refetchOnWindowFocus: false,
  });
}
