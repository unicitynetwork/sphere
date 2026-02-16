import { useState, useCallback, useRef, type ReactNode } from 'react';
import type { DAppMetadata, PermissionScope } from '@unicitylabs/sphere-sdk/connect';
import type { ConnectHost } from '@unicitylabs/sphere-sdk/connect';
import {
  ConnectContext,
  type PendingApproval,
  type PendingIntent,
  type ConnectContextValue,
} from './ConnectContext';
import { ConnectionApprovalModal } from './ConnectionApprovalModal';
import { ConnectIntentHandler } from './ConnectIntentHandler';

interface ConnectProviderProps {
  children: ReactNode;
}

export function ConnectProvider({ children }: ConnectProviderProps) {
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [pendingIntent, setPendingIntent] = useState<PendingIntent | null>(null);
  const connectHostRef = useRef<ConnectHost | null>(null);
  const [, forceUpdate] = useState(0);

  const setConnectHost = useCallback((host: ConnectHost | null) => {
    connectHostRef.current = host;
    forceUpdate((n) => n + 1);
  }, []);

  const requestApproval = useCallback(
    (dapp: DAppMetadata, permissions: PermissionScope[]) => {
      return new Promise<{ approved: boolean; grantedPermissions: PermissionScope[] }>((resolve) => {
        setPendingApproval({ dapp, permissions, resolve });
      });
    },
    [],
  );

  const requestIntent = useCallback(
    (action: string, params: Record<string, unknown>) => {
      return new Promise<{ result?: unknown; error?: { code: number; message: string } }>((resolve) => {
        setPendingIntent({ action, params, resolve });
      });
    },
    [],
  );

  const approveConnection = useCallback(
    (grantedPermissions: PermissionScope[]) => {
      pendingApproval?.resolve({ approved: true, grantedPermissions });
      setPendingApproval(null);
    },
    [pendingApproval],
  );

  const denyConnection = useCallback(() => {
    pendingApproval?.resolve({ approved: false, grantedPermissions: [] });
    setPendingApproval(null);
  }, [pendingApproval]);

  const resolveIntent = useCallback(
    (result: unknown) => {
      pendingIntent?.resolve({ result });
      setPendingIntent(null);
    },
    [pendingIntent],
  );

  const rejectIntent = useCallback(
    (code: number, message: string) => {
      pendingIntent?.resolve({ error: { code, message } });
      setPendingIntent(null);
    },
    [pendingIntent],
  );

  const value: ConnectContextValue = {
    requestApproval,
    requestIntent,
    pendingApproval,
    pendingIntent,
    approveConnection,
    denyConnection,
    resolveIntent,
    rejectIntent,
    connectHost: connectHostRef.current,
    setConnectHost,
  };

  return (
    <ConnectContext.Provider value={value}>
      {children}
      <ConnectionApprovalModal />
      <ConnectIntentHandler />
    </ConnectContext.Provider>
  );
}
