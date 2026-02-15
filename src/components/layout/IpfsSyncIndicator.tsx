import { useState } from 'react';
import { Cloud, CloudOff, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useIpfsSync, useSphereContext } from '../../sdk/hooks';

function formatTime(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 10) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function getStatusText(
  ipfsEnabled: boolean,
  status: string,
  lastSynced: number | null,
): string {
  if (!ipfsEnabled) return 'IPFS off';
  if (status === 'syncing') return 'Syncing...';
  if (status === 'error') return 'Error';
  if (lastSynced) return 'Synced';
  return 'IPFS';
}

export function IpfsSyncIndicator() {
  const { ipfsEnabled, toggleIpfs } = useSphereContext();
  const { status, lastSynced, lastError } = useIpfsSync();
  const [showTooltip, setShowTooltip] = useState(false);

  const isSyncing = ipfsEnabled && status === 'syncing';
  const isError = ipfsEnabled && status === 'error';
  const statusText = getStatusText(ipfsEnabled, status, lastSynced);

  const iconClass = 'w-4 h-4 sm:w-5 sm:h-5';

  return (
    <div
      className="relative"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <button
        onClick={toggleIpfs}
        className="flex items-center gap-1.5 px-2 py-1.5 sm:px-2.5 sm:py-2 rounded-lg transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
        title={ipfsEnabled ? 'Disable IPFS sync' : 'Enable IPFS sync'}
      >
        <AnimatePresence mode="wait">
          {!ipfsEnabled ? (
            <motion.div
              key="disabled"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.15 }}
            >
              <CloudOff className={`${iconClass} text-neutral-400 dark:text-neutral-500`} />
            </motion.div>
          ) : isSyncing ? (
            <motion.div
              key="syncing"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.15 }}
            >
              <Loader2 className={`${iconClass} text-orange-500 animate-spin`} />
            </motion.div>
          ) : isError ? (
            <motion.div
              key="error"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.15 }}
              className="relative"
            >
              <CloudOff className={`${iconClass} text-red-400 dark:text-red-500`} />
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-red-500" />
            </motion.div>
          ) : (
            <motion.div
              key="idle"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.15 }}
            >
              <Cloud className={`${iconClass} ${
                lastSynced
                  ? 'text-green-500/70 dark:text-green-400/70'
                  : 'text-neutral-400 dark:text-neutral-500'
              }`} />
            </motion.div>
          )}
        </AnimatePresence>

        <span className={`text-xs font-medium hidden sm:inline ${
          !ipfsEnabled ? 'text-neutral-400 dark:text-neutral-500' :
          isError ? 'text-red-400 dark:text-red-500' :
          isSyncing ? 'text-orange-500' :
          lastSynced ? 'text-green-500/70 dark:text-green-400/70' :
          'text-neutral-400 dark:text-neutral-500'
        }`}>
          {statusText}
        </span>
      </button>

      {/* Tooltip */}
      <AnimatePresence>
        {showTooltip && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full right-0 mt-2 px-3 py-2 rounded-lg text-xs whitespace-nowrap z-50 bg-neutral-900 dark:bg-neutral-800 text-neutral-100 border border-neutral-700 shadow-lg"
          >
            <div className="font-medium mb-0.5">
              {!ipfsEnabled && 'IPFS sync disabled'}
              {ipfsEnabled && isSyncing && 'IPFS syncing...'}
              {ipfsEnabled && isError && 'IPFS sync error'}
              {ipfsEnabled && status === 'idle' && (lastSynced ? 'IPFS synced' : 'IPFS idle')}
            </div>
            {lastSynced && ipfsEnabled && (
              <div className="text-neutral-400">
                Last sync: {formatTime(lastSynced)}
              </div>
            )}
            {lastError && ipfsEnabled && (
              <div className="text-red-400 max-w-48 truncate">
                {lastError}
              </div>
            )}
            <div className="text-neutral-500 mt-1">
              Click to {ipfsEnabled ? 'disable' : 'enable'}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
