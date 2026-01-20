# IPFS Sync Performance Analysis & Optimization Recommendations

**Goal**: Reduce sync time from current ~5-15 seconds to under 2 seconds

**Analysis Date**: 2025-12-23

---

## Current Architecture Overview

### Sync Flow Sequence

The sync operation follows this sequence:

1. **Initialization** (`ensureInitialized`)
   - Check WebCrypto availability
   - Derive Ed25519 keys from wallet private key (HKDF)
   - Generate libp2p IPNS keypair
   - Initialize Helia with restricted peer connections
   - Wait for bootstrap peer connections

2. **Initial Sync on Startup** (`syncFromIpns`)
   - Retry any pending IPNS publishes
   - Progressive IPNS resolution from 5 gateways (10s initial timeout)
   - Race two methods per gateway:
     - Gateway path: `/ipns/{name}?format=dag-json` (fast ~30ms, returns content)
     - Routing API: `/api/v0/routing/get` (slow ~5s, returns sequence)
   - Fetch remote content if CID differs
   - Compare versions and merge conflicts
   - Update local state

3. **Manual Sync** (`syncNow`)
   - Acquire cross-tab lock via SyncCoordinator
   - Validate all tokens
   - Check for remote conflicts (fetch last CID)
   - Merge remote changes if needed
   - Build TXF storage data
   - Store to local Helia instance
   - **Wait 3 seconds for bitswap** ⚠️
   - Upload to all 5 IPFS nodes via HTTP API (parallel)
   - DHT announce (10s timeout)
   - Publish to IPNS via HTTP (parallel to 5 nodes)
   - Fire-and-forget DHT IPNS publish

---

## Performance Bottlenecks Identified

### 🔴 CRITICAL BOTTLENECKS

#### 1. **3-Second Bitswap Wait** (Line 2640)
```typescript
// 4.2. Wait briefly for bitswap to have a chance to exchange blocks
if (backendConnected) {
  console.log(`📦 Waiting for bitswap block exchange...`);
  await new Promise((resolve) => setTimeout(resolve, 3000));  // ⚠️ BLOCKING 3 SECONDS
}
```
**Impact**: Fixed 3-second delay on every sync
**Why it exists**: Allows browser to exchange IPFS blocks with backend via bitswap before HTTP upload
**Problem**: Browser clients can't be dialed directly, making this wait mostly ineffective

#### 2. **Sequential Remote Conflict Check** (Lines 2451-2599)
```typescript
if (lastCid) {
  try {
    console.log(`📦 Checking for remote conflicts...`);
    const remoteData = await Promise.race([
      j.get(remoteCid),  // ⚠️ BLOCKING: 15s timeout via IPFS network
      new Promise((_, reject) => setTimeout(() => reject(new Error("Remote fetch timeout")), REMOTE_FETCH_TIMEOUT)),
    ]) as unknown;
    // ... 150 lines of merge logic
  }
}
```
**Impact**: 0-15 seconds depending on IPFS network latency
**Why it exists**: Prevents overwriting remote changes
**Problem**: Uses slow IPFS DHT/bitswap instead of direct HTTP GET from known nodes

#### 3. **DHT Announce Timeout** (Lines 2686-2700)
```typescript
await Promise.race([
  this.helia.routing.provide(cid),  // ⚠️ DHT operation - slow in browser
  new Promise((_, reject) => setTimeout(() => reject(new Error("DHT provide timeout")), PROVIDE_TIMEOUT)),
]);
```
**Impact**: Up to 10 seconds (usually times out)
**Why it exists**: Announces content to DHT for discovery
**Problem**: Browser DHT operations are unreliable; we already do direct HTTP upload

#### 4. **Progressive IPNS Resolution Initial Timeout** (Line 1022)
```typescript
await Promise.race([
  Promise.allSettled(gatewayPromises),
  new Promise((resolve) => setTimeout(resolve, IPNS_RESOLUTION_CONFIG.initialTimeoutMs)), // 10 seconds
]);
```
**Impact**: Up to 10 seconds on startup sync
**Why it exists**: Waits for multiple gateways to respond for consensus
**Problem**: Uses both gateway path AND routing API - routing API is slow

### 🟡 MODERATE BOTTLENECKS

#### 5. **Multiple Serial HTTP Uploads** (Lines 2654-2682)
Currently parallel, but could be optimized further with race conditions and early success.

#### 6. **Helia Initialization** (Lines 335-482)
- Key derivation (HKDF + Ed25519)
- Libp2p peer discovery and connection
- Bootstrap peer connection wait (~2-5 seconds)

