/**
 * IPFS Cache Layer
 *
 * Implements intelligent caching for IPNS records and content
 * with TTL management to reduce network calls.
 *
 * Cache structure:
 * - IPNS records: 60-second TTL (short-lived, changes during sync)
 * - Content (by CID): Infinite TTL (immutable by definition)
 * - Failure tracking: 30-second TTL (exponential backoff)
 */

import type { TxfStorageData } from "./types/TxfTypes";

// Re-export TxfStorageData for convenience
export type { TxfStorageData };

export interface IpnsGatewayResult {
  cid: string;
  sequence: bigint;
  gateway?: string;
  recordData?: Uint8Array;
  _cachedContent?: TxfStorageData;
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  source: "http" | "dht" | "local";
  sequenceNumber?: bigint;
}

export class IpfsCache {
  private recordCache = new Map<string, CacheEntry<IpnsGatewayResult>>();
  private contentCache = new Map<string, CacheEntry<TxfStorageData>>();
  private failureCache = new Set<string>();

  /** Tracks when IPNS cache was marked as "known-fresh" (post-publish or WebSocket update) */
  private ipnsRecordFreshTimestamp = new Map<string, number>();

  private readonly IPNS_RECORD_TTL_MS = 60000; // 1 minute
  private readonly FAILURE_CACHE_TTL_MS = 30000; // 30 seconds
  private readonly IPNS_KNOWN_FRESH_MAX_AGE_MS = 30000; // 30 seconds - max age for "known-fresh" status

  /**
   * Get cached IPNS record if fresh
   */
  getIpnsRecord(ipnsName: string): IpnsGatewayResult | null {
    const cached = this.recordCache.get(ipnsName);
    if (!cached) return null;

    const isExpired = Date.now() - cached.timestamp > this.IPNS_RECORD_TTL_MS;
    if (isExpired) {
      this.recordCache.delete(ipnsName);
      return null;
    }

    return cached.data;
  }

  /**
   * Store resolved IPNS record with TTL
   */
  setIpnsRecord(
    ipnsName: string,
    result: IpnsGatewayResult,
    ttlMs: number = this.IPNS_RECORD_TTL_MS
  ): void {
    this.recordCache.set(ipnsName, {
      data: result,
      timestamp: Date.now(),
      source: result.gateway ? "http" : "dht",
      sequenceNumber: result.sequence,
    });

    // Clear failure cache on success
    this.failureCache.delete(ipnsName);

    // Auto-expire cached record
    setTimeout(() => {
      const entry = this.recordCache.get(ipnsName);
      if (entry && entry.timestamp === (this.recordCache.get(ipnsName)?.timestamp || 0)) {
        this.recordCache.delete(ipnsName);
      }
    }, ttlMs);
  }

  /**
   * Get immutable content from cache (always valid)
   */
  getContent(cid: string): TxfStorageData | null {
    return this.contentCache.get(cid)?.data || null;
  }

  /**
   * Store immutable content (no expiration)
   */
  setContent(cid: string, content: TxfStorageData): void {
    this.contentCache.set(cid, {
      data: content,
      timestamp: Date.now(),
      source: "http",
    });
  }

  /**
   * Track failed resolution attempts for backoff
   */
  recordFailure(ipnsName: string): void {
    this.failureCache.add(ipnsName);

    // Auto-clear after TTL
    setTimeout(() => {
      this.failureCache.delete(ipnsName);
    }, this.FAILURE_CACHE_TTL_MS);
  }

  /**
   * Check if we recently failed to resolve (for backoff)
   */
  hasRecentFailure(ipnsName: string): boolean {
    return this.failureCache.has(ipnsName);
  }

  /**
   * Mark IPNS cache as "known-fresh" - called after local publish or WebSocket update.
   * This allows FAST mode to skip network resolution when we know our cache is current.
   */
  markIpnsCacheFresh(ipnsName: string): void {
    this.ipnsRecordFreshTimestamp.set(ipnsName, Date.now());
    console.log(`[IpfsCache] IPNS cache marked fresh for ${ipnsName.slice(0, 20)}...`);
  }

  /**
   * Check if IPNS cache is "known-fresh" (within configured max age).
   * Used by FAST mode to skip network resolution.
   * @param ipnsName The IPNS name to check
   * @param maxAgeMs Optional custom max age (defaults to 30s)
   */
  isIpnsCacheKnownFresh(ipnsName: string, maxAgeMs?: number): boolean {
    const freshTimestamp = this.ipnsRecordFreshTimestamp.get(ipnsName);
    if (!freshTimestamp) return false;

    const maxAge = maxAgeMs ?? this.IPNS_KNOWN_FRESH_MAX_AGE_MS;
    const age = Date.now() - freshTimestamp;
    const isFresh = age < maxAge;

    if (isFresh) {
      console.log(`[IpfsCache] IPNS cache is known-fresh for ${ipnsName.slice(0, 20)}... (age: ${age}ms)`);
    }
    return isFresh;
  }

  /**
   * Get cached IPNS record ignoring TTL (for FAST mode with known-fresh cache).
   * Caller MUST verify freshness via isIpnsCacheKnownFresh() before trusting this data.
   */
  getIpnsRecordIgnoreTTL(ipnsName: string): IpnsGatewayResult | null {
    const cached = this.recordCache.get(ipnsName);
    if (!cached) return null;
    // Return cached record regardless of TTL - caller must verify freshness
    return cached.data;
  }

  /**
   * Get cache statistics for monitoring
   */
  getStats(): {
    recordCacheSize: number;
    contentCacheSize: number;
    failureCacheSize: number;
  } {
    return {
      recordCacheSize: this.recordCache.size,
      contentCacheSize: this.contentCache.size,
      failureCacheSize: this.failureCache.size,
    };
  }

  /**
   * Clear all caches (on logout, account switch)
   */
  clear(): void {
    this.recordCache.clear();
    this.contentCache.clear();
    this.failureCache.clear();
    this.ipnsRecordFreshTimestamp.clear();
  }

  /**
   * Clear only IPNS records (for forced re-sync)
   */
  clearIpnsRecords(): void {
    this.recordCache.clear();
    this.failureCache.clear();
    this.ipnsRecordFreshTimestamp.clear();
  }

  /**
   * Clear only content cache
   */
  clearContentCache(): void {
    this.contentCache.clear();
  }
}

// Singleton instance
let cacheInstance: IpfsCache | null = null;

/**
 * Get or create the singleton cache instance
 */
export function getIpfsCache(): IpfsCache {
  if (!cacheInstance) {
    cacheInstance = new IpfsCache();
  }
  return cacheInstance;
}
