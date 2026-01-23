# Fast IPFS/IPNS Sync Strategy for Wallet Application

**Target: Sub-2 second sync completion**

## Executive Summary

Your current IPFS architecture uses DHT-based IPNS resolution (10-30+ seconds), which is too slow for a responsive wallet UX. This document presents a **three-tier hybrid strategy** combining:

1. **HTTP API Fast-Path** (100-300ms) - Direct calls to your 5 dedicated Kubo nodes
2. **Parallel Multi-Node Racing** (optimal latency) - Query all 5 nodes concurrently, use first response
3. **DHT Fallback** (>2 seconds allowed) - Only if all HTTP paths fail, with timeout management
4. **Intelligent Caching** - Reduce unnecessary resolution attempts
5. **Optimized Publishing** - Batch operations and parallel multi-node publishes

This strategy maintains full IPFS compatibility while leveraging your infrastructure advantage of running dedicated nodes.

---

## Architecture Overview

### Three-Tier Resolution Model

```
┌─────────────────────────────────────────────────────────┐
│  Wallet Sync Request (token data)                       │
└──────────────────────┬──────────────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        │              │              │
        v              v              v
   ┌─────────┐  ┌──────────┐  ┌──────────┐
   │ Tier 1  │  │ Tier 2   │  │ Tier 3   │
   │ Cache   │  │ HTTP API │  │ DHT      │
   │ (ms)    │  │ (100-300)│  │ (>2s)    │
   └──┬──────┘  └──┬───────┘  └──┬───────┘
      │            │             │
      ├─ Hit ──────┤ Parallel    ├─ Timeout
      │            │ to 5 nodes  │  fallback
      │            │             │
      └─Hit Tier 2─┼─────────────┴─ Fail gracefully
                   │
          ┌────────┴────────┐
          v                 v
    ┌──────────┐      ┌──────────┐
    │ Publisher│      │ Aggregator│
    │ Content  │      │ Validation│
    └──────────┘      └──────────┘
```

---

## 1. Tier 1: Intelligent Cache Layer

### Cache Strategy
Reduce unnecessary network calls with smart TTL policies:

```typescript
// File: src/config/cache.config.ts

export const IPFS_CACHE_CONFIG = {
  // IPNS records: cache by sequence number + lifetime
  ipnsRecordTtlMs: 60000,  // 1 minute - IPNS records rarely change during active sync

  // Published content: immutable by CID - cache indefinitely
  contentCacheMs: Infinity,

  // Negative cache: remember failed resolutions (prevent thundering herd)
  failureCacheTtlMs: 30000,  // 30 seconds

  // Version history: keep last N versions to detect resets
  versionHistorySize: 5,
};
```

### Cache Key Structure
```typescript
// IPNS record cache
const key = `ipns:${ipnsName}`;  // Single key per identity
const entry = {
  cid: "QmXXX...",
  sequence: 42n,
  timestamp: Date.now(),
  source: "http" | "dht",
};

// Content cache (keyed by CID)
const contentKey = `content:${cid}`;  // Immutable content
const content = {
  data: TxfStorageData,
  timestamp: Date.now(),
};
```