---

## Optimization Recommendations

### Priority 1: Eliminate Bitswap Wait ⚡ **SAVES 3 SECONDS**

**Current Code** (Line 2636-2641):
```typescript
if (backendConnected) {
  console.log(`📦 Waiting for bitswap block exchange...`);
  await new Promise((resolve) => setTimeout(resolve, 3000));  // DELETE THIS
}
```

**Optimized Code**:
```typescript
// Remove entirely - bitswap is unreliable in browsers
// Direct HTTP upload makes this unnecessary
// if (backendConnected) {
//   console.log(`📦 Waiting for bitswap block exchange...`);
//   await new Promise((resolve) => setTimeout(resolve, 3000));
// }
```

**Rationale**:
- Browser clients cannot be dialed by backend peers (WebRTC/WebSocket limitations)
- Direct HTTP upload to all 5 nodes already ensures content availability
- Bitswap is a "nice-to-have" but the 3-second wait provides minimal benefit
- Even if bitswap succeeds, the HTTP upload happens anyway

**Risk**: Low - HTTP upload is the primary distribution mechanism

---

### Priority 2: Use Direct HTTP for Remote Conflict Check ⚡ **SAVES 5-15 SECONDS**

**Current Code** (Line 2451-2465):
```typescript
const remoteData = await Promise.race([
  j.get(remoteCid),  // ⚠️ Slow IPFS network fetch
  new Promise((_, reject) => setTimeout(() => reject(new Error("Remote fetch timeout")), REMOTE_FETCH_TIMEOUT)),
]) as unknown;
```

**Optimized Code**:
```typescript
// NEW: Add HTTP fetch method
private async fetchRemoteContentViaHttp(cidString: string): Promise<TxfStorageData | null> {
  const gatewayUrls = getAllBackendGatewayUrls();
  if (gatewayUrls.length === 0) return null;

  // Race all gateways - first one wins
  const promises = gatewayUrls.map(async (gatewayUrl) => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000); // 2s per gateway

      const response = await fetch(
        `${gatewayUrl}/ipfs/${cidString}?format=dag-json`,
        {
          signal: controller.signal,
          headers: { Accept: "application/vnd.ipld.dag-json, application/json" },
        }
      );

      clearTimeout(timeoutId);

      if (!response.ok) return null;

      const content = await response.json() as TxfStorageData;
      console.log(`📦 Fetched CID via HTTP from ${new URL(gatewayUrl).hostname} (${Date.now() - start}ms)`);
      return content;
    } catch (error) {
      return null;
    }
  });

  // Return first successful response
  const results = await Promise.allSettled(promises);
  for (const result of results) {
    if (result.status === "fulfilled" && result.value) {
      return result.value;
    }
  }

  // Fallback to IPFS network if all HTTP fetches fail
  console.warn(`📦 HTTP fetch failed, falling back to IPFS network...`);
  return this.fetchRemoteContentViaIpfs(cidString);
}

private async fetchRemoteContentViaIpfs(cidString: string): Promise<TxfStorageData | null> {
  // Current j.get() implementation
  if (!this.helia) return null;
  const FETCH_TIMEOUT = 15000;
  try {
    const j = json(this.helia);
    const { CID } = await import("multiformats/cid");
    const cid = CID.parse(cidString);
    const data = await Promise.race([
      j.get(cid),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Fetch timeout")), FETCH_TIMEOUT)),
    ]);
    if (data && typeof data === "object" && "_meta" in (data as object)) {
      return data as TxfStorageData;
    }
    return null;
  } catch (error) {
    console.warn(`📦 Failed to fetch CID ${cidString.slice(0, 16)}... via IPFS:`, error);
    return null;
  }
}
```

**Usage in syncNow** (Line 2460):
```typescript
// OLD:
const remoteData = await Promise.race([
  j.get(remoteCid),
  new Promise((_, reject) => setTimeout(() => reject(new Error("Remote fetch timeout")), REMOTE_FETCH_TIMEOUT)),
]) as unknown;

// NEW:
const remoteData = await this.fetchRemoteContentViaHttp(lastCid);
```

**Rationale**:
- HTTP gateway access is ~50-200ms vs IPFS network 5-15 seconds
- We already know the CID and have 5 reliable IPFS nodes
- Gateway path `/ipfs/{cid}?format=dag-json` is cached and fast
- Race all 5 gateways - first success wins
- Fallback to IPFS network if HTTP fails

**Risk**: Low - adds HTTP as primary with IPFS fallback

---

