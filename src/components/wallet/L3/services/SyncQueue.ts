/**
 * SyncQueue (L3 Wrapper)
 *
 * Re-exports SDK SyncQueue with L3-specific StorageResult type.
 */

import {
  SyncQueue as SdkSyncQueue,
  SyncPriority,
  type SyncOptions,
  type QueueStatus,
  type SyncQueueConfig,
} from "../../sdk/browser/ipfs";
import type { StorageResult } from "./IpfsStorageService";

// Re-export types for backwards compatibility
export { SyncPriority };
export type { SyncOptions, QueueStatus };

/**
 * L3-typed SyncQueue using StorageResult
 */
export class SyncQueue extends SdkSyncQueue<StorageResult> {
  constructor(executor: (options?: { forceIpnsPublish?: boolean; isRetryAttempt?: boolean }) => Promise<StorageResult>) {
    const config: SyncQueueConfig<StorageResult> = {
      executor,
      createErrorResult: (error: string): StorageResult => ({
        success: false,
        timestamp: Date.now(),
        error,
      }),
    };
    super(config);
  }
}
