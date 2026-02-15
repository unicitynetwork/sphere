/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react';
import { Send, MessageSquare, Loader2, CheckCircle, XCircle } from 'lucide-react';
import { toSmallestUnit } from '@unicitylabs/sphere-sdk';
import { ERROR_CODES } from '@unicitylabs/sphere-sdk/connect';
import { useAssets, useTransfer, formatAmount } from '../../sdk';
import { BaseModal, ModalHeader, Button } from '../wallet/ui';
import { useConnectContext } from './ConnectContext';

export function ConnectIntentHandler() {
  const { pendingIntent, resolveIntent, rejectIntent } = useConnectContext();
  const { assets } = useAssets();
  const { transfer } = useTransfer();
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<'success' | 'error' | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  if (!pendingIntent) return null;

  const { action, params } = pendingIntent;

  const handleClose = () => {
    rejectIntent(ERROR_CODES.USER_REJECTED, 'User cancelled');
    setProcessing(false);
    setResult(null);
    setErrorMsg('');
  };

  // --- Send Intent ---
  if (action === 'send') {
    const to = params.to as string;
    const amount = params.amount as string;
    const coinId = (params.coinId as string) ?? 'UCT';
    const asset = assets.find((a) => a.coinId === coinId);

    const handleConfirmSend = async () => {
      setProcessing(true);
      try {
        const smallestAmount = asset
          ? toSmallestUnit(amount, asset.decimals).toString()
          : amount;

        await transfer({
          coinId,
          amount: smallestAmount,
          recipient: to,
        });

        setResult('success');
        setTimeout(() => {
          resolveIntent({ success: true });
          setProcessing(false);
          setResult(null);
        }, 1500);
      } catch (e: any) {
        setResult('error');
        setErrorMsg(e.message || 'Transfer failed');
        setProcessing(false);
      }
    };

    return (
      <BaseModal isOpen={true} onClose={handleClose} showOrbs={false}>
        <ModalHeader title="dApp Transfer Request" icon={Send} onClose={handleClose} closeDisabled={processing} />

        <div className="px-6 py-5 flex-1 flex flex-col justify-center">
          {result === 'success' ? (
            <div className="text-center py-6">
              <div className="w-14 h-14 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-3">
                <CheckCircle className="w-7 h-7 text-emerald-500" />
              </div>
              <p className="text-neutral-900 dark:text-white font-semibold">Sent!</p>
            </div>
          ) : result === 'error' ? (
            <div className="text-center py-6">
              <div className="w-14 h-14 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-3">
                <XCircle className="w-7 h-7 text-red-500" />
              </div>
              <p className="text-red-500 font-semibold mb-2">Transfer Failed</p>
              <p className="text-neutral-500 text-sm">{errorMsg}</p>
              <Button variant="secondary" onClick={handleClose} className="mt-4">
                Close
              </Button>
            </div>
          ) : processing ? (
            <div className="text-center py-6">
              <Loader2 className="w-10 h-10 text-orange-500 animate-spin mx-auto mb-3" />
              <p className="text-neutral-700 dark:text-neutral-300">Processing transfer...</p>
            </div>
          ) : (
            <>
              <div className="bg-neutral-100 dark:bg-neutral-900 rounded-2xl p-5 mb-5 border border-neutral-200 dark:border-white/10 text-center">
                <div className="text-sm text-neutral-500 mb-1">Send</div>
                <div className="text-3xl font-bold text-neutral-900 dark:text-white mb-3">
                  {amount} <span className="text-orange-500">{asset?.symbol ?? coinId}</span>
                </div>
                <div className="text-sm text-neutral-500">
                  to <span className="text-neutral-900 dark:text-white font-medium">{to}</span>
                </div>
                {asset && (
                  <div className="text-xs text-neutral-400 mt-2">
                    Balance: {formatAmount(asset.totalAmount, asset.decimals)} {asset.symbol}
                  </div>
                )}
              </div>

              <div className="flex gap-3">
                <Button variant="secondary" fullWidth onClick={handleClose}>
                  Reject
                </Button>
                <Button variant="primary" fullWidth onClick={handleConfirmSend}>
                  Confirm & Send
                </Button>
              </div>
            </>
          )}
        </div>
      </BaseModal>
    );
  }

  // --- DM Intent ---
  if (action === 'dm') {
    const to = params.to as string;
    const message = params.message as string;

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

          <div className="flex gap-3">
            <Button variant="secondary" fullWidth onClick={handleClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              fullWidth
              onClick={() => {
                // DM not fully integrated yet — return success stub
                resolveIntent({ sent: false, reason: 'DM UI integration pending' });
              }}
            >
              Send DM
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
