import { useEffect, useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  IpfsStorageService,
  type StorageResult,
  type RestoreResult,
  type StorageEvent,
  type StorageStatus,
} from "../services/IpfsStorageService";
import { IdentityManager } from "../services/IdentityManager";
import { WalletRepository } from "../../../../repositories/WalletRepository";

// Query keys
export const IPFS_STORAGE_KEYS = {
  STATUS: ["ipfs", "storage", "status"],
  IPNS_NAME: ["ipfs", "storage", "ipnsName"],
};

// Session key (same as useWallet.ts)
const SESSION_KEY = "user-pin-1234";
const identityManager = new IdentityManager(SESSION_KEY);

/**
 * React hook for IPFS storage operations
 * Provides storage status, manual sync/restore, and event listening
 */
export function useIpfsStorage() {
  const queryClient = useQueryClient();
  const [lastEvent, setLastEvent] = useState<StorageEvent | null>(null);
  const [isServiceReady, setIsServiceReady] = useState(false);

  // Get storage service instance
  const storageService = IpfsStorageService.getInstance(identityManager);

  // Listen for storage events
  useEffect(() => {
    const handleEvent = (e: CustomEvent<StorageEvent>) => {
      setLastEvent(e.detail);

      // Invalidate status query on storage completion
      if (
        e.detail.type === "storage:completed" ||
        e.detail.type === "storage:failed"
      ) {
        queryClient.invalidateQueries({ queryKey: IPFS_STORAGE_KEYS.STATUS });
      }
    };

    window.addEventListener(
      "ipfs-storage-event",
      handleEvent as EventListener
    );
    return () => {
      window.removeEventListener(
        "ipfs-storage-event",
        handleEvent as EventListener
      );
    };
  }, [queryClient]);

  // Start auto-sync on mount
  useEffect(() => {
    storageService.startAutoSync();
    setIsServiceReady(true);

    return () => {
      // Note: Don't shutdown on unmount as service is singleton
    };
  }, [storageService]);

  // Query: Storage status
  const statusQuery = useQuery({
    queryKey: IPFS_STORAGE_KEYS.STATUS,
    queryFn: (): StorageStatus => storageService.getStatus(),
    refetchInterval: 30000, // Refresh every 30 seconds
    enabled: isServiceReady,
  });

  // Query: IPNS name
  const ipnsNameQuery = useQuery({
    queryKey: IPFS_STORAGE_KEYS.IPNS_NAME,
    queryFn: () => storageService.getIpnsName(),
    staleTime: Infinity, // IPNS name is deterministic, doesn't change
    enabled: isServiceReady,
  });

  // Mutation: Manual sync
  const syncMutation = useMutation({
    mutationFn: (): Promise<StorageResult> => storageService.syncNow(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: IPFS_STORAGE_KEYS.STATUS });
    },
  });

  // Mutation: Restore from CID
  const restoreMutation = useMutation({
    mutationFn: async (cid: string): Promise<RestoreResult> => {
      const result = await storageService.restore(cid);

      // If successful, add tokens to wallet
      if (result.success && result.tokens) {
        const walletRepo = WalletRepository.getInstance();
        for (const token of result.tokens) {
          walletRepo.addToken(token);
        }
      }

      return result;
    },
    onSuccess: (result) => {
      if (result.success) {
        // Invalidate wallet queries to refresh UI
        queryClient.invalidateQueries({ queryKey: ["wallet"] });
      }
    },
  });

  // Register event callback for external integrations
  const onStorageEvent = useCallback(
    (callback: (event: StorageEvent) => void | Promise<void>) => {
      return storageService.onEvent(callback);
    },
    [storageService]
  );

  return {
    // Status
    status: statusQuery.data,
    isLoadingStatus: statusQuery.isLoading,
    isServiceReady,

    // IPNS name
    ipnsName: ipnsNameQuery.data,
    isLoadingIpnsName: ipnsNameQuery.isLoading,

    // Sync operations
    sync: syncMutation.mutateAsync,
    isSyncing: syncMutation.isPending || storageService.isCurrentlySyncing(),
    syncError: syncMutation.error,

    // Restore operations
    restore: restoreMutation.mutateAsync,
    isRestoring: restoreMutation.isPending,
    restoreError: restoreMutation.error,

    // Events
    lastEvent,
    onStorageEvent,
  };
}