### Priority 3: Skip DHT Announce (Already Non-Blocking, But Creates Noise) ⚡ **SAVES 0-10 SECONDS**

**Current Code** (Line 2684-2700):
```typescript
try {
  console.log(`📦 Announcing CID to network: ${cidString.slice(0, 16)}...`);
  await Promise.race([
    this.helia.routing.provide(cid),  // ⚠️ Usually times out
    new Promise((_, reject) => setTimeout(() => reject(new Error("DHT provide timeout")), PROVIDE_TIMEOUT)),
  ]);
  console.log(`📦 CID announced to network`);
} catch (provideError) {
  console.warn(`📦 Could not announce to DHT (non-fatal):`, provideError);
}
```

**Optimized Code**:
```typescript
// Skip entirely - HTTP upload makes DHT announce redundant
// Fire-and-forget in background if desired (don't await)
if (false) { // Disabled - HTTP upload is sufficient
  (async () => {
    try {
      await Promise.race([
        this.helia.routing.provide(cid),
        new Promise((_, reject) => setTimeout(() => reject(new Error("DHT provide timeout")), 5000)),
      ]);
      console.log(`📦 DHT announce completed in background`);
    } catch {
      // Silent fail
    }
  })();
}
```

**Rationale**:
- DHT announce in browsers is unreliable (NAT traversal issues)
- We already upload to all 5 nodes via HTTP with pinning
- The 10-second timeout usually fires, wasting cycles
- Make it fire-and-forget background operation if needed at all

**Risk**: None - HTTP upload already makes content available

---

### Priority 4: Optimize IPNS Resolution with Gateway Path Priority ⚡ **SAVES 5-8 SECONDS**

**Problem**: Currently waits 10 seconds for both gateway path AND routing API.

**Current Code** (Line 962-1023):
```typescript
const gatewayPromises = gatewayUrls.map(async (url) => {
  const gatewayPathPromise = this.resolveIpnsViaGatewayPath(url);
  const routingApiPromise = this.resolveIpnsFromGateway(url);

  const [gatewayPathResult, routingApiResult] = await Promise.allSettled([
    gatewayPathPromise,
    routingApiPromise,
  ]);
  // ... processing
});

await Promise.race([
  Promise.allSettled(gatewayPromises),
  new Promise((resolve) => setTimeout(resolve, IPNS_RESOLUTION_CONFIG.initialTimeoutMs)), // 10s
]);
```

**Optimized Code**:
```typescript
// Two-phase resolution: fast path first, then sequence verification
const resolveFastPath = async () => {
  const promises = gatewayUrls.map(url => this.resolveIpnsViaGatewayPath(url));

  // Wait for first success or 2 seconds (whichever comes first)
  const result = await Promise.race([
    Promise.race(
      promises.map(async (p) => {
        const res = await p;
        if (res) return res;
        throw new Error("No result");
      })
    ),
    new Promise((_, reject) => setTimeout(() => reject(new Error("Fast path timeout")), 2000)),
  ]);

  return result;
};

// Try fast path first (gateway path only - ~30-200ms)
let bestResult: IpnsGatewayResult | null = null;
try {
  const fastPath = await resolveFastPath();
  if (fastPath) {
    console.log(`📦 Fast IPNS resolution: ${fastPath.latency}ms`);
    bestResult = {
      cid: fastPath.cid,
      sequence: 0n, // Unknown - will verify later
      gateway: "fast-path",
      recordData: new Uint8Array(),
      _cachedContent: fastPath.content,
    };
  }
} catch {
  console.log(`📦 Fast path timeout, falling back to full resolution`);
}

// If fast path succeeded, verify sequence in background (don't await)
if (bestResult) {
  // Start sequence verification in background
  this.verifyIpnsSequenceInBackground(bestResult.cid);

  // Return immediately with cached content
  return {
    best: bestResult,
    allResults: [bestResult],
    respondedCount: 1,
    totalGateways: gatewayUrls.length,
  };
}

// If fast path failed, fall back to full resolution (current code)
// ... existing progressive resolution logic
```

**Add background sequence verification**:
```typescript
private verifyIpnsSequenceInBackground(expectedCid: string): void {
  const gatewayUrls = getAllBackendGatewayUrls();

  // Fire and forget - verify sequence numbers from routing API
  (async () => {
    const promises = gatewayUrls.map(url => this.resolveIpnsFromGateway(url));
    const results = await Promise.allSettled(promises);

    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        const { sequence, cid } = result.value;
        if (cid !== expectedCid && sequence > this.ipnsSequenceNumber) {
          console.log(`📦 Background sequence check: CID mismatch detected (seq=${sequence})`);
          await this.handleHigherSequenceDiscovered(result.value);
          break;
        }
      }
    }
  })();
}
```

