# IPFS Fast-Path Integration Guide

This guide explains how to integrate the new fast HTTP IPFS resolver into your existing `IpfsStorageService`.

## Quick Start

### 1. Import the new services

```typescript
import { getIpfsHttpResolver } from "../services/IpfsHttpResolver";
import { getIpfsPublisher } from "../services/IpfsPublisher";
import { getIpfsMetrics } from "../services/IpfsMetrics";
```

### 2. Update the sync method

Replace DHT-based resolution with HTTP fast-path:

```typescript
// In IpfsStorageService.ts

async sync(): Promise<StorageResult> {
  const startTime = performance.now();
  const metrics = getIpfsMetrics();

  try {
    const resolver = getIpfsHttpResolver();

    // Step 1: Resolve IPNS name via HTTP (100-300ms)
    const resolveResult = await resolver.resolveIpnsName(this.ipnsName);

    metrics.recordOperation({
      operation: "resolve",
      source: resolveResult.source,
      latencyMs: resolveResult.latencyMs,
      success: resolveResult.success,
      timestamp: Date.now(),
      cacheHit: resolveResult.source === "cache",
    });

    if (!resolveResult.success) {
      return {
        success: false,
        timestamp: Date.now(),
        error: resolveResult.error || "IPNS resolution failed",
      };
    }

    // Step 2: Fetch content by CID (50-200ms)
    let content = resolveResult.content;

    if (!content && resolveResult.cid) {
      const fetchStart = performance.now();
      content = await resolver.fetchContentByCid(resolveResult.cid);
      const fetchLatency = performance.now() - fetchStart;

      metrics.recordOperation({
        operation: "fetch",
        source: "http-gateway",
        latencyMs: fetchLatency,
        success: content !== null,
        timestamp: Date.now(),
      });
    }

    if (!content) {
      return {
        success: false,
        timestamp: Date.now(),
        error: "Failed to fetch content by CID",
      };
    }

    // Step 3: Process and validate
    const tokens = parseTxfStorageData(content);

    // ... rest of your sync logic ...

    const totalLatency = performance.now() - startTime;

    return {
      success: true,
      cid: resolveResult.cid,
      ipnsName: this.ipnsName,
      tokenCount: tokens.length,
      timestamp: Date.now(),
      version: content.version,
    };
  } catch (error) {
    metrics.recordOperation({
      operation: "resolve",
      source: "none",
      latencyMs: performance.now() - startTime,
      success: false,
      timestamp: Date.now(),
      error: error instanceof Error ? error.message : "Unknown error",
    });

    return {
      success: false,
      timestamp: Date.now(),
      error: error instanceof Error ? error.message : "Sync failed",
    };
  }
}
```

### 3. Update the publish method

Replace DHT publish with parallel multi-node HTTP publish:

```typescript
// In IpfsStorageService.ts

async publishToIpfs(tokenData: TxfStorageData): Promise<StorageResult> {
  const startTime = performance.now();
  const metrics = getIpfsMetrics();

  try {
    const publisher = getIpfsPublisher();

    // Publish to all nodes in parallel (150-500ms)
    const publishResult = await publisher.publishTokenData(tokenData, {
      lifetime: "87660h", // 10 years
      timeoutMs: 5000,
    });

    metrics.recordOperation({
      operation: "publish",
      source: publishResult.publishedNodes > 0 ? "http-gateway" : "none",
      latencyMs: publishResult.latencyMs,
      success: publishResult.success,
      timestamp: Date.now(),
      nodeCount: publishResult.totalNodes,
      failedNodes: publishResult.failedNodes.length,
    });

    if (!publishResult.success) {
      return {
        success: false,
        timestamp: Date.now(),
        error: `IPNS publish failed (${publishResult.failedNodes.length}/${publishResult.totalNodes} nodes failed)`,
        ipnsPublishPending: true, // Mark for retry
      };
    }

    // Success - update local version tracking
    const latency = performance.now() - startTime;

    return {
      success: true,
      cid: publishResult.cid,
      ipnsName: publishResult.ipnsName,
      timestamp: Date.now(),
      ipnsPublished: true,
      // Log node performance for monitoring
      validationIssues: publishResult.failedNodes.length > 0
        ? [`${publishResult.failedNodes.length} nodes failed to publish`]
        : [],
    };
  } catch (error) {
    metrics.recordOperation({
      operation: "publish",
      source: "none",
      latencyMs: performance.now() - startTime,
      success: false,
      timestamp: Date.now(),
      error: error instanceof Error ? error.message : "Publish failed",
    });

    return {
      success: false,
      timestamp: Date.now(),
      error: error instanceof Error ? error.message : "Publish failed",
      ipnsPublishPending: true,
    };
  }
}
```

## Metrics Monitoring

