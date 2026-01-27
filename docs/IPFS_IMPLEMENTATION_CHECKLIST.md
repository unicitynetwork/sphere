# IPFS Fast-Path Implementation Checklist

## Phase 1: Core Services (Week 1, Day 1-2)

### IpfsCache.ts
- [x] Create singleton cache with TTL management
- [x] Implement IPNS record cache (60s TTL)
- [x] Implement content cache (infinite TTL)
- [x] Implement failure tracking (30s backoff)
- [x] Add cache statistics for monitoring
- [x] Add clear methods (full and targeted)

**Files**: `src/components/wallet/L3/services/IpfsCache.ts`

### IpfsHttpResolver.ts
- [x] Create HTTP resolver with parallel multi-node support
- [x] Implement gateway path resolution (fast path)
- [x] Implement routing API fallback (reliable path)
- [x] Implement content fetch by CID
- [x] Add Promise.any racing logic
- [x] Integrate with cache layer
- [x] Add metrics recording hooks
- [x] Add timeout management

**Files**: `src/components/wallet/L3/services/IpfsHttpResolver.ts`

### IpfsPublisher.ts
- [x] Create publisher with parallel multi-node support
- [x] Implement content store on all nodes
- [x] Implement IPNS publish on all nodes
- [x] Add result aggregation (which nodes succeeded/failed)
- [x] Implement IPNS-only republish
- [x] Add configurable lifetime (default 87660h)
- [x] Add timeout management

**Files**: `src/components/wallet/L3/services/IpfsPublisher.ts`

### IpfsMetrics.ts
- [x] Create metrics collector singleton
- [x] Implement operation recording
- [x] Calculate percentiles (p50, p95, p99)
- [x] Track by source (http-gateway, http-routing, dht, cache)
- [x] Track by operation (resolve, publish, fetch)
- [x] Implement target status check (sub-2s)
- [x] Add slow operation detection
- [x] Export functionality for logging

**Files**: `src/components/wallet/L3/services/IpfsMetrics.ts`

---

## Phase 2: Integration into IpfsStorageService (Week 1, Day 3-4)

### Update sync() Method
- [ ] Import IpfsHttpResolver
- [ ] Replace DHT IPNS resolution with HTTP resolver
- [ ] Add metrics recording for resolve operation
- [ ] Implement cache-aware logic
- [ ] Add fallback handling
- [ ] Update return type if needed
- [ ] Keep error handling robust

**File**: `src/components/wallet/L3/services/IpfsStorageService.ts`

**Code snippet**:
```typescript
async sync(): Promise<StorageResult> {
  const resolver = getIpfsHttpResolver();
  const metrics = getIpfsMetrics();
  const startTime = performance.now();

  try {
    const result = await resolver.resolveIpnsName(this.ipnsName);
    metrics.recordOperation({
      operation: "resolve",
      source: result.source,
      latencyMs: result.latencyMs,
      success: result.success,
      timestamp: Date.now(),
      cacheHit: result.source === "cache",
    });

    if (!result.success) {
      return { success: false, timestamp: Date.now(), error: result.error };
    }

    // Fetch content if not included in result
    const content = result.content || await resolver.fetchContentByCid(result.cid);
    // ... rest of sync logic
  }
}
```

### Update publish() Method
- [ ] Import IpfsPublisher
- [ ] Replace DHT IPNS publish with HTTP publisher
- [ ] Add metrics recording for publish operation
- [ ] Track node success/failure counts
- [ ] Implement retry logic for partial failures
- [ ] Mark pending if any node fails

**File**: `src/components/wallet/L3/services/IpfsStorageService.ts`

**Code snippet**:
```typescript
async publishToIpfs(tokenData: TxfStorageData): Promise<StorageResult> {
  const publisher = getIpfsPublisher();
  const metrics = getIpfsMetrics();
  const startTime = performance.now();

  try {
    const result = await publisher.publishTokenData(tokenData);
    metrics.recordOperation({
      operation: "publish",
      source: result.publishedNodes > 0 ? "http-gateway" : "none",
      latencyMs: result.latencyMs,
      success: result.success,
      timestamp: Date.now(),
      nodeCount: result.totalNodes,
      failedNodes: result.failedNodes.length,
    });

    if (!result.success) {
      return { success: false, timestamp: Date.now(), ipnsPublishPending: true };
    }

    return { success: true, cid: result.cid, ipnsName: result.ipnsName };
  }
}
```

