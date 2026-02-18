import { Cloud, CloudOff, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useIpfsSync, useSphereContext } from '../../sdk/hooks';
import { HeaderTooltip } from './HeaderTooltip';

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
  const { status, lastSynced } = useIpfsSync();
  const isSyncing = ipfsEnabled && status === 'syncing';
  const isError = ipfsEnabled && status === 'error';
  const statusText = getStatusText(ipfsEnabled, status, lastSynced);

  const iconClass = 'w-4 h-4 sm:w-5 sm:h-5';

  return (
    <HeaderTooltip label={ipfsEnabled ? 'Disable IPFS sync' : 'Enable IPFS sync'}>
      <motion.button
        onClick={toggleIpfs}
        whileHover={{ scale: 1.05, y: -2 }}
        whileTap={{ scale: 0.95 }}
        transition={{ duration: 0.05 }}
        className="relative flex items-center gap-1.5 px-2 py-1.5 sm:px-2.5 sm:py-2 rounded-lg sm:rounded-xl transition-all hover:bg-neutral-100 dark:hover:bg-neutral-800/80 cursor-pointer group"
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
              <CloudOff className={`${iconClass} text-neutral-400 dark:text-neutral-500 group-hover:text-orange-400 transition-colors`} />
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
              <Cloud className={`${iconClass} transition-colors group-hover:text-orange-400 ${
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
        <div className="absolute inset-0 rounded-lg sm:rounded-xl bg-orange-500/0 group-hover:bg-orange-500/10 transition-colors" />
      </motion.button>
    </HeaderTooltip>
  );
}
