import { useState, useRef } from 'react';
import { MessageSquare } from 'lucide-react';
import { ERROR_CODES } from '@unicitylabs/sphere-sdk/connect';
import { BaseModal, ModalHeader, Button } from '../wallet/ui';
import { SendModal } from '../wallet/L3/modals/SendModal';
import { useConnectContext } from './ConnectContext';
import { useSendDM } from '../../sdk/hooks/comms/useSendDM';

export function ConnectIntentHandler() {
  const { pendingIntent, resolveIntent, rejectIntent, connectHost } = useConnectContext();
  const { sendDM, isLoading: isSendingDM } = useSendDM();
  const [dmError, setDmError] = useState<string | null>(null);
  const [autoApproveDM, setAutoApproveDM] = useState(false);

  // Ref so the auto-approve closure always uses the latest sendDM
  const sendDMRef = useRef(sendDM);
  sendDMRef.current = sendDM;

  if (!pendingIntent) return null;

  const { action, params } = pendingIntent;

  const handleClose = () => {
    rejectIntent(ERROR_CODES.USER_REJECTED, 'User cancelled');
  };

  // --- Send Intent: reuse the wallet's SendModal ---
  if (action === 'send') {
    return (
      <SendModal
        isOpen={true}
        onClose={(result) => {
          if (result?.success) {
            resolveIntent({ success: true });
          } else {
            rejectIntent(ERROR_CODES.USER_REJECTED, 'User cancelled');
          }
        }}
        prefill={{
          to: params.to as string,
          amount: params.amount as string,
          coinId: (params.coinId as string) ?? 'UCT',
          memo: params.memo as string | undefined,
        }}
      />
    );
  }

  // --- DM Intent ---
  if (action === 'dm') {
    const to = params.to as string;
    const message = params.message as string;

    const handleSendDM = async () => {
      setDmError(null);
      try {
        const dm = await sendDM(to, message);

        // Register auto-approve if user checked the checkbox
        if (autoApproveDM && connectHost) {
          connectHost.setIntentAutoApprove('dm', async (_action, intentParams) => {
            try {
              const result = await sendDMRef.current(
                intentParams.to as string,
                intentParams.message as string,
              );
              return { result: { sent: true, messageId: result.id, timestamp: result.timestamp } };
            } catch (err) {
              return {
                error: {
                  code: ERROR_CODES.INTERNAL_ERROR,
                  message: err instanceof Error ? err.message : 'DM failed',
                },
              };
            }
          });
        }

        resolveIntent({ sent: true, messageId: dm.id, timestamp: dm.timestamp });
      } catch (err) {
        setDmError(err instanceof Error ? err.message : 'Failed to send DM');
      }
    };

    return (
      <BaseModal isOpen={true} onClose={handleClose} showOrbs={false}>
        <ModalHeader title="dApp DM Request" icon={MessageSquare} onClose={handleClose} />

        <div className="px-6 py-5 flex-1 flex flex-col justify-center">
          <div className="bg-neutral-100 dark:bg-neutral-900 rounded-2xl p-5 mb-5 border border-neutral-200 dark:border-white/10">
            <div className="text-sm text-neutral-500 mb-2">
              Send DM to <span className="text-neutral-900 dark:text-white font-medium">{to}</span>
            </div>
            <div className="bg-white dark:bg-neutral-800 rounded-xl p-3 text-neutral-700 dark:text-neutral-300 text-sm">
              {message}
            </div>
          </div>

          {/* Auto-approve checkbox */}
          <label className="flex items-center gap-3 mb-4 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoApproveDM}
              onChange={(e) => setAutoApproveDM(e.target.checked)}
              className="w-4 h-4 rounded accent-orange-500"
            />
            <span className="text-sm text-neutral-600 dark:text-neutral-400">
              Allow this dApp to send DMs without confirmation
            </span>
          </label>

          {dmError && (
            <div className="text-red-500 text-sm mb-3 text-center">{dmError}</div>
          )}

          <div className="flex gap-3">
            <Button variant="secondary" fullWidth onClick={handleClose} disabled={isSendingDM}>
              Cancel
            </Button>
            <Button
              variant="primary"
              fullWidth
              disabled={isSendingDM}
              onClick={handleSendDM}
            >
              {isSendingDM ? 'Sending…' : 'Send DM'}
            </Button>
          </div>
        </div>
      </BaseModal>
    );
  }

  // --- Unknown Intent ---
  return (
    <BaseModal isOpen={true} onClose={handleClose} showOrbs={false}>
      <ModalHeader title="Unknown Request" onClose={handleClose} />
      <div className="px-6 py-5 text-center">
        <p className="text-neutral-500 mb-4">
          Unsupported intent: <code className="text-neutral-700 dark:text-neutral-300">{action}</code>
        </p>
        <Button variant="secondary" onClick={handleClose}>
          Dismiss
        </Button>
      </div>
    </BaseModal>
  );
}