**Rationale**:
- Gateway path is cached and fast (~30ms)
- Routing API is slow (~5s) but only needed for sequence numbers
- Most syncs don't need sequence verification (no conflicts)
- Verify sequence in background, return content immediately
- If sequence mismatch detected later, trigger merge automatically

**Risk**: Low - sequence verification still happens, just async

---

### Priority 5: Parallelize Token Validation ⚡ **SAVES 0.5-2 SECONDS**

**Current Code** (Line 2436-2442):
```typescript
const validationService = getTokenValidationService();
const { validTokens, issues } = await validationService.validateAllTokens(wallet.tokens);
```

**Check Implementation**: Need to verify if `validateAllTokens` is already parallel.

**If Sequential, Optimize**:
```typescript
// Inside TokenValidationService.validateAllTokens()
// OLD (if sequential):
for (const token of tokens) {
  const result = await this.validateToken(token);
  // ...
}

// NEW (parallel):
const validationPromises = tokens.map(token =>
  this.validateToken(token).catch(error => ({
    valid: false,
    token,
    error: error.message,
  }))
);

const results = await Promise.all(validationPromises);
// ... process results
```

**Rationale**: Token validation hits aggregator API - parallel is faster

---

### Priority 6: Cache IPNS Name Computation ⚡ **SAVES 50-100ms**

**Current Code** (Line 389-400):
```typescript
// Every time ensureInitialized runs:
this.ed25519PrivateKey = derivedKey;
this.ed25519PublicKey = ed.getPublicKey(derivedKey);
this.ipnsKeyPair = await generateKeyPairFromSeed("Ed25519", derivedKey);
const ipnsPeerId = peerIdFromPrivateKey(this.ipnsKeyPair);
this.cachedIpnsName = ipnsPeerId.toString();
```

**Optimized Code**:
```typescript
// Check if keys already derived for this identity
if (this.ed25519PrivateKey &&
    this.currentIdentityAddress === identity.address) {
  return true; // Already initialized for this identity
}

// ... existing key derivation code
```

**Already Implemented**: Line 345-354 has this optimization ✓

---

### Priority 7: Reduce SyncCoordinator Lock Timeout ⚡ **SAVES 0-5 SECONDS**

**Current Code** (SyncCoordinator.ts, Line 56):
```typescript
private readonly LOCK_TIMEOUT = 30000; // 30s max wait for lock
```

**Optimized Code**:
```typescript
private readonly LOCK_TIMEOUT = 5000; // 5s max wait (if sync takes >5s, something is wrong)
```

**Rationale**: With optimizations, sync should complete in <2s, so 5s timeout is plenty

---

## Implementation Priority Order

### Phase 1: Quick Wins (Implementation Time: 30 minutes)
1. ✅ **Remove 3-second bitswap wait** - Lines 2636-2641
2. ✅ **Skip DHT announce** - Lines 2684-2700
3. ✅ **Reduce SyncCoordinator timeout** - SyncCoordinator.ts Line 56

**Expected Improvement**: 3-10 seconds → **~7-12 seconds saved**

### Phase 2: HTTP Optimization (Implementation Time: 2-3 hours)
4. ✅ **Direct HTTP for remote conflict check** - Add `fetchRemoteContentViaHttp()` method
5. ✅ **Fast-path IPNS resolution** - Modify `resolveIpnsProgressively()`

**Expected Improvement**: 7-12 seconds → **~10-20 seconds saved total**

### Phase 3: Parallelization (Implementation Time: 1-2 hours)
6. ✅ **Parallelize token validation** - Check TokenValidationService implementation

**Expected Improvement**: Additional 0.5-2 seconds

---

## Expected Performance After Optimizations

### Current Baseline
- **Startup sync**: 10-15 seconds (IPNS resolution + conflict check)
- **Manual sync**: 5-15 seconds (conflict check + upload + waits)

### After Phase 1 (Quick Wins)
- **Startup sync**: 7-12 seconds
- **Manual sync**: 2-5 seconds ✅ **TARGET APPROACHED**

### After Phase 2 (HTTP Optimization)
- **Startup sync**: 0.5-2 seconds ✅ **TARGET MET**
- **Manual sync**: 0.5-1.5 seconds ✅ **TARGET EXCEEDED**

### After Phase 3 (Parallelization)
- **Startup sync**: 0.3-1.5 seconds
- **Manual sync**: 0.3-1 second

