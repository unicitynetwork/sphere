/**
 * useChatHistorySync - TanStack Query-based IPFS sync for chat history
 *
 * Provides:
 * - useQuery for initial IPNS resolution and data fetch
 * - useMutation for uploading changes to IPFS
 * - Automatic refetch on window focus and network reconnect
 * - Debounced sync mutations
 * - Detailed step tracking from IPFS service
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useEffect } from 'react';
import { getChatHistoryIpfsService, type SyncStep } from './ChatHistoryIpfsService';

// Query keys
export const chatHistorySyncKeys = {
  all: ['chat-history-sync'] as const,
  ipns: (userId: string) => [...chatHistorySyncKeys.all, 'ipns', userId] as const,
  status: () => [...chatHistorySyncKeys.all, 'status'] as const,
};

interface UseChatHistorySyncOptions {
  userId?: string;
  enabled?: boolean;
}

export interface SyncState {
  // Query states (download)
  isInitialLoading: boolean;  // First load
  isFetching: boolean;        // Any fetch (including background)
  isRefetching: boolean;      // Background refetch
  fetchError: Error | null;

  // Mutation states (upload)
  isUploading: boolean;
  uploadError: Error | null;

  // Combined states for UI
  isSyncing: boolean;         // Any sync activity
  isError: boolean;
  lastSyncTime: number | null;
  sessionCount: number | null;

  // Detailed step from IPFS service (for UI display)
  currentStep: SyncStep;
  stepProgress?: string;
}

export function useChatHistorySync({
  userId,
  enabled = true,
}: UseChatHistorySyncOptions) {
  const queryClient = useQueryClient();
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSyncRef = useRef(false);

  // Global sync status via TanStack Query (shared across all components)
  const { data: serviceStatus } = useQuery({
    queryKey: chatHistorySyncKeys.status(),
    queryFn: () => {
      const ipfsService = getChatHistoryIpfsService();
      return ipfsService.getStatus();
    },
    staleTime: Infinity, // Only update via setQueryData from subscription
    gcTime: Infinity,    // Never garbage collect
  });

  const currentStep = serviceStatus?.currentStep ?? 'idle';
  const stepProgress = serviceStatus?.stepProgress ?? '';

  // Subscribe to IPFS service status changes and update TanStack Query cache
  useEffect(() => {
    const ipfsService = getChatHistoryIpfsService();

    // Update cache with current status on mount
    queryClient.setQueryData(chatHistorySyncKeys.status(), ipfsService.getStatus());

    // Subscribe to future changes and update cache
    const unsubscribe = ipfsService.onStatusChange(() => {
      const status = ipfsService.getStatus();
      queryClient.setQueryData(chatHistorySyncKeys.status(), status);
    });

    return unsubscribe;
  }, [queryClient]);

  // Query: Initial load and periodic sync from IPNS
  const {
    data: syncResult,
    isLoading: isInitialLoading,
    isFetching,
    isRefetching,
    error: fetchError,
    refetch,
  } = useQuery({
    queryKey: chatHistorySyncKeys.ipns(userId || ''),
    queryFn: async () => {
      const ipfsService = getChatHistoryIpfsService();
      // Start auto-sync if not already started
      ipfsService.startAutoSync();
      return ipfsService.syncFromIpns();
    },
    enabled: enabled && !!userId,
    staleTime: 30_000, // Consider data stale after 30s
    gcTime: 5 * 60 * 1000, // Keep in cache for 5 minutes
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: 2,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
  });

  // Mutation: Upload changes to IPFS
  const {
    mutate: uploadToIpfs,
    mutateAsync: uploadToIpfsAsync,
    isPending: isUploading,
    error: uploadError,
  } = useMutation({
    mutationFn: async () => {
      const ipfsService = getChatHistoryIpfsService();
      return ipfsService.syncNow();
    },
    onSuccess: (result) => {
      // Update the query cache with new result
      if (userId) {
        queryClient.setQueryData(chatHistorySyncKeys.ipns(userId), result);
      }
      // Dispatch event for other components
      window.dispatchEvent(new CustomEvent('agent-chat-history-synced'));
    },
    onError: (error) => {
      console.error('[useChatHistorySync] Upload failed:', error);
    },
  });

  // Debounced sync - schedules upload after delay
  const scheduleSync = useCallback((delayMs: number = 3000) => {
    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current);
    }

    // If already uploading, mark as pending
    if (isUploading) {
      pendingSyncRef.current = true;
      return;
    }

    syncTimerRef.current = setTimeout(() => {
      syncTimerRef.current = null;
      uploadToIpfs();
    }, delayMs);
  }, [isUploading, uploadToIpfs]);

  // Immediate sync - no debounce
  const syncImmediately = useCallback(async () => {
    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
    }
    return uploadToIpfsAsync();
  }, [uploadToIpfsAsync]);

  // Handle pending sync after upload completes
  useEffect(() => {
    if (!isUploading && pendingSyncRef.current) {
      pendingSyncRef.current = false;
      scheduleSync(1000); // Short delay for pending sync
    }
  }, [isUploading, scheduleSync]);

  // Listen for local changes that need sync
  useEffect(() => {
    if (!enabled || !userId) return;

    const handleLocalChange = () => {
      scheduleSync();
    };

    window.addEventListener('agent-chat-history-updated', handleLocalChange);
    return () => {
      window.removeEventListener('agent-chat-history-updated', handleLocalChange);
      if (syncTimerRef.current) {
        clearTimeout(syncTimerRef.current);
      }
    };
  }, [enabled, userId, scheduleSync]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (syncTimerRef.current) {
        clearTimeout(syncTimerRef.current);
      }
    };
  }, []);

  // Derive sync state from service's currentStep (global) rather than mutation state (local)
  // This ensures consistent status across component remounts
  const isServiceSyncing = currentStep !== 'idle' && currentStep !== 'complete' && currentStep !== 'error';
  const isServiceUploading = currentStep === 'building-data' || currentStep === 'uploading' || currentStep === 'publishing-ipns';

  // Computed state for UI
  const syncState: SyncState = {
    isInitialLoading,
    isFetching: isFetching || isServiceSyncing,
    isRefetching,
    fetchError: fetchError as Error | null,
    isUploading: isUploading || isServiceUploading,
    uploadError: uploadError as Error | null,
    isSyncing: isFetching || isUploading || isServiceSyncing,
    isError: !!fetchError || !!uploadError || currentStep === 'error',
    lastSyncTime: syncResult?.timestamp || null,
    sessionCount: syncResult?.sessionCount ?? null,
    currentStep,
    stepProgress: stepProgress || undefined,
  };

  return {
    // State
    syncState,

    // Actions
    refetch,
    scheduleSync,
    syncImmediately,

    // Raw query/mutation for advanced usage
    syncResult,
  };
}

/**
 * Hook to get sync status for display in UI
 * Simplified version of useChatHistorySync for status-only usage
 */
export function useChatHistorySyncStatus(userId?: string) {
  const { syncState } = useChatHistorySync({
    userId,
    enabled: !!userId,
  });

  // Map to display-friendly status
  const getDisplayStatus = () => {
    if (syncState.isInitialLoading) {
      return { status: 'loading' as const, label: 'Loading...' };
    }
    if (syncState.isUploading) {
      return { status: 'uploading' as const, label: 'Saving...' };
    }
    if (syncState.isRefetching) {
      return { status: 'syncing' as const, label: 'Syncing...' };
    }
    if (syncState.isError) {
      return { status: 'error' as const, label: 'Sync error' };
    }
    return { status: 'synced' as const, label: 'Synced' };
  };

  return {
    ...getDisplayStatus(),
    isSyncing: syncState.isSyncing,
    lastSyncTime: syncState.lastSyncTime,
  };
}
