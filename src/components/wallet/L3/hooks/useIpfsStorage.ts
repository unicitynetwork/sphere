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
import type { Token } from "../data/model";

// Query keys
export const IPFS_STORAGE_KEYS = {
  STATUS: ["ipfs", "storage", "status"],
  IPNS_NAME: ["ipfs", "storage", "ipnsName"],
};

// Session key (same as useWallet.ts)
const SESSION_KEY = "user-pin-1234";
const identityManager = IdentityManager.getInstance(SESSION_KEY);

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

      // If successful, add tokens to wallet and restore nametag
      if (result.success && result.tokens) {
        const walletRepo = WalletRepository.getInstance();
        for (const token of result.tokens) {
          walletRepo.addToken(token);
        }
        // Restore nametag if present
        if (result.nametag) {
          walletRepo.setNametag(result.nametag);
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

  // Mutation: Restore from last known CID
  const restoreFromLastMutation = useMutation({
    mutationFn: async (): Promise<RestoreResult> => {
      const result = await storageService.restoreFromLastCid();

      // If successful, add tokens to wallet
      if (result.success && result.tokens) {
        const walletRepo = WalletRepository.getInstance();
        for (const token of result.tokens) {
          walletRepo.addToken(token);
        }
        if (result.nametag) {
          walletRepo.setNametag(result.nametag);
        }
      }

      return result;
    },
    onSuccess: (result) => {
      if (result.success) {
        queryClient.invalidateQueries({ queryKey: ["wallet"] });
      }
    },
  });

  // Mutation: Export as TXF
  const exportTxfMutation = useMutation({
    mutationFn: async (): Promise<{ success: boolean; data?: string; filename?: string; error?: string }> => {
      const result = await storageService.exportAsTxf();

      // If successful, trigger browser download
      if (result.success && result.data && result.filename) {
        const blob = new Blob([result.data], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = result.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }

      return result;
    },
  });

  // Mutation: Import from TXF file
  const importTxfMutation = useMutation({
    mutationFn: async (content: string): Promise<{
      success: boolean;
      tokens?: Token[];
      imported?: number;
      skipped?: number;
      error?: string;
    }> => {
      const result = await storageService.importFromTxf(content);

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
    currentVersion: statusQuery.data?.currentVersion ?? 0,
    lastCid: statusQuery.data?.lastCid ?? null,

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
    restoreFromLast: restoreFromLastMutation.mutateAsync,
    isRestoringFromLast: restoreFromLastMutation.isPending,

    // TXF Import/Export
    exportTxf: exportTxfMutation.mutateAsync,
    isExportingTxf: exportTxfMutation.isPending,
    exportTxfError: exportTxfMutation.error,
    importTxf: importTxfMutation.mutateAsync,
    isImportingTxf: importTxfMutation.isPending,
    importTxfError: importTxfMutation.error,

    // Events
    lastEvent,
    onStorageEvent,
  };
}