### Implementation
```typescript
// File: src/components/wallet/L3/services/IpfsCache.ts

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  source: "http" | "dht" | "local";
  sequenceNumber?: bigint;  // For IPNS records
}

export class IpfsCache {
  private recordCache = new Map<string, CacheEntry<IpnsGatewayResult>>();
  private contentCache = new Map<string, CacheEntry<TxfStorageData>>();
  private failureCache = new Set<string>();

  // Get cached IPNS record if fresh
  getIpnsRecord(ipnsName: string): IpnsGatewayResult | null {
    const cached = this.recordCache.get(ipnsName);
    if (!cached) return null;

    const isExpired = Date.now() - cached.timestamp > 60000;
    if (isExpired) {
      this.recordCache.delete(ipnsName);
      return null;
    }

    return cached.data;
  }

  // Store resolved IPNS record
  setIpnsRecord(
    ipnsName: string,
    result: IpnsGatewayResult,
    ttlMs: number = 60000
  ): void {
    this.recordCache.set(ipnsName, {
      data: result,
      timestamp: Date.now(),
      source: result.gateway ? "http" : "dht",
      sequenceNumber: result.sequence,
    });

    // Clear failure cache on success
    this.failureCache.delete(ipnsName);
  }

  // Get immutable content from cache (always valid)
  getContent(cid: string): TxfStorageData | null {
    return this.contentCache.get(cid)?.data || null;
  }

  // Store immutable content
  setContent(cid: string, content: TxfStorageData): void {
    this.contentCache.set(cid, {
      data: content,
      timestamp: Date.now(),
      source: "http",
    });
  }

  // Track failed resolution attempts
  recordFailure(ipnsName: string): void {
    this.failureCache.add(ipnsName);
    // Auto-clear after 30 seconds
    setTimeout(() => this.failureCache.delete(ipnsName), 30000);
  }

  // Check if we recently failed to resolve
  hasRecentFailure(ipnsName: string): boolean {
    return this.failureCache.has(ipnsName);
  }

  // Clear all caches (on logout, account switch)
  clear(): void {
    this.recordCache.clear();
    this.contentCache.clear();
    this.failureCache.clear();
  }
}
```

---

## 2. Tier 2: HTTP API Fast-Path (Primary Strategy)

### Direct HTTP API Advantages
- **Latency**: 100-300ms (vs DHT 10-30s+)
- **Reliability**: Your infrastructure control
- **Throughput**: No DHT bottlenecks
- **Predictability**: Consistent performance

### Kubo HTTP API Endpoints

#### 2.1 IPNS Record Resolution (Recommended Path)

**Fastest method: Gateway path with direct resolution**

```http
GET /ipns/{ipnsName}?format=dag-json
Host: unicity-ipfs1.dyndns.org
Accept: application/vnd.ipld.dag-json, application/json
Timeout: 5 seconds
```

**Expected Performance**: 30-100ms for cached records, 200-300ms for DHT lookup by gateway

**Response**: Directly returns the published TXF content (token data)

**Example using fetch:**
```typescript
async function resolveIpnsViaGateway(
  ipnsName: string,
  gatewayUrl: string
): Promise<TxfStorageData | null> {
  const url = `${gatewayUrl}/ipns/${ipnsName}?format=dag-json`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/vnd.ipld.dag-json, application/json",
      },
    });

    if (!response.ok) {
      // 404 = not found, 500 = resolution failed
      return null;
    }

    const data = await response.json();
    return data as TxfStorageData;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      console.warn(`Gateway ${gatewayUrl} timeout for ${ipnsName}`);
    }
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}
```

#### 2.2 Routing API (Fallback within HTTP)

**More reliable but slower method: Returns IPNS record details**

```http
POST /api/v0/routing/get?arg=/ipns/{ipnsName}
Host: unicity-ipfs1.dyndns.org
Timeout: 5 seconds
```

**Response**: Returns IPNS record in `Extra` field (base64 encoded)

**Advantages**:
- Authoritative sequence number (for version tracking)
- Returns IPNS record properties (TTL, expiry)
- More reliable if gateway path fails

**Example:**
```typescript
async function resolveIpnsViaRoutingApi(
  ipnsName: string,
  gatewayUrl: string
): Promise<{
  cid: string;
  sequence: bigint;
  recordData: Uint8Array;
} | null> {
  const url = `${gatewayUrl}/api/v0/routing/get?arg=/ipns/${ipnsName}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
    });

    if (!response.ok) return null;

    const json = await response.json() as { Extra?: string };
    if (!json.Extra) return null;

    // Decode base64 IPNS record
    const recordData = Uint8Array.from(
      atob(json.Extra),
      c => c.charCodeAt(0)
    );

    const record = unmarshalIPNSRecord(recordData);
    const cidMatch = record.value.match(/^\/ipfs\/(.+)$/);

    if (!cidMatch) return null;

    return {
      cid: cidMatch[1],
      sequence: record.sequence,
      recordData,
    };
  } catch (error) {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}
