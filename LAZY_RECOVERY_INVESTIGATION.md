# Lazy Recovery Mode Investigation

## Executive Summary

This document investigates how to implement a "lazy recovery" mode for token inventory sync that bypasses IPFS cache to recover tokens lost due to cache corruption at the IPFS node side.

**Goal:** Run a background recovery task after app startup that queries IPFS directly (bypassing sidecar cache) to recover lost tokens without degrading main sync performance.

---

## 1. Current IPFS Resolution Flow

### 1.1 Resolution Architecture

**Location:** `/home/vrogojin/sphere/src/components/wallet/L3/services/IpfsHttpResolver.ts`

The IPFS resolution uses a **two-tier caching system**:

1. **Client-side cache** (`IpfsCache`) - In-memory cache in browser
   - IPNS records cached for TTL (default: 60s)
   - Content CIDs cached indefinitely (immutable)
   - Location: `IpfsCache.ts` (line 16)

2. **Sidecar cache** (MongoDB at IPFS node side)
   - Backend cache at `/home/vrogojin/ipfs-storage/nostr-pinner/nostr_pinner.py`
   - Stores IPNS records with timestamps
   - Response header: `X-IPNS-Source: sidecar-cache` (served from cache)
   - Response header: `X-IPNS-Source: kubo` (served from DHT/Kubo)
   - Staleness threshold: 60 seconds (STALE_THRESHOLD_SECONDS)

### 1.2 Resolution Methods

**Method 1: HTTP Gateway Path** (Fast, ~30-100ms)
```
GET https://unicity-ipfs1.dyndns.org/ipns/{name}?format=dag-json
```
- Returns content directly
- May use nginx cache (7d for /ipfs/, shorter for /ipns/)
- **Problem:** Does not support cache bypass headers

**Method 2: Routing API** (Authoritative, ~200-300ms with cache, ~5-10s DHT)
```
POST https://unicity-ipfs1.dyndns.org/api/v0/routing/get?arg=/ipns/{name}
```
- Returns IPNS record with sequence number
- Uses sidecar cache (5-20ms) with Kubo DHT fallback (1-5s)
- **Key insight:** This is where cache bypass would be implemented

### 1.3 `resolveIpnsProgressively()` Flow

**File:** `IpfsStorageService.ts:1831-1890`

```
1. Check client-side cache (IpfsHttpResolver.cache)
   ├─ Cache hit → return immediately (0ms)
   └─ Cache miss → continue

2. Query all nodes via IpfsHttpResolver.resolveIpnsName()
   ├─ Uses routing API: /api/v0/routing/get
   ├─ Response includes X-IPNS-Source header
   └─ Returns: { cid, sequence, source: 'cache' | 'dht' }

3. Fetch content by CID in parallel
   └─ Returns first successful response

4. Update caches and return
```

**Cache Bypass Mechanisms:**
- Client-side: `httpResolver.invalidateIpnsCache()` - clears client cache
- Sidecar: **NO DIRECT BYPASS AVAILABLE** (see Section 4)

---

## 2. InventorySyncService Modes

### 2.1 Current Sync Modes

**File:** `/home/vrogojin/sphere/src/components/wallet/L3/types/SyncTypes.ts:34`

```typescript
export type SyncMode = 'LOCAL' | 'RECOVERY' | 'NAMETAG' | 'FAST' | 'NORMAL';
```

**Mode Precedence** (Section 6.1 of TOKEN_INVENTORY_SPEC.md):
```
1. LOCAL     - Skip IPFS entirely (local-only)
2. RECOVERY  - Traverse version chain via _meta.lastCid
3. NAMETAG   - Fetch nametag tokens only (read-only)
4. FAST      - Skip Step 7 spent detection (for speed)
5. NORMAL    - Full sync with all validation
```

### 2.2 RECOVERY Mode Details

**File:** `InventorySyncService.ts:1194-1395`

**Purpose:** Traverse IPFS version chain backwards to recover tokens from historical versions.

**Activation:**
- Explicit: Pass `recoveryDepth` parameter to `inventorySync()`
  - `recoveryDepth: 0` = unlimited traversal
  - `recoveryDepth: 10` = max 10 versions
- Auto-trigger: When `tokens.size === 0` AND `remoteLastCid !== null` (line 489-508)

**Version Chain Traversal:**
```
IPNS → CID_v2 (current, possibly empty)
         ↓ _meta.lastCid
       CID_v68 (previous version)
         ↓ _meta.lastCid
       CID_v67
         ↓ ...
```

