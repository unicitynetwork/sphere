import { motion } from "framer-motion";
import { Loader2, WifiOff, RefreshCw, XCircle } from "lucide-react";
import type { ConnectionState } from "../hooks/useConnectionStatus";

interface ConnectionStatusProps {
  state: ConnectionState;
  message: string;
  error?: string;
  onRetry: () => void;
  onCancel: () => void;
}

export function ConnectionStatus({
  state,
  message,
  error,
  onRetry,
  onCancel,
}: ConnectionStatusProps) {
  // Don't show anything when connected
  if (state === "connected") {
    return null;
  }

  const isConnecting = state === "connecting";
  const isError = state === "error";

  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[300px] p-6">
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="flex flex-col items-center text-center max-w-sm"
      >
        {/* Animated spinner like logout/onboarding */}
        {isConnecting ? (
          <div className="relative w-20 h-20 mb-6">
            {/* Outer Ring */}
            <motion.div
              className="absolute inset-0 border-3 border-neutral-200 dark:border-neutral-800/50 rounded-full"
              animate={{ rotate: 360 }}
              transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
            />
            {/* Middle Ring */}
            <motion.div
              className="absolute inset-1.5 border-3 rounded-full border-blue-500/30 border-t-blue-500 border-r-blue-500"
              animate={{ rotate: -360 }}
              transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
            />
            {/* Inner Glow */}
            <div className="absolute inset-3 rounded-full blur-xl bg-blue-500/20" />
            {/* Center Icon */}
            <div className="absolute inset-0 flex items-center justify-center">
              <motion.div
                animate={{
                  scale: [1, 1.1, 1],
                  opacity: [0.5, 1, 0.5],
                }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
              >
                <Loader2 className="w-7 h-7 animate-spin text-blue-500 dark:text-blue-400" />
              </motion.div>
            </div>
          </div>
        ) : isError ? (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring" }}
            className="w-20 h-20 rounded-full bg-red-500/10 flex items-center justify-center mb-6"
          >
            <XCircle className="w-10 h-10 text-red-500" />
          </motion.div>
        ) : (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring" }}
            className="w-20 h-20 rounded-full bg-neutral-500/10 flex items-center justify-center mb-6"
          >
            <WifiOff className="w-10 h-10 text-neutral-400" />
          </motion.div>
        )}

        {/* Status Title */}
        <h3
          className={`text-xl font-bold mb-2 ${
            isError
              ? "text-red-600 dark:text-red-400"
              : isConnecting
              ? "text-blue-600 dark:text-blue-400"
              : "text-neutral-600 dark:text-neutral-400"
          }`}
        >
          {state === "connecting" && "Connecting to Blockchain"}
          {state === "error" && "Connection Failed"}
          {state === "disconnected" && "Disconnected"}
        </h3>

        {/* Status Message */}
        <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-4">
          {message}
        </p>

        {/* Status message with pulsing dot for connecting state */}
        {isConnecting && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-3 px-4 py-3 rounded-xl backdrop-blur-sm border mb-4 text-neutral-700 dark:text-neutral-300 bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-700/30"
          >
            <motion.span
              className="w-2 h-2 rounded-full bg-blue-500"
              animate={{ scale: [1, 1.5, 1], opacity: [1, 0.5, 1] }}
              transition={{ duration: 1.5, repeat: Infinity }}
            />
            <span className="text-sm">Establishing connection...</span>
          </motion.div>
        )}

        {/* Error details */}
        {error && isError && (
          <div className="w-full p-3 mb-4 bg-red-500/10 border border-red-500/20 rounded-xl">
            <p className="text-xs text-red-600 dark:text-red-400 font-mono break-all">
              {error}
            </p>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-3">
          {(isError || state === "disconnected") && (
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={onRetry}
              className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-xl flex items-center gap-2 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Retry Connection
            </motion.button>
          )}

          {isConnecting && (
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={onCancel}
              className="px-6 py-2.5 bg-neutral-200 dark:bg-neutral-700 hover:bg-neutral-300 dark:hover:bg-neutral-600 text-neutral-700 dark:text-neutral-200 font-medium rounded-xl flex items-center gap-2 transition-colors"
            >
              <XCircle className="w-4 h-4" />
              Cancel
            </motion.button>
          )}
        </div>

        {/* Server info */}
        <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-6">
          Fulcrum Server: fulcrum.unicity.network:50004
        </p>
      </motion.div>
    </div>
  );
}