---

## Code Changes Summary

### Files to Modify

1. **IpfsStorageService.ts**
   - Remove bitswap wait (Line 2636-2641)
   - Skip DHT announce (Line 2684-2700)
   - Add `fetchRemoteContentViaHttp()` method
   - Add `fetchRemoteContentViaIpfs()` method (refactor existing)
   - Modify `syncNow()` to use HTTP fetch (Line 2460)
   - Optimize `resolveIpnsProgressively()` with fast path
   - Add `verifyIpnsSequenceInBackground()` method

2. **SyncCoordinator.ts**
   - Reduce LOCK_TIMEOUT from 30000 to 5000 (Line 56)

3. **TokenValidationService.ts** (if needed)
   - Parallelize `validateAllTokens()` if currently sequential

---

## Risk Assessment

| Optimization | Risk Level | Mitigation |
|-------------|-----------|-----------|
| Remove bitswap wait | 🟢 Low | HTTP upload already ensures availability |
| Skip DHT announce | 🟢 Low | HTTP upload + IPNS publish sufficient |
| HTTP remote fetch | 🟢 Low | Fallback to IPFS network if HTTP fails |
| Fast-path IPNS | 🟡 Medium | Background sequence verification prevents conflicts |
| Reduce lock timeout | 🟢 Low | 5s is sufficient with optimizations |
| Parallel validation | 🟢 Low | Standard async pattern |

---

## Testing Checklist

- [ ] Sync completes in <2 seconds with no tokens
- [ ] Sync completes in <2 seconds with 10 tokens
- [ ] Sync completes in <2 seconds with 100 tokens
- [ ] Conflict resolution still works (two devices, same wallet)
- [ ] Tombstone sync works correctly
- [ ] IPNS publishing succeeds on all 5 nodes
- [ ] HTTP fetch fallback works when one node is down
- [ ] Cross-tab sync coordination still prevents race conditions
- [ ] Token validation issues are still caught
- [ ] Startup sync correctly discovers remote changes

---

## Monitoring & Metrics

Add performance timing logs:

```typescript
// At start of syncNow():
const syncStartTime = performance.now();
const timings: Record<string, number> = {};

// After each phase:
timings.validation = performance.now() - syncStartTime;
// ... after conflict check
timings.conflictCheck = performance.now() - syncStartTime;
// ... after upload
timings.upload = performance.now() - syncStartTime;
// ... after IPNS
timings.ipnsPublish = performance.now() - syncStartTime;

// At end:
const totalTime = performance.now() - syncStartTime;
console.log(`📦 Sync completed in ${totalTime.toFixed(0)}ms:`, timings);
```

**Target Metrics**:
- Validation: <100ms
- Conflict check: <200ms (HTTP) or <100ms (cached)
- Upload: <500ms (parallel to 5 nodes)
- IPNS publish: <300ms (parallel to 5 nodes)
- **Total: <1000ms (1 second)**

---

## Additional Optimization Ideas (Future)

### 1. Service Worker for IPFS Content Caching
- Cache IPFS content in service worker
- Intercept `/ipfs/` and `/ipns/` requests
- Serve from cache if available
- **Benefit**: Zero-latency reads for repeated access

### 2. WebAssembly for Crypto Operations
- Move HKDF, Ed25519 signing to WASM
- **Benefit**: 2-3x faster key derivation

### 3. IndexedDB for Token Cache
- Cache validated tokens with TTL
- Skip validation if token unchanged and cache valid
- **Benefit**: Skip aggregator API calls

### 4. HTTP/2 Server Push
- Configure IPFS nodes to push common resources
- **Benefit**: Eliminate round trips for known resources

### 5. Delta Sync
- Only upload changed tokens, not entire wallet
- Use CID references to unchanged tokens
- **Benefit**: Smaller uploads, faster for large wallets

---

## Conclusion

The current IPFS sync implementation has **3-second fixed delay** plus **10-15 seconds of network operations** that can be reduced by **80-90%** using direct HTTP to known IPFS nodes instead of DHT/bitswap.

**Key Insight**: We have 5 reliable IPFS nodes at known addresses. Instead of waiting for P2P network discovery and bitswap, we should:
1. Upload directly via HTTP API (already done, but preceded by waits)
2. Fetch remote content via HTTP gateway path (not currently done)
3. Use fast gateway path for IPNS resolution, verify sequence async (partially done)

**Implementation time**: 3-5 hours
**Expected result**: Sync time reduced from 5-15 seconds to **<1 second** in optimal conditions, <2 seconds in worst case.
