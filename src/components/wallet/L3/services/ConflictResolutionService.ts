/**
 * Conflict Resolution Service
 * Handles merging of local and remote IPFS storage data when versions conflict
 *
 * This module extends the SDK's ConflictResolutionService with app-specific types.
 */

import {
  ConflictResolutionService as BaseConflictResolutionService,
} from "../../sdk";

import type { TxfStorageData, MergeResult } from "./types/TxfTypes";
import type { NametagData } from "../../../../repositories/WalletRepository";

// Re-export SDK utilities for convenience
export {
  isTokenKey,
  isArchivedKey,
  isForkedKey,
  tokenIdFromKey,
  tokenIdFromArchivedKey,
  parseForkedKey,
  keyFromTokenId,
  archivedKeyFromTokenId,
  forkedKeyFromTokenIdAndState,
} from "./types/TxfTypes";

// ==========================================
// App-Specific ConflictResolutionService
// ==========================================

/**
 * App-specific ConflictResolutionService that uses app types
 */
export class ConflictResolutionService extends BaseConflictResolutionService<
  TxfStorageData,
  NametagData
> {
  // The base class handles all logic, this class just provides type safety
  // for app-specific TxfStorageData and NametagData types

  /**
   * Resolve conflicts between local and remote storage data
   * Returns merged data and list of conflicts that were resolved
   */
  override resolveConflict(
    local: TxfStorageData,
    remote: TxfStorageData
  ): MergeResult {
    // Call parent method with proper type casting
    const result = super.resolveConflict(local, remote);
    return {
      ...result,
      merged: result.merged as TxfStorageData,
    };
  }
}

// ==========================================
// Singleton Instance
// ==========================================

let conflictServiceInstance: ConflictResolutionService | null = null;

/**
 * Get singleton instance of ConflictResolutionService
 */
export function getConflictResolutionService(): ConflictResolutionService {
  if (!conflictServiceInstance) {
    conflictServiceInstance = new ConflictResolutionService();
  }
  return conflictServiceInstance;
}
