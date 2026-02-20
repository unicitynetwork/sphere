import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Info, AlertTriangle, CheckCircle, XCircle, ArrowDownLeft } from 'lucide-react';
import type { ToastType, ShowToastDetail, TransferToastData } from './toast-utils';

export interface ToastData {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
  transfer?: TransferToastData;
}

const icons: Record<ToastType, React.ReactNode> = {
  info: <Info className="w-5 h-5" />,
  success: <CheckCircle className="w-5 h-5" />,
  warning: <AlertTriangle className="w-5 h-5" />,
  error: <XCircle className="w-5 h-5" />,
};

const colors: Record<ToastType, string> = {
  info: 'bg-blue-500/90 border-blue-400',
  success: 'bg-green-500/90 border-green-400',
  warning: 'bg-yellow-500/90 border-yellow-400',
  error: 'bg-red-500/90 border-red-400',
};

function TransferToast({ data, onClose }: { data: TransferToastData; onClose: () => void }) {
  return (
    <div className="pointer-events-auto rounded-2xl border border-emerald-500/30 bg-neutral-900/95 backdrop-blur-md shadow-2xl shadow-emerald-500/10 overflow-hidden min-w-80 max-w-96">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-emerald-500/10 border-b border-emerald-500/20">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center">
            <ArrowDownLeft className="w-3 h-3 text-white" />
          </div>
          <span className="text-xs font-medium text-emerald-400">Incoming Transfer</span>
        </div>
        <button
          onClick={onClose}
          className="p-1 hover:bg-white/10 rounded-lg transition-colors"
        >
          <X className="w-3.5 h-3.5 text-neutral-400" />
        </button>
      </div>

      {/* Body */}
      <div className="px-4 py-3 flex items-center gap-3">
        {/* Token icon */}
        {data.iconUrl ? (
          <img src={data.iconUrl} className="w-10 h-10 rounded-full shrink-0" alt="" />
        ) : (
          <div className="w-10 h-10 rounded-full bg-neutral-700 flex items-center justify-center shrink-0">
            <span className="text-sm font-semibold text-neutral-300">{data.symbol.slice(0, 2)}</span>
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="text-lg font-bold text-white">
            +{data.amount} <span className="text-emerald-400">{data.symbol}</span>
          </div>
          <div className="text-xs text-neutral-400">
            from <span className="text-neutral-200 font-medium">{data.sender}</span>
          </div>
        </div>
      </div>

      {/* Memo */}
      {data.memo && (
        <div className="px-4 pb-3 -mt-1">
          <div className="text-xs text-neutral-500 bg-neutral-800/50 rounded-lg px-3 py-1.5 italic truncate">
            &ldquo;{data.memo}&rdquo;
          </div>
        </div>
      )}
    </div>
  );
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastData[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((detail: ShowToastDetail) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const toast: ToastData = {
      id,
      message: detail.message,
      type: detail.type || 'info',
      duration: detail.duration ?? 4000,
      transfer: detail.transfer,
    };

    setToasts((prev) => [...prev, toast]);

    if (toast.duration && toast.duration > 0) {
      setTimeout(() => removeToast(id), toast.duration);
    }
  }, [removeToast]);

  useEffect(() => {
    const handleShowToast = (event: CustomEvent<ShowToastDetail>) => {
      addToast(event.detail);
    };

    window.addEventListener('show-toast', handleShowToast as EventListener);
    return () => {
      window.removeEventListener('show-toast', handleShowToast as EventListener);
    };
  }, [addToast]);

  return (
    <div className="fixed bottom-4 right-4 z-100001 flex flex-col gap-2 pointer-events-none">
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
          >
            {toast.transfer ? (
              <TransferToast data={toast.transfer} onClose={() => removeToast(toast.id)} />
            ) : (
              <div className={`
                pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl
                border shadow-lg backdrop-blur-sm text-white min-w-70 max-w-100
                ${colors[toast.type]}
              `}>
                {icons[toast.type]}
                <span className="flex-1 text-sm font-medium">{toast.message}</span>
                <button
                  onClick={() => removeToast(toast.id)}
                  className="p-1 hover:bg-white/20 rounded-lg transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
