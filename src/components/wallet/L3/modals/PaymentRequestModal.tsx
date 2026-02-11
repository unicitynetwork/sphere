import { Check, Sparkles, Trash2, Loader2, XIcon, ArrowRight, Clock, Receipt, AlertCircle } from 'lucide-react';
import { useIncomingPaymentRequests } from '../hooks/useIncomingPaymentRequests';
import { type IncomingPaymentRequest, PaymentRequestStatus } from '../data/model';
import { useTransfer } from '../../../../sdk';
import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import { AmountFormatUtils } from '../utils/currency';
import { BaseModal, ModalHeader, EmptyState } from '../../ui';

interface PaymentRequestsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function PaymentRequestsModal({ isOpen, onClose }: PaymentRequestsModalProps) {
  const { requests, pendingCount, reject, clearProcessed, paid } = useIncomingPaymentRequests();
  const { transfer } = useTransfer();
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const hasProcessed = requests.some(r => r.status !== PaymentRequestStatus.PENDING);
  const isGlobalProcessing = !!processingId;

  const handleSafeClose = () => {
    if (!isGlobalProcessing) {
      setErrors({});
      onClose();
    }
  };

  const handlePay = async (req: IncomingPaymentRequest) => {
    setProcessingId(req.id);
    setErrors(prev => ({ ...prev, [req.id]: '' }));
    try {
      const recipient = req.recipientNametag ? `@${req.recipientNametag}` : req.senderPubkey;
      console.log(`Initiating payment for request ${req.requestId} to ${recipient}`);
      await transfer({
        recipient,
        amount: req.amount.toString(),
        coinId: req.coinId,
      });
      paid(req);
    } catch (error: unknown) {
      console.error("Failed to execute payment transaction:", error);
      let errorMessage = "Transaction failed";
      if (error instanceof Error) {
        if (error.message.includes("Insufficient")) {
          errorMessage = "Insufficient funds";
        } else {
          errorMessage = error.message;
        }
      }

      setErrors(prev => ({ ...prev, [req.id]: errorMessage }));
    } finally {
      setProcessingId(null);
    }
  };

  const subtitle = pendingCount > 0 ? (
    <div className="flex items-center gap-2">
      <span className="flex h-2 w-2 relative">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75"></span>
        <span className="relative inline-flex rounded-full h-2 w-2 bg-orange-500"></span>
      </span>
      <span className="text-orange-500 dark:text-orange-400 font-semibold">
        {pendingCount} pending
      </span>
    </div>
  ) : undefined;

  return (
    <BaseModal isOpen={isOpen} onClose={handleSafeClose}>
      <ModalHeader
        title="Payment Requests"
        icon={Receipt}
        subtitle={subtitle}
        onClose={handleSafeClose}
        closeDisabled={isGlobalProcessing}
      />

      {/* Content - Scrollable */}
      <div className="relative flex-1 overflow-y-auto custom-scrollbar p-4 space-y-3 z-10 min-h-0">
        {requests.length === 0 ? (
          <EmptyState
            icon={Sparkles}
            title="No Requests"
            description="Incoming payment requests will appear here"
          />
        ) : (
          <AnimatePresence mode='popLayout'>
            {requests.map((req) => (
              <RequestCard
                key={req.id}
                req={req}
                error={errors[req.id]}
                onPay={() => handlePay(req)}
                onReject={() => reject(req)}
                isProcessing={processingId === req.id}
                isGlobalDisabled={isGlobalProcessing}
              />
            ))}
          </AnimatePresence>
        )}
      </div>

      {/* Footer - Fixed */}
      {hasProcessed && (
        <div className="relative shrink-0 p-4 border-t border-neutral-200/50 dark:border-neutral-700/50 backdrop-blur-xl z-20">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={clearProcessed}
            disabled={isGlobalProcessing}
            className="w-full py-3 flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-wider text-neutral-500 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-500/10 rounded-xl transition-all disabled:opacity-50 border border-neutral-200/50 dark:border-neutral-700/50 hover:border-red-500/30"
          >
            <Trash2 className="w-4 h-4" /> Clear History
          </motion.button>
        </div>
      )}
    </BaseModal>
  );
}


interface RequestCardProps {
  req: IncomingPaymentRequest;
  error?: string;
  onPay: () => void;
  onReject: () => void;
  isProcessing: boolean;
  isGlobalDisabled: boolean;
}

