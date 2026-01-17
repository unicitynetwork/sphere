/**
 * Sync Progress Indicator Component
 *
 * Shows sync progress and user notifications.
 * Per TOKEN_INVENTORY_SPEC.md Section 10.3 (User Notifications)
 */

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  CloudOff,
  WifiOff,
  X,
  RefreshCw,
  Upload,
  Download,
  Shield,
  Search
} from 'lucide-react';
import type { SyncResult, SyncStatus, SyncErrorCode } from '../types/SyncTypes';

interface SyncProgressIndicatorProps {
  /** Last sync result */
  lastSyncResult?: SyncResult | null;
  /** Whether sync is in progress */
  isSyncing: boolean;
  /** Current sync step (0-10) */
  currentStep?: number;
  /** Auto-dismiss success notifications after ms (0 = no auto-dismiss) */
  autoDismissMs?: number;
  /** Callback when user dismisses notification */
  onDismiss?: () => void;
  /** Show as minimal inline indicator */
  inline?: boolean;
}

/**
 * Sync step descriptions for progress display
 */
const SYNC_STEPS = [
  { step: 1, label: 'Loading local data', icon: Download },
  { step: 2, label: 'Fetching from IPFS', icon: CloudOff },
  { step: 3, label: 'Normalizing proofs', icon: Shield },
  { step: 4, label: 'Validating commitments', icon: Shield },
  { step: 5, label: 'Validating tokens', icon: Shield },
  { step: 6, label: 'Deduplicating', icon: Search },
  { step: 7, label: 'Checking spent status', icon: Search },
  { step: 8, label: 'Merging inventory', icon: RefreshCw },
  { step: 9, label: 'Preparing upload', icon: Upload },
  { step: 10, label: 'Publishing to IPFS', icon: Upload },
];

/**
 * Status-based notification config
 */
interface NotificationConfig {
  title: string;
  message: string;
  icon: typeof CheckCircle2;
  color: string;
  bgColor: string;
  borderColor: string;
}

function getNotificationConfig(result: SyncResult): NotificationConfig {
  switch (result.status) {
    case 'SUCCESS':
      return {
        title: 'Sync Complete',
        message: `${result.operationStats.tokensImported} tokens imported, ${result.operationStats.tokensValidated} validated`,
        icon: CheckCircle2,
        color: 'text-green-400',
        bgColor: 'bg-green-500/10',
        borderColor: 'border-green-500/30'
      };
    case 'PARTIAL_SUCCESS':
      return {
        title: 'Sync Pending',
        message: 'Changes saved locally. IPFS publish will retry automatically.',
        icon: AlertTriangle,
        color: 'text-yellow-400',
        bgColor: 'bg-yellow-500/10',
        borderColor: 'border-yellow-500/30'
      };
    case 'LOCAL_ONLY':
      return {
        title: 'Offline Mode',
        message: 'Changes saved locally only. Some features unavailable.',
        icon: CloudOff,
        color: 'text-orange-400',
        bgColor: 'bg-orange-500/10',
        borderColor: 'border-orange-500/30'
      };
    case 'NAMETAG_ONLY':
      return {
        title: 'Nametag Loaded',
        message: 'Minimal sync completed',
        icon: CheckCircle2,
        color: 'text-blue-400',
        bgColor: 'bg-blue-500/10',
        borderColor: 'border-blue-500/30'
      };
    case 'ERROR':
      return getErrorNotificationConfig(result.errorCode, result.errorMessage);
    default:
      return {
        title: 'Unknown Status',
        message: result.errorMessage || 'Sync completed with unknown status',
        icon: AlertTriangle,
        color: 'text-gray-400',
        bgColor: 'bg-gray-500/10',
        borderColor: 'border-gray-500/30'
      };
  }
}

function getErrorNotificationConfig(errorCode?: SyncErrorCode, errorMessage?: string): NotificationConfig {
  switch (errorCode) {
    case 'IPFS_UNAVAILABLE':
    case 'IPNS_RESOLUTION_FAILED':
      return {
        title: 'IPFS Unavailable',
        message: 'Unable to connect to IPFS. Working in offline mode.',
        icon: CloudOff,
        color: 'text-orange-400',
        bgColor: 'bg-orange-500/10',
        borderColor: 'border-orange-500/30'
      };
    case 'IPNS_PUBLISH_FAILED':
      return {
        title: 'Sync Pending',
        message: 'Tokens saved locally. IPFS publish will retry.',
        icon: AlertTriangle,
        color: 'text-yellow-400',
        bgColor: 'bg-yellow-500/10',
        borderColor: 'border-yellow-500/30'
      };
    case 'INTEGRITY_FAILURE':
      return {
        title: 'Critical Error',
        message: 'Data integrity issue detected. Please contact support.',
        icon: XCircle,
        color: 'text-red-400',
        bgColor: 'bg-red-500/10',
        borderColor: 'border-red-500/30'
      };
    case 'AGGREGATOR_UNREACHABLE':
      return {
        title: 'Network Error',
        message: 'Unable to reach Unicity aggregator. Will retry.',
        icon: WifiOff,
        color: 'text-orange-400',
        bgColor: 'bg-orange-500/10',
        borderColor: 'border-orange-500/30'
      };
    default:
      return {
        title: 'Sync Error',
        message: errorMessage || 'An error occurred during sync',
        icon: XCircle,
        color: 'text-red-400',
        bgColor: 'bg-red-500/10',
        borderColor: 'border-red-500/30'
      };
  }
}

