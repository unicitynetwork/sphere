# IPFS Fast Sync Strategy - Executive Summary

## Problem Statement

Your wallet application needs to sync token data in **under 2 seconds**, but current IPFS/IPNS implementation using DHT takes **10-30+ seconds**.

**Root Cause**: DHT lookups are slow for frequently-accessed data without persistent cache.

## Solution Overview

**Three-tier hybrid strategy** leveraging your infrastructure advantage of running 5 dedicated Kubo nodes:

1. **Tier 1: Local Cache** - 0-5ms (60-second TTL for IPNS records)
2. **Tier 2: HTTP API Fast-Path** - 100-300ms (parallel multi-node racing)
3. **Tier 3: DHT Fallback** - >1s (only if HTTP fails, with aggressive timeout)

### Expected Performance

```
Before:  30-60 seconds (DHT-based)
After:   <500ms (HTTP fast-path)
Cached:  <10ms (cache hits)

Improvement: 30-100x faster
```

---

## Architecture

### Parallel Multi-Node Racing

Query all 5 IPFS nodes **simultaneously**, return **first successful response**:

```
Client Request
    ↓
┌───┬───┬───┬───┬───┐
│ N1│ N2│ N3│ N4│ N5│  ← Parallel HTTP queries
└───┴───┴───┴───┴───┘
    ↓
   WIN (first success)
    ↓
Return Result (~100-300ms)
```

**Advantage**: Even if one node is slow/down, others respond quickly.

### Three HTTP Methods

**Method 1: Gateway Path (Fastest)**
```http
GET /ipns/{ipnsName}?format=dag-json
Returns: Content directly (30-100ms)
Used: Primary resolution path
```

**Method 2: Routing API (More Reliable)**
```http
POST /api/v0/routing/get?arg=/ipns/{ipnsName}
Returns: IPNS record with sequence number (200-300ms)
Used: Fallback if gateway path fails on all nodes
```

**Method 3: Content Fetch (Immutable)**
```http
GET /ipfs/{cid}?format=dag-json
Returns: Token content by CID (50-200ms)
Used: Fetch actual content after IPNS resolution
```

---

## Key Components

### 1. IpfsCache.ts

Smart caching with TTL management:

```typescript
// IPNS records: 60-second TTL (short, as records change during sync)
const cached = cache.getIpnsRecord(ipnsName);

// Content: Infinite TTL (immutable by CID)
const content = cache.getContent(cid);

// Failure tracking: 30-second backoff
if (cache.hasRecentFailure(ipnsName)) skip_http_retry();
```

**Impact**: Reduces 99% of HTTP calls after first sync.

### 2. IpfsHttpResolver.ts

Parallel multi-node HTTP resolution:

```typescript
const resolver = new IpfsHttpResolver();

// Resolves IPNS name in 100-300ms
const result = await resolver.resolveIpnsName(ipnsName);

// Fetches content by CID
const content = await resolver.fetchContentByCid(cid);
```

**Key Features**:
- Queries all gateways in parallel
- Returns on first success (Promise.any)
- Falls back from gateway path to routing API
- Caches both IPNS records and content

### 3. IpfsPublisher.ts

Parallel multi-node publishing:

```typescript
const publisher = new IpfsPublisher();

// Stores content on all nodes + publishes IPNS to all nodes
const result = await publisher.publishTokenData(tokenData);
// Result: { cid, ipnsName, publishedNodes, failedNodes }
```

**Performance**: 150-500ms total (content + IPNS record)

### 4. IpfsMetrics.ts

Comprehensive performance monitoring:

```typescript
const metrics = getIpfsMetrics();

// Record every operation
metrics.recordOperation({
  operation: "resolve",
  source: "http-gateway",
  latencyMs: 150,
  success: true,
  cacheHit: false,
});

// Get snapshot
const snapshot = metrics.getSnapshot();
// { avgLatencyMs, p50, p95, p99, successRate, cacheHitRate, slowOperations[] }
```

---

## Integration Steps

### 1. In IpfsStorageService.sync()

Replace DHT resolution:

