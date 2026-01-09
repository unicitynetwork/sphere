/**
 * IPFS HTTP Resolver
 *
 * Fast IPNS resolution and content fetching via HTTP API
 * to dedicated IPFS nodes, using parallel multi-node racing.
 *
 * Resolves IPNS names in 100-300ms (vs DHT 10-30+ seconds)
 *
 * Two resolution strategies:
 * 1. Gateway path (/ipns/{name}?format=dag-json) - Returns content directly (~30-100ms)
 * 2. Routing API (/api/v0/routing/get) - Returns IPNS record details (~200-300ms)
 *
 * Strategy: Race gateway path on all nodes, fallback to routing API if needed.
 */

import { getIpfsCache, type TxfStorageData } from "./IpfsCache";
import { getAllBackendGatewayUrls } from "../../../../config/ipfs.config";
import { unmarshalIPNSRecord } from "ipns";
import { CID } from "multiformats/cid";
import * as jsonCodec from "multiformats/codecs/json";
import { sha256 } from "multiformats/hashes/sha2";

export interface IpnsResolutionResult {
  success: boolean;
  cid?: string;
  content?: TxfStorageData | null;
  sequence?: bigint;
  source: "cache" | "http-gateway" | "http-routing" | "dht" | "none";
  error?: string;
  latencyMs: number;
}

/**
 * Fetch with timeout support
 */
async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  options: RequestInit = {}
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Try resolving IPNS via gateway path (fast path)
 * Returns both CID and content
 */
async function tryGatewayPath(
  ipnsName: string,
  gatewayUrl: string,
  timeoutMs: number = 5000
): Promise<{ content: TxfStorageData; cid?: string } | null> {
  try {
    const url = `${gatewayUrl}/ipns/${ipnsName}?format=dag-json`;

    const response = await fetchWithTimeout(url, timeoutMs, {
      headers: {
        Accept: "application/vnd.ipld.dag-json, application/json",
      },
    });

    if (!response.ok) {
      return null;
    }

    const content = (await response.json()) as TxfStorageData;
    return { content, cid: content._cid as string | undefined };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      console.debug(`Gateway path timeout for ${ipnsName} on ${gatewayUrl}`);
    }
    return null;
  }
}

/**
 * Try resolving IPNS via routing API (fallback path)
 * Returns IPNS record with CID and sequence number
 */
async function tryRoutingApi(
  ipnsName: string,
  gatewayUrl: string,
  timeoutMs: number = 5000
): Promise<{
  cid: string;
  sequence: bigint;
  recordData: Uint8Array;
} | null> {
  try {
    const url = `${gatewayUrl}/api/v0/routing/get?arg=/ipns/${ipnsName}`;

    const response = await fetchWithTimeout(url, timeoutMs, {
      method: "POST",
    });

    if (!response.ok) {
      return null;
    }

    const json = (await response.json()) as { Extra?: string };
    if (!json.Extra) {
      return null;
    }

    // Decode base64 IPNS record
    const recordData = Uint8Array.from(
      atob(json.Extra),
      (c) => c.charCodeAt(0)
    );

    // Parse IPNS record to extract CID and sequence
    const record = unmarshalIPNSRecord(recordData);
    const cidMatch = record.value.match(/^\/ipfs\/(.+)$/);

    if (!cidMatch) {
      return null;
    }

    return {
      cid: cidMatch[1],
      sequence: record.sequence,
      recordData,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      console.debug(`Routing API timeout for ${ipnsName} on ${gatewayUrl}`);
    }
    return null;
  }
}

/**
 * Compute CID from content for integrity verification.
 * Uses the same approach as @helia/json:
 * - Encode with multiformats/codecs/json (JSON.stringify as bytes)
 * - Hash with SHA-256
 * - Create CIDv1 with json codec (0x0200)
 */
async function computeCidFromContent(content: TxfStorageData): Promise<string> {
  // Encode content as JSON (same as @helia/json uses)
  const encoded = jsonCodec.encode(content);
  // Hash with SHA-256 (same as @helia/json default)
  const hash = await sha256.digest(encoded);
  // Create CIDv1 with json codec (0x0200) - same as @helia/json
  const computedCid = CID.createV1(jsonCodec.code, hash);
  return computedCid.toString();
}

/**
 * Fetch content by CID
 * Requests raw content without format conversion to preserve original bytes
 */