**Implementation:**
```typescript
async function step2_5_traverseVersionChain(ctx: SyncContext): Promise<void> {
  let currentCid = remoteData._meta.lastCid;
  const depthLimit = ctx.recoveryDepth === 0 ? Infinity : ctx.recoveryDepth;

  while (ctx.recoveryStats.versionsTraversed < depthLimit) {
    // Cycle detection
    if (ctx.processedCids.has(currentCid)) break;

    // Fetch historical version
    historicalData = await resolver.fetchContentByCid(currentCid);

    // Merge tokens from history
    for (const [key, token] of Object.entries(historicalData)) {
      if (isTokenKey(key)) {
        // Add if not already present
      }
    }

    // Follow chain
    currentCid = historicalData._meta?.lastCid;
  }
}
```

**Key Characteristics:**
- ✅ Uses `resolver.fetchContentByCid()` - respects sidecar cache
- ✅ Merges tokens without overwriting newer versions
- ✅ Stops on cycle detection or depth limit
- ❌ **Does NOT bypass cache** - relies on cached CIDs

---

## 3. Initialization Flow

### 3.1 App Startup Sequence

**DashboardLayout** (where wallet UI is mounted):
```
1. Mount DashboardLayout component
2. useWallet() hook initializes
3. InventoryBackgroundLoopsManager.getInstance(identityManager)
4. loopsManager.initialize() - sets up receive/delivery queues
5. First inventorySync() triggered by useWallet effect
```

**useWallet Hook** (`/home/vrogojin/sphere/src/components/wallet/L3/hooks/useWallet.ts`):
```typescript
useEffect(() => {
  // Auto-sync on mount (runs once)
  if (identity?.ipnsName) {
    inventorySync({
      address: identity.address,
      publicKey: identity.publicKey,
      ipnsName: identity.ipnsName,
    }).catch(err => {
      console.error("Auto-sync failed:", err);
    });
  }
}, [identity?.ipnsName]);
```

**Timing:**
- DashboardLayout mount: ~100-200ms after app start
- Identity resolution: ~50ms (from IdentityManager)
- First inventorySync(): ~300-500ms after mount
- **Total to first sync: ~500-700ms**

### 3.2 Background Loop Initialization

**File:** `InventoryBackgroundLoops.ts:641-672`

```typescript
async initialize(): Promise<void> {
  // Race-condition safe: Returns existing promise if initialization in progress
  if (this.isInitialized) return;
  if (this.initializationPromise) return this.initializationPromise;

  this.initializationPromise = this.doInitialize();
  return this.initializationPromise;
}

private async doInitialize(): Promise<void> {
  this.receiveLoop = new ReceiveTokensToInventoryLoop(identityManager, config);
  this.deliveryQueue = new NostrDeliveryQueue(identityManager, config);
  this.isInitialized = true;
  console.log('✅ [LoopsManager] Background loops initialized');
}
```

**Initialization Steps:**
1. ReceiveTokensToInventoryLoop - batches incoming Nostr tokens (Section 7.1)
2. NostrDeliveryQueue - sends tokens via Nostr with parallelism (Section 7.3)
3. No periodic background sync loop exists currently

---

## 4. Cache Bypass Mechanisms

### 4.1 Client-Side Cache Bypass

**Available Methods:**

1. **Invalidate IPNS cache:**
   ```typescript
   const httpResolver = getIpfsHttpResolver();
   httpResolver.invalidateIpnsCache(ipnsName); // Clear specific name
   httpResolver.getCache().clear();            // Clear all caches
   ```

2. **Skip cache check in FAST mode:**
   ```typescript
   // IpfsHttpResolver.resolveIpnsName() line 243-274
   const result = await httpResolver.resolveIpnsName(ipnsName, useCacheOnly);
   // useCacheOnly: true = return cached value only (FAST mode optimization)
   ```

### 4.2 Sidecar Cache Bypass

**Problem:** The sidecar cache at `/home/vrogojin/ipfs-storage` has **no cache bypass header support**.

**Current Sidecar Behavior** (`nostr_pinner.py`):
```python
# Check cache first
cached_record = self.db.get_ipns_record(ipns_name)
if cached_record and is_fresh(cached_record):
    # Serve from cache
    return Response(
        data=cached_record,
        headers={
            'X-IPNS-Source': 'sidecar-cache',
            'Cache-Control': f'max-age={STALE_THRESHOLD_SECONDS}'
        }
    )

# If stale, fetch from Kubo DHT
kubo_response = await client.post(f"{IPFS_API_URL}/api/v0/routing/get")
return Response(
    data=kubo_response,
    headers={'X-IPNS-Source': 'kubo'}
)
```

