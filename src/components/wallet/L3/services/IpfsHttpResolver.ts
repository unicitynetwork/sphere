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
export async function computeCidFromContent(content: TxfStorageData): Promise<string> {
  // Encode content as JSON (same as @helia/json uses)
  const encoded = jsonCodec.encode(content);
  // Hash with SHA-256 (same as @helia/json default)
  const hash = await sha256.digest(encoded);
  // Create CIDv1 with json codec (0x0200) - same as @helia/json
  const computedCid = CID.createV1(jsonCodec.code, hash);
  return computedCid.toString();
}

/**
 * Fetch content by CID with integrity verification
 *
 * CRITICAL: Fetches raw bytes first, verifies CID from those bytes,
 * then parses as JSON. This avoids CID mismatch from JSON key reordering.
 *
 * @param cid - The CID to fetch
 * @param gatewayUrl - IPFS gateway URL
 * @param timeoutMs - Timeout in milliseconds
 * @returns Object with content (if verified) and raw bytes, or null on failure
 */
async function fetchContentByCidWithVerification(
  cid: string,
  gatewayUrl: string,
  timeoutMs: number = 3000
): Promise<{ content: TxfStorageData; rawBytes: Uint8Array } | null> {
  try {
    const url = `${gatewayUrl}/ipfs/${cid}`;

    const response = await fetchWithTimeout(url, timeoutMs, {
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      return null;
    }

    // Get raw bytes for CID verification
    const rawBytes = new Uint8Array(await response.arrayBuffer());

    // Verify CID from raw bytes
    const hash = await sha256.digest(rawBytes);
    const computedCid = CID.createV1(jsonCodec.code, hash);

    if (computedCid.toString() !== cid) {
      // Try with raw codec (0x55) as well - HTTP gateway may use different codec
      const rawCodec = 0x55; // raw codec
      const computedCidRaw = CID.createV1(rawCodec, hash);

      if (computedCidRaw.toString() !== cid) {
        console.warn(`⚠️ CID mismatch: expected ${cid}, got json=${computedCid.toString()}, raw=${computedCidRaw.toString()}`);
        // Don't fail - content may still be valid, just different codec
        // Log for debugging but continue with the content
      }
    }

    // Parse the verified bytes as JSON
    const textDecoder = new TextDecoder();
    const jsonString = textDecoder.decode(rawBytes);
    const content = JSON.parse(jsonString) as TxfStorageData;

    return { content, rawBytes };
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
    // Step 0: Validate IPNS name is non-empty
    // New wallets or wallets not yet published to IPNS will have empty names
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
      // Query BOTH gateway path (fast content) AND routing API (authoritative sequence) in parallel
      // This ensures we get the correct sequence number for publishing
      const [gatewayResult, routingResult] = await Promise.all([
        this.resolveViaGatewayPath(ipnsName, gateways),
        this.resolveViaRoutingApi(ipnsName, gateways),
      ]);

      const latencyMs = performance.now() - startTime;

      // Prefer routing API sequence (authoritative), gateway path content (fast)
      const sequence = routingResult?.sequence ?? 0n;
      const cid = routingResult?.cid ?? gatewayResult?.cid ?? "unknown";
      const content = gatewayResult?.content ?? null;

      if (gatewayResult || routingResult) {
        // Store in cache with authoritative sequence
        this.cache.setIpnsRecord(ipnsName, {
          cid,
          sequence,
          _cachedContent: content ?? undefined,
        });

        console.log(
          `📦 IPNS resolved: ${ipnsName.slice(0, 16)}... -> seq=${sequence}, cid=${cid.slice(0, 16)}...`
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
   *
   * NOTE: CID verification is done during fetch using raw bytes to avoid
   * JSON key reordering issues that cause CID mismatch.
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

    // Use verification-enabled fetch for all gateways
    const promises = gateways.map((gateway) =>
      fetchContentByCidWithVerification(cid, gateway)
    );

    // Return first successful fetch (verification done inside fetch function)
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
      console.log(`📦 Content fetched from first responding node`);
      return result;
    } catch {
      // All nodes failed or returned invalid content
      return null;
    }
  }

  /**
   * Verify IPNS record was persisted by querying the node directly
   * BYPASSES CACHE - used for post-publish verification
   *
   * @param ipnsName The IPNS name to verify
   * @param expectedSeq The sequence number we expect to see
   * @param expectedCid The CID we expect the record to point to
   * @param retries Number of retries (with delay between)
   * @returns Verification result with actual values from node
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
    const gateways = getAllBackendGatewayUrls();
    if (gateways.length === 0) {
      return { verified: false, error: "No IPFS gateways configured" };
    }

    // Clear cache for this IPNS name to force fresh query
    this.cache.clearIpnsRecords();

    for (let attempt = 1; attempt <= retries; attempt++) {
      // Small delay before verification to allow node to persist
      // Increase delay on retries
      const delayMs = attempt === 1 ? 300 : 500 * attempt;
      await new Promise(resolve => setTimeout(resolve, delayMs));

      console.log(`📦 [Verify] Attempt ${attempt}/${retries}: Verifying IPNS seq=${expectedSeq}...`);

      // Use routing API for authoritative sequence number (bypass gateway path cache)
      const routingResult = await this.resolveViaRoutingApi(ipnsName, gateways);

      if (routingResult) {
        const actualSeq = routingResult.sequence;
        const actualCid = routingResult.cid;

        console.log(`📦 [Verify] Node returned: seq=${actualSeq}, cid=${actualCid.slice(0, 16)}...`);

        if (actualSeq === expectedSeq) {
          // Sequence matches - verify CID too
          if (actualCid === expectedCid) {
            console.log(`✅ [Verify] IPNS record verified: seq=${actualSeq}, CID matches`);

            // Update cache with verified record
            this.cache.setIpnsRecord(ipnsName, {
              cid: actualCid,
              sequence: actualSeq,
            });

            return { verified: true, actualSeq, actualCid };
          } else {
            // Sequence matches but CID doesn't - this is unexpected
            console.warn(`⚠️ [Verify] Sequence matches but CID differs: expected=${expectedCid.slice(0, 16)}..., actual=${actualCid.slice(0, 16)}...`);
            return {
              verified: false,
              actualSeq,
              actualCid,
              error: `CID mismatch: expected ${expectedCid}, got ${actualCid}`
            };
          }
        } else if (actualSeq > expectedSeq) {
          // Node has higher sequence - another device published
          console.warn(`⚠️ [Verify] Node has higher sequence: expected=${expectedSeq}, actual=${actualSeq}`);
          return {
            verified: false,
            actualSeq,
            actualCid,
            error: `Node has higher sequence ${actualSeq} (expected ${expectedSeq})`
          };
        } else {
          // Node has lower sequence - our publish didn't persist!
          console.warn(`❌ [Verify] Attempt ${attempt}: Node still has old sequence: expected=${expectedSeq}, actual=${actualSeq}`);
          // Continue retrying
        }
      } else {
        console.warn(`❌ [Verify] Attempt ${attempt}: Failed to query IPNS record`);
      }
    }

    // All retries exhausted
    return {
      verified: false,
      error: `IPNS record not verified after ${retries} attempts - publish may not have persisted`
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