### Update Status Tracking
- [ ] Remove DHT-specific status fields
- [ ] Add HTTP resolver cache stats if needed
- [ ] Track metrics availability
- [ ] Update storage status response

### Add Shutdown/Cleanup
- [ ] Clear caches on logout/account switch
- [ ] Export metrics on app close (for analysis)
- [ ] Reset singleton instances if needed

---

## Phase 3: Configuration (Week 1, Day 5)

### Update ipfs.config.ts
- [ ] Add HTTP timeout configuration (default 5000ms)
- [ ] Add content fetch timeout (default 3000ms)
- [ ] Add publish timeout (default 5000ms)
- [ ] Add cache TTL settings (IPNS 60s, failure 30s)
- [ ] Verify gateway URLs point to HTTPS on port 443
- [ ] Add slow operation threshold (1000ms)

**File**: `src/config/ipfs.config.ts`

**What to add**:
```typescript
export const IPFS_HTTP_CONFIG = {
  resolutionTimeoutMs: 5000,      // Gateway path + routing API
  contentFetchTimeoutMs: 3000,     // Content fetch
  publishTimeoutMs: 5000,          // IPNS publish
  recordCacheTtlMs: 60000,         // IPNS record cache (1 minute)
  failureCacheTtlMs: 30000,        // Failure backoff
  slowOpThresholdMs: 1000,         // Log warning threshold
  enableMetrics: true,
};
```

### Environment Variables
- [ ] Add VITE_IPFS_HTTP_TIMEOUT_MS (default 5000)
- [ ] Add VITE_IPFS_ENABLE_METRICS (default true)
- [ ] Add VITE_IPFS_RECORD_CACHE_TTL_MS (default 60000)
- [ ] Update .env.example with new variables
- [ ] Document in CLAUDE.md

---

## Phase 4: Node Configuration (Week 1, End + Week 2, Start)

### On Each Kubo Node (5 nodes)
- [ ] Verify HTTP API on port 9080
- [ ] Verify Gateway on port 8080
- [ ] Verify WebSocket on port 4002
- [ ] Test HTTP endpoints: `curl https://unicity-ipfs1.dyndns.org/api/v0/id`
- [ ] Test gateway: `curl https://unicity-ipfs1.dyndns.org/ipfs/{cid}`

### Reverse Proxy (nginx)
- [ ] Configure HTTPS on port 443
- [ ] Proxy / to http://localhost:8080 (gateway)
- [ ] Proxy /api/ to http://localhost:9080 (API)
- [ ] Enable WebSocket upgrade
- [ ] Set appropriate timeouts (30s for large operations)
- [ ] Test: `curl -I https://unicity-ipfs1.dyndns.org/`

**Nginx config**:
```nginx
server {
  listen 443 ssl http2;
  server_name unicity-ipfs1.dyndns.org;

  ssl_certificate /path/to/cert.pem;
  ssl_certificate_key /path/to/key.pem;

  location / {
    proxy_pass http://localhost:8080;
    proxy_read_timeout 30s;
    proxy_connect_timeout 10s;
  }

  location ~ ^/ws {
    proxy_pass http://localhost:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
```

---

## Phase 5: Testing (Week 2)

### Unit Tests
- [ ] Create `tests/unit/services/IpfsCache.test.ts`
  - [ ] Test cache hit/miss
  - [ ] Test TTL expiration
  - [ ] Test failure tracking
- [ ] Create `tests/unit/services/IpfsHttpResolver.test.ts`
  - [ ] Test gateway path resolution
  - [ ] Test routing API fallback
  - [ ] Test content fetch
  - [ ] Test cache integration
  - [ ] Test parallel multi-node racing
- [ ] Create `tests/unit/services/IpfsPublisher.test.ts`
  - [ ] Test content storage
  - [ ] Test IPNS publishing
  - [ ] Test partial failures
- [ ] Create `tests/unit/services/IpfsMetrics.test.ts`
  - [ ] Test operation recording
  - [ ] Test percentile calculation
  - [ ] Test snapshot generation

### Integration Tests
- [ ] Create `tests/integration/ipfs-sync.test.ts`
  - [ ] Test full sync flow (resolve + fetch)
  - [ ] Test full publish flow (store + publish)
  - [ ] Test with cache hits
  - [ ] Test timeout behavior
  - [ ] Test fallback scenarios