export function SyncProgressIndicator({
  lastSyncResult,
  isSyncing,
  currentStep = 0,
  autoDismissMs = 5000,
  onDismiss,
  inline = false
}: SyncProgressIndicatorProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [displayedResult, setDisplayedResult] = useState<SyncResult | null>(null);

  // Show notification when sync completes or result changes
  useEffect(() => {
    if (lastSyncResult && !isSyncing) {
      setDisplayedResult(lastSyncResult);
      setIsVisible(true);

      // Auto-dismiss success notifications
      if (autoDismissMs > 0 && lastSyncResult.status === 'SUCCESS') {
        const timer = setTimeout(() => {
          setIsVisible(false);
        }, autoDismissMs);
        return () => clearTimeout(timer);
      }
    }
  }, [lastSyncResult, isSyncing, autoDismissMs]);

  // Show syncing state
  useEffect(() => {
    if (isSyncing) {
      setIsVisible(true);
    }
  }, [isSyncing]);

  const handleDismiss = useCallback(() => {
    setIsVisible(false);
    onDismiss?.();
  }, [onDismiss]);

  // Inline mode - minimal indicator
  if (inline) {
    if (isSyncing) {
      const stepInfo = SYNC_STEPS.find(s => s.step === currentStep) || SYNC_STEPS[0];
      return (
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <Loader2 className="w-3 h-3 animate-spin text-blue-400" />
          <span>{stepInfo.label}...</span>
        </div>
      );
    }

    if (displayedResult && isVisible) {
      const config = getNotificationConfig(displayedResult);
      const Icon = config.icon;
      return (
        <div className={`flex items-center gap-2 text-xs ${config.color}`}>
          <Icon className="w-3 h-3" />
          <span>{config.title}</span>
        </div>
      );
    }

    return null;
  }

  // Full notification mode
  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, y: -20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -20, scale: 0.95 }}
          className="fixed top-20 right-4 z-50 max-w-sm"
        >
          {isSyncing ? (
            // Syncing progress card
            <div className="bg-gray-800 border border-blue-500/30 rounded-lg p-4 shadow-lg">
              <div className="flex items-center gap-3 mb-3">
                <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
                <div>
                  <div className="font-medium text-gray-200">Syncing...</div>
                  <div className="text-xs text-gray-400">
                    Step {currentStep}/10
                  </div>
                </div>
              </div>

              {/* Progress bar */}
              <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-blue-500"
                  initial={{ width: 0 }}
                  animate={{ width: `${(currentStep / 10) * 100}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>

              {/* Current step label */}
              {currentStep > 0 && currentStep <= 10 && (
                <div className="mt-2 text-xs text-gray-400">
                  {SYNC_STEPS[currentStep - 1]?.label}...
                </div>
              )}
            </div>
          ) : displayedResult ? (
            // Result notification card
            (() => {
              const config = getNotificationConfig(displayedResult);
              const Icon = config.icon;
              return (
                <div className={`${config.bgColor} border ${config.borderColor} rounded-lg p-4 shadow-lg`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <Icon className={`w-5 h-5 ${config.color} mt-0.5`} />
                      <div>
                        <div className={`font-medium ${config.color}`}>{config.title}</div>
                        <div className="text-xs text-gray-400 mt-0.5">{config.message}</div>

                        {/* Stats for successful sync */}
                        {displayedResult.status === 'SUCCESS' && displayedResult.inventoryStats && (
                          <div className="mt-2 flex gap-3 text-xs text-gray-500">
                            <span>{displayedResult.inventoryStats.activeTokens} active</span>
                            <span>{displayedResult.inventoryStats.sentTokens} sent</span>
                            <span>{displayedResult.inventoryStats.outboxTokens} pending</span>
                          </div>
                        )}

                        {/* Duration */}
                        <div className="mt-1 text-xs text-gray-500">
                          Completed in {(displayedResult.syncDurationMs / 1000).toFixed(1)}s
                        </div>
                      </div>
                    </div>

                    {/* Dismiss button */}
                    <button
                      onClick={handleDismiss}
                      className="text-gray-500 hover:text-gray-300 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })()
          ) : null}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default SyncProgressIndicator;
