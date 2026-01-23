import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Info, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import type { ToastType, ShowToastDetail } from './toast-utils';

export interface ToastData {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
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
    <div className="fixed bottom-4 right-4 z-[100001] flex flex-col gap-2 pointer-events-none">
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className={`
              pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl
              border shadow-lg backdrop-blur-sm text-white min-w-[280px] max-w-[400px]
              ${colors[toast.type]}
            `}
          >
            {icons[toast.type]}
            <span className="flex-1 text-sm font-medium">{toast.message}</span>
            <button
              onClick={() => removeToast(toast.id)}
              className="p-1 hover:bg-white/20 rounded-lg transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
