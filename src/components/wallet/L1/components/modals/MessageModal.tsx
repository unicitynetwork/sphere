import { useState } from "react";
import { motion } from "framer-motion";
import { CheckCircle, XCircle, AlertTriangle, Info, X, Copy, Check, ExternalLink } from "lucide-react";

export type MessageType = "success" | "error" | "warning" | "info";

interface MessageModalProps {
  show: boolean;
  type: MessageType;
  title: string;
  message: string;
  txids?: string[];
  onClose: () => void;
}

const iconMap = {
  success: CheckCircle,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const colorMap = {
  success: {
    bg: "bg-emerald-500/10",
    text: "text-emerald-500",
    border: "border-emerald-900/50",
    button: "bg-emerald-600 hover:bg-emerald-500",
  },
  error: {
    bg: "bg-red-500/10",
    text: "text-red-500",
    border: "border-red-900/50",
    button: "bg-red-600 hover:bg-red-500",
  },
  warning: {
    bg: "bg-amber-500/10",
    text: "text-amber-500",
    border: "border-amber-900/50",
    button: "bg-amber-600 hover:bg-amber-500",
  },
  info: {
    bg: "bg-blue-500/10",
    text: "text-blue-500",
    border: "border-blue-900/50",
    button: "bg-blue-600 hover:bg-blue-500",
  },
};

function TxidItem({ txid }: { txid: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(txid);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const explorerUrl = `https://www.unicity.network/tx/${txid}`;

  return (
    <div className="flex items-center gap-2 p-2 bg-neutral-800/50 rounded-lg">
      <a
        href={explorerUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex-1 text-xs text-blue-400 hover:text-blue-300 font-mono truncate"
        title={txid}
      >
        {txid.slice(0, 12)}...{txid.slice(-12)}
      </a>
      <a
        href={explorerUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="p-1.5 text-neutral-400 hover:text-blue-400 transition-colors"
        title="Open in explorer"
      >
        <ExternalLink className="w-4 h-4" />
      </a>
      <button
        onClick={handleCopy}
        className="p-1.5 text-neutral-400 hover:text-emerald-400 transition-colors"
        title="Copy TXID"
      >
        {copied ? (
          <Check className="w-4 h-4 text-emerald-400" />
        ) : (
          <Copy className="w-4 h-4" />
        )}
      </button>
    </div>
  );
}

export function MessageModal({
  show,
  type,
  title,
  message,
  txids,
  onClose,
}: MessageModalProps) {
  if (!show) return null;

  const Icon = iconMap[type];
  const colors = colorMap[type];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-50 p-6"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.9, opacity: 0, y: 20 }}
        transition={{ type: "spring", duration: 0.4 }}
        className={`bg-neutral-900 p-6 rounded-xl w-full max-w-md border ${colors.border} shadow-2xl relative`}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-neutral-500 hover:text-neutral-300 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.1 }}
          className="flex flex-col items-center text-center mb-6"
        >
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
            className={`w-12 h-12 ${colors.bg} rounded-full flex items-center justify-center mb-4`}
          >
            <motion.div
              initial={{ scale: 0.8 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.3 }}
            >
              <Icon className={`w-6 h-6 ${colors.text}`} />
            </motion.div>
          </motion.div>
          <h3 className="text-white text-xl font-bold mb-2">{title}</h3>
          <p className="text-neutral-400 text-sm whitespace-pre-wrap">
            {message}
          </p>
        </motion.div>

        {txids && txids.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
            className="mb-4 space-y-2"
          >
            <p className="text-xs text-neutral-500 mb-2">Transaction ID{txids.length > 1 ? 's' : ''}:</p>
            {txids.map((txid) => (
              <TxidItem key={txid} txid={txid} />
            ))}
          </motion.div>
        )}

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onClose}
            className={`w-full py-3 ${colors.button} rounded-xl text-white font-medium transition-colors`}
          >
            OK
          </motion.button>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
