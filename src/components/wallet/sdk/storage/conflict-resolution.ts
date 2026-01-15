/**
 * Conflict Resolution Service (Platform-Independent)
 * Handles merging of local and remote TXF storage data when versions conflict
 */

import type {
  TxfStorageDataBase,
  TxfMeta,
  TxfToken,
  TokenConflict,
  MergeResult,
  TxfTransaction,
  TombstoneEntry,
  NametagDataBase,
} from '../types/txf';

import {
  isTokenKey,
  isArchivedKey,
  isForkedKey,
  tokenIdFromKey,
  tokenIdFromArchivedKey,
  parseForkedKey,
  keyFromTokenId,
  archivedKeyFromTokenId,
  forkedKeyFromTokenIdAndState,
  getCurrentStateHash,
} from '../types/txf';

// ==========================================
// ConflictResolutionService
// ==========================================

export class ConflictResolutionService<
  TStorageData extends TxfStorageDataBase = TxfStorageDataBase,
  TNametag extends NametagDataBase = NametagDataBase
> {
  // ==========================================
  // Public API
  // ==========================================

  /**
   * Resolve conflicts between local and remote storage data
   * Returns merged data and list of conflicts that were resolved
   */
  resolveConflict(
    local: TStorageData,
    remote: TStorageData
  ): MergeResult<TStorageData> {
    const localVersion = local._meta.version;
    const remoteVersion = remote._meta.version;

    console.log(
      `📦 Resolving conflict: local v${localVersion} vs remote v${remoteVersion}`
    );

    // Determine base version to use
    let baseMeta: TxfMeta;
    let baseTokens: Map<string, TxfToken>;
    let otherTokens: Map<string, TxfToken>;
    let baseIsLocal: boolean;

    if (remoteVersion > localVersion) {
      // Remote is newer - use remote as base
      baseMeta = {
        ...remote._meta,
        version: remoteVersion + 1, // Increment for merged version
      };
      baseTokens = this.extractTokens(remote);
      otherTokens = this.extractTokens(local);
      baseIsLocal = false;
      console.log(`📦 Remote is newer, using remote as base`);
    } else if (localVersion > remoteVersion) {
      // Local is newer - use local as base
      baseMeta = {
        ...local._meta,
        version: localVersion + 1,
      };
      baseTokens = this.extractTokens(local);
      otherTokens = this.extractTokens(remote);
      baseIsLocal = true;
      console.log(`📦 Local is newer, using local as base`);
    } else {
      // Same version - use local as base (local wins on tie)
      baseMeta = {
        ...local._meta,
        version: localVersion + 1,
      };
      baseTokens = this.extractTokens(local);
      otherTokens = this.extractTokens(remote);
      baseIsLocal = true;
      console.log(`📦 Same version, using local as base (local wins on tie)`);
    }

    // Merge tokens
    const conflicts: TokenConflict[] = [];
    const newTokens: string[] = [];
    const removedTokens: string[] = [];

    // Add all tokens from base
    const mergedTokens = new Map<string, TxfToken>(baseTokens);

    // Process tokens from other source
    for (const [tokenId, otherToken] of otherTokens) {
      if (baseTokens.has(tokenId)) {
        // Token exists in both - resolve conflict
        const baseToken = baseTokens.get(tokenId)!;
        const { winner, resolution, reason } = this.resolveTokenConflict(
          baseIsLocal ? baseToken : otherToken,
          baseIsLocal ? otherToken : baseToken
        );

        mergedTokens.set(tokenId, winner);

        if (resolution !== (baseIsLocal ? 'local' : 'remote')) {
          // Winner was from the "other" source
          conflicts.push({
            tokenId,
            localVersion: baseIsLocal ? baseToken : otherToken,
            remoteVersion: baseIsLocal ? otherToken : baseToken,
            resolution,
            reason,
          });
        }
      } else {
        // Token only in other source - add it
        mergedTokens.set(tokenId, otherToken);
        newTokens.push(tokenId);
        console.log(`📦 Adding token ${tokenId.slice(0, 8)}... from other source`);
      }
    }

    // Build merged storage data
    const merged = {
      _meta: baseMeta,
    } as TStorageData;

    // Add nametag (prefer local if available)
    const localNametag = local._nametag as TNametag | undefined;
    const remoteNametag = remote._nametag as TNametag | undefined;
    if (localNametag || remoteNametag) {
      (merged as TxfStorageDataBase)._nametag = this.mergeNametags(localNametag, remoteNametag);
    }

    // Merge tombstones (union of local and remote by tokenId+stateHash)
    const localTombstones: TombstoneEntry[] = local._tombstones || [];
    const remoteTombstones: TombstoneEntry[] = remote._tombstones || [];

    // Use Map for deduplication by tokenId+stateHash key
    const tombstoneMap = new Map<string, TombstoneEntry>();
    for (const t of [...localTombstones, ...remoteTombstones]) {
      const key = `${t.tokenId}:${t.stateHash}`;
      if (!tombstoneMap.has(key)) {
        tombstoneMap.set(key, t);
      }
    }
    const mergedTombstones = [...tombstoneMap.values()];

    if (mergedTombstones.length > 0) {
      (merged as TxfStorageDataBase)._tombstones = mergedTombstones;
      console.log(`📦 Merged ${mergedTombstones.length} tombstone(s)`);
    }

    // Build tombstone lookup set (tokenId:stateHash)
    const tombstoneKeySet = new Set(tombstoneMap.keys());

    // Add all tokens (excluding tombstoned states)
    for (const [tokenId, token] of mergedTokens) {
      const stateHash = getCurrentStateHash(token);
      const tombstoneKey = `${tokenId}:${stateHash}`;

      if (tombstoneKeySet.has(tombstoneKey)) {
        console.log(`📦 Excluding tombstoned token ${tokenId.slice(0, 8)}...`);
        removedTokens.push(tokenId);
        continue;
      }
      (merged as TxfStorageDataBase)[keyFromTokenId(tokenId)] = token;
    }

    // Merge archived tokens
    const localArchived = this.extractArchivedTokens(local);
    const remoteArchived = this.extractArchivedTokens(remote);
    const mergedArchived = this.mergeArchivedTokenMaps(localArchived, remoteArchived);
    for (const [tokenId, token] of mergedArchived) {
      (merged as TxfStorageDataBase)[archivedKeyFromTokenId(tokenId)] = token;
    }

    // Merge forked tokens
    const localForked = this.extractForkedTokens(local);
    const remoteForked = this.extractForkedTokens(remote);
    const mergedForked = this.mergeForkedTokenMaps(localForked, remoteForked);
    for (const [key, token] of mergedForked) {
      const parts = key.split('_');
      if (parts.length >= 2) {
        const tokenId = parts[0];
        const stateHash = parts.slice(1).join('_');
        (merged as TxfStorageDataBase)[forkedKeyFromTokenIdAndState(tokenId, stateHash)] = token;
      }
    }

    console.log(
      `📦 Merge complete: ${mergedTokens.size - removedTokens.length} active, ${mergedArchived.size} archived, ${mergedForked.size} forked, ${conflicts.length} conflicts resolved`
    );

    return {
      merged,
      conflicts,
      newTokens,
      removedTokens,
    };
  }

  // ==========================================
  // Token Conflict Resolution
  // ==========================================

  /**
   * Resolve conflict between two versions of the same token
   * Priority: 1) Longer chain, 2) More proofs, 3) Deterministic hash comparison
   */
  private resolveTokenConflict(
    localToken: TxfToken,
    remoteToken: TxfToken
  ): { winner: TxfToken; resolution: 'local' | 'remote'; reason: string } {
    // 1. Longer chain wins
    const localChainLength = localToken.transactions.length;
    const remoteChainLength = remoteToken.transactions.length;

    if (localChainLength !== remoteChainLength) {
      if (localChainLength > remoteChainLength) {
        return {
          winner: localToken,
          resolution: 'local',
          reason: `Longer chain (${localChainLength} vs ${remoteChainLength})`,
        };
      } else {
        return {
          winner: remoteToken,
          resolution: 'remote',
          reason: `Longer chain (${remoteChainLength} vs ${localChainLength})`,
        };
      }
    }

    // 2. More proofs wins
    const localProofCount = this.countProofs(localToken);
    const remoteProofCount = this.countProofs(remoteToken);

    if (localProofCount !== remoteProofCount) {
      if (localProofCount > remoteProofCount) {
        return {
          winner: localToken,
          resolution: 'local',
          reason: `More proofs (${localProofCount} vs ${remoteProofCount})`,
        };
      } else {
        return {
          winner: remoteToken,
          resolution: 'remote',
          reason: `More proofs (${remoteProofCount} vs ${localProofCount})`,
        };
      }
    }

    // 3. Deterministic tiebreaker: use genesis data hash
    const localGenesisHash = localToken._integrity?.genesisDataJSONHash || '';
    const remoteGenesisHash = remoteToken._integrity?.genesisDataJSONHash || '';

    if (localGenesisHash !== remoteGenesisHash) {
      if (localGenesisHash > remoteGenesisHash) {
        return {
          winner: localToken,
          resolution: 'local',
          reason: 'Deterministic tiebreaker (hash comparison)',
        };
      } else {
        return {
          winner: remoteToken,
          resolution: 'remote',
          reason: 'Deterministic tiebreaker (hash comparison)',
        };
      }
    }

    // 4. Final fallback: prefer local
    return {
      winner: localToken,
      resolution: 'local',
      reason: 'Identical tokens, preferring local',
    };
  }

  /**
   * Count total inclusion proofs in a token
   */
  private countProofs(token: TxfToken): number {
    let count = 0;

    if (token.genesis?.inclusionProof) {
      count++;
    }

    if (token.transactions) {
      count += token.transactions.filter(
        (tx: TxfTransaction) => tx.inclusionProof !== null
      ).length;
    }

    return count;
  }

  // ==========================================
  // Helper Methods
  // ==========================================

  /**
   * Extract tokens from storage data into a Map
   */
  private extractTokens(data: TxfStorageDataBase): Map<string, TxfToken> {
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
   * Merge nametag data, preferring local if both exist
   */
  protected mergeNametags(
    local: TNametag | undefined,
    remote: TNametag | undefined
  ): TNametag {
    if (local && remote) {
      return local;
    }
    return (local || remote)!;
  }

  // ==========================================
  // Conflict Detection
  // ==========================================

  /**
   * Check if two storage data sets have conflicting versions
   */
  hasConflict(local: TxfStorageDataBase, remote: TxfStorageDataBase): boolean {
    return local._meta.version !== remote._meta.version;
  }

  /**
   * Check if remote is strictly newer
   */
  isRemoteNewer(local: TxfStorageDataBase, remote: TxfStorageDataBase): boolean {
    const localVersion = local._meta.version;
    const remoteVersion = remote._meta.version;

    if (remoteVersion <= localVersion) {
      return false;
    }

    const localTokens = this.extractTokens(local);
    const remoteTokens = this.extractTokens(remote);

    for (const [tokenId] of localTokens) {
      if (!remoteTokens.has(tokenId)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check if local is strictly newer
   */
  isLocalNewer(local: TxfStorageDataBase, remote: TxfStorageDataBase): boolean {
    const localVersion = local._meta.version;
    const remoteVersion = remote._meta.version;

    if (localVersion <= remoteVersion) {
      return false;
    }

    const localTokens = this.extractTokens(local);
    const remoteTokens = this.extractTokens(remote);

    for (const [tokenId] of remoteTokens) {
      if (!localTokens.has(tokenId)) {
        return false;
      }
    }

    return true;
  }

  // ==========================================
  // Archived Token Methods
  // ==========================================

  /**
   * Extract archived tokens from storage data
   */
  private extractArchivedTokens(data: TxfStorageDataBase): Map<string, TxfToken> {
    const archived = new Map<string, TxfToken>();

    for (const key of Object.keys(data)) {
      if (isArchivedKey(key)) {
        const tokenId = tokenIdFromArchivedKey(key);
        const token = data[key] as TxfToken;
        if (token && token.genesis) {
          archived.set(tokenId, token);
        }
      }
    }

    return archived;
  }

  /**
   * Extract forked tokens from storage data
   */
  private extractForkedTokens(data: TxfStorageDataBase): Map<string, TxfToken> {
    const forked = new Map<string, TxfToken>();

    for (const key of Object.keys(data)) {
      if (isForkedKey(key)) {
        const parsed = parseForkedKey(key);
        if (parsed) {
          const token = data[key] as TxfToken;
          if (token && token.genesis) {
            const mapKey = `${parsed.tokenId}_${parsed.stateHash}`;
            forked.set(mapKey, token);
          }
        }
      }
    }

    return forked;
  }

  /**
   * Merge archived token maps
   */
  private mergeArchivedTokenMaps(
    local: Map<string, TxfToken>,
    remote: Map<string, TxfToken>
  ): Map<string, TxfToken> {
    const merged = new Map<string, TxfToken>(local);

    for (const [tokenId, remoteToken] of remote) {
      const localToken = merged.get(tokenId);

      if (!localToken) {
        merged.set(tokenId, remoteToken);
      } else {
        const localTxnCount = localToken.transactions?.length || 0;
        const remoteTxnCount = remoteToken.transactions?.length || 0;

        if (remoteTxnCount > localTxnCount) {
          merged.set(tokenId, remoteToken);
        }
      }
    }

    return merged;
  }

  /**
   * Merge forked token maps (union merge)
   */
  private mergeForkedTokenMaps(
    local: Map<string, TxfToken>,
    remote: Map<string, TxfToken>
  ): Map<string, TxfToken> {
    const merged = new Map<string, TxfToken>(local);

    for (const [key, token] of remote) {
      if (!merged.has(key)) {
        merged.set(key, token);
      }
    }

    return merged;
  }
}

// ==========================================
// Factory Function
// ==========================================

/**
 * Create a ConflictResolutionService instance
 */
export function createConflictResolutionService<
  TStorageData extends TxfStorageDataBase = TxfStorageDataBase,
  TNametag extends NametagDataBase = NametagDataBase
>(): ConflictResolutionService<TStorageData, TNametag> {
  return new ConflictResolutionService<TStorageData, TNametag>();
}
