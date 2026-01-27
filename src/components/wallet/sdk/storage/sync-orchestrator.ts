/**
 * Sync Orchestrator (Platform-Independent)
 *
 * Manages sync decisions between local and remote token storage.
 * Determines when and how to sync based on version comparison,
 * token differences, and conflict resolution strategies.
 */

import type {
  TxfStorageDataBase,
  TxfToken,
  TombstoneEntry,
  MergeResult,
  NametagDataBase,
} from '../types/txf';

import {
  isTokenKey,
  tokenIdFromKey,
  keyFromTokenId,
  getCurrentStateHash,
} from '../types/txf';

import {
  compareTokenVersions,
  type TokenComparisonResult,
} from './token-comparison';

import {
  buildTombstoneKeySet,
  mergeTombstones,
  findNewTombstones,
} from './tombstone-utils';

import {
  ConflictResolutionService,
} from './conflict-resolution';

// ==========================================
// Types
// ==========================================

/**
 * Sync action to take
 */
export type SyncAction = 'push' | 'pull' | 'merge' | 'none';

/**
 * Sync decision result
 */
export interface SyncDecision {
  /** Action to take */
  action: SyncAction;
  /** Whether sync is needed */
  needsSync: boolean;
  /** Human-readable reason for the decision */
  reason: string;
  /** Details about the decision */
  details?: {
    localVersion?: number;
    remoteVersion?: number;
    localTokenCount?: number;
    remoteTokenCount?: number;
    localHasNewTokens?: boolean;
    remoteHasNewTokens?: boolean;
    hasConflicts?: boolean;
  };
}

/**
 * Result of checking local vs remote differences
 */
export interface DiffResult {
  /** Whether local differs from remote */
  hasDifferences: boolean;
  /** Token IDs only in local */
  localOnlyTokens: string[];
  /** Token IDs only in remote */
  remoteOnlyTokens: string[];
  /** Token IDs in both with local being better */
  localBetterTokens: string[];
  /** Token IDs in both with remote being better */
  remoteBetterTokens: string[];
  /** Token IDs that are equal */
  equalTokens: string[];
  /** Nametag difference */
  nametagDiff?: {
    localOnly?: boolean;
    remoteOnly?: boolean;
    different?: boolean;
  };
}

/**
 * Options for sync orchestrator
 */
export interface SyncOrchestratorOptions<
  TStorageData extends TxfStorageDataBase = TxfStorageDataBase,
  TNametag extends NametagDataBase = NametagDataBase
> {
  /** Conflict resolution service instance */
  conflictResolver?: ConflictResolutionService<TStorageData, TNametag>;
  /** Custom token comparator (defaults to compareTokenVersions) */
  tokenComparator?: (local: TxfToken, remote: TxfToken) => TokenComparisonResult;
}

// ==========================================
// SyncOrchestrator Class
// ==========================================

/**
 * Orchestrates sync decisions between local and remote storage
 */
export class SyncOrchestrator<
  TStorageData extends TxfStorageDataBase = TxfStorageDataBase,
  TNametag extends NametagDataBase = NametagDataBase
