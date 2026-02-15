import { QueryClient } from '@tanstack/react-query';

/**
 * Shared QueryClient instance for TanStack Query.
 *
 * Usage in services:
 *   import { queryClient } from '@/lib/queryClient';
 *   queryClient.invalidateQueries({ queryKey: ['some', 'key'] });
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

// Dev tools: expose queryClient on window for debugging
declare global {
  interface Window {
    __TANSTACK_QUERY_CLIENT__?: import('@tanstack/query-core').QueryClient;
  }
}

window.__TANSTACK_QUERY_CLIENT__ = queryClient;