**Missing Feature:**
- No `Cache-Control: no-cache` header support
- No `X-Force-DHT: true` header support
- No query parameter like `?bypass=true`

### 4.3 DHT Resolution Cost

**Performance Comparison:**
- Sidecar cache hit: 5-20ms
- Sidecar cache miss (DHT): 1-5 seconds (first query)
- Subsequent DHT queries: 200-500ms (DHT peers cached)

**Network Implications:**
- DHT queries traverse multiple hops
- Peak load: ~10-20 DHT queries/sec per node (acceptable)
- 100 clients doing lazy recovery: ~1000-2000 DHT queries burst (may overload DHT)

---

## 5. Token Recovery Logic

### 5.1 Existing RECOVERY Mode

**File:** `InventorySyncService.ts:1216-1395`

**Recovery Strategy:**
1. Start from `remoteData._meta.lastCid` (not current CID)
2. Traverse backwards through version chain
3. Merge tokens using `ctx.tokens.has(tokenId)` check
4. Prefer newer versions (don't overwrite)
5. Stop on depth limit or no more history

**Recovered Token Handling:**
```typescript
// Add token if not already present
if (!ctx.tokens.has(tokenId)) {
  ctx.tokens.set(tokenId, token);
  ctx.recoveryStats.tokensRecoveredFromHistory++;
}
```

**Upload Behavior:**
```typescript
// RECOVERY mode always forces upload to persist recovered state
if (ctx.mode === 'RECOVERY') {
  forceUpload = true;
}
```

### 5.2 Auto-Recovery Detection

**File:** `InventorySyncService.ts:487-508`

**Trigger Condition:**
```typescript
const shouldAutoRecover =
  ctx.tokens.size === 0 &&          // No tokens found
  ctx.remoteCid !== null &&         // Successfully loaded from IPFS
  ctx.remoteLastCid !== null;       // History exists
```

**Behavior:**
- Sets `ctx.recoveryDepth = 10` (reasonable default)
- Runs `step2_5_traverseVersionChain()`
- Marks `ctx.autoRecoveryTriggered = true`
- Forces upload to persist recovered state

---

## 6. Recommendations for Lazy Recovery

### 6.1 Implementation Strategy

**Option A: Add New Sync Mode** (Recommended)
```typescript
export type SyncMode = 'LOCAL' | 'RECOVERY' | 'RECOVERY_NOCACHE' | 'NAMETAG' | 'FAST' | 'NORMAL';
```

**Mode Behavior:**
- Run in background after app startup (low priority)
- Clear client-side cache before resolution
- Wait for sidecar cache staleness (60s) OR implement cache bypass
- Traverse version chain with depth limit (e.g., 20)
- **Do NOT force upload** - only restore to localStorage
- Run once per session

**Option B: Background Recovery Loop** (Alternative)
- Add to `InventoryBackgroundLoopsManager`
- Schedule after first NORMAL sync completes
- Use existing RECOVERY mode with cache invalidation
- Run with delay (e.g., 5 minutes after startup)

### 6.2 Recommended Approach

**Phased Implementation:**

**Phase 1: Client-Side Cache Bypass (Immediate)**
```typescript
// New function in InventoryBackgroundLoops.ts
class LazyRecoveryLoop {
  async runLazyRecovery(identity: IdentityData): Promise<void> {
    // Wait for app to fully initialize
    await this.sleep(10000); // 10 second delay

    console.log('🔄 [LazyRecovery] Starting background recovery...');

    // Clear client-side caches
    const httpResolver = getIpfsHttpResolver();
    httpResolver.invalidateIpnsCache(identity.ipnsName);

    // Run RECOVERY mode with depth limit
    const result = await inventorySync({
      address: identity.address,
      publicKey: identity.publicKey,
      ipnsName: identity.ipnsName,
      recoveryDepth: 20, // Traverse up to 20 versions
      local: false, // Allow IPFS operations
    });

    console.log('✅ [LazyRecovery] Completed:', result.recoveryStats);
  }
}
```

**Phase 2: Sidecar Cache Bypass (Backend Enhancement)**

Enhance `nostr_pinner.py` to support cache bypass:
```python
async def handle_routing_get(self, request):
    ipns_name = request.query.get('arg', '').replace('/ipns/', '')
    bypass_cache = request.headers.get('X-Force-DHT') == 'true'

    if not bypass_cache:
        cached_record = self.db.get_ipns_record(ipns_name)
        if cached_record and is_fresh(cached_record):
            return Response(...)

    # Force DHT query
    kubo_response = await self.fetch_from_dht(ipns_name)
    return Response(headers={'X-IPNS-Source': 'kubo'})
```

Client-side usage:
```typescript
// Add header support to IpfsHttpResolver.ts
async function tryRoutingApi(
  ipnsName: string,
  gatewayUrl: string,
  bypassCache: boolean = false
): Promise<{...}> {
  const headers: Record<string, string> = {};
  if (bypassCache) {
    headers['X-Force-DHT'] = 'true';
  }

  const response = await fetchWithTimeout(url, timeoutMs, {
    method: "POST",
    headers,
  });
  ...
}
```

### 6.3 Integration Points

**Hook into existing flow:**

1. **After first NORMAL sync:**
   ```typescript
   // In InventoryBackgroundLoopsManager.initialize()
   await this.doInitialize();

   // Schedule lazy recovery after 10 seconds
   setTimeout(() => {
     this.lazyRecoveryLoop.runLazyRecovery(identity);
   }, 10000);
   ```

2. **User-triggered recovery:**
   ```typescript
   // Add to useIpfsStorage hook
   const runRecoveryMutation = useMutation({
     mutationFn: async (depth: number = 20) => {
       return await storageService.runLazyRecovery(depth);
     },
   });
   ```

### 6.4 Performance Considerations

**Cache Invalidation Impact:**
- Client-side cache clear: 0ms (instant)
- Sidecar cache bypass: +1-5s per resolution (DHT query)
- Total overhead: ~1-5 seconds for background task

**DHT Load:**
- Single recovery run: 1 IPNS query + N CID fetches (N = depth)
- With depth=20: ~21 DHT queries over 30-60 seconds
- Acceptable load for background operation

**Main Sync Impact:**
- Zero impact if delayed by 10+ seconds
- Client cache repopulated by normal operations
- Sidecar cache unaffected (separate query)

---

## 7. Code Locations Reference

### Key Files

| File | Location | Purpose |
|------|----------|---------|
| **IpfsHttpResolver.ts** | `/home/vrogojin/sphere/src/components/wallet/L3/services/` | IPNS resolution, cache management |
| **InventorySyncService.ts** | `/home/vrogojin/sphere/src/components/wallet/L3/services/` | Main sync orchestrator, RECOVERY mode |
| **IpfsStorageService.ts** | `/home/vrogojin/sphere/src/components/wallet/L3/services/` | IPFS operations, `resolveIpnsProgressively()` |
| **InventoryBackgroundLoops.ts** | `/home/vrogojin/sphere/src/components/wallet/L3/services/` | Background task manager |
| **SyncModeDetector.ts** | `/home/vrogojin/sphere/src/components/wallet/L3/services/utils/` | Sync mode detection logic |
| **SyncTypes.ts** | `/home/vrogojin/sphere/src/components/wallet/L3/types/` | Type definitions for sync modes |
| **ipfs.config.ts** | `/home/vrogojin/sphere/src/config/` | IPFS node configuration |
| **nostr_pinner.py** | `/home/vrogojin/ipfs-storage/nostr-pinner/` | Sidecar cache implementation |

### Key Functions

| Function | File:Line | Description |
|----------|-----------|-------------|
| `resolveIpnsProgressively()` | IpfsStorageService.ts:1831 | Progressive IPNS resolution across nodes |
| `resolveIpnsName()` | IpfsHttpResolver.ts:243 | Resolve IPNS with cache support |
| `step2_5_traverseVersionChain()` | InventorySyncService.ts:1216 | Version chain traversal for recovery |
| `detectSyncMode()` | SyncModeDetector.ts:65 | Determine sync mode from parameters |
| `inventorySync()` | InventorySyncService.ts:374 | Main sync orchestrator |
| `invalidateIpnsCache()` | IpfsHttpResolver.ts:583 | Clear IPNS cache |

### Cache Headers

| Header | Source | Value | Purpose |
|--------|--------|-------|---------|
| `X-IPNS-Source` | Sidecar | `sidecar-cache` | Served from cache |
| `X-IPNS-Source` | Sidecar | `kubo` | Served from DHT |
| `Cache-Control` | Sidecar | `max-age=60, stale-while-revalidate=30` | Cache directives |

---

## 8. Next Steps

### Immediate (No Backend Changes)

1. **Add LazyRecoveryLoop class** to `InventoryBackgroundLoops.ts`
   - Implement 10-second startup delay
   - Clear client-side cache before recovery
   - Run RECOVERY mode with depth=20
   - Log recovery statistics

2. **Integrate into InventoryBackgroundLoopsManager**
   - Initialize after first NORMAL sync
   - Add status tracking for debugging
   - Expose recovery trigger via hook

3. **Testing**
   - Simulate cache corruption scenario
   - Measure performance impact
   - Verify zero degradation to main sync

### Medium-Term (Backend Enhancement)

1. **Add cache bypass to sidecar** (`nostr_pinner.py`)
   - Implement `X-Force-DHT` header support
   - Add query parameter `?bypass=true` alternative
   - Update response headers to indicate bypass

2. **Update IpfsHttpResolver**
   - Add `bypassCache` parameter to `resolveIpnsName()`
   - Pass header to routing API requests
   - Document behavior in code comments

3. **Performance Monitoring**
   - Track DHT query latency
   - Monitor sidecar load impact
   - Optimize depth limit based on metrics

### Long-Term (Enhanced Recovery)

1. **IPNS Archive Service** (per TODO in ipfs.config.ts:134-150)
   - Archive N previous IPNS versions
   - API endpoint: `/api/v0/ipns/archive/{name}`
   - MongoDB storage alongside current records
   - Enables recovery from race conditions

2. **Smart Recovery Triggers**
   - Detect version regressions automatically
   - Compare token counts across versions
   - Alert user to potential data loss

---

## Appendix A: Cache Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                     Client (Browser)                             │
├─────────────────────────────────────────────────────────────────┤
│  IpfsHttpResolver                                                │
│    ├─ Client Cache (IpfsCache)                                   │
│    │    └─ TTL: 60s for IPNS, ∞ for CID                         │
│    └─ resolveIpnsName(ipnsName, useCacheOnly)                    │
│         ├─ Check cache first                                     │
│         └─ POST /api/v0/routing/get?arg=/ipns/{name}            │
└─────────────────────────────────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                  IPFS Node (unicity-ipfs1)                       │
├─────────────────────────────────────────────────────────────────┤
│  Nginx (Reverse Proxy)                                           │
│    └─ Cache: 7d for /ipfs/, shorter for /ipns/                  │
│         └─ Forward to nostr_pinner.py                            │
├─────────────────────────────────────────────────────────────────┤
│  Sidecar Cache (nostr_pinner.py)                                 │
│    ├─ MongoDB storage                                            │
│    ├─ Staleness: 60s (STALE_THRESHOLD_SECONDS)                  │
│    ├─ Headers: X-IPNS-Source: sidecar-cache | kubo             │
│    └─ Fallback to Kubo DHT if stale                             │
├─────────────────────────────────────────────────────────────────┤
│  Kubo IPFS Node                                                  │
│    └─ DHT queries (1-5s first query, 200-500ms cached)          │
└─────────────────────────────────────────────────────────────────┘
```

## Appendix B: Sync Mode Comparison

| Mode | IPFS Read | IPFS Write | Spent Check | Lock | Use Case |
|------|-----------|------------|-------------|------|----------|
| **LOCAL** | ❌ Skip | ❌ Skip | ❌ Skip | ✅ Yes | Offline mode |
| **RECOVERY** | ✅ Yes (chain) | ✅ Force | ❌ Skip | ✅ Yes | Token recovery |
| **NAMETAG** | ✅ Yes (name) | ❌ Skip | ❌ Skip | ❌ No | Nametag fetch |
| **FAST** | ✅ Yes (cache) | ✅ If changed | ❌ Skip | ✅ Yes | Receive/Send |
| **NORMAL** | ✅ Yes | ✅ If changed | ✅ Yes | ✅ Yes | Full sync |

## Appendix C: Recovery Mode Parameters

```typescript
interface RecoveryParams {
  // Recovery depth (versions to traverse)
  recoveryDepth?: number;  // 0 = unlimited, >0 = limit

  // Skip extended verification (for speed)
  skipExtendedVerification?: boolean;

  // Force upload after recovery
  forceUpload?: boolean;  // RECOVERY mode sets this to true
}

// Example: Lazy background recovery
await inventorySync({
  address: identity.address,
  publicKey: identity.publicKey,
  ipnsName: identity.ipnsName,
  recoveryDepth: 20,                  // Traverse 20 versions
  skipExtendedVerification: true,     // Fast mode
  // forceUpload: false (not exposed, internal)
});
```

---

**Document Version:** 1.0
**Last Updated:** 2026-01-27
**Author:** Claude Opus 4.5