async function fetchContentByCid(
  cid: string,
  gatewayUrl: string,
  timeoutMs: number = 3000
): Promise<TxfStorageData | null> {
  try {
    // Request without format parameter to get raw content as stored
    const url = `${gatewayUrl}/ipfs/${cid}`;

    const response = await fetchWithTimeout(url, timeoutMs, {
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as TxfStorageData;
  } catch {
    return null;
  }
}

/**
 * Main HTTP resolver using parallel multi-node racing
 */
export class IpfsHttpResolver {
  private cache = getIpfsCache();

  /**
   * Resolve IPNS name across all configured nodes in parallel
   *
   * Execution flow:
   * 1. Check cache for fresh record
   * 2. Query all nodes with gateway path (fast)
   * 3. If all fail, query all nodes with routing API (reliable)
   * 4. Return first success or fail after timeout
   */
  async resolveIpnsName(ipnsName: string): Promise<IpnsResolutionResult> {
    // Step 1: Check cache first
    const cached = this.cache.getIpnsRecord(ipnsName);
    if (cached) {
      return {
        success: true,
        cid: cached.cid,
        content: cached._cachedContent || null,
        sequence: cached.sequence,
        source: "cache",
        latencyMs: 0,
      };
    }

    // Step 2: Check if we recently failed (backoff)
    if (this.cache.hasRecentFailure(ipnsName)) {
      return {
        success: false,
        error: "Recent resolution failure, backing off",
        source: "cache",
        latencyMs: 0,
      };
    }

    const startTime = performance.now();
    const gateways = getAllBackendGatewayUrls();

    if (gateways.length === 0) {
      return {
        success: false,
        error: "No IPFS gateways configured",
        source: "none",
        latencyMs: 0,
      };
    }

    try {
      // Phase 1: Try gateway path on all nodes in parallel (fast)
      const gatewayResult = await this.resolveViaGatewayPath(
        ipnsName,
        gateways
      );

      if (gatewayResult) {
        const latencyMs = performance.now() - startTime;

        // Store in cache
        this.cache.setIpnsRecord(ipnsName, {
          cid: gatewayResult.cid,
          sequence: 0n, // Gateway path doesn't return sequence
          _cachedContent: gatewayResult.content,
        });

        return {
          success: true,
          cid: gatewayResult.cid,
          content: gatewayResult.content,
          sequence: 0n,
          source: "http-gateway",
          latencyMs,
        };
      }

      // Phase 2: Fallback to routing API on all nodes
      const routingResult = await this.resolveViaRoutingApi(
        ipnsName,
        gateways
      );

      const latencyMs = performance.now() - startTime;

      if (routingResult) {
        // Store in cache
        this.cache.setIpnsRecord(ipnsName, {
          cid: routingResult.cid,
          sequence: routingResult.sequence,
        });

        return {
          success: true,
          cid: routingResult.cid,
          content: null,
          sequence: routingResult.sequence,
          source: "http-routing",
          latencyMs,
        };
      }

      // Both methods failed
      this.cache.recordFailure(ipnsName);

      return {
        success: false,
        error: "All IPFS gateways failed",
        source: "none",
        latencyMs,
      };
    } catch (error) {
      const latencyMs = performance.now() - startTime;
      this.cache.recordFailure(ipnsName);

      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        source: "none",
        latencyMs,
      };
    }
  }

  /**
   * Query all gateways in parallel with gateway path
   * Returns as soon as ANY gateway responds successfully
   */
  private async resolveViaGatewayPath(
    ipnsName: string,
    gateways: string[]
  ): Promise<{ cid: string; content: TxfStorageData } | null> {
    const promises = gateways.map((gateway) =>
      tryGatewayPath(ipnsName, gateway)
        .then((result) => ({
          success: result !== null,
          data: result,
          gateway,
        }))
        .catch(() => ({ success: false, data: null, gateway }))
    );

    // Use Promise.any to get first success
    try {
      const result = await Promise.any(
        promises.map((p) =>
          p.then((r) => {
            if (!r.success) throw new Error("Failed");
            return r;
          })
        )
      );

      return {
        cid: result.data?.cid || "unknown",
        content: result.data!.content,
      };
    } catch {
      return null;
    }
  }

  /**
   * Query all gateways in parallel with routing API
   * Returns detailed IPNS record with sequence number
   */
  private async resolveViaRoutingApi(
    ipnsName: string,
    gateways: string[]
  ): Promise<{
    cid: string;
    sequence: bigint;
    recordData: Uint8Array;
  } | null> {
    const promises = gateways.map((gateway) =>
      tryRoutingApi(ipnsName, gateway)
        .then((result) => ({
          success: result !== null,
          record: result,
          gateway,
        }))
        .catch(() => ({ success: false, record: null, gateway }))
    );

    try {
      const result = await Promise.any(
        promises.map((p) =>
          p.then((r) => {
            if (!r.success) throw new Error("Failed");
            return r;
          })
        )
      );

      return result.record!;
    } catch {
      return null;
    }
  }

  /**
   * Fetch token content by CID
   * Cache is checked first, then all gateways queried in parallel.
   * Returns immediately when first gateway responds with valid content.
   * CID integrity is verified before accepting content.
   */
  async fetchContentByCid(cid: string): Promise<TxfStorageData | null> {
    // Check immutable content cache
    const cached = this.cache.getContent(cid);
    if (cached) {
      return cached;
    }

    const gateways = getAllBackendGatewayUrls();
    if (gateways.length === 0) {
      return null;
    }

    const promises = gateways.map((gateway) =>
      fetchContentByCid(cid, gateway)
    );

    // Return first successful fetch with CID verification
    try {
      const content = await Promise.any(
        promises.map((p) =>
          p.then(async (result) => {
            if (result === null) throw new Error("No content");

            // CRITICAL: Verify CID matches content hash
            const computedCid = await computeCidFromContent(result);
            if (computedCid !== cid) {
              console.warn(`⚠️ CID mismatch: expected ${cid}, got ${computedCid}`);
              throw new Error("CID integrity check failed");
            }

            return result;
          })
        )
      );

      // Store in cache (verified immutable content)
      this.cache.setContent(cid, content);
      console.log(`📦 Content fetched and verified from first responding node`);
      return content;
    } catch {
      // All nodes failed or returned invalid content
      return null;
    }
  }

  /**
   * Force invalidate IPNS cache (for manual sync)
   */
  invalidateIpnsCache(ipnsName?: string): void {
    if (ipnsName) {
      this.cache.clearIpnsRecords();
    } else {
      this.cache.clear();
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return this.cache.getStats();
  }
}

// Singleton instance
let resolverInstance: IpfsHttpResolver | null = null;

/**
 * Get or create the singleton resolver instance
 */
export function getIpfsHttpResolver(): IpfsHttpResolver {
  if (!resolverInstance) {
    resolverInstance = new IpfsHttpResolver();
  }
  return resolverInstance;
}