function RequestCard({ req, error, onPay, onReject, isProcessing, isGlobalDisabled }: RequestCardProps) {
  const isPending = req.status === PaymentRequestStatus.PENDING;
  const amountDisplay = AmountFormatUtils.formatDisplayAmount(req.amount.toString(), req.coinId);
  const timeAgo = getTimeAgo(req.timestamp);

  // Стиль статуса
  const statusConfig = {
    [PaymentRequestStatus.ACCEPTED]: { color: 'text-emerald-500', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', icon: Check, label: 'Payment Sent' },
    [PaymentRequestStatus.PAID]: { color: 'text-emerald-500', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', icon: Check, label: 'Paid Successfully' },
    [PaymentRequestStatus.REJECTED]: { color: 'text-red-500', bg: 'bg-red-500/10', border: 'border-red-500/20', icon: XIcon, label: 'Request Declined' },
    [PaymentRequestStatus.PENDING]: { color: 'text-orange-500', bg: 'bg-orange-500/10', border: 'border-orange-500/20', icon: Clock, label: 'Awaiting Payment' },
  };

  const currentStatus = statusConfig[req.status];
  const StatusIcon = currentStatus.icon;

  const isDisabled = isGlobalDisabled && !isProcessing;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
      className={`relative rounded-2xl overflow-hidden border transition-all duration-300 ${isPending
        ? 'bg-white/60 dark:bg-neutral-800/60 border-neutral-200/60 dark:border-neutral-700/60 shadow-xl shadow-black/10 dark:shadow-black/30 backdrop-blur-xl'
        : 'bg-neutral-100/40 dark:bg-neutral-800/40 border-neutral-200/40 dark:border-neutral-700/40 opacity-70'
        } ${isDisabled ? 'opacity-50 pointer-events-none' : ''}`}
    >
      {/* Decorative gradient top bar */}
      {isPending && (
        <div className="absolute top-0 left-0 right-0 h-1 bg-linear-to-r from-orange-500 via-orange-400 to-orange-600" />
      )}

      <div className="p-5">
        {/* Top: Info */}
        <div className="flex justify-between items-start mb-5">
          <div className="flex flex-col">
            <span className="text-[10px] text-neutral-500 font-bold uppercase tracking-wider mb-1.5">From</span>
            <div className="flex items-center gap-2">
              <span className="text-neutral-900 dark:text-white font-bold text-base">
                {req.recipientNametag ? `@${req.recipientNametag}` : `${req.senderPubkey.slice(0, 12)}...`}
              </span>
            </div>
          </div>
          <div className="bg-neutral-200/50 dark:bg-neutral-700/50 px-2.5 py-1 rounded-lg text-[10px] text-neutral-500 dark:text-neutral-400 font-medium">
            {timeAgo}
          </div>
        </div>

        {/* Center: Amount */}
        <div className="flex flex-col items-center justify-center py-3 mb-4">
          <div className="text-4xl font-black text-neutral-900 dark:text-white tracking-tight flex items-baseline gap-2">
            {amountDisplay} <span className="text-xl text-orange-500 dark:text-orange-400 font-bold">{req.symbol}</span>
          </div>
          {req.message && (
            <motion.div
              initial={{ opacity: 0, y: -5 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-4 text-xs text-neutral-700 dark:text-neutral-300 bg-neutral-200/50 dark:bg-neutral-700/50 px-4 py-2 rounded-xl border border-neutral-300/50 dark:border-neutral-600/50 backdrop-blur-sm max-w-full"
            >
              <span className="text-neutral-500">"</span>{req.message}<span className="text-neutral-500">"</span>
            </motion.div>
          )}
        </div>
      </div>

      {/* Bottom: Actions */}
      <div className="p-4 bg-neutral-100/50 dark:bg-neutral-900/50 border-t border-neutral-200/50 dark:border-neutral-700/50 backdrop-blur-sm">
        {isPending ? (
          <div className="flex flex-col gap-3">

            {/* ERROR DISPLAY */}
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="flex items-center justify-center gap-2 text-red-400 text-xs font-semibold bg-red-500/10 py-2.5 rounded-xl border border-red-500/30"
                >
                  <AlertCircle className="w-3.5 h-3.5" />
                  {error}
                </motion.div>
              )}
            </AnimatePresence>

            <div className="grid grid-cols-[1fr_2fr] gap-3">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                onClick={onReject}
                disabled={isGlobalDisabled}
                className="py-3 rounded-xl font-bold text-xs bg-neutral-200/80 dark:bg-neutral-800/80 text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-white hover:bg-neutral-300/80 dark:hover:bg-neutral-700/80 border border-neutral-300/60 dark:border-neutral-700/60 hover:border-neutral-400 dark:hover:border-neutral-600 transition-all"
              >
                Decline
              </motion.button>

              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                onClick={onPay}
                disabled={isGlobalDisabled}
                className="relative py-3 rounded-xl font-bold text-sm text-white bg-linear-to-r from-orange-500 to-orange-600 shadow-xl shadow-orange-500/30 flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:shadow-none overflow-hidden group"
              >
                <div className="absolute inset-0 bg-linear-to-r from-orange-400 to-orange-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                <span className="relative z-10 flex items-center gap-2">
                  {isProcessing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> Processing
                    </>
                  ) : (
                    <>
                      Pay Now <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </span>
              </motion.button>
            </div>
          </div>
        ) : (
          /* STATUS BADGE */
          <div className={`flex items-center justify-center gap-2 py-2.5 text-xs font-bold uppercase tracking-wider rounded-lg ${currentStatus.bg} ${currentStatus.color} border ${currentStatus.border}`}>
            <StatusIcon className="w-4 h-4" />
            {currentStatus.label}
          </div>
        )}
      </div>
    </motion.div>
  );
}


const getTimeAgo = (timestamp: number) => {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};
