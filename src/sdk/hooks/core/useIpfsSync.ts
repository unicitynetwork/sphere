import { useState, useEffect, useCallback } from 'react';
import { useSphereContext } from './useSphere';

export type IpfsSyncStatus = 'idle' | 'syncing' | 'error';

export interface IpfsSyncState {
  status: IpfsSyncStatus;
  lastSynced: number | null;
  lastError: string | null;
  lastRemoteUpdate: {
    cid: string;
    added: number;
    removed: number;
  } | null;
}

export interface UseIpfsSyncReturn extends IpfsSyncState {
  triggerSync: () => Promise<void>;
}

export function useIpfsSync(): UseIpfsSyncReturn {
  const { sphere } = useSphereContext();
  const [state, setState] = useState<IpfsSyncState>({
    status: 'idle',
    lastSynced: null,
    lastError: null,
    lastRemoteUpdate: null,
  });

  useEffect(() => {
    if (!sphere) return;

    const handleSyncStarted = () => {
      setState(prev => ({ ...prev, status: 'syncing', lastError: null }));
    };

    const handleSyncCompleted = () => {
      setState(prev => ({
        ...prev,
        status: 'idle',
        lastSynced: Date.now(),
        lastError: null,
      }));
    };

    const handleSyncError = (data: { source: string; error: string }) => {
      setState(prev => ({
        ...prev,
        status: 'error',
        lastError: data.error,
      }));
    };

    const handleRemoteUpdate = (data: {
      providerId: string;
      cid: string;
      added: number;
      removed: number;
    }) => {
      setState(prev => ({
        ...prev,
        lastSynced: Date.now(),
        lastRemoteUpdate: {
          cid: data.cid,
          added: data.added,
          removed: data.removed,
        },
      }));
    };

    sphere.on('sync:started', handleSyncStarted);
    sphere.on('sync:completed', handleSyncCompleted);
    sphere.on('sync:error', handleSyncError);
    sphere.on('sync:remote-update', handleRemoteUpdate);

    return () => {
      sphere.off('sync:started', handleSyncStarted);
      sphere.off('sync:completed', handleSyncCompleted);
      sphere.off('sync:error', handleSyncError);
      sphere.off('sync:remote-update', handleRemoteUpdate);
    };
  }, [sphere]);

  const triggerSync = useCallback(async () => {
    if (!sphere) return;
    await sphere.sync();
  }, [sphere]);

  return { ...state, triggerSync };
}