### Display sync performance

```typescript
// In your dashboard/monitoring component

import { getIpfsMetrics } from "../services/IpfsMetrics";

function IpfsPerformanceDisplay() {
  const metrics = getIpfsMetrics();
  const snapshot = metrics.getSnapshot();
  const targetStatus = metrics.getTargetStatus();

  return (
    <div>
      <h3>IPFS Sync Performance</h3>
      <p>Target: Sub-2 second sync</p>
      <p className={targetStatus.targetMet ? "success" : "warning"}>
        {targetStatus.message}
      </p>

      <div className="metrics-grid">
        <Metric label="Avg Latency" value={`${snapshot.avgLatencyMs.toFixed(0)}ms`} />
        <Metric label="P95 Latency" value={`${snapshot.p95LatencyMs.toFixed(0)}ms`} />
        <Metric label="P99 Latency" value={`${snapshot.p99LatencyMs.toFixed(0)}ms`} />
        <Metric
          label="Success Rate"
          value={`${(snapshot.successRate * 100).toFixed(1)}%`}
        />
        <Metric
          label="Cache Hit Rate"
          value={`${(snapshot.cacheHitRate * 100).toFixed(1)}%`}
        />
      </div>

      {snapshot.slowOperations.length > 0 && (
        <div className="slow-operations">
          <h4>Recent Slow Operations (&gt;1s)</h4>
          <ul>
            {snapshot.slowOperations.map((op, i) => (
              <li key={i}>
                {op.operation} via {op.source}: {op.latencyMs.toFixed(0)}ms
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

### Export metrics for analysis

```typescript
// Log metrics periodically for analysis

function setupMetricsExport() {
  setInterval(() => {
    const metrics = getIpfsMetrics();
    const exported = metrics.export();

    // Send to analytics or logging service
    console.log("IPFS Metrics Export:", {
      timestamp: new Date().toISOString(),
      snapshot: exported.snapshot,
      // Optionally sample raw metrics (every 10th operation)
      sampleMetrics: exported.rawMetrics.filter((_, i) => i % 10 === 0),
    });
  }, 60000); // Every minute
}
```

## Fallback to DHT

If HTTP methods fail, you can optionally fallback to DHT (though not recommended):

```typescript
// Create a wrapper that tries HTTP first, then DHT

