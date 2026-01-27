import { QueryClient } from '@tanstack/react-query';
import { QUERY_KEYS } from '../config/queryKeys';

// Re-export for convenience
export { QUERY_KEYS };

/**
 * Shared QueryClient instance for TanStack Query.
 *
 * Usage in services:
 *   import { queryClient, QUERY_KEYS } from '@/lib/queryClient';
 *   queryClient.invalidateQueries({ queryKey: QUERY_KEYS.TOKENS });
 */
/**
 * QueryClient with CPU-optimized defaults
 *
 * CPU OPTIMIZATION (Phase 3a):
 * - staleTime: 60000 (1 min) - Reduce redundant refetches
 * - gcTime: 300000 (5 min) - Keep data in cache longer
 * - refetchOnMount: false - Prevent mount refetch storms
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 60000,           // 1 minute default stale time
      gcTime: 5 * 60 * 1000,      // Keep data in cache for 5 minutes
      refetchOnMount: false,      // Prevent mount refetch storms
    },
  },
});

/**
 * Helper to invalidate and refetch wallet-related queries.
 * Call this when tokens change (e.g., from Nostr service).
 * Uses invalidateQueries with refetchType:'active' to trigger immediate refetch
 * for mounted components while avoiding memory issues from aggressive refetching.
 */
export function invalidateWalletQueries() {
  console.log(`🔄 [invalidateWalletQueries] Invalidating TOKENS and AGGREGATED queries with refetchType:'active'`);
  // invalidateQueries marks data as stale AND triggers refetch for active queries
  // This is safer than refetchQueries which can cause memory issues if called too frequently
  queryClient.invalidateQueries({
    queryKey: QUERY_KEYS.TOKENS,
    refetchType: 'active'  // Only refetch if query is currently being observed
  });
  queryClient.invalidateQueries({
    queryKey: QUERY_KEYS.AGGREGATED,
    refetchType: 'active'
  });
  console.log(`🔄 [invalidateWalletQueries] Invalidation complete`);
}

// Dev tools: expose queryClient on window for debugging
declare global {
  interface Window {
    __TANSTACK_QUERY_CLIENT__?: import('@tanstack/query-core').QueryClient;
  }
}

window.__TANSTACK_QUERY_CLIENT__ = queryClient;
