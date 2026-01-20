/**
 * Sync Mode Selector Component
 *
 * Displays current sync mode and provides controls for LOCAL mode recovery.
 * Per TOKEN_INVENTORY_SPEC.md Section 10.7 and Section 12
 */

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Cloud, CloudOff, RefreshCw, Clock, AlertTriangle, Zap } from 'lucide-react';
import type { SyncMode, CircuitBreakerState, SyncResult } from '../types/SyncTypes';

interface SyncModeSelectorProps {
  /** Current sync mode */
  mode: SyncMode;
  /** Circuit breaker state for LOCAL mode recovery */
  circuitBreaker?: CircuitBreakerState;
  /** Last sync result for status display */
  lastSyncResult?: SyncResult | null;
  /** Whether a sync is currently in progress */
  isSyncing: boolean;
  /** Callback to trigger manual sync/retry */
  onRetrySync?: () => Promise<void>;
  /** Compact display mode for header */
  compact?: boolean;
}

/**
 * Mode configuration for display
 */
const MODE_CONFIG: Record<SyncMode, {
  label: string;
  icon: typeof Cloud;
  color: string;
  bgColor: string;
  description: string;
}> = {
  NORMAL: {
    label: 'Synced',
    icon: Cloud,
    color: 'text-green-400',
    bgColor: 'bg-green-500/10',
    description: 'Full sync with IPFS'
  },
  FAST: {
    label: 'Quick Sync',
    icon: Zap,
    color: 'text-yellow-400',
    bgColor: 'bg-yellow-500/10',
    description: 'Fast sync (skipping spent detection)'
  },
  NAMETAG: {
    label: 'Nametag Only',
    icon: Cloud,
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/10',
    description: 'Fetching nametag only'
  },
  LOCAL: {
    label: 'Offline',
    icon: CloudOff,
    color: 'text-orange-400',
    bgColor: 'bg-orange-500/10',
    description: 'Changes saved locally only'
  }
};

/**
 * Format time remaining for countdown display
 */