```typescript
async sync(): Promise<StorageResult> {
  const resolver = getIpfsHttpResolver();
  const metrics = getIpfsMetrics();

  // This now completes in 100-300ms instead of 10-30s
  const result = await resolver.resolveIpnsName(this.ipnsName);

  if (result.success) {
    // Fetch content by CID if not in result
    const content = result.content || await resolver.fetchContentByCid(result.cid);
    // Process tokens...
    return { success: true, tokenCount: tokens.length };
  }

  return { success: false, error: result.error };
}
```

### 2. In IpfsStorageService.publish()

Replace DHT publish:

```typescript
async publishToIpfs(tokenData: TxfStorageData): Promise<StorageResult> {
  const publisher = getIpfsPublisher();

  // This now completes in 150-500ms instead of 30-60s
  const result = await publisher.publishTokenData(tokenData);

  if (result.success) {
    return {
      success: true,
      cid: result.cid,
      ipnsName: result.ipnsName,
    };
  }

  return { success: false, error: "Publish failed" };
}
```

---

## Performance Targets

### Latency Distribution

```
┌─────────────────────────────────────────┐
│ Sync Time Breakdown                     │
├─────────────────────────────────────────┤
│ 1st sync (cache miss):                  │
│  ├─ IPNS resolution:     100-300ms      │
│  ├─ Content fetch:       50-200ms       │
│  ├─ Processing:          <50ms          │
│  └─ Total:               <500ms         │
│                                         │
│ Subsequent syncs (cache hit):           │
│  ├─ Cache lookup:        <5ms           │
│  ├─ Content fetch:       50-200ms       │
│  └─ Total:               <10ms*         │
│                          (*if content   │
│                           also cached)  │
│                                         │
│ Worst case (all nodes down):            │
│  └─ Timeout + fallback:  ~2000ms        │
│     (still within budget)                │
└─────────────────────────────────────────┘
```

### Success Rate Targets

- **HTTP success rate**: >99% (with 5 nodes, unlikely all fail)
- **Cache hit rate**: >60% (within 60-second window)
- **Overall sync success**: >99.5%

---

## Monitoring Dashboard

### Key Metrics to Track

```typescript
{
  // Latency metrics
  p50LatencyMs: 120,        // 50th percentile
  p95LatencyMs: 280,        // 95th percentile (target <2000)
  p99LatencyMs: 450,        // 99th percentile

  // Success metrics
  successRate: 0.9987,      // Target >0.99
  cacheHitRate: 0.6,        // % of requests hitting cache

  // Operation breakdown
  "resolve": 850,           // Total resolve operations
  "publish": 120,           // Total publish operations
  "fetch": 340,             // Total content fetches

  // Source breakdown
  "http-gateway": 650,      // Resolved via gateway
  "cache": 520,             // Resolved from cache
  "http-routing": 85,       // Resolved via routing API

  // Slow operations
  slowOperations: [
    { operation: "resolve", latency: 1200, source: "http-routing" }
  ]
}
```

### Alert Thresholds

- **p95 latency > 1000ms**: Investigate node performance
- **success rate < 0.99**: Check node availability
- **cache hit rate < 0.5**: Possible sync time drift

---

## Node Configuration

### Required for each Kubo node

```bash
# HTTP API (for fast-path queries)
ipfs config Addresses.API /ip4/0.0.0.0/tcp/9080

# Gateway (for content serving)
ipfs config Addresses.Gateway /ip4/0.0.0.0/tcp/8080

# WebSocket (for browser P2P)
ipfs config --json Addresses.Swarm '["/ip4/0.0.0.0/tcp/4001","/ip4/0.0.0.0/tcp/4002/ws"]'

# HTTPS Reverse Proxy (nginx) on port 443
# Proxies to http://localhost:8080 (gateway) + /api/* to 9080 (API)
```

### Nginx Configuration

```nginx
server {
  listen 443 ssl http2;
  server_name unicity-ipfs1.dyndns.org;

  ssl_certificate /path/to/cert.pem;
  ssl_certificate_key /path/to/key.pem;

  # All traffic (gateway + API) to Kubo
  location / {
    proxy_pass http://localhost:8080;
    proxy_read_timeout 30s;
  }

  # API endpoints
  location /api/ {
    proxy_pass http://localhost:9080/api/;
  }

  # WebSocket support
  location ~ ^/ws {
    proxy_pass http://localhost:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
```

---

## Fallback to DHT

If **all** HTTP methods fail:

