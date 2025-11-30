import { X, Check, Sparkles, Trash2, Loader2, XIcon, ArrowRight, Clock, Receipt, AlertCircle } from 'lucide-react'; // Иконки
import { useIncomingPaymentRequests } from '../hooks/useIncomingPaymentRequests';
import { type IncomingPaymentRequest, PaymentRequestStatus } from '../data/model';
import { useWallet } from '../hooks/useWallet';
import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';

interface PaymentRequestsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function PaymentRequestsModal({ isOpen, onClose }: PaymentRequestsModalProps) {
  const { requests, pendingCount, reject, clearProcessed, paid } = useIncomingPaymentRequests();
  const { sendAmount } = useWallet();
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
      console.log(`Initiating payment for request ${req.requestId} to @${req.recipientNametag}`);
      await sendAmount({
        recipientNametag: req.recipientNametag,
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


  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop with Blur */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleSafeClose}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md"
          />

          {/* Modal Container */}
          <div className="fixed inset-0 z-100 flex items-center justify-center p-4">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={handleSafeClose}
              className="absolute inset-0 bg-black/80 backdrop-blur-xl"
            />

            {/* Modal Container */}
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              transition={{ type: "spring", bounce: 0.3, duration: 0.5 }}
              className="relative w-full max-w-md bg-[#0a0a0a] border border-white/10 rounded-4xl shadow-2xl shadow-black flex flex-col max-h-[85vh] overflow-hidden"
            >
              {/* Header */}
              <div className="px-6 py-5 border-b border-white/5 flex justify-between items-center bg-[#111]/50 backdrop-blur-md z-20">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-white/5 border border-white/5 flex items-center justify-center">
                    <Receipt className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white leading-tight">Invoices</h3>
                    <p className="text-xs text-neutral-500 font-medium">
                      {pendingCount} pending requests
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleSafeClose}
                  disabled={isGlobalProcessing}
                  className={`w-8 h-8 flex items-center justify-center rounded-full transition-colors ${isGlobalProcessing
                    ? 'bg-white/5 text-neutral-600 cursor-not-allowed'
                    : 'bg-white/5 hover:bg-white/10 text-neutral-400 hover:text-white'
                    }`}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4 bg-linear-to-b from-[#0a0a0a] to-black">
                {requests.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center opacity-40 py-12">
                    <div className="w-20 h-20 bg-white/5 rounded-3xl rotate-3 flex items-center justify-center mb-6 border border-white/5">
                      <Sparkles className="w-10 h-10 text-white" />
                    </div>
                    <p className="text-white font-medium text-lg">No Invoices</p>
                    <p className="text-neutral-500 text-sm mt-2 max-w-[200px]">
                      Incoming payment requests will appear here.
                    </p>
                  </div>
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

              {/* Footer */}
              {hasProcessed && (
                <div className="p-4 border-t border-white/5 bg-[#0a0a0a] z-20">
                  <button
                    onClick={clearProcessed}
                    disabled={isGlobalProcessing}
                    className="w-full py-3 flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-widest text-neutral-600 hover:text-red-500 hover:bg-red-500/5 rounded-xl transition-all disabled:opacity-50"
                  >
                    <Trash2 className="w-4 h-4" /> Clear History
                  </button>
                </div>
              )}
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
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
  const amountDisplay = formatDisplayAmount(req.amount.toString(), req.symbol);
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
        ? 'bg-[#141414] border-white/10 shadow-lg shadow-black/50'
        : 'bg-[#0a0a0a] border-white/5 opacity-60 grayscale-[0.5]'
        } ${isDisabled ? 'opacity-50 pointer-events-none' : ''}`}
    >
      {/* Декоративный градиент сверху */}
      {isPending && (
        <div className="absolute top-0 left-0 right-0 h-1 bg-linear-to-r from-orange-500 via-pink-500 to-purple-600 opacity-80" />
      )}

      <div className="p-5">
        {/* Top: Info */}
        <div className="flex justify-between items-start mb-6">
          <div className="flex flex-col">
            <span className="text-xs text-neutral-500 font-medium uppercase tracking-wider mb-1">Request From</span>
            <div className="flex items-center gap-2">
              <span className="text-white font-medium">@{req.recipientNametag}</span>
            </div>
          </div>
          <div className="bg-white/5 px-2 py-1 rounded-md text-[10px] text-neutral-500 font-mono">
            {timeAgo}
          </div>
        </div>

        {/* Center: Amount */}
        <div className="flex flex-col items-center justify-center py-2">
          <div className="text-3xl font-black text-white tracking-tight flex items-baseline gap-1">
            {amountDisplay} <span className="text-lg text-neutral-500 font-bold">{req.symbol}</span>
          </div>
          {req.message && (
            <div className="mt-3 text-xs text-neutral-400 bg-neutral-900/50 px-3 py-1.5 rounded-lg border border-white/5">
              "{req.message}"
            </div>
          )}
        </div>
      </div>

      {/* Bottom: Actions */}
      <div className="p-3 bg-[#0f0f0f]">
        {isPending ? (
          <div className="flex flex-col gap-3">

            {/* ВЫВОД ОШИБКИ */}
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="flex items-center justify-center gap-2 text-red-500 text-xs bg-red-500/10 py-2 rounded-lg border border-red-500/20"
                >
                  <AlertCircle className="w-3 h-3" />
                  {error}
                </motion.div>
              )}
            </AnimatePresence>

            <div className="grid grid-cols-[1fr_2fr] gap-3">
              <motion.button
                whileHover={{ scale: 1.02, backgroundColor: "#222" }}
                whileTap={{ scale: 0.97 }}
                onClick={onReject}
                disabled={isGlobalDisabled}
                className="py-3.5 rounded-xl font-bold text-xs bg-[#1a1a1a] text-neutral-400 hover:text-white border border-white/5 hover:border-white/10 transition-all"
              >
                Decline
              </motion.button>

              <motion.button
                whileHover={{ scale: 1.02, filter: "brightness(1.1)" }}
                whileTap={{ scale: 0.97 }}
                onClick={onPay}
                disabled={isGlobalDisabled}
                className="relative py-3.5 rounded-xl font-bold text-sm text-white bg-linear-to-r from-orange-500 to-orange-600 shadow-lg shadow-orange-500/20 flex items-center justify-center gap-2 transition-all disabled:opacity-70 disabled:shadow-none"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Processing
                  </>
                ) : (
                  <>
                    Pay Now <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </motion.button>
            </div>
          </div>
        ) : (
          /* STATUS BADGE */
          <div className={`flex items-center justify-center gap-2 py-2 text-xs font-bold uppercase tracking-wider ${currentStatus.color
            }`}>
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

const formatDisplayAmount = (amountStr: string, symbol: string): string => {
  try {
    const amount = parseFloat(amountStr);
    let divisor = 1_000_000.0;
    const sym = symbol.toUpperCase();
    if (sym === "SOL") divisor = 1_000_000_000.0;
    else if (sym === "BTC") divisor = 100_000_000.0;
    else if (sym === "ETH") divisor = 1_000_000_000_000_000_000.0;

    const val = amount / divisor;
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 }).format(val);
  } catch { return amountStr; }
};