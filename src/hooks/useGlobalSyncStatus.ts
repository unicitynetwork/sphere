/**
 * useGlobalSyncStatus - Provides sync status for UI components
 *
 * Previously aggregated IPFS sync status from multiple services.
 * Now simplified since IPFS sync has been removed.
 * Kept for API compatibility with LogoutConfirmModal and DeleteConfirmationModal.
 */

export interface GlobalSyncStatus {
  isAnySyncing: boolean;
  statusMessage: string;
}

export function useGlobalSyncStatus(): GlobalSyncStatus {
  return {
    isAnySyncing: false,
    statusMessage: 'All data synced',
  };
}
