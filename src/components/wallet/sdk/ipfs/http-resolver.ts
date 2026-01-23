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

import { getIpfsCache } from "./cache";
import { unmarshalIPNSRecord } from "ipns";
import { CID } from "multiformats/cid";
import * as jsonCodec from "multiformats/codecs/json";
import { sha256 } from "multiformats/hashes/sha2";

// Re-export for backwards compatibility
export { computeCidFromContent } from "./crypto";

export interface IpnsResolutionResult<T = unknown> {
  success: boolean;
  cid?: string;
  content?: T | null;
  sequence?: bigint;
  source: "cache" | "http-gateway" | "http-routing" | "dht" | "none";
  error?: string;
  latencyMs: number;
}

export interface IpfsHttpResolverConfig {
  /** Function that returns list of gateway URLs */
  getGatewayUrls: () => string[];
  /** Timeout for gateway path requests (ms) */
  gatewayTimeoutMs?: number;
  /** Timeout for routing API requests (ms) */
  routingTimeoutMs?: number;
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
async function tryGatewayPath<T>(
  ipnsName: string,
  gatewayUrl: string,
  timeoutMs: number = 5000
): Promise<{ content: T; cid?: string } | null> {
  try {
    // Request raw JSON (not dag-json) to preserve original encoding for CID verification
    const url = `${gatewayUrl}/ipns/${ipnsName}`;

    const response = await fetchWithTimeout(url, timeoutMs, {
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      return null;
    }

    const content = (await response.json()) as T & { _cid?: string };
    return { content, cid: content._cid };
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

// computeCidFromContent is now in crypto.ts and re-exported above

/**
 * Fetch content by CID with integrity verification
 *
 * CRITICAL: Fetches raw bytes first, verifies CID from those bytes,
 * then parses as JSON. This avoids CID mismatch from JSON key reordering.
 */
async function fetchContentByCidWithVerification<T>(
  cid: string,
  gatewayUrl: string,
  timeoutMs: number = 3000
): Promise<{ content: T; rawBytes: Uint8Array } | null> {
  try {
    const url = `${gatewayUrl}/ipfs/${cid}`;

    // Request raw bytes - DO NOT use Accept: application/json
    // JSON content negotiation can cause gateways to re-serialize JSON,
    // which changes property order and breaks CID verification
    const response = await fetchWithTimeout(url, timeoutMs, {
      headers: {
        Accept: "application/octet-stream, */*",
      },
    });

    if (!response.ok) {
      return null;
    }

    // Get raw bytes for CID verification
    const rawBytes = new Uint8Array(await response.arrayBuffer());

    // Verify CID from raw bytes
    // IPFS backend uses raw codec (0x55) by default, so try that first
    const hash = await sha256.digest(rawBytes);
    const rawCodec = 0x55; // raw codec (bafkrei... prefix)
    const computedCidRaw = CID.createV1(rawCodec, hash);

    if (computedCidRaw.toString() !== cid) {
      // Also try with json codec (0x0200) for legacy Helia-created CIDs
      const computedCidJson = CID.createV1(jsonCodec.code, hash);

      if (computedCidJson.toString() !== cid) {
        console.warn(`CID mismatch: expected ${cid}, got raw=${computedCidRaw.toString()}, json=${computedCidJson.toString()}`);
        // Don't fail - content may still be valid, just different codec
      }
    }

    // Parse the verified bytes as JSON
    const textDecoder = new TextDecoder();
    const jsonString = textDecoder.decode(rawBytes);
    const content = JSON.parse(jsonString) as T;

    return { content, rawBytes };
  } catch {
    return null;
  }
}

/**
 * Main HTTP resolver using parallel multi-node racing
 */
export class IpfsHttpResolver<T = unknown> {
  private cache = getIpfsCache();
  private config: Required<IpfsHttpResolverConfig>;

  constructor(config: IpfsHttpResolverConfig) {
    this.config = {
      getGatewayUrls: config.getGatewayUrls,
      gatewayTimeoutMs: config.gatewayTimeoutMs ?? 5000,
      routingTimeoutMs: config.routingTimeoutMs ?? 5000,
    };
  }

  /**
   * Resolve IPNS name across all configured nodes in parallel
   */
  async resolveIpnsName(ipnsName: string): Promise<IpnsResolutionResult<T>> {
    // Step 0: Validate IPNS name is non-empty
    if (!ipnsName || typeof ipnsName !== 'string' || ipnsName.trim().length === 0) {
      return {
        success: false,
        error: 'IPNS name is empty - wallet not fully initialized yet',
        source: 'none',
        latencyMs: 0,
      };
    }

    // Step 1: Check cache first
    const cached = this.cache.getIpnsRecord(ipnsName);
    if (cached) {
      return {
        success: true,
        cid: cached.cid,
        content: (cached._cachedContent as T) || null,
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
    const gateways = this.config.getGatewayUrls();

    if (gateways.length === 0) {
      return {
        success: false,
        error: "No IPFS gateways configured",
        source: "none",
        latencyMs: 0,
      };
    }

    try {
      // Query BOTH gateway path (fast content) AND routing API (authoritative sequence) in parallel
      const [gatewayResult, routingResult] = await Promise.all([
        this.resolveViaGatewayPath(ipnsName, gateways),
        this.resolveViaRoutingApi(ipnsName, gateways),
      ]);

      const latencyMs = performance.now() - startTime;

      // Prefer routing API sequence (authoritative), gateway path content (fast)
      const sequence = routingResult?.sequence ?? 0n;
      const authoritativeCid = routingResult?.cid ?? gatewayResult?.cid ?? "unknown";
      let content: T | null = gatewayResult?.content ?? null;
      let contentSource = "gateway-path";

      // CRITICAL FIX: Verify gateway content matches authoritative CID
      if (content && routingResult?.cid && gatewayResult?.cid) {
        if (gatewayResult.cid !== routingResult.cid) {
          console.warn(`Gateway content CID mismatch: gateway=${gatewayResult.cid.slice(0, 16)}..., routing=${routingResult.cid.slice(0, 16)}...`);
          console.log(`Fetching fresh content by authoritative CID...`);

          // Fetch content by the authoritative CID
          for (const gateway of gateways) {
            const freshResult = await fetchContentByCidWithVerification<T>(routingResult.cid, gateway);
            if (freshResult) {
              content = freshResult.content;
              contentSource = "cid-fetch";
              break;
            }
          }

          if (contentSource !== "cid-fetch") {
            console.warn(`Could not fetch content by CID ${routingResult.cid.slice(0, 16)}... - returning null content`);
            content = null;
          }
        }
      }

      const cid = authoritativeCid;

      if (gatewayResult || routingResult) {
        // Store in cache with authoritative sequence
        this.cache.setIpnsRecord(ipnsName, {
          cid,
          sequence,
          _cachedContent: content ?? undefined,
        });

        console.log(
          `IPNS resolved: ${ipnsName.slice(0, 16)}... -> seq=${sequence}, cid=${cid.slice(0, 16)}..., content=${contentSource}`
        );

        return {
          success: true,
          cid,
          content,
          sequence,
          source: routingResult ? "http-routing" : "http-gateway",
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
   */
  private async resolveViaGatewayPath(
    ipnsName: string,
    gateways: string[]
  ): Promise<{ cid: string; content: T } | null> {
    const promises = gateways.map((gateway) =>
      tryGatewayPath<T>(ipnsName, gateway, this.config.gatewayTimeoutMs)
        .then((result) => ({
          success: result !== null,
          data: result,
          gateway,
        }))
        .catch(() => ({ success: false, data: null, gateway }))
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
      tryRoutingApi(ipnsName, gateway, this.config.routingTimeoutMs)
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
   */
  async fetchContentByCid(cid: string): Promise<T | null> {
    // Check immutable content cache
    const cached = this.cache.getContent<T>(cid);
    if (cached) {
      return cached;
    }

    const gateways = this.config.getGatewayUrls();
    if (gateways.length === 0) {
      return null;
    }

    const promises = gateways.map((gateway) =>
      fetchContentByCidWithVerification<T>(cid, gateway)
    );

    try {
      const result = await Promise.any(
        promises.map((p) =>
          p.then((fetchResult) => {
            if (fetchResult === null) throw new Error("No content");
            return fetchResult.content;
          })
        )
      );

      // Store in cache (verified immutable content)
      this.cache.setContent(cid, result);
      console.log(`Content fetched from first responding node`);
      return result;
    } catch {
      return null;
    }
  }

  /**
   * Verify IPNS record was persisted by querying the node directly
   * BYPASSES CACHE - used for post-publish verification
   */
  async verifyIpnsRecord(
    ipnsName: string,
    expectedSeq: bigint,
    expectedCid: string,
    retries: number = 3
  ): Promise<{
    verified: boolean;
    actualSeq?: bigint;
    actualCid?: string;
    error?: string;
  }> {
    const gateways = this.config.getGatewayUrls();
    if (gateways.length === 0) {
      return { verified: false, error: "No IPFS gateways configured" };
    }

    // Clear cache for this IPNS name to force fresh query
    this.cache.clearIpnsRecords();

    for (let attempt = 1; attempt <= retries; attempt++) {
      const delayMs = attempt === 1 ? 300 : 500 * attempt;
      await new Promise(resolve => setTimeout(resolve, delayMs));

      console.log(`[Verify] Attempt ${attempt}/${retries}: Verifying IPNS seq=${expectedSeq}...`);

      const routingResult = await this.resolveViaRoutingApi(ipnsName, gateways);

      if (routingResult) {
        const actualSeq = routingResult.sequence;
        const actualCid = routingResult.cid;

        console.log(`[Verify] Node returned: seq=${actualSeq}, cid=${actualCid.slice(0, 16)}...`);

        if (actualSeq === expectedSeq) {
          if (actualCid === expectedCid) {
            console.log(`[Verify] IPNS record verified: seq=${actualSeq}, CID matches`);

            this.cache.setIpnsRecord(ipnsName, {
              cid: actualCid,
              sequence: actualSeq,
            });

            return { verified: true, actualSeq, actualCid };
          } else {
            console.warn(`[Verify] Sequence matches but CID differs`);
            return {
              verified: false,
              actualSeq,
              actualCid,
              error: `CID mismatch: expected ${expectedCid}, got ${actualCid}`
            };
          }
        } else if (actualSeq > expectedSeq) {
          console.warn(`[Verify] Node has higher sequence: expected=${expectedSeq}, actual=${actualSeq}`);
          return {
            verified: false,
            actualSeq,
            actualCid,
            error: `Node has higher sequence ${actualSeq} (expected ${expectedSeq})`
          };
        } else {
          console.warn(`[Verify] Attempt ${attempt}: Node still has old sequence`);
        }
      } else {
        console.warn(`[Verify] Attempt ${attempt}: Failed to query IPNS record`);
      }
    }

    return {
      verified: false,
      error: `IPNS record not verified after ${retries} attempts`
    };
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

/**
 * Create a configured resolver instance
 */
export function createIpfsHttpResolver<T = unknown>(
  config: IpfsHttpResolverConfig
): IpfsHttpResolver<T> {
  return new IpfsHttpResolver<T>(config);
}