async function resolveIpnsWithFallback(
  ipnsName: string
): Promise<IpnsResolutionResult> {
  const resolver = getIpfsHttpResolver();
  const metrics = getIpfsMetrics();

  // Try HTTP first (should complete in 100-300ms)
  const httpResult = await resolver.resolveIpnsName(ipnsName);

  if (httpResult.success) {
    return httpResult;
  }

  // Fallback to DHT only if HTTP fails completely
  console.warn(
    `HTTP resolution failed for ${ipnsName}, falling back to DHT`
  );

  try {
    // Your existing Helia DHT resolution with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1000);

    const dhtResult = await helia.ipns?.resolve(ipnsName, {
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    metrics.recordOperation({
      operation: "resolve",
      source: "dht",
      latencyMs: 1000, // Approximate
      success: true,
      timestamp: Date.now(),
    });

    return {
      success: true,
      cid: String(dhtResult),
      content: null,
      source: "dht",
      latencyMs: 1000,
    };
  } catch (error) {
    metrics.recordOperation({
      operation: "resolve",
      source: "dht",
      latencyMs: 1000,
      success: false,
      timestamp: Date.now(),
      error: "DHT timeout",
    });

    return {
      success: false,
      error: "Both HTTP and DHT resolution failed",
      source: "dht",
      latencyMs: 1000,
    };
  }
}
```

## Configuration

### Update environment variables

```env
# .env.production

# IPFS HTTP timeouts
VITE_IPFS_HTTP_TIMEOUT_MS=5000        # Gateway path + routing API
VITE_IPFS_CONTENT_TIMEOUT_MS=3000     # Content fetch
VITE_IPFS_PUBLISH_TIMEOUT_MS=5000     # IPNS publish

# Cache configuration
VITE_IPFS_RECORD_CACHE_TTL_MS=60000   # IPNS record cache (1 minute)
VITE_IPFS_FAILURE_CACHE_TTL_MS=30000  # Failure backoff (30 seconds)

# Monitoring
VITE_IPFS_ENABLE_METRICS=true
VITE_IPFS_SLOW_OP_THRESHOLD_MS=1000   # Log warnings for ops > 1s
```

### Kubo node configuration

Ensure each Kubo node has:

```bash
# Enable HTTP API on port 9080
docker exec ipfs-kubo ipfs config Addresses.API /ip4/0.0.0.0/tcp/9080

# Enable Gateway on port 8080
docker exec ipfs-kubo ipfs config Addresses.Gateway /ip4/0.0.0.0/tcp/8080

# Enable WebSocket for browser P2P
docker exec ipfs-kubo ipfs config --json Addresses.Swarm '["/ip4/0.0.0.0/tcp/4001","/ip4/0.0.0.0/tcp/4002/ws"]'

# Restart
docker restart ipfs-kubo
```

## Testing

### Performance test

```typescript
import { describe, it, expect } from "vitest";
import { getIpfsHttpResolver } from "../services/IpfsHttpResolver";
import { getIpfsPublisher } from "../services/IpfsPublisher";

describe("IPFS Fast-Path Performance", () => {
  it("should resolve IPNS in under 300ms", async () => {
    const resolver = getIpfsHttpResolver();
    const startTime = performance.now();

    const result = await resolver.resolveIpnsName(testIpnsName);
    const latency = performance.now() - startTime;

    expect(result.success).toBe(true);
    expect(latency).toBeLessThan(300);
  });

  it("should fetch content in under 200ms", async () => {
    const resolver = getIpfsHttpResolver();
    const startTime = performance.now();

    const content = await resolver.fetchContentByCid(testCid);
    const latency = performance.now() - startTime;

    expect(content).not.toBeNull();
    expect(latency).toBeLessThan(200);
  });

  it("should publish in under 500ms", async () => {
    const publisher = getIpfsPublisher();
    const startTime = performance.now();

    const result = await publisher.publishTokenData(testTokenData);
    const latency = performance.now() - startTime;

    expect(result.success).toBe(true);
    expect(latency).toBeLessThan(500);
  });

  it("should use cache for second request", async () => {
    const resolver = getIpfsHttpResolver();

    // First request
    await resolver.resolveIpnsName(testIpnsName);

    // Second request (should hit cache)
    const startTime = performance.now();
    const result = await resolver.resolveIpnsName(testIpnsName);
    const latency = performance.now() - startTime;

    expect(result.success).toBe(true);
    expect(result.source).toBe("cache");
    expect(latency).toBeLessThan(10);
  });
});
```

## Troubleshooting

### Slow IPNS resolution

Check the metrics:

```typescript
const metrics = getIpfsMetrics();
const resolveMetrics = metrics.getOperationMetrics("resolve");

console.log("IPNS Resolution:", {
  count: resolveMetrics.count,
  avgLatency: resolveMetrics.avgLatencyMs,
  successRate: resolveMetrics.successRate,
  preferredSource: resolveMetrics.preferredSource,
});
```

If `http-gateway` is slow, check:
1. Gateway node is responsive: `curl https://unicity-ipfs1.dyndns.org/ipfs/{cid}`
2. DNS resolution time: `dig unicity-ipfs1.dyndns.org`
3. Network latency: `mtr unicity-ipfs1.dyndns.org`

### High failure rate

If `successRate < 0.95`, check:
1. All 5 nodes are running: `curl https://unicity-ipfs{1-5}.dyndns.org/api/v0/id`
2. IPNS records exist: `ipfs name resolve /ipns/{name}` (on a Kubo node)
3. Content is stored: `ipfs cat {cid}` (on a Kubo node)

### Cache not helping

If `cacheHitRate` is low:
1. Check TTL configuration (should be 60 seconds for IPNS records)
2. Verify sync is happening within TTL window
3. Look at time between consecutive resolves

## Migration Checklist

- [ ] Create IpfsCache class
- [ ] Create IpfsHttpResolver class
- [ ] Create IpfsPublisher class
- [ ] Create IpfsMetrics class
- [ ] Update IpfsStorageService.sync() method
- [ ] Update IpfsStorageService.publish() method
- [ ] Add metrics monitoring to dashboard
- [ ] Test with real IPFS network (staging)
- [ ] Monitor metrics in production for 1 week
- [ ] Document performance improvements
- [ ] Update CLAUDE.md with new architecture

## Performance Expectations

After integration:

| Operation | Before (DHT) | After (HTTP) | Improvement |
|-----------|------------|--------------|-------------|
| IPNS Resolution | 10-30s | 100-300ms | 30-100x faster |
| Content Fetch | 10-30s | 50-200ms | 50-100x faster |
| IPNS Publish | 30-60s | 150-500ms | 60-100x faster |
| **Total Sync** | **30-60s** | **<500ms** | **60-100x faster** |

Cache hits (1 per minute):
| Operation | Latency |
|-----------|---------|
| IPNS Resolution (cached) | <5ms |
| Content Fetch (cached) | <5ms |
| **Total Sync (cached)** | **<10ms** |

---

## Next Steps

1. Deploy code to staging
2. Run E2E performance tests
3. Monitor metrics for 1 week
4. Compare against DHT-based implementation
5. Deploy to production if metrics target achieved