function formatTimeRemaining(ms: number): string {
  if (ms <= 0) return 'now';
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

export function SyncModeSelector({
  mode,
  circuitBreaker,
  lastSyncResult,
  isSyncing,
  onRetrySync,
  compact = false
}: SyncModeSelectorProps) {
  const [isRetrying, setIsRetrying] = useState(false);
  const [timeUntilRetry, setTimeUntilRetry] = useState<number | null>(null);

  // Update countdown timer for LOCAL mode auto-recovery
  useEffect(() => {
    if (circuitBreaker?.localModeActive && circuitBreaker.nextRecoveryAttempt) {
      const updateTimer = () => {
        const remaining = circuitBreaker.nextRecoveryAttempt! - Date.now();
        setTimeUntilRetry(remaining > 0 ? remaining : 0);
      };

      updateTimer();
      const interval = setInterval(updateTimer, 1000);
      return () => clearInterval(interval);
    } else {
      setTimeUntilRetry(null);
    }
  }, [circuitBreaker?.localModeActive, circuitBreaker?.nextRecoveryAttempt]);

  const handleRetrySync = useCallback(async () => {
    if (!onRetrySync || isRetrying || isSyncing) return;
    setIsRetrying(true);
    try {
      await onRetrySync();
    } finally {
      setIsRetrying(false);
    }
  }, [onRetrySync, isRetrying, isSyncing]);

  const config = MODE_CONFIG[mode];
  const Icon = config.icon;
  const isLocalMode = mode === 'LOCAL';
  const showRetryButton = isLocalMode && onRetrySync && !isSyncing;

  // Compact mode - just show an icon with tooltip
  if (compact) {
    return (
      <div className="relative group">
        <motion.div
          className={`flex items-center gap-1.5 px-2 py-1 rounded-full ${config.bgColor}`}
          animate={isSyncing ? { opacity: [1, 0.5, 1] } : {}}
          transition={{ repeat: isSyncing ? Infinity : 0, duration: 1.5 }}
        >
          {isSyncing ? (
            <RefreshCw className={`w-3.5 h-3.5 ${config.color} animate-spin`} />
          ) : (
            <Icon className={`w-3.5 h-3.5 ${config.color}`} />
          )}
          <span className={`text-xs font-medium ${config.color}`}>
            {isSyncing ? 'Syncing' : config.label}
          </span>
        </motion.div>

        {/* Tooltip */}
        <div className="absolute top-full left-0 mt-1 opacity-0 group-hover:opacity-100 transition-opacity z-50">
          <div className="bg-gray-900 border border-gray-700 rounded-lg p-2 shadow-lg min-w-[180px]">
            <div className="text-xs text-gray-400">{config.description}</div>
            {isLocalMode && timeUntilRetry !== null && (
              <div className="text-xs text-orange-400 mt-1 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                Auto-retry in {formatTimeRemaining(timeUntilRetry)}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Full mode - expanded card
  return (
    <div className={`rounded-lg border ${isLocalMode ? 'border-orange-500/50 bg-orange-500/5' : 'border-gray-700 bg-gray-800/50'} p-3`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <motion.div
            className={`p-2 rounded-lg ${config.bgColor}`}
            animate={isSyncing ? { scale: [1, 1.1, 1] } : {}}
            transition={{ repeat: isSyncing ? Infinity : 0, duration: 1 }}
          >
            {isSyncing ? (
              <RefreshCw className={`w-5 h-5 ${config.color} animate-spin`} />
            ) : (
              <Icon className={`w-5 h-5 ${config.color}`} />
            )}
          </motion.div>

          <div>
            <div className="flex items-center gap-2">
              <span className={`font-medium ${config.color}`}>
                {isSyncing ? 'Syncing...' : config.label}
              </span>
              {lastSyncResult?.ipnsPublishPending && !isLocalMode && (
                <span className="text-xs text-yellow-400 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  IPNS pending
                </span>
              )}
            </div>
            <p className="text-xs text-gray-400">{config.description}</p>
          </div>
        </div>

        {/* Retry button for LOCAL mode */}
        <AnimatePresence>
          {showRetryButton && (
            <motion.button
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              onClick={handleRetrySync}
              disabled={isRetrying}
              className="flex items-center gap-2 px-3 py-1.5 bg-orange-500/20 hover:bg-orange-500/30 text-orange-400 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isRetrying ? 'animate-spin' : ''}`} />
              {isRetrying ? 'Retrying...' : 'Retry IPFS'}
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* LOCAL mode recovery info */}
      {isLocalMode && circuitBreaker && (
        <div className="mt-3 pt-3 border-t border-orange-500/20">
          <div className="flex items-center justify-between text-xs">
            <div className="text-gray-400">
              {circuitBreaker.consecutiveIpfsFailures > 0 && (
                <span>IPFS failures: {circuitBreaker.consecutiveIpfsFailures}</span>
              )}
              {circuitBreaker.consecutiveConflicts > 0 && (
                <span className="ml-2">Conflicts: {circuitBreaker.consecutiveConflicts}</span>
              )}
            </div>
            {timeUntilRetry !== null && (
              <div className="flex items-center gap-1 text-orange-400">
                <Clock className="w-3 h-3" />
                Auto-retry in {formatTimeRemaining(timeUntilRetry)}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Last sync result stats */}
      {lastSyncResult && !isSyncing && lastSyncResult.status !== 'ERROR' && (
        <div className="mt-3 pt-3 border-t border-gray-700/50 grid grid-cols-3 gap-2 text-xs">
          <div className="text-center">
            <div className="text-gray-400">Imported</div>
            <div className="font-medium text-gray-200">{lastSyncResult.operationStats.tokensImported}</div>
          </div>
          <div className="text-center">
            <div className="text-gray-400">Updated</div>
            <div className="font-medium text-gray-200">{lastSyncResult.operationStats.tokensUpdated}</div>
          </div>
          <div className="text-center">
            <div className="text-gray-400">Validated</div>
            <div className="font-medium text-gray-200">{lastSyncResult.operationStats.tokensValidated}</div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SyncModeSelector;
