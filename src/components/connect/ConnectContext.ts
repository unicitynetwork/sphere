import { createContext, useContext } from 'react';
import type { DAppMetadata, PermissionScope } from '@unicitylabs/sphere-sdk/connect';

export interface PendingApproval {
  dapp: DAppMetadata;
  permissions: PermissionScope[];
  resolve: (result: { approved: boolean; grantedPermissions: PermissionScope[] }) => void;
}

export interface PendingIntent {
  action: string;
  params: Record<string, unknown>;
  resolve: (result: { result?: unknown; error?: { code: number; message: string } }) => void;
}

export interface ConnectContextValue {
  /** Called by IframeAgent's ConnectHost when a dApp requests connection */
  requestApproval: (
    dapp: DAppMetadata,
    permissions: PermissionScope[],
  ) => Promise<{ approved: boolean; grantedPermissions: PermissionScope[] }>;

  /** Called by IframeAgent's ConnectHost when a dApp sends an intent */
  requestIntent: (
    action: string,
    params: Record<string, unknown>,
  ) => Promise<{ result?: unknown; error?: { code: number; message: string } }>;

  /** Current pending approval (for modal rendering) */
  pendingApproval: PendingApproval | null;

  /** Current pending intent (for intent handler rendering) */
  pendingIntent: PendingIntent | null;

  /** Approve the pending connection */
  approveConnection: (grantedPermissions: PermissionScope[]) => void;

  /** Deny the pending connection */
  denyConnection: () => void;

  /** Resolve the pending intent with a result */
  resolveIntent: (result: unknown) => void;

  /** Reject the pending intent with an error */
  rejectIntent: (code: number, message: string) => void;
}

export const ConnectContext = createContext<ConnectContextValue | null>(null);

export function useConnectContext(): ConnectContextValue {
  const ctx = useContext(ConnectContext);
  if (!ctx) throw new Error('useConnectContext must be used within ConnectProvider');
  return ctx;
}
