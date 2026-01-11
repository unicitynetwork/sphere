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

  // Combined state
  isAnySyncing: boolean;

  // Human-readable status
  statusMessage: string;
}

export function useGlobalSyncStatus(): GlobalSyncStatus {
  const [chatSyncing, setChatSyncing] = useState(false);
  const [chatStep, setChatStep] = useState<SyncStep>('idle');
  const [tokenSyncing, setTokenSyncing] = useState(false);

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

  // Subscribe to token storage sync status
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
    const pollInterval = setInterval(() => {
      const currentSyncing = tokenService.isCurrentlySyncing();
      setTokenSyncing(currentSyncing);
    }, 500);

    return () => {
      window.removeEventListener('ipfs-storage-event', handleSyncEvent as EventListener);
      clearInterval(pollInterval);
    };
  }, []);

  const isAnySyncing = chatSyncing || tokenSyncing;

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

    if (parts.length === 0) {
      return 'All data synced';
    }

    return parts.join(' ');
  }, [chatSyncing, chatStep, tokenSyncing]);

  return {
    chatSyncing,
    chatStep,
    tokenSyncing,
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