**Sample test**:
```typescript
describe("IPFS Sync Performance", () => {
  it("should resolve IPNS in under 300ms via HTTP", async () => {
    const resolver = getIpfsHttpResolver();
    const startTime = performance.now();

    const result = await resolver.resolveIpnsName(testIpnsName);
    const latency = performance.now() - startTime;

    expect(result.success).toBe(true);
    expect(latency).toBeLessThan(300);
    expect(result.source).not.toBe("dht");
  });

  it("should use cache for second request", async () => {
    const resolver = getIpfsHttpResolver();

    // First call
    await resolver.resolveIpnsName(testIpnsName);

    // Second call (cache hit)
    const startTime = performance.now();
    const result = await resolver.resolveIpnsName(testIpnsName);
    const latency = performance.now() - startTime;

    expect(result.source).toBe("cache");
    expect(latency).toBeLessThan(10);
  });
});
```

### Performance Tests
- [ ] Test resolve latency p50, p95, p99
- [ ] Test publish latency p50, p95, p99
- [ ] Test with all nodes available
- [ ] Test with one node down
- [ ] Test with two nodes down
- [ ] Verify sub-2-second target

### E2E Tests
- [ ] Test wallet sync end-to-end
- [ ] Test with real IPFS data
- [ ] Test metrics collection
- [ ] Verify no DHT calls (monitor logs)

---

## Phase 6: Monitoring & Dashboard (Week 2)

### Metrics Dashboard Component
- [ ] Create component to display metrics
- [ ] Show p50, p95, p99 latencies
- [ ] Show success rate
- [ ] Show cache hit rate
- [ ] Show target status (sub-2s)
- [ ] Show operation breakdown
- [ ] Show slow operations list
- [ ] Add alerts for degraded performance

**Locations**:
- [ ] Add to wallet debug panel
- [ ] Add to admin dashboard
- [ ] Add to performance monitoring

### Metrics Export
- [ ] Implement periodic export (every 60s)
- [ ] Log to console for analysis
- [ ] Send to analytics service (if available)
- [ ] Store in IndexedDB for historical analysis

**Code**:
```typescript
function setupMetricsMonitoring() {
  setInterval(() => {
    const metrics = getIpfsMetrics();
    const snapshot = metrics.getSnapshot();
    const targetStatus = metrics.getTargetStatus();

    console.log("IPFS Metrics", {
      timestamp: new Date().toISOString(),
      p95Latency: snapshot.p95LatencyMs,
      successRate: snapshot.successRate,
      cacheHitRate: snapshot.cacheHitRate,
      targetMet: targetStatus.targetMet,
    });

    // Alert if target not met
    if (!targetStatus.targetMet) {
      console.warn(targetStatus.message);
    }
  }, 60000);
}
```

---

## Phase 7: Documentation (Week 2, Day 4-5)

### Update CLAUDE.md
- [ ] Add IPFS fast-path architecture overview
- [ ] Document new service classes
- [ ] Update sync flow diagram
- [ ] Add performance targets
- [ ] Document cache strategy
- [ ] Add troubleshooting section

### Create API Documentation
- [ ] Document IpfsHttpResolver API
- [ ] Document IpfsPublisher API
- [ ] Document IpfsMetrics API
- [ ] Include code examples
- [ ] Add error handling patterns

### Update README
- [ ] Add "Fast IPFS Sync" section
- [ ] Document performance improvements
- [ ] Link to full strategy document
- [ ] Add troubleshooting tips

---

## Phase 8: Staging Deployment (Week 2-3)

### Pre-Deployment
- [ ] Run full test suite
- [ ] Review code coverage
- [ ] Check for console warnings
- [ ] Verify metrics collection
- [ ] Test on multiple browsers
- [ ] Test on mobile (if applicable)

### Deploy to Staging
- [ ] Deploy code to staging environment
- [ ] Configure staging IPFS nodes
- [ ] Run performance tests
- [ ] Monitor metrics for 24-48 hours

### Staging Validation
- [ ] Verify sync completes in <500ms (avg)
- [ ] Verify cache hit rate >50%
- [ ] Verify success rate >99%
- [ ] Verify no DHT calls (check logs)
- [ ] Compare with main branch metrics

**Metrics to compare**:
| Metric | Main (DHT) | Staging (HTTP) | Target |
|--------|-----------|---------------|--------|
| Avg latency | 15,000ms | <500ms | <2000ms |
| P95 latency | 25,000ms | <300ms | <2000ms |
| Success rate | 95% | >99% | >99% |

---