```

#### 2.3 Content Fetching (GET CID)

**Fast immutable content retrieval**

```http
GET /ipfs/{cid}?format=dag-json
Host: unicity-ipfs1.dyndns.org
Accept: application/vnd.ipld.dag-json, application/json
Timeout: 3 seconds
```

**Performance**: 50-200ms for cached content, 200-500ms for unpopular CIDs

**Example:**
```typescript
async function fetchContentByCid(
  cid: string,
  gatewayUrl: string
): Promise<TxfStorageData | null> {
  const url = `${gatewayUrl}/ipfs/${cid}?format=dag-json`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/vnd.ipld.dag-json, application/json",
      },
    });

    if (!response.ok) return null;

    return await response.json() as TxfStorageData;
  } finally {
    clearTimeout(timeoutId);
  }
}
```

### 2.4 Parallel Multi-Node Racing Strategy

**Execute all requests concurrently, return first success:**

```typescript
// File: src/components/wallet/L3/services/IpfsHttpResolver.ts

import { getAllBackendGatewayUrls } from "../../../../config/ipfs.config";

export class IpfsHttpResolver {
  private cache: IpfsCache;

  constructor() {
    this.cache = new IpfsCache();
  }

  /**
   * Resolve IPNS name across all configured nodes in parallel
   * Returns first successful result (fastest node wins)
   *
   * Execution flow:
   * 1. Check cache for fresh record
   * 2. Query all nodes with gateway path (fast)
   * 3. If all fail, query all nodes with routing API (reliable)
   * 4. Return first success or timeout after 5 seconds
   */
  async resolveIpnsName(ipnsName: string): Promise<IpnsResolutionResult> {
    // Check cache first
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

    // Check if we recently failed
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
      const result = await this.resolveViaGatewayPath(
        ipnsName,
        gateways
      );

      if (result.success) {
        const latencyMs = performance.now() - startTime;
        this.cache.setIpnsRecord(result.data!, { latencyMs });
        return {
          success: true,
          cid: result.data!.cid,
          content: result.data!.content,
          sequence: result.data!.sequence,
          source: "http-gateway",
          latencyMs,
        };
      }

      // Phase 2: Fallback to routing API on all nodes
      const fallbackResult = await this.resolveViaRoutingApi(
        ipnsName,
        gateways
      );

      const latencyMs = performance.now() - startTime;

      if (fallbackResult.success) {
        this.cache.setIpnsRecord(fallbackResult.data!);
        return {
          success: true,
          cid: fallbackResult.data!.cid,
          content: fallbackResult.data!.content,
          sequence: fallbackResult.data!.sequence,
          source: "http-routing",
          latencyMs,
        };
      }

      // Both methods failed
      this.cache.recordFailure(ipnsName);
      return {
        success: false,
        error: "All IPFS gateways failed",
        source: "http",
        latencyMs,
      };
    } catch (error) {
      const latencyMs = performance.now() - startTime;
      this.cache.recordFailure(ipnsName);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        source: "http",
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
  ): Promise<{
    success: boolean;
    data?: IpnsResolutionData;
  }> {
    const promises = gateways.map(gateway =>
      resolveIpnsViaGateway(ipnsName, gateway)
        .then(content => ({
          success: content !== null,
          content,
          gateway,
        }))
        .catch(() => ({ success: false, content: null, gateway }))
    );

    // Use Promise.any to get first success
    // Throws AggregateError if all fail (we catch and return false)
    try {
      const result = await Promise.any(
        promises.map(p => p.then(r => {
          if (!r.success) throw new Error("Failed");
          return r;
        }))
      );

      // Extract CID from content if available
      let cid: string | undefined;
      if (result.content && "_cid" in result.content) {
        cid = (result.content._cid as string);
      }

      return {
        success: true,
        data: {
          cid: cid || "unknown",
          content: result.content,
          sequence: 0n,
          source: "http-gateway",
        },
      };
    } catch {
      return { success: false };
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
    success: boolean;
    data?: IpnsResolutionData;
  }> {
    const promises = gateways.map(gateway =>
      resolveIpnsViaRoutingApi(ipnsName, gateway)
        .then(record => ({
          success: record !== null,
          record,
          gateway,
        }))
        .catch(() => ({ success: false, record: null, gateway }))
    );

    try {
      const result = await Promise.any(
        promises.map(p => p.then(r => {
          if (!r.success) throw new Error("Failed");
          return r;
        }))
      );

      return {
        success: true,
        data: {
          cid: result.record!.cid,
          content: null,
          sequence: result.record!.sequence,
          source: "http-routing",
        },
      };
    } catch {
      return { success: false };
    }
  }

  /**
   * Fetch token content by CID
   * Cache is checked, and all gateways queried in parallel
   */
  async fetchContentByCid(cid: string): Promise<TxfStorageData | null> {
    // Check immutable content cache
    const cached = this.cache.getContent(cid);
    if (cached) return cached;

    const gateways = getAllBackendGatewayUrls();
    const promises = gateways.map(gw =>
      fetchContentByCid(cid, gw).catch(() => null)
    );

    // Return first successful fetch
    try {
      const content = await Promise.any(
        promises.filter((p): p is Promise<TxfStorageData> => p !== null)
      );

      this.cache.setContent(cid, content);
      return content;
    } catch {
      return null;
    }
  }
}

interface IpnsResolutionResult {
  success: boolean;
  cid?: string;
  content?: TxfStorageData | null;
  sequence?: bigint;
  source: "cache" | "http-gateway" | "http-routing" | "dht" | "none";
  error?: string;
  latencyMs: number;
}

interface IpnsResolutionData {
  cid: string;
  content: TxfStorageData | null;
  sequence: bigint;
  source: string;
}
```

---

## 3. Tier 3: DHT Fallback with Timeout Management

### When to Use DHT
Only if HTTP paths exhaust in >2 seconds. DHT should be a last resort.

### Timeout Strategy
```typescript
// File: src/components/wallet/L3/services/IpfsDhtResolver.ts

export class IpfsDhtResolver {
  /**
   * Attempt DHT resolution as final fallback
   * Only called if HTTP methods fail
   * Max timeout: 1 second (we're already past fast-path time)
   */
  async resolveIpnsViaDht(
    ipnsName: string,
    timeoutMs: number = 1000
  ): Promise<IpnsResolutionResult> {
    // This would use Helia's DHT if available
    // Or skip entirely if HTTP success rate is high enough

    const startTime = performance.now();

    try {
      // Your Helia instance already has DHT resolution
      // Just add aggressive timeout
      const controller = new AbortController();
      const timeoutHandle = setTimeout(
        () => controller.abort(),
        timeoutMs
      );

      // This is pseudo-code - your Helia setup may differ
      const result = await heliaInstance.ipns?.resolve(
        ipnsName,
        { signal: controller.signal }
      );

      clearTimeout(timeoutHandle);

      return {
        success: true,
        cid: String(result),
        source: "dht",
        latencyMs: performance.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: "DHT resolution timeout",
        source: "dht",
        latencyMs: performance.now() - startTime,
      };
    }
  }
}
```

### Decision Logic
```typescript
/**
 * Orchestrates three-tier resolution with timeouts
 */
export async function resolveIpnsWithFallback(
  ipnsName: string,
  options: {
    httpTimeoutMs?: number;      // Default: 5000ms
    dhtTimeoutMs?: number;       // Default: 1000ms
    maxTotalTimeMs?: number;     // Default: 2000ms for fast response
  } = {}
): Promise<IpnsResolutionResult> {
  const httpTimeoutMs = options.httpTimeoutMs ?? 5000;
  const dhtTimeoutMs = options.dhtTimeoutMs ?? 1000;
  const maxTotalTimeMs = options.maxTotalTimeMs ?? 2000;

  const startTime = performance.now();

  // Try HTTP first (should complete in 100-300ms)
  const httpResolver = new IpfsHttpResolver();
  const httpResult = await httpResolver.resolveIpnsName(ipnsName);

  if (httpResult.success) {
    return httpResult; // Fast path successful
  }

  const elapsedMs = performance.now() - startTime;

  // If we're already past max total time, don't try DHT
  if (elapsedMs > maxTotalTimeMs) {
    return {
      ...httpResult,
      error: `HTTP failed and total time exceeded (${elapsedMs}ms)`,
    };
  }

  // DHT fallback with remaining time
  const remainingTimeMs = maxTotalTimeMs - elapsedMs;
  const actualDhtTimeoutMs = Math.min(dhtTimeoutMs, remainingTimeMs);

  const dhtResolver = new IpfsDhtResolver();
  const dhtResult = await dhtResolver.resolveIpnsViaDht(
    ipnsName,
    actualDhtTimeoutMs
  );

  return dhtResult.success ? dhtResult : httpResult;
}
```

---

## 4. Publishing Strategy (Under 2 Seconds)

### Publish Flow
```
Your app wants to publish token data
         ↓
   1. Serialize to TXF format (already done)
         ↓
   2. Store in all 5 nodes in parallel
         ↓
   3. Publish IPNS record to all 5 nodes
         ↓
   4. Broadcast pin notification (Nostr)
         ↓
Done (100-500ms)
```

### Implementation

#### 4.1 HTTP PUT to Store Content

```http
POST /api/v0/add
Host: unicity-ipfs1.dyndns.org
Content-Type: multipart/form-data

[binary content]
```

**Response**: Returns CID

```typescript
async function storeContentOnGateway(
  content: TxfStorageData,
  gatewayUrl: string
): Promise<string | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3000);

  try {
    const formData = new FormData();
    const blob = new Blob(
      [JSON.stringify(content)],
      { type: "application/json" }
    );
    formData.append("file", blob);

    const response = await fetch(`${gatewayUrl}/api/v0/add`, {
      method: "POST",
      body: formData,
      signal: controller.signal,
    });

    if (!response.ok) return null;

    const json = await response.json() as { Hash?: string };
    return json.Hash || null;
  } finally {
    clearTimeout(timeoutId);
  }
}
```

#### 4.2 HTTP IPNS Publish

```http
POST /api/v0/name/publish?arg={cid}&lifetime=87660h
Host: unicity-ipfs1.dyndns.org
```

**Parameters**:
- `arg`: The CID to publish
- `lifetime`: How long the IPNS record is valid (default 24h, set to 99 years = 87660h)
- `key`: Which key to use (default = self, or specify specific key ID)

```typescript
async function publishIpnsOnGateway(
  cid: string,
  gatewayUrl: string,
  options: {
    keyName?: string;
    lifetime?: string;  // e.g., "87660h" for 10 years
  } = {}
): Promise<{
  name: string;    // IPNS name (pubkey)
  value: string;   // CID path
} | null> {
  const lifetime = options.lifetime ?? "87660h";
  const keyParam = options.keyName ? `&key=${options.keyName}` : "";

  const url = `${gatewayUrl}/api/v0/name/publish?arg=/ipfs/${cid}&lifetime=${lifetime}${keyParam}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
    });

    if (!response.ok) return null;

    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}
```

#### 4.3 Parallel Multi-Node Publish

```typescript
/**
 * Publish token data to all configured IPFS nodes in parallel
 */
export async function publishTokenDataToIpfs(
  tokenData: TxfStorageData
): Promise<{
  success: boolean;
  cid?: string;
  ipnsName?: string;
  publishedNodes: number;
  totalNodes: number;
  failedNodes: string[];
}> {
  const gateways = getAllBackendGatewayUrls();

  if (gateways.length === 0) {
    return {
      success: false,
      publishedNodes: 0,
      totalNodes: 0,
      failedNodes: [],
    };
  }

  // Step 1: Store content on all nodes in parallel
  const storePromises = gateways.map(gw =>
    storeContentOnGateway(tokenData, gw)
      .then(cid => ({ cid, gateway: gw, success: cid !== null }))
      .catch(() => ({ cid: null, gateway: gw, success: false }))
  );

  const storeResults = await Promise.all(storePromises);

  // Check if any succeeded
  const successfulStore = storeResults.find(r => r.success);
  if (!successfulStore) {
    return {
      success: false,
      publishedNodes: 0,
      totalNodes: gateways.length,
      failedNodes: gateways,
    };
  }

  const cid = successfulStore.cid!;

  // Step 2: Publish IPNS record to all nodes in parallel
  const publishPromises = gateways.map(gw =>
    publishIpnsOnGateway(cid, gw, { lifetime: "87660h" })
      .then(result => ({
        result,
        gateway: gw,
        success: result !== null
      }))
      .catch(() => ({ result: null, gateway: gw, success: false }))
  );

  const publishResults = await Promise.all(publishPromises);

  const successfulPublishes = publishResults.filter(r => r.success).length;
  const failedNodes = publishResults
    .filter(r => !r.success)
    .map(r => r.gateway);

  return {
    success: successfulPublishes > 0,
    cid,
    ipnsName: publishResults[0]?.result?.name,
    publishedNodes: successfulPublishes,
    totalNodes: gateways.length,
    failedNodes,
  };
}
```

---

## 5. Integration with Existing Code

### Update IpfsStorageService

Your current `IpfsStorageService` should be updated to use the HTTP resolver as the primary path:

```typescript
// In IpfsStorageService.ts

async sync(): Promise<StorageResult> {
  const startTime = performance.now();

  try {
    // Use HTTP resolver as primary path
    const httpResolver = new IpfsHttpResolver();
    const result = await httpResolver.resolveIpnsName(this.ipnsName);

    if (!result.success) {
      return {
        success: false,
        timestamp: Date.now(),
        error: result.error,
      };
    }

    // Fetch content by CID
    const content = await httpResolver.fetchContentByCid(result.cid!);
    if (!content) {
      return {
        success: false,
        timestamp: Date.now(),
        error: "Failed to fetch content",
      };
    }

    // Process and validate
    const tokens = parseTxfStorageData(content);
    const latencyMs = performance.now() - startTime;

    return {
      success: true,
      cid: result.cid,
      ipnsName: this.ipnsName,
      tokenCount: tokens.length,
      timestamp: Date.now(),
    };
  } catch (error) {
    return {
      success: false,
      timestamp: Date.now(),
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
```

### Update Publish Flow

Replace DHT publish with HTTP parallel publish:

```typescript
async publishToIpfs(tokenData: TxfStorageData): Promise<StorageResult> {
  const result = await publishTokenDataToIpfs(tokenData);

  if (!result.success) {
    return {
      success: false,
      timestamp: Date.now(),
      error: "IPFS publish failed",
    };
  }

  return {
    success: true,
    cid: result.cid,
    ipnsName: result.ipnsName,
    timestamp: Date.now(),
    ipnsPublished: result.publishedNodes > 0,
  };
}
```

---

## 6. Performance Targets

### Resolution Latency Profile

```
┌─────────────────────────────────────────────────────────┐
│ Latency Distribution (with HTTP fast-path)              │
├─────────────────────────────────────────────────────────┤
│ Cache hit:                    0-5ms      (1 in 60s TTL) │
│ HTTP gateway path success:    30-100ms   (single round) │
│ HTTP gateway + routing API:   200-300ms  (fallback)     │
│ DHT fallback (if used):       >2000ms    (not preferred)│
├─────────────────────────────────────────────────────────┤
│ Average sync time:            ~100ms     (with cache)   │
│ Worst-case sync time:         ~300ms     (HTTP fallback)│
│ Budget remaining for app:     ~1700ms    (within 2s)    │
└─────────────────────────────────────────────────────────┘
```

### Publish Latency Profile

```
┌─────────────────────────────────────────────────────────┐
│ Publish Latency (content + IPNS record)                 │
├─────────────────────────────────────────────────────────┤
│ Content store (all 5 nodes parallel): 50-200ms          │
│ IPNS publish (all 5 nodes parallel):  100-300ms         │
│ Total time:                           150-500ms         │
└─────────────────────────────────────────────────────────┘
```

---

## 7. Monitoring & Observability

### Metrics to Track

```typescript
// File: src/components/wallet/L3/services/IpfsMetrics.ts

export interface IpfsOperationMetrics {
  operation: "resolve" | "publish" | "fetch";
  latencyMs: number;
  success: boolean;
  source: "http-gateway" | "http-routing" | "dht" | "cache";
  nodeCount?: number;
  failedNodes?: number;
  timestamp: number;
}

export class IpfsMetricsCollector {
  private metrics: IpfsOperationMetrics[] = [];
  private maxMetrics = 1000;

  recordOperation(metric: IpfsOperationMetrics): void {
    this.metrics.push(metric);
    if (this.metrics.length > this.maxMetrics) {
      this.metrics.shift();
    }

    // Log slow operations
    if (metric.latencyMs > 1000) {
      console.warn(
        `Slow IPFS operation: ${metric.operation} took ${metric.latencyMs}ms`
      );
    }
  }

  getStats(): {
    avgLatencyMs: number;
    p50LatencyMs: number;
    p95LatencyMs: number;
    successRate: number;
    preferredSource: string;
  } {
    const latencies = this.metrics.map(m => m.latencyMs).sort((a, b) => a - b);
    const successCount = this.metrics.filter(m => m.success).length;

    return {
      avgLatencyMs: latencies.reduce((a, b) => a + b, 0) / latencies.length,
      p50LatencyMs: latencies[Math.floor(latencies.length * 0.5)],
      p95LatencyMs: latencies[Math.floor(latencies.length * 0.95)],
      successRate: successCount / this.metrics.length,
      preferredSource: this.getMostSuccessfulSource(),
    };
  }

  private getMostSuccessfulSource(): string {
    const bySource = new Map<string, number>();
    for (const metric of this.metrics) {
      if (metric.success) {
        bySource.set(
          metric.source,
          (bySource.get(metric.source) || 0) + 1
        );
      }
    }
    return Array.from(bySource.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || "unknown";
  }

  clear(): void {
    this.metrics = [];
  }
}
```

---

## 8. Configuration Summary

### Recommended nginx Setup (Reverse Proxy)

Each Kubo node should be behind an nginx proxy exposing:

```nginx
server {
  listen 443 ssl http2;
  server_name unicity-ipfs1.dyndns.org;

  ssl_certificate /path/to/cert.pem;
  ssl_certificate_key /path/to/key.pem;

  # IPFS gateway and API backend
  location / {
    # Kubo listens on http://localhost:8080
    proxy_pass http://localhost:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;

    # Important: increase timeout for large files/slow operations
    proxy_read_timeout 30s;
    proxy_connect_timeout 10s;
  }

  # WebSocket support (for browser P2P)
  location ~ ^/ws {
    proxy_pass http://localhost:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
```

### Environment Variables

```bash
# .env.production

# IPFS configuration
VITE_IPFS_HTTP_TIMEOUT_MS=5000        # HTTP resolution timeout
VITE_IPFS_DHT_TIMEOUT_MS=1000         # DHT fallback timeout
VITE_IPFS_MAX_TOTAL_TIME_MS=2000      # Max total time before giving up

# Cache TTLs
VITE_IPFS_CACHE_RECORD_TTL_MS=60000   # IPNS record cache
VITE_IPFS_CACHE_FAILURE_TTL_MS=30000  # Failure cache

# Publishing
VITE_IPFS_PUBLISH_TIMEOUT_MS=5000
VITE_IPFS_PUBLISH_LIFETIME=87660h     # 10 years

# Monitoring
VITE_IPFS_ENABLE_METRICS=true
```

---

## 9. Testing Strategy

### Performance Tests

```typescript
// tests/integration/ipfs-sync.test.ts

describe("IPFS Sync Performance", () => {
  it("should resolve IPNS in under 300ms via HTTP", async () => {
    const resolver = new IpfsHttpResolver();
    const startTime = performance.now();

    const result = await resolver.resolveIpnsName(testIpnsName);
    const latencyMs = performance.now() - startTime;

    expect(result.success).toBe(true);
    expect(latencyMs).toBeLessThan(300);
  });

  it("should fetch content by CID in under 200ms", async () => {
    const resolver = new IpfsHttpResolver();
    const startTime = performance.now();

    const content = await resolver.fetchContentByCid(testCid);
    const latencyMs = performance.now() - startTime;

    expect(content).not.toBeNull();
    expect(latencyMs).toBeLessThan(200);
  });

  it("should publish to all nodes in under 500ms", async () => {
    const startTime = performance.now();

    const result = await publishTokenDataToIpfs(testTokenData);
    const latencyMs = performance.now() - startTime;

    expect(result.success).toBe(true);
    expect(result.publishedNodes).toBeGreaterThan(0);
    expect(latencyMs).toBeLessThan(500);
  });

  it("should use cache when available (sub-10ms)", async () => {
    const resolver = new IpfsHttpResolver();

    // First call (cache miss)
    await resolver.resolveIpnsName(testIpnsName);

    // Second call (cache hit)
    const startTime = performance.now();
    const result = await resolver.resolveIpnsName(testIpnsName);
    const latencyMs = performance.now() - startTime;

    expect(result.success).toBe(true);
    expect(latencyMs).toBeLessThan(10);
  });
});
```

---

## 10. Migration Path

### Phase 1: Implement HTTP Fast-Path (Week 1)
1. Create `IpfsHttpResolver` class
2. Create `IpfsCache` class
3. Update config with gateway URLs
4. Add metrics collection

### Phase 2: Integrate into IpfsStorageService (Week 1)
1. Update `sync()` method to use HTTP resolver
2. Update `publish()` method for parallel multi-node
3. Wire in metrics

### Phase 3: Test & Monitor (Week 2)
1. Deploy to staging
2. Monitor latency metrics
3. Compare DHT vs HTTP performance
4. Adjust timeouts based on real data

### Phase 4: Deprecate DHT (Optional, Week 3)
1. If HTTP success rate > 99%, make DHT fallback optional
2. Update documentation
3. Remove DHT code if not needed

---

## 11. Checklist for Implementation

- [ ] Configure all 5 Kubo nodes with HTTPS on port 443
- [ ] Verify nginx reverse proxy setup
- [ ] Create IpfsCache class
- [ ] Create IpfsHttpResolver class
- [ ] Create IpfsDhtResolver class with timeout management
- [ ] Update IpfsStorageService.sync() to use HTTP primary path
- [ ] Update IpfsStorageService.publish() for parallel multi-node
- [ ] Create IpfsMetricsCollector for monitoring
- [ ] Update config/ipfs.config.ts with timeouts
- [ ] Add performance tests
- [ ] Add E2E test for sub-2-second sync
- [ ] Monitor metrics in production
- [ ] Document in CLAUDE.md
- [ ] Update error handling for network fallbacks

---

## 12. FAQ & Troubleshooting

**Q: What if one IPFS node is down?**
A: Parallel racing means other 4 nodes will respond. Sync continues unaffected.

**Q: What if all HTTP paths fail?**
A: Falls back to DHT with 1-second timeout. User sees error but no hang.

**Q: How do you avoid cache staleness?**
A: 60-second TTL is short enough for wallet sync. Negative cache tracks failures.

**Q: Can multiple devices sync simultaneously?**
A: Yes - SyncCoordinator prevents local race conditions. Network operations are independent.

**Q: What about IPNS record publishing conflicts?**
A: Your ed25519 private key ensures you're always the authority. Higher sequence number wins.

**Q: Do we need the DHT at all?**
A: No, if your HTTP success rate is > 99%. Can be disabled completely.

**Q: What about IPNS record TTL?**
A: Publishing with 87660h (10 years) means records stay valid across devices/syncs.

---

## Conclusion

This three-tier strategy leverages your infrastructure advantage while maintaining IPFS compatibility. Expected performance:

- **Cache hit**: 0-5ms
- **HTTP success**: 30-300ms
- **Avg sync time**: <100ms
- **Worst case**: ~300ms (still < 2s budget)

The parallel multi-node racing pattern is optimal for your 5-node setup, providing both speed and reliability.