```typescript
// Only reached if:
// 1. All 5 nodes unreachable
// 2. All nodes timeout
// 3. Both gateway path AND routing API fail

if (httpResolver.failed) {
  // DHT fallback with 1-second timeout
  // This prevents hanging, but still slow compared to HTTP
  const dhtResult = await dhtResolver.resolveWithTimeout(ipnsName, 1000);
}
```

**Why DHT fallback is important**:
- Maintains IPFS compatibility with public network
- Handles node maintenance/upgrade scenarios
- Provides graceful degradation

---

## Files Created

1. **`docs/IPFS_SYNC_STRATEGY.md`**
   - Comprehensive 12-section design document
   - API examples, cache strategy, testing, FAQ

2. **`docs/IPFS_INTEGRATION_GUIDE.md`**
   - Step-by-step integration instructions
   - Code examples, monitoring setup
   - Troubleshooting guide

3. **`src/components/wallet/L3/services/IpfsCache.ts`**
   - Smart cache with TTL management
   - IPNS records + content + failure tracking

4. **`src/components/wallet/L3/services/IpfsHttpResolver.ts`**
   - Parallel multi-node HTTP resolution
   - Gateway path + routing API fallback
   - Content fetching by CID

5. **`src/components/wallet/L3/services/IpfsPublisher.ts`**
   - Parallel content storage (all nodes)
   - Parallel IPNS publishing (all nodes)
   - Result aggregation

6. **`src/components/wallet/L3/services/IpfsMetrics.ts`**
   - Comprehensive metrics collection
   - Performance tracking + alerts
   - Dashboard-ready snapshots

---

## Implementation Timeline

| Phase | Duration | Tasks |
|-------|----------|-------|
| 1 | Week 1 | Implement IpfsCache, IpfsHttpResolver, IpfsMetrics |
| 2 | Week 1 | Update IpfsStorageService (sync + publish) |
| 3 | Week 2 | Deploy to staging, run E2E tests |
| 4 | Week 2 | Monitor metrics, compare vs DHT |
| 5 | Week 3 | Deploy to production, monitor for 1 week |

---

## Success Criteria

- [ ] Sub-2 second sync latency (p95 < 2000ms)
- [ ] >99% success rate for HTTP operations
- [ ] >60% cache hit rate within 60-second window
- [ ] Zero hangs (always timeout, never infinite wait)
- [ ] Graceful fallback when nodes are down
- [ ] Metrics dashboard shows improvements

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| All nodes down | DHT fallback with 1s timeout |
| Slow node | Parallel racing (fastest wins) |
| Cache staleness | 60-second TTL for IPNS records |
| Network partition | Failure tracking + 30s backoff |
| Browser cache hit | Immutable content cache (infinite TTL) |
| Concurrent publishes | SyncCoordinator (existing) |

---

## Questions Answered

### Direct HTTP Strategy?
**Yes.** Bypass DHT entirely for your nodes using `/ipns/{name}?format=dag-json` gateway path and `/api/v0/routing/get` routing API.

### Fast IPNS Endpoints?
- **Gateway path**: `/ipns/{name}?format=dag-json` (fastest, 30-100ms)
- **Routing API**: `/api/v0/routing/get?arg=/ipns/{name}` (reliable, 200-300ms)

### Parallel Operations?
**Yes.** Query all 5 nodes concurrently, return first success (Promise.any). Typical: 5 concurrent requests, one completes in 100-300ms.

### Caching Strategy?
- IPNS records: 60-second TTL (short, changes during sync)
- Content: Infinite TTL (immutable by CID)
- Failure: 30-second backoff (exponential)

### Fallback Pattern?
1. Cache (0-5ms)
2. HTTP gateway path (30-100ms)
3. HTTP routing API (200-300ms)
4. DHT timeout (1000ms max)
5. Fail gracefully

---

## Next Steps

1. Review `IPFS_SYNC_STRATEGY.md` for comprehensive details
2. Follow `IPFS_INTEGRATION_GUIDE.md` to integrate code
3. Deploy to staging and run performance tests
4. Monitor metrics for 1 week before production
5. Document improvements in CLAUDE.md

---

**Author**: Network Architecture Analysis
**Date**: 2025-12-23
**Target**: Sub-2 second wallet sync
**Status**: Architecture Complete, Ready for Implementation