> {
  private conflictResolver: ConflictResolutionService<TStorageData, TNametag>;
  private tokenComparator: (local: TxfToken, remote: TxfToken) => TokenComparisonResult;

  constructor(options: SyncOrchestratorOptions<TStorageData, TNametag> = {}) {
    this.conflictResolver = options.conflictResolver ||
      new ConflictResolutionService<TStorageData, TNametag>();
    this.tokenComparator = options.tokenComparator || compareTokenVersions;
  }

  // ==========================================
  // Public API
  // ==========================================

  /**
   * Decide what sync action to take based on local and remote data
   */
  decideSyncAction(
    localData: TStorageData,
    remoteData: TStorageData
  ): SyncDecision {
    const localVersion = localData._meta.version;
    const remoteVersion = remoteData._meta.version;

    const localTokens = this.extractTokenMap(localData);
    const remoteTokens = this.extractTokenMap(remoteData);

    const details = {
      localVersion,
      remoteVersion,
      localTokenCount: localTokens.size,
      remoteTokenCount: remoteTokens.size,
    };

    // Check for new tokens in each direction
    const localOnlyIds = [...localTokens.keys()].filter(id => !remoteTokens.has(id));
    const remoteOnlyIds = [...remoteTokens.keys()].filter(id => !localTokens.has(id));

    const localHasNewTokens = localOnlyIds.length > 0;
    const remoteHasNewTokens = remoteOnlyIds.length > 0;

    // Check for conflicts in shared tokens
    let hasConflicts = false;
    for (const tokenId of localTokens.keys()) {
      if (remoteTokens.has(tokenId)) {
        const comparison = this.tokenComparator(
          localTokens.get(tokenId)!,
          remoteTokens.get(tokenId)!
        );
        if (comparison.winner !== 'equal') {
          hasConflicts = true;
          break;
        }
      }
    }

    const extendedDetails = {
      ...details,
      localHasNewTokens,
      remoteHasNewTokens,
      hasConflicts,
    };

    // Decision logic
    if (localVersion === remoteVersion && !hasConflicts && !localHasNewTokens && !remoteHasNewTokens) {
      // Versions match and no differences
      return {
        action: 'none',
        needsSync: false,
        reason: 'Local and remote are in sync',
        details: extendedDetails,
      };
    }

    if (remoteVersion > localVersion && !localHasNewTokens && !hasConflicts) {
      // Remote is strictly newer and local has nothing new
      return {
        action: 'pull',
        needsSync: true,
        reason: `Remote version (${remoteVersion}) is newer than local (${localVersion})`,
        details: extendedDetails,
      };
    }

    if (localVersion > remoteVersion && !remoteHasNewTokens && !hasConflicts) {
      // Local is strictly newer and remote has nothing new
      return {
        action: 'push',
        needsSync: true,
        reason: `Local version (${localVersion}) is newer than remote (${remoteVersion})`,
        details: extendedDetails,
      };
    }

    // Merge needed: both have changes or there are conflicts
    return {
      action: 'merge',
      needsSync: true,
      reason: 'Both local and remote have changes - merge required',
      details: extendedDetails,
    };
  }

  /**
   * Check if local differs from remote in any way that requires sync
   * Returns true if we need to sync local changes to remote
   */
  localDiffersFromRemote(
    localData: TStorageData,
    remoteData: TStorageData
  ): boolean {
    const diff = this.computeDiff(localData, remoteData);
    return diff.hasDifferences && (
      diff.localOnlyTokens.length > 0 ||
      diff.localBetterTokens.length > 0 ||
      diff.nametagDiff?.localOnly === true ||
      diff.nametagDiff?.different === true
    );
  }

  /**
   * Check if remote has changes that local should import
   */
  remoteDiffersFromLocal(
    localData: TStorageData,
    remoteData: TStorageData
  ): boolean {
    const diff = this.computeDiff(localData, remoteData);
    return diff.hasDifferences && (
      diff.remoteOnlyTokens.length > 0 ||
      diff.remoteBetterTokens.length > 0 ||
      diff.nametagDiff?.remoteOnly === true
    );
  }

  /**
   * Compute detailed diff between local and remote
   */
  computeDiff(
    localData: TStorageData,
    remoteData: TStorageData
  ): DiffResult {
    const localTokens = this.extractTokenMap(localData);
    const remoteTokens = this.extractTokenMap(remoteData);

    const localOnlyTokens: string[] = [];
    const remoteOnlyTokens: string[] = [];
    const localBetterTokens: string[] = [];
    const remoteBetterTokens: string[] = [];
    const equalTokens: string[] = [];

    // Find local-only tokens
    for (const tokenId of localTokens.keys()) {
      if (!remoteTokens.has(tokenId)) {
        localOnlyTokens.push(tokenId);
      }
    }

    // Find remote-only tokens
    for (const tokenId of remoteTokens.keys()) {
      if (!localTokens.has(tokenId)) {
        remoteOnlyTokens.push(tokenId);
      }
    }

    // Compare shared tokens
    for (const tokenId of localTokens.keys()) {
      if (remoteTokens.has(tokenId)) {
        const comparison = this.tokenComparator(
          localTokens.get(tokenId)!,
          remoteTokens.get(tokenId)!
        );
        switch (comparison.winner) {
          case 'local':
            localBetterTokens.push(tokenId);
            break;
          case 'remote':
            remoteBetterTokens.push(tokenId);
            break;
          case 'equal':
            equalTokens.push(tokenId);
            break;
        }
      }
    }

    // Check nametag differences
    const localNametag = localData._nametag as TNametag | undefined;
    const remoteNametag = remoteData._nametag as TNametag | undefined;
    let nametagDiff: DiffResult['nametagDiff'];

    if (localNametag && !remoteNametag) {
      nametagDiff = { localOnly: true };
    } else if (!localNametag && remoteNametag) {
      nametagDiff = { remoteOnly: true };
    } else if (localNametag && remoteNametag && localNametag.name !== remoteNametag.name) {
      nametagDiff = { different: true };
    }

    const hasDifferences =
      localOnlyTokens.length > 0 ||
      remoteOnlyTokens.length > 0 ||
      localBetterTokens.length > 0 ||
      remoteBetterTokens.length > 0 ||
      nametagDiff !== undefined;

    return {
      hasDifferences,
      localOnlyTokens,
      remoteOnlyTokens,
      localBetterTokens,
      remoteBetterTokens,
      equalTokens,
      nametagDiff,
    };
  }

  /**
   * Build merged data from local and remote
   * Delegates to ConflictResolutionService for actual merge
   */
  buildMergedData(
    localData: TStorageData,
    remoteData: TStorageData
  ): MergeResult<TStorageData> {
    return this.conflictResolver.resolveConflict(localData, remoteData);
  }

  /**
   * Merge and apply tombstones from remote to local
   * Returns the merged tombstone list
   */
  mergeTombstonesFromRemote(
    localTombstones: TombstoneEntry[],
    remoteTombstones: TombstoneEntry[]
  ): TombstoneEntry[] {
    return mergeTombstones(localTombstones, remoteTombstones);
  }

  /**
   * Find tokens that would be excluded by tombstones
   */
  findTombstonedTokens(
    tokens: Map<string, TxfToken>,
    tombstones: TombstoneEntry[]
  ): string[] {
    const tombstoneKeySet = buildTombstoneKeySet(tombstones);
    const tombstonedIds: string[] = [];

    for (const [tokenId, txf] of tokens) {
      const stateHash = getCurrentStateHash(txf);
      const key = `${tokenId}:${stateHash}`;
      if (tombstoneKeySet.has(key)) {
        tombstonedIds.push(tokenId);
      }
    }

    return tombstonedIds;
  }

  /**
   * Get new tombstones from remote that local doesn't have
   */
  getNewTombstonesFromRemote(
    localTombstones: TombstoneEntry[],
    remoteTombstones: TombstoneEntry[]
  ): TombstoneEntry[] {
    return findNewTombstones(remoteTombstones, localTombstones);
  }

  // ==========================================
  // Helper Methods
  // ==========================================

  /**
   * Extract tokens from storage data into a Map
   */
  private extractTokenMap(data: TxfStorageDataBase): Map<string, TxfToken> {
    const tokens = new Map<string, TxfToken>();

    for (const key of Object.keys(data)) {
      if (isTokenKey(key)) {
        const tokenId = tokenIdFromKey(key);
        const token = data[key] as TxfToken;
        if (token && token.genesis) {
          tokens.set(tokenId, token);
        }
      }
    }

    return tokens;
  }

  /**
   * Convert token Map back to storage data format
   */
  convertTokenMapToStorageEntries(
    tokens: Map<string, TxfToken>
  ): Record<string, TxfToken> {
    const entries: Record<string, TxfToken> = {};
    for (const [tokenId, token] of tokens) {
      entries[keyFromTokenId(tokenId)] = token;
    }
    return entries;
  }
}

// ==========================================
// Factory Function
// ==========================================

/**
 * Create a SyncOrchestrator instance
 */
export function createSyncOrchestrator<
  TStorageData extends TxfStorageDataBase = TxfStorageDataBase,
  TNametag extends NametagDataBase = NametagDataBase
>(
  options: SyncOrchestratorOptions<TStorageData, TNametag> = {}
): SyncOrchestrator<TStorageData, TNametag> {
  return new SyncOrchestrator<TStorageData, TNametag>(options);
}
