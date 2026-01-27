/**
 * useGlobalSyncStatus - Aggregates IPFS sync status from all services
 *
 * Monitors sync status from:
 * - ChatHistoryIpfsService (chat history)
 * - IpfsStorageService (tokens)
 *
 * Used to prevent wallet deletion while sync is in progress.
 */

import { useState, useEffect, useCallback } from 'react';
import { getChatHistoryIpfsService, type SyncStep } from '../components/agents/shared/ChatHistoryIpfsService';
import { IpfsStorageService } from '../components/wallet/L3/services/IpfsStorageService';
import { IdentityManager } from '../components/wallet/L3/services/IdentityManager';

// Session key (same as useWallet.ts)
const SESSION_KEY = 'user-pin-1234';

export interface GlobalSyncStatus {
  // Individual service states
  chatSyncing: boolean;
  chatStep: SyncStep;
  tokenSyncing: boolean;
  inventorySyncing: boolean;

  // Combined state
  isAnySyncing: boolean;

  // Human-readable status
  statusMessage: string;
}

// Event name for inventory sync state changes (same as useInventorySync.ts)
const INVENTORY_SYNC_STATE_EVENT = 'inventory-sync-state';

export function useGlobalSyncStatus(): GlobalSyncStatus {
  const [chatSyncing, setChatSyncing] = useState(false);
  const [chatStep, setChatStep] = useState<SyncStep>('idle');
  const [tokenSyncing, setTokenSyncing] = useState(false);
  const [inventorySyncing, setInventorySyncing] = useState(false);

  // Subscribe to chat history sync status
  useEffect(() => {
    const chatService = getChatHistoryIpfsService();

    // Get initial status
    const updateChatStatus = () => {
      const status = chatService.getStatus();
      // Consider syncing if: actively syncing, has pending sync (debounce period), or in a sync step
      const isSyncing = status.isSyncing ||
        status.hasPendingSync ||
        (status.currentStep !== 'idle' && status.currentStep !== 'complete' && status.currentStep !== 'error');
      setChatSyncing(isSyncing);
      setChatStep(status.currentStep);
    };

    updateChatStatus();

    // Subscribe to changes
    const unsubscribe = chatService.onStatusChange(updateChatStatus);

    return unsubscribe;
  }, []);

  // Subscribe to token storage sync status (IpfsStorageService)
  useEffect(() => {
    const identityManager = IdentityManager.getInstance(SESSION_KEY);
    const tokenService = IpfsStorageService.getInstance(identityManager);

    // Get initial status
    setTokenSyncing(tokenService.isCurrentlySyncing());

    // Listen for sync state changes via custom event
    const handleSyncEvent = (e: CustomEvent) => {
      if (e.detail?.type === 'sync:state-changed' && e.detail.data?.isSyncing !== undefined) {
        setTokenSyncing(e.detail.data.isSyncing);
      }
    };

    window.addEventListener('ipfs-storage-event', handleSyncEvent as EventListener);

    // Poll for token sync status as backup (events may be missed during initialization)
    // Reduced from 500ms to 5000ms (10x) to lower CPU overhead - events are primary source
    const pollInterval = setInterval(() => {
      const currentSyncing = tokenService.isCurrentlySyncing();
      setTokenSyncing(currentSyncing);
    }, 5000);

    return () => {
      window.removeEventListener('ipfs-storage-event', handleSyncEvent as EventListener);
      clearInterval(pollInterval);
    };
  }, []);

  // Subscribe to inventory sync status (InventorySyncService)
  useEffect(() => {
    const handleInventorySyncEvent = (e: CustomEvent<{ isSyncing: boolean }>) => {
      setInventorySyncing(e.detail.isSyncing);
    };

    window.addEventListener(INVENTORY_SYNC_STATE_EVENT, handleInventorySyncEvent as EventListener);

    return () => {
      window.removeEventListener(INVENTORY_SYNC_STATE_EVENT, handleInventorySyncEvent as EventListener);
    };
  }, []);

  const isAnySyncing = chatSyncing || tokenSyncing || inventorySyncing;

  // Generate human-readable status message
  const getStatusMessage = useCallback((): string => {
    const parts: string[] = [];

    if (chatSyncing) {
      switch (chatStep) {
        case 'initializing':
          parts.push('Initializing...');
          break;
        case 'resolving-ipns':
          parts.push('Resolving chat history...');
          break;
        case 'fetching-content':
          parts.push('Fetching chat history...');
          break;
        case 'importing-data':
          parts.push('Importing chat data...');
          break;
        case 'building-data':
          parts.push('Preparing chat data...');
          break;
        case 'uploading':
          parts.push('Uploading chat history...');
          break;
        case 'publishing-ipns':
          parts.push('Publishing chat to network...');
          break;
        case 'idle':
        case 'complete':
        case 'error':
          // If chatSyncing is true but step is idle/complete/error,
          // it means we have a pending sync (debounce period)
          parts.push('Preparing to sync chat...');
          break;
        default:
          parts.push('Syncing chat history...');
      }
    }

    if (tokenSyncing) {
      parts.push('Syncing tokens...');
    }

    if (inventorySyncing) {
      parts.push('Syncing wallet data...');
    }

    if (parts.length === 0) {
      return 'All data synced';
    }

    return parts.join(' ');
  }, [chatSyncing, chatStep, tokenSyncing, inventorySyncing]);

  return {
    chatSyncing,
    chatStep,
    tokenSyncing,
    inventorySyncing,
    isAnySyncing,
    statusMessage: getStatusMessage(),
  };
}

/**
 * Utility function to wait for all syncs to complete
 * Returns a promise that resolves when no sync is in progress
 */
export async function waitForAllSyncsToComplete(timeoutMs: number = 60000): Promise<boolean> {
  const chatService = getChatHistoryIpfsService();
  const identityManager = IdentityManager.getInstance(SESSION_KEY);
  const tokenService = IpfsStorageService.getInstance(identityManager);

  const startTime = Date.now();

  return new Promise((resolve) => {
    const checkSync = () => {
      const chatStatus = chatService.getStatus();
      const tokenSyncing = tokenService.isCurrentlySyncing();

      // Check both active sync and pending sync (debounce period)
      const chatBusy = chatStatus.isSyncing || chatStatus.hasPendingSync;

      if (!chatBusy && !tokenSyncing) {
        resolve(true);
        return;
      }

      if (Date.now() - startTime > timeoutMs) {
        resolve(false); // Timeout
        return;
      }

      // Check again in 500ms
      setTimeout(checkSync, 500);
    };

    checkSync();
  });
}
