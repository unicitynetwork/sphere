import { useState } from 'react';
import { Plug, Shield } from 'lucide-react';
import { PERMISSION_SCOPES } from '@unicitylabs/sphere-sdk/connect';
import type { PermissionScope } from '@unicitylabs/sphere-sdk/connect';
import { BaseModal, ModalHeader, Button } from '../wallet/ui';
import { useConnectContext } from './ConnectContext';

const PERMISSION_LABELS: Record<string, string> = {
  [PERMISSION_SCOPES.IDENTITY_READ]: 'View identity',
  [PERMISSION_SCOPES.BALANCE_READ]: 'View balance',
  [PERMISSION_SCOPES.TOKENS_READ]: 'View tokens',
  [PERMISSION_SCOPES.HISTORY_READ]: 'View history',
  [PERMISSION_SCOPES.L1_READ]: 'View L1 data',
  [PERMISSION_SCOPES.EVENTS_SUBSCRIBE]: 'Subscribe to events',
  [PERMISSION_SCOPES.RESOLVE_PEER]: 'Resolve addresses',
  [PERMISSION_SCOPES.TRANSFER_REQUEST]: 'Request transfers',
  [PERMISSION_SCOPES.L1_TRANSFER]: 'Request L1 transfers',
  [PERMISSION_SCOPES.DM_REQUEST]: 'Send direct messages',
  [PERMISSION_SCOPES.DM_READ]: 'Read direct messages',
  [PERMISSION_SCOPES.PAYMENT_REQUEST]: 'Payment requests',
  [PERMISSION_SCOPES.SIGN_REQUEST]: 'Sign messages',
};

export function ConnectionApprovalModal() {
  const { pendingApproval, approveConnection, denyConnection } = useConnectContext();
  const [selected, setSelected] = useState<Set<PermissionScope>>(new Set());

  if (!pendingApproval) return null;

  const { dapp, permissions } = pendingApproval;

  // Initialize selected permissions on first render
  if (selected.size === 0 && permissions.length > 0) {
    const initial = new Set(permissions);
    // identity:read is always granted
    initial.add(PERMISSION_SCOPES.IDENTITY_READ as PermissionScope);
    setSelected(initial);
  }

  const togglePermission = (perm: PermissionScope) => {
    if (perm === PERMISSION_SCOPES.IDENTITY_READ) return; // always granted
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(perm)) {
        next.delete(perm);
      } else {
        next.add(perm);
      }
      return next;
    });
  };

  const handleApprove = () => {
    approveConnection([...selected]);
    setSelected(new Set());
  };

  const handleDeny = () => {
    denyConnection();
    setSelected(new Set());
  };

  return (
    <BaseModal isOpen={true} onClose={handleDeny}>
      <ModalHeader
        title="Connect dApp"
        subtitle={dapp.url}
        icon={Plug}
        onClose={handleDeny}
      />

      <div className="relative z-10 px-6 py-5 overflow-y-auto flex-1">
        {/* dApp info */}
        <div className="flex items-center gap-3 mb-5 p-3 bg-neutral-50 dark:bg-neutral-800/50 rounded-xl">
          {dapp.icon && (
            <img src={dapp.icon} alt="" className="w-10 h-10 rounded-lg" />
          )}
          <div>
            <div className="font-semibold text-neutral-900 dark:text-white">{dapp.name}</div>
            {dapp.description && (
              <div className="text-xs text-neutral-500 dark:text-neutral-400">{dapp.description}</div>
            )}
          </div>
        </div>

        {/* Permissions */}
        <div className="flex items-center gap-2 mb-3">
          <Shield className="w-4 h-4 text-neutral-500" />
          <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Permissions</span>
        </div>

        <div className="space-y-2">
          {permissions.map((perm) => {
            const isIdentity = perm === PERMISSION_SCOPES.IDENTITY_READ;
            return (
              <label
                key={perm}
                className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-neutral-50 dark:hover:bg-neutral-800/30 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selected.has(perm)}
                  onChange={() => togglePermission(perm)}
                  disabled={isIdentity}
                  className="w-4 h-4 rounded accent-orange-500"
                />
                <span className={`text-sm ${isIdentity ? 'text-neutral-400' : 'text-neutral-700 dark:text-neutral-300'}`}>
                  {PERMISSION_LABELS[perm] ?? perm}
                </span>
                {isIdentity && (
                  <span className="text-xs text-neutral-400 ml-auto">Always granted</span>
                )}
              </label>
            );
          })}
        </div>
      </div>

      {/* Actions */}
      <div className="relative z-10 px-6 py-4 border-t border-neutral-200/50 dark:border-neutral-700/50 flex gap-3 shrink-0">
        <Button variant="secondary" fullWidth onClick={handleDeny}>
          Deny
        </Button>
        <Button variant="success" fullWidth onClick={handleApprove}>
          Connect
        </Button>
      </div>
    </BaseModal>
  );
}
