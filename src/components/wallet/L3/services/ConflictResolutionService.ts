/**
 * Conflict Resolution Service
 * Handles merging of local and remote IPFS storage data when versions conflict
 */

import type {
  TxfStorageData,
  TxfMeta,
  TxfToken,
  TokenConflict,
  MergeResult,
  TxfTransaction,
  TombstoneEntry,
} from "./types/TxfTypes";
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
} from "./types/TxfTypes";
import { getCurrentStateHash } from "./TxfSerializer";
import type { NametagData } from "../../../../repositories/WalletRepository";

// ==========================================
// ConflictResolutionService
// ==========================================

export class ConflictResolutionService {
  // ==========================================
  // Public API
  // ==========================================

  /**
   * Resolve conflicts between local and remote storage data
   * Returns merged data and list of conflicts that were resolved
   */
  resolveConflict(
    local: TxfStorageData,
    remote: TxfStorageData
  ): MergeResult {
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

        if (resolution !== (baseIsLocal ? "local" : "remote")) {
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
    const merged: TxfStorageData = {
      _meta: baseMeta,
    };

    // Add nametag (prefer local if available)
    const localNametag = local._nametag;
    const remoteNametag = remote._nametag;
    if (localNametag || remoteNametag) {
      merged._nametag = this.mergeNametags(localNametag, remoteNametag);
    }

    // Merge tombstones (union of local and remote by tokenId+stateHash)
    // This ensures deleted token states stay deleted across devices
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
      merged._tombstones = mergedTombstones;
      console.log(`📦 Merged ${mergedTombstones.length} tombstone(s) (${localTombstones.length} local + ${remoteTombstones.length} remote)`);
    }

    // Build tombstone lookup set (tokenId:stateHash)
    const tombstoneKeySet = new Set(tombstoneMap.keys());

    // Add all tokens (excluding tombstoned states)
    for (const [tokenId, token] of mergedTokens) {
      // Get the token's current state hash
      const stateHash = getCurrentStateHash(token);
      const tombstoneKey = `${tokenId}:${stateHash}`;

      // Don't include tokens whose current state is tombstoned
      if (tombstoneKeySet.has(tombstoneKey)) {
        console.log(`📦 Excluding tombstoned token ${tokenId.slice(0, 8)}... (state ${stateHash.slice(0, 12)}...) from merge`);
        removedTokens.push(tokenId);
        continue;
      }
      merged[keyFromTokenId(tokenId)] = token;
    }

    // Merge archived tokens (union of local and remote, prefer more transactions)
    const localArchived = this.extractArchivedTokens(local);
    const remoteArchived = this.extractArchivedTokens(remote);
    const mergedArchived = this.mergeArchivedTokenMaps(localArchived, remoteArchived);
    for (const [tokenId, token] of mergedArchived) {
      merged[archivedKeyFromTokenId(tokenId)] = token;
    }
    if (mergedArchived.size > 0) {
      console.log(`📦 Merged ${mergedArchived.size} archived token(s)`);
    }

    // Merge forked tokens (union of local and remote)
    const localForked = this.extractForkedTokens(local);
    const remoteForked = this.extractForkedTokens(remote);
    const mergedForked = this.mergeForkedTokenMaps(localForked, remoteForked);
    for (const [key, token] of mergedForked) {
      // Parse key to get tokenId and stateHash
      const parts = key.split("_");
      if (parts.length >= 2) {
        const tokenId = parts[0];
        const stateHash = parts.slice(1).join("_");  // stateHash may contain underscores
        merged[forkedKeyFromTokenIdAndState(tokenId, stateHash)] = token;
      }
    }
    if (mergedForked.size > 0) {
      console.log(`📦 Merged ${mergedForked.size} forked token(s)`);
    }

    console.log(
      `📦 Merge complete: ${mergedTokens.size - removedTokens.length} active, ${mergedArchived.size} archived, ${mergedForked.size} forked, ${conflicts.length} conflicts resolved, ${newTokens.length} new, ${removedTokens.length} tombstoned`
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
   * Priority: 1) Longer chain, 2) More proofs, 3) Newer timestamp
   */
  private resolveTokenConflict(
    localToken: TxfToken,
    remoteToken: TxfToken
  ): { winner: TxfToken; resolution: "local" | "remote"; reason: string } {
    // 1. Longer chain wins
    const localChainLength = localToken.transactions.length;
    const remoteChainLength = remoteToken.transactions.length;

    if (localChainLength !== remoteChainLength) {
      if (localChainLength > remoteChainLength) {
        return {
          winner: localToken,
          resolution: "local",
          reason: `Longer chain (${localChainLength} vs ${remoteChainLength})`,
        };
      } else {
        return {
          winner: remoteToken,
          resolution: "remote",
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
          resolution: "local",
          reason: `More proofs (${localProofCount} vs ${remoteProofCount})`,
        };
      } else {
        return {
          winner: remoteToken,
          resolution: "remote",
          reason: `More proofs (${remoteProofCount} vs ${localProofCount})`,
        };
      }
    }

    // 3. Deterministic tiebreaker: use genesis data hash for consistency
    const localGenesisHash = localToken._integrity?.genesisDataJSONHash || "";
    const remoteGenesisHash = remoteToken._integrity?.genesisDataJSONHash || "";

    if (localGenesisHash !== remoteGenesisHash) {
      // Use lexicographic comparison for determinism
      if (localGenesisHash > remoteGenesisHash) {
        return {
          winner: localToken,
          resolution: "local",
          reason: "Deterministic tiebreaker (hash comparison)",
        };
      } else {
        return {
          winner: remoteToken,
          resolution: "remote",
          reason: "Deterministic tiebreaker (hash comparison)",
        };
      }
    }

    // 4. Final fallback: prefer local
    return {
      winner: localToken,
      resolution: "local",
      reason: "Identical tokens, preferring local",
    };
  }

  /**
   * Count total inclusion proofs in a token
   */
  private countProofs(token: TxfToken): number {
    let count = 0;

    // Genesis always has a proof
    if (token.genesis?.inclusionProof) {
      count++;
    }

    // Count transaction proofs
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
  private extractTokens(data: TxfStorageData): Map<string, TxfToken> {
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
  private mergeNametags(
    local: NametagData | undefined,
    remote: NametagData | undefined
  ): NametagData {
    if (local && remote) {
      // Both exist - use local (user's current choice)
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
  hasConflict(local: TxfStorageData, remote: TxfStorageData): boolean {
    return local._meta.version !== remote._meta.version;
  }

  /**
   * Check if remote is strictly newer (no merge needed, just accept remote)
   */
  isRemoteNewer(local: TxfStorageData, remote: TxfStorageData): boolean {
    const localVersion = local._meta.version;
    const remoteVersion = remote._meta.version;

    // Remote is newer if version is higher
    // AND all local tokens are also in remote (no local-only changes)
    if (remoteVersion <= localVersion) {
      return false;
    }

    const localTokens = this.extractTokens(local);
    const remoteTokens = this.extractTokens(remote);

    for (const [tokenId] of localTokens) {
      if (!remoteTokens.has(tokenId)) {
        return false; // Local has token that remote doesn't
      }
    }

    return true;
  }

  /**
   * Check if local is strictly newer (just push local, no fetch needed)
   */
  isLocalNewer(local: TxfStorageData, remote: TxfStorageData): boolean {
    const localVersion = local._meta.version;
    const remoteVersion = remote._meta.version;

    // Local is newer if version is higher
    // AND all remote tokens are also in local
    if (localVersion <= remoteVersion) {
      return false;
    }

    const localTokens = this.extractTokens(local);
    const remoteTokens = this.extractTokens(remote);

    for (const [tokenId] of remoteTokens) {
      if (!localTokens.has(tokenId)) {
        return false; // Remote has token that local doesn't
      }
    }

    return true;
  }

  // ==========================================
  // Archived Token Methods
  // ==========================================

  /**
   * Extract archived tokens from storage data into a Map
   */
  private extractArchivedTokens(data: TxfStorageData): Map<string, TxfToken> {
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
   * Extract forked tokens from storage data into a Map
   * Map key format: tokenId_stateHash
   */
  private extractForkedTokens(data: TxfStorageData): Map<string, TxfToken> {
    const forked = new Map<string, TxfToken>();

    for (const key of Object.keys(data)) {
      if (isForkedKey(key)) {
        const parsed = parseForkedKey(key);
        if (parsed) {
          const token = data[key] as TxfToken;
          if (token && token.genesis) {
            // Use tokenId_stateHash as map key
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
   * Prefers token with more transactions (more complete history)
   */
  private mergeArchivedTokenMaps(
    local: Map<string, TxfToken>,
    remote: Map<string, TxfToken>
  ): Map<string, TxfToken> {
    const merged = new Map<string, TxfToken>(local);

    for (const [tokenId, remoteToken] of remote) {
      const localToken = merged.get(tokenId);

      if (!localToken) {
        // Only in remote - add it
        merged.set(tokenId, remoteToken);
      } else {
        // Both have it - prefer one with more transactions (more complete history)
        const localTxnCount = localToken.transactions?.length || 0;
        const remoteTxnCount = remoteToken.transactions?.length || 0;

        if (remoteTxnCount > localTxnCount) {
          merged.set(tokenId, remoteToken);
        }
        // else keep local (ties go to local)
      }
    }

    return merged;
  }

  /**
   * Merge forked token maps (union merge)
   * Each fork is unique by tokenId_stateHash
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
