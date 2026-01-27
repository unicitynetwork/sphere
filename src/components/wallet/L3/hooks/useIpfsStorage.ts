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
import { addToken, getTokensForAddress, removeToken, setNametagForAddress } from "../services/InventorySyncService";
import { getTokenValidationService } from "../services/TokenValidationService";
import type { Token } from "../data/model";
import { tokenToTxf, getCurrentStateHash } from "../services/TxfSerializer";

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
  const [isSyncingRealtime, setIsSyncingRealtime] = useState(false);

  // Check if IPFS is disabled via environment variable
  const isEnabled = import.meta.env.VITE_ENABLE_IPFS !== 'false';

  // Get storage service instance - useWallet will have started this
  const storageService = IpfsStorageService.getInstance(identityManager);

  // Listen for storage events
  useEffect(() => {
    console.log(`🔄 useIpfsStorage: setting up event listener`);
    const handleEvent = (e: CustomEvent<StorageEvent>) => {
      setLastEvent(e.detail);

      // Handle real-time sync state changes for immediate UI updates
      if (e.detail.type === "sync:state-changed" && e.detail.data?.isSyncing !== undefined) {
        console.log(`🔄 useIpfsStorage: received sync:state-changed, isSyncing=${e.detail.data.isSyncing}`);
        setIsSyncingRealtime(e.detail.data.isSyncing);
      }

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

  // Mark service as ready on mount
  // NOTE: Auto-sync is now handled by useWallet.ts via InventorySyncService.inventorySync()
  // This hook only provides UI state and manual sync operations
  useEffect(() => {
    if (!storageService) return;
    setIsServiceReady(true);

    // Initialize sync state from service (in case sync already started before hook mounted)
    const currentSyncState = storageService.isCurrentlySyncing();
    console.log(`🔄 useIpfsStorage: initializing sync state to ${currentSyncState}`);
    setIsSyncingRealtime(currentSyncState);

    return () => {
      // Note: Don't shutdown on unmount as service is singleton
    };
  }, [storageService]);

  // Query: Storage status
  // CPU OPTIMIZATION (Phase 3c): Removed polling - status is already
  // invalidated via storage:completed and storage:failed events
  const statusQuery = useQuery({
    queryKey: IPFS_STORAGE_KEYS.STATUS,
    queryFn: (): StorageStatus => storageService!.getStatus(),
    refetchInterval: false,  // No polling - events handle updates
    staleTime: Infinity,     // Only refetch on explicit invalidation
    enabled: isServiceReady && !!storageService,
  });

  // Query: IPNS name
  const ipnsNameQuery = useQuery({
    queryKey: IPFS_STORAGE_KEYS.IPNS_NAME,
    queryFn: () => storageService!.getIpnsName(),
    staleTime: Infinity, // IPNS name is deterministic, doesn't change
    enabled: isServiceReady && !!storageService,
  });

  // Mutation: Manual sync
  const syncMutation = useMutation({
    mutationFn: (): Promise<StorageResult> => storageService!.syncNow(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: IPFS_STORAGE_KEYS.STATUS });
    },
  });

  // Mutation: Restore from CID
  const restoreMutation = useMutation({
    mutationFn: async (cid: string): Promise<RestoreResult> => {
      const result = await storageService!.restore(cid);

      // If successful, add tokens to wallet and restore nametag
      if (result.success && result.tokens) {
        // Get identity context for InventorySyncService
        const identity = await identityManager.getCurrentIdentity();
        if (!identity?.address || !identity?.publicKey || !identity?.ipnsName) {
          console.error(`📦 Cannot restore: missing identity context`);
          return result;
        }

        // Add tokens using InventorySyncService
        for (const token of result.tokens) {
          await addToken(identity.address, identity.publicKey, identity.ipnsName, token, { local: true });
        }

        // Restore nametag if present
        if (result.nametag) {
          setNametagForAddress(identity.address, result.nametag);
        }

        // CRITICAL: Validate restored tokens against aggregator to detect spent tokens
        // that bypassed tombstone checks (e.g., tokens with different state hashes)
        console.log(`📦 Running post-restore spent token validation...`);
        const validationService = getTokenValidationService();
        const allTokens = await getTokensForAddress(identity.address);
        const validationResult = await validationService.checkSpentTokens(allTokens, identity.publicKey);

        if (validationResult.spentTokens.length > 0) {
          console.log(`📦 Found ${validationResult.spentTokens.length} spent token(s) during restore validation:`);
          for (const spent of validationResult.spentTokens) {
            console.log(`📦   - Removing spent token ${spent.tokenId.slice(0, 8)}...`);
            // Find the actual token from localStorage using localId
            const token = allTokens.find(t => t.id === spent.localId);
            if (token) {
              const txf = tokenToTxf(token);
              if (txf) {
                const stateHash = getCurrentStateHash(txf);
                if (stateHash) {
                  await removeToken(identity.address, identity.publicKey, identity.ipnsName, spent.localId, stateHash);
                }
              }
            }
          }
          window.dispatchEvent(new Event("wallet-updated"));
        } else {
          console.log(`📦 Post-restore validation: all ${allTokens.length} token(s) are valid`);
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
      const result = await storageService!.restoreFromLastCid();

      // If successful, add tokens to wallet
      if (result.success && result.tokens) {
        // Get identity context for InventorySyncService
        const identity = await identityManager.getCurrentIdentity();
        if (!identity?.address || !identity?.publicKey || !identity?.ipnsName) {
          console.error(`📦 Cannot restore: missing identity context`);
          return result;
        }

        // Add tokens using InventorySyncService
        for (const token of result.tokens) {
          await addToken(identity.address, identity.publicKey, identity.ipnsName, token, { local: true });
        }

        // Restore nametag if present
        if (result.nametag) {
          setNametagForAddress(identity.address, result.nametag);
        }

        // CRITICAL: Validate restored tokens against aggregator to detect spent tokens
        // that bypassed tombstone checks (e.g., tokens with different state hashes)
        console.log(`📦 Running post-restore spent token validation...`);
        const validationService = getTokenValidationService();
        const allTokens = await getTokensForAddress(identity.address);
        const validationResult = await validationService.checkSpentTokens(allTokens, identity.publicKey);

        if (validationResult.spentTokens.length > 0) {
          console.log(`📦 Found ${validationResult.spentTokens.length} spent token(s) during restore validation:`);
          for (const spent of validationResult.spentTokens) {
            console.log(`📦   - Removing spent token ${spent.tokenId.slice(0, 8)}...`);
            // Find the actual token from localStorage using localId
            const token = allTokens.find(t => t.id === spent.localId);
            if (token) {
              const txf = tokenToTxf(token);
              if (txf) {
                const stateHash = getCurrentStateHash(txf);
                if (stateHash) {
                  await removeToken(identity.address, identity.publicKey, identity.ipnsName, spent.localId, stateHash);
                }
              }
            }
          }
          window.dispatchEvent(new Event("wallet-updated"));
        } else {
          console.log(`📦 Post-restore validation: all ${allTokens.length} token(s) are valid`);
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
      const result = await storageService!.exportAsTxf();

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
      const result = await storageService!.importFromTxf(content);

      // If successful, add tokens to wallet
      if (result.success && result.tokens) {
        // Get identity context for InventorySyncService
        const identity = await identityManager.getCurrentIdentity();
        if (!identity?.address || !identity?.publicKey || !identity?.ipnsName) {
          console.error(`📦 Cannot import: missing identity context`);
          return result;
        }

        // Add tokens using InventorySyncService
        for (const token of result.tokens) {
          await addToken(identity.address, identity.publicKey, identity.ipnsName, token, { local: true });
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
      if (!storageService) return () => {};
      return storageService.onEvent(callback);
    },
    [storageService]
  );

  return {
    // Enabled state
    isEnabled,

    // Status
    status: statusQuery.data,
    isLoadingStatus: statusQuery.isLoading,
    isServiceReady: isEnabled && isServiceReady,
    currentVersion: statusQuery.data?.currentVersion ?? 0,
    lastCid: statusQuery.data?.lastCid ?? null,

    // IPNS name
    ipnsName: ipnsNameQuery.data,
    isLoadingIpnsName: ipnsNameQuery.isLoading,

    // Sync operations
    sync: syncMutation.mutateAsync,
    isSyncing: isEnabled && (syncMutation.isPending || isSyncingRealtime || (storageService?.isCurrentlySyncing() ?? false)),
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