## Phase 9: Production Deployment (Week 3)

### Pre-Production
- [ ] Get stakeholder approval
- [ ] Plan deployment schedule
- [ ] Prepare rollback plan
- [ ] Set up production monitoring alerts
- [ ] Brief support team

### Deploy to Production
- [ ] Deploy code in stages (canary/blue-green)
- [ ] Monitor metrics closely
- [ ] Watch error rates
- [ ] Verify sub-2-second sync
- [ ] Check user feedback

### Post-Deployment Monitoring (1 week)
- [ ] Monitor metrics daily
- [ ] Check for anomalies
- [ ] Compare with pre-deployment
- [ ] Verify no regressions
- [ ] Document improvements

### Success Criteria
- [ ] P95 latency < 2000ms (target achieved)
- [ ] Average latency < 500ms
- [ ] Success rate > 99%
- [ ] Cache hit rate > 50%
- [ ] Zero user-facing hangs
- [ ] No increase in error rates

---

## Phase 10: Final Steps (Week 3-4)

### Clean Up
- [ ] Remove any temporary/debug code
- [ ] Update all documentation
- [ ] Archive metrics from staging
- [ ] Close related tickets/issues

### Retrospective
- [ ] Document lessons learned
- [ ] Update CLAUDE.md with final implementation
- [ ] Create postmortem if any issues
- [ ] Plan next optimization phase

### Optional Enhancements (Later)
- [ ] IPNS archiving service (see config comment)
- [ ] HTTP caching headers optimization
- [ ] Circuit breaker pattern for failed nodes
- [ ] Distributed cache (across tabs)
- [ ] Metrics visualization dashboard

---

## Quick Reference: Files to Create/Modify

### New Files (Services)
```
src/components/wallet/L3/services/
  ├── IpfsCache.ts                 (NEW - cache layer)
  ├── IpfsHttpResolver.ts          (NEW - HTTP resolution)
  ├── IpfsPublisher.ts             (NEW - multi-node publish)
  └── IpfsMetrics.ts               (NEW - performance tracking)
```

### Modified Files
```
src/components/wallet/L3/services/
  └── IpfsStorageService.ts        (MODIFY - use HTTP resolver)

src/config/
  └── ipfs.config.ts              (MODIFY - add HTTP timeouts)

tests/
  ├── unit/services/               (NEW - unit tests)
  └── integration/                 (NEW - integration tests)

docs/
  ├── IPFS_SYNC_STRATEGY.md        (NEW - full strategy)
  ├── IPFS_INTEGRATION_GUIDE.md    (NEW - integration guide)
  └── IPFS_FAST_SYNC_SUMMARY.md    (NEW - executive summary)
```

### Documentation Updates
```
CLAUDE.md                           (UPDATE - add IPFS fast-path)
README.md                           (UPDATE - performance section)
.env.example                        (UPDATE - new env vars)
```

---

## Estimated Effort

| Phase | Duration | Dev Days | Notes |
|-------|----------|----------|-------|
| 1 | Day 1-2 | 1.5 | Services implementation |
| 2 | Day 3-4 | 1.5 | IpfsStorageService integration |
| 3 | Day 5 | 0.5 | Configuration updates |
| 4 | Day 5-6 | 1 | Node setup + verification |
| 5 | Day 7-10 | 2 | Testing + bug fixes |
| 6 | Day 10-11 | 1 | Monitoring dashboard |
| 7 | Day 11-12 | 0.5 | Documentation |
| 8 | Day 13-14 | 1 | Staging deployment + validation |
| 9 | Day 15+ | 0.5 | Production deployment |
| 10 | Ongoing | Minimal | Maintenance + optimization |

**Total**: ~10 development days (~2 weeks with testing/validation)

---

## Success Checklist

Final validation before declaring complete:

- [ ] All unit tests passing
- [ ] All integration tests passing
- [ ] Performance tests show <500ms avg sync
- [ ] Metrics dashboard shows target achievement
- [ ] Production metrics > 99% success rate
- [ ] Cache hit rate > 50% after 1 week
- [ ] Zero user complaints about sync speed
- [ ] Documentation complete and accurate
- [ ] Team trained on new architecture
- [ ] Monitoring alerts configured

---

**Status**: Ready for Implementation
**Difficulty**: Medium (straightforward HTTP calls, good architecture exists)
**Risk**: Low (HTTP fast-path, DHT fallback always available)
**Impact**: Very High (30-100x performance improvement)
