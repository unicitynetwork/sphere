/**
 * React Hook for Inventory Sync Operations
 *
 * Provides integration between InventorySyncService and React components.
 * Per TOKEN_INVENTORY_SPEC.md Section 6 and Section 12
 */

import { useState, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { inventorySync, type SyncParams } from '../services/InventorySyncService';
import type { SyncResult, SyncMode, CircuitBreakerState } from '../types/SyncTypes';
import { IdentityManager } from '../services/IdentityManager';

// Session key (same as useWallet.ts)
const SESSION_KEY = 'user-pin-1234';

// Event name for sync state changes
const SYNC_STATE_EVENT = 'inventory-sync-state';

export interface SyncState {
  /** Whether a sync is currently in progress */
  isSyncing: boolean;
  /** Current sync step (1-10) */
  currentStep: number;
  /** Current sync mode */
  mode: SyncMode;
  /** Last sync result */
  lastResult: SyncResult | null;
  /** Circuit breaker state */
  circuitBreaker: CircuitBreakerState | null;
  /** Error message if sync failed */
  error: string | null;
}

interface SyncStateEvent {
  isSyncing: boolean;
  currentStep: number;
  mode: SyncMode;
}

/**
 * Hook for inventory sync operations
 *
 * @returns Sync state and control functions
 */
export function useInventorySync() {
  const queryClient = useQueryClient();
  const identityManager = IdentityManager.getInstance(SESSION_KEY);

  const [syncState, setSyncState] = useState<SyncState>({
    isSyncing: false,
    currentStep: 0,
    mode: 'NORMAL',
    lastResult: null,
    circuitBreaker: null,
    error: null
  });

  // Listen for sync state events from other tabs/components
  useEffect(() => {
    const handleSyncState = (e: CustomEvent<SyncStateEvent>) => {
      setSyncState(prev => ({
        ...prev,
        isSyncing: e.detail.isSyncing,
        currentStep: e.detail.currentStep,
        mode: e.detail.mode
      }));
    };

    window.addEventListener(SYNC_STATE_EVENT, handleSyncState as EventListener);
    return () => {
      window.removeEventListener(SYNC_STATE_EVENT, handleSyncState as EventListener);
    };
  }, []);

  /**
   * Emit sync state change event
   */
  const emitSyncState = useCallback((state: SyncStateEvent) => {
    window.dispatchEvent(new CustomEvent(SYNC_STATE_EVENT, { detail: state }));
  }, []);

  /**
   * Trigger a sync operation
   *
   * @param params - Optional sync parameters
   * @returns Sync result
   */
  const triggerSync = useCallback(async (params?: Partial<SyncParams>): Promise<SyncResult | null> => {
    // Use functional state update to avoid stale closure
    let shouldProceed = true;
    setSyncState(prev => {
      if (prev.isSyncing) {
        console.warn('[useInventorySync] Sync already in progress');
        shouldProceed = false;
        return prev;
      }
      return prev;
    });

    if (!shouldProceed) {
      return null;
    }

    const identity = await identityManager.getCurrentIdentity();
    if (!identity) {
      console.warn('[useInventorySync] No identity available');
      setSyncState(prev => ({
        ...prev,
        error: 'No identity available'
      }));
      return null;
    }

    // Determine sync mode
    const hasIncoming = params?.incomingTokens && params.incomingTokens.length > 0;
    const hasOutbox = params?.outboxTokens && params.outboxTokens.length > 0;
    const mode: SyncMode = params?.local ? 'LOCAL' :
      params?.nametag ? 'NAMETAG' :
      (hasIncoming || hasOutbox) ? 'FAST' : 'NORMAL';

    setSyncState(prev => ({
      ...prev,
      isSyncing: true,
      currentStep: 1,
      mode,
      error: null
    }));

    emitSyncState({ isSyncing: true, currentStep: 1, mode });

    try {
      const syncParams: SyncParams = {
        address: identity.address,
        publicKey: identity.publicKey,
        ipnsName: identity.ipnsName || '',
        ...params
      };

      const result = await inventorySync(syncParams);

      setSyncState(prev => ({
        ...prev,
        isSyncing: false,
        currentStep: 0,
        lastResult: result,
        circuitBreaker: result.circuitBreaker || null,
        error: result.status === 'ERROR' ? result.errorMessage || 'Sync failed' : null
      }));

      emitSyncState({ isSyncing: false, currentStep: 0, mode: result.syncMode });

      // NOTE: Don't invalidate queries here - InventorySyncService.dispatchWalletUpdated()
      // already calls invalidateWalletQueries(). Duplicate invalidation causes cascading
      // refetches and infinite loops when multiple useWallet instances are mounted.

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown sync error';
      console.error('[useInventorySync] Sync failed:', error);

      setSyncState(prev => ({
        ...prev,
        isSyncing: false,
        currentStep: 0,
        error: errorMessage
      }));

      emitSyncState({ isSyncing: false, currentStep: 0, mode });
      return null;
    }
  }, [identityManager, queryClient, emitSyncState]);

  /**
   * Trigger NORMAL mode sync (full validation)
   */
  const syncNormal = useCallback(async (): Promise<SyncResult | null> => {
    return triggerSync();
  }, [triggerSync]);

  /**
   * Trigger LOCAL mode sync (skip IPFS)
   */
  const syncLocal = useCallback(async (): Promise<SyncResult | null> => {
    return triggerSync({ local: true });
  }, [triggerSync]);

  /**
   * Trigger NAMETAG mode sync (minimal fetch)
   */
  const syncNametag = useCallback(async (): Promise<SyncResult | null> => {
    return triggerSync({ nametag: true });
  }, [triggerSync]);

  /**
   * Retry IPFS sync (for LOCAL mode recovery)
   */
  const retryIpfsSync = useCallback(async (): Promise<SyncResult | null> => {
    // Clear LOCAL mode flag and try NORMAL sync
    return triggerSync();
  }, [triggerSync]);

  /**
   * Cancel ongoing sync
   * NOTE: Currently only resets UI state. Actual sync operations
   * cannot be cancelled until inventorySync supports abort signals.
   */
  const cancelSync = useCallback(() => {
    setSyncState(prev => {
      if (!prev.isSyncing) return prev;
      emitSyncState({ isSyncing: false, currentStep: 0, mode: prev.mode });
      return {
        ...prev,
        isSyncing: false,
        currentStep: 0
      };
    });
  }, [emitSyncState]);

  return {
    // State
    isSyncing: syncState.isSyncing,
    currentStep: syncState.currentStep,
    mode: syncState.mode,
    lastResult: syncState.lastResult,
    circuitBreaker: syncState.circuitBreaker,
    error: syncState.error,

    // Actions
    triggerSync,
    syncNormal,
    syncLocal,
    syncNametag,
    retryIpfsSync,
    cancelSync
  };
}

export default useInventorySync;
