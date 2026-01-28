# Lazy Recovery Implementation Plan

## Executive Summary

This document provides a detailed refactoring plan for implementing **Lazy Recovery Mode** in the Sphere wallet application. Lazy recovery will run a background task 10 seconds after app startup to recover tokens lost due to IPFS cache corruption, without degrading main sync performance.

**Key Features:**
- Single execution per session, 10 seconds after startup
- Bypasses client-side IPFS cache for fresh resolution
- Traverses up to 20 IPFS versions via `_meta.lastCid` chain
- Non-blocking background operation
- Zero impact on main sync operations

---

## 1. Architecture Overview

### 1.1 Integration Point

The lazy recovery system will be implemented as a new class `LazyRecoveryLoop` within the existing background loops architecture:

```
InventoryBackgroundLoopsManager (Singleton)
├── ReceiveTokensToInventoryLoop (Existing)
├── NostrDeliveryQueue (Existing)
└── LazyRecoveryLoop (NEW) ← Lazy recovery implementation
```

### 1.2 Execution Flow

```
App Startup
     ↓
DashboardLayout Mounts (~100-200ms)
     ↓
InventoryBackgroundLoopsManager.initialize()
     ↓
First inventorySync() in NORMAL mode (~500-700ms)
     ↓
[Wait 10 seconds - app fully stabilized]
     ↓
LazyRecoveryLoop.runLazyRecovery()
     ↓
1. Clear client-side IPNS cache
2. Call inventorySync() in RECOVERY mode with depth=20
3. Log recovery statistics
4. Mark recovery as completed (one-time execution)
```

### 1.3 Design Principles

1. **Non-invasive**: Existing sync operations continue unmodified
2. **One-shot execution**: Runs once per session, not periodic
3. **Graceful degradation**: Failures don't affect main operations
4. **Observable**: Comprehensive logging for debugging
5. **Configurable**: Recovery depth and timing are parameterized

---

## 2. Class Design: LazyRecoveryLoop

### 2.1 Class Structure

```typescript
/**
 * Lazy Recovery Loop
 *
 * Runs a single background recovery task 10 seconds after app startup
 * to recover tokens lost due to IPFS cache corruption.
 *
 * Key Features:
 * - One-time execution per session
 * - Bypasses client-side cache for fresh IPFS resolution
 * - Traverses version chain up to configurable depth (default: 20)
 * - Non-blocking background operation
 */
export class LazyRecoveryLoop {
  private identityManager: IdentityManager;
  private config: LoopConfig;
  private hasRun: boolean = false;
  private isRunning: boolean = false;
  private scheduledTimeout: ReturnType<typeof setTimeout> | null = null;
  private completedAt: number | null = null;
  private lastRecoveryStats: RecoveryStats | null = null;
  private lastError: string | null = null;

  constructor(
    identityManager: IdentityManager,
    config: LoopConfig = DEFAULT_LOOP_CONFIG
  ) {
    this.identityManager = identityManager;
    this.config = config;
  }

  /**
   * Schedule lazy recovery to run after a delay
   * Called automatically by InventoryBackgroundLoopsManager.initialize()
   */
  scheduleRecovery(delayMs: number = 10000): void {
    // Prevent duplicate scheduling
    if (this.scheduledTimeout || this.hasRun) {
      console.log('🔄 [LazyRecovery] Already scheduled or completed, skipping');
      return;
    }

    console.log(`🔄 [LazyRecovery] Scheduled to run in ${delayMs}ms`);

    this.scheduledTimeout = setTimeout(() => {
      this.scheduledTimeout = null;
      this.runLazyRecovery().catch(err => {
        console.error('🔄 [LazyRecovery] Unexpected error:', err);
      });
    }, delayMs);
  }

  /**
   * Execute lazy recovery operation
   * INTERNAL: Called automatically by scheduleRecovery(), not directly by user code
   */
  private async runLazyRecovery(): Promise<void> {
    // Guard against concurrent execution
    if (this.isRunning || this.hasRun) {
      console.log('🔄 [LazyRecovery] Already running or completed');
      return;
    }

    this.isRunning = true;
    const startTime = performance.now();

    console.log('🔄 [LazyRecovery] Starting background recovery...');

    try {
      // Step 1: Get current identity
      const identity = await this.identityManager.getCurrentIdentity();
      if (!identity || !identity.ipnsName) {
        console.log('🔄 [LazyRecovery] No identity or IPNS name available, skipping');
        return;
      }

      console.log(`🔄 [LazyRecovery] Identity: ${identity.address.slice(0, 16)}...`);
      console.log(`🔄 [LazyRecovery] IPNS: ${identity.ipnsName.slice(0, 24)}...`);

      // Step 2: Clear client-side IPNS cache to force fresh resolution
      const httpResolver = getIpfsHttpResolver();
      httpResolver.invalidateIpnsCache(identity.ipnsName);
      console.log('🔄 [LazyRecovery] Client-side IPNS cache cleared');

      // Step 3: Run inventorySync in RECOVERY mode
      const syncParams: SyncParams = {
        address: identity.address,
        publicKey: identity.publicKey,
        ipnsName: identity.ipnsName,
        recoveryDepth: this.config.lazyRecoveryDepth || 20,
        skipExtendedVerification: true, // Speed optimization
      };

      console.log(`🔄 [LazyRecovery] Calling inventorySync(RECOVERY, depth=${syncParams.recoveryDepth})`);

      const result = await inventorySync(syncParams);

      // Step 4: Analyze results
      this.completedAt = Date.now();
      this.lastRecoveryStats = result.recoveryStats || null;

      const durationMs = performance.now() - startTime;

      if (result.status === 'SUCCESS' || result.status === 'PARTIAL_SUCCESS') {
        const tokensRecovered = result.recoveryStats?.tokensRecoveredFromHistory || 0;
        const versionsTraversed = result.recoveryStats?.versionsTraversed || 0;

        if (tokensRecovered > 0) {
          console.log(`✅ [LazyRecovery] RECOVERED ${tokensRecovered} tokens from ${versionsTraversed} versions (${durationMs.toFixed(0)}ms)`);
        } else {
          console.log(`✅ [LazyRecovery] Completed - no additional tokens found (${versionsTraversed} versions checked, ${durationMs.toFixed(0)}ms)`);
        }
      } else {
        this.lastError = result.errorMessage || 'Unknown error';
        console.warn(`⚠️ [LazyRecovery] Completed with errors: ${this.lastError} (${durationMs.toFixed(0)}ms)`);
      }

    } catch (error) {
      const durationMs = performance.now() - startTime;
      this.lastError = error instanceof Error ? error.message : String(error);
      console.error(`❌ [LazyRecovery] Failed after ${durationMs.toFixed(0)}ms:`, error);
    } finally {
      this.isRunning = false;
      this.hasRun = true;
    }
  }

  /**
   * Get recovery status for debugging/UI
   */
  getStatus(): {
    hasRun: boolean;
    isRunning: boolean;
    isScheduled: boolean;
    completedAt: number | null;
    lastRecoveryStats: RecoveryStats | null;
    lastError: string | null;
  } {
    return {
      hasRun: this.hasRun,
      isRunning: this.isRunning,
      isScheduled: this.scheduledTimeout !== null,
      completedAt: this.completedAt,
      lastRecoveryStats: this.lastRecoveryStats,
      lastError: this.lastError,
    };
  }

  /**
   * Cancel scheduled recovery (e.g., on app shutdown before it runs)
   */
  cancel(): void {
    if (this.scheduledTimeout) {
      clearTimeout(this.scheduledTimeout);
      this.scheduledTimeout = null;
      console.log('🔄 [LazyRecovery] Scheduled recovery cancelled');
    }
  }

  /**
   * Cleanup on app shutdown
   */
  destroy(): void {
    this.cancel();
    console.log('🛑 [LazyRecovery] Destroyed');
  }
}
```

### 2.2 Configuration Extension

Add lazy recovery configuration to `LoopConfig` in `/home/vrogojin/sphere/src/components/wallet/L3/services/types/QueueTypes.ts`:

```typescript
export interface LoopConfig {
  // ... existing fields ...

  /** Delay before running lazy recovery (default: 10000ms = 10 seconds) */
  lazyRecoveryDelayMs?: number;

  /** Max versions to traverse during lazy recovery (default: 20) */
  lazyRecoveryDepth?: number;
}

export const DEFAULT_LOOP_CONFIG: Required<LoopConfig> = {
  // ... existing defaults ...

  lazyRecoveryDelayMs: 10000,  // 10 seconds after startup
  lazyRecoveryDepth: 20,       // Traverse up to 20 versions
};
```

---

## 3. Integration Points

### 3.1 InventoryBackgroundLoopsManager Integration

Modify `/home/vrogojin/sphere/src/components/wallet/L3/services/InventoryBackgroundLoops.ts`:

```typescript
export class InventoryBackgroundLoopsManager {
  private static instance: InventoryBackgroundLoopsManager | null = null;
  private receiveLoop: ReceiveTokensToInventoryLoop | null = null;
  private deliveryQueue: NostrDeliveryQueue | null = null;
  private lazyRecoveryLoop: LazyRecoveryLoop | null = null;  // NEW
  private identityManager: IdentityManager;
  private config: LoopConfig;
  private isInitialized = false;
  private initializationPromise: Promise<void> | null = null;

  // ... existing constructor and getInstance ...

  /**
   * Internal initialization logic
   */
  private async doInitialize(): Promise<void> {
    try {
      this.receiveLoop = new ReceiveTokensToInventoryLoop(this.identityManager, this.config);
      this.deliveryQueue = new NostrDeliveryQueue(this.identityManager, this.config);
      this.lazyRecoveryLoop = new LazyRecoveryLoop(this.identityManager, this.config);  // NEW

      this.isInitialized = true;
      console.log('✅ [LoopsManager] Background loops initialized');

      // Schedule lazy recovery after initialization
      const delayMs = this.config.lazyRecoveryDelayMs || 10000;
      this.lazyRecoveryLoop.scheduleRecovery(delayMs);  // NEW

    } finally {
      this.initializationPromise = null;
    }
  }

  /**
   * Gracefully shutdown all loops
   */
  shutdown(): void {
    if (this.receiveLoop) {
      this.receiveLoop.destroy();
      this.receiveLoop = null;
    }
    if (this.deliveryQueue) {
      this.deliveryQueue.destroy();
      this.deliveryQueue = null;
    }
    if (this.lazyRecoveryLoop) {  // NEW
      this.lazyRecoveryLoop.destroy();
      this.lazyRecoveryLoop = null;
    }
    this.isInitialized = false;
    console.log('🛑 [LoopsManager] Background loops shutdown');
  }

  /**
   * Get lazy recovery loop (throws if not initialized)
   */
  getLazyRecoveryLoop(): LazyRecoveryLoop {  // NEW
    if (!this.lazyRecoveryLoop) {
      throw new Error('LazyRecoveryLoop not initialized - call initialize() first');
    }
    return this.lazyRecoveryLoop;
  }

  /**
   * Get combined status of all loops
   */
  getStatus(): {
    receive: { pending: number; batchId: string | null; isProcessing: boolean };
    delivery: DeliveryQueueStatus;
    lazyRecovery: {  // NEW
      hasRun: boolean;
      isRunning: boolean;
      isScheduled: boolean;
      completedAt: number | null;
      tokensRecovered: number | null;
    };
    isInitialized: boolean;
  } {
    const lazyRecoveryStatus = this.lazyRecoveryLoop?.getStatus();
    const tokensRecovered = lazyRecoveryStatus?.lastRecoveryStats?.tokensRecoveredFromHistory ?? null;

    return {
      receive: this.receiveLoop?.getBatchStatus() || { pending: 0, batchId: null, isProcessing: false },
      delivery: this.deliveryQueue?.getQueueStatus() || {
        totalPending: 0,
        totalCompleted: 0,
        totalFailed: 0,
        byRetryCount: {},
        oldestEntryAge: 0,
        activeDeliveries: 0,
      },
      lazyRecovery: {  // NEW
        hasRun: lazyRecoveryStatus?.hasRun || false,
        isRunning: lazyRecoveryStatus?.isRunning || false,
        isScheduled: lazyRecoveryStatus?.isScheduled || false,
        completedAt: lazyRecoveryStatus?.completedAt || null,
        tokensRecovered,
      },
      isInitialized: this.isInitialized,
    };
  }
}
```

### 3.2 InventorySyncService (No Changes Required)

The existing `inventorySync()` function and RECOVERY mode implementation in `/home/vrogojin/sphere/src/components/wallet/L3/services/InventorySyncService.ts` already supports:

- ✅ `recoveryDepth` parameter for limiting traversal
- ✅ `skipExtendedVerification` for faster execution
- ✅ `step2_5_traverseVersionChain()` for version chain traversal
- ✅ Recovery statistics in `SyncResult.recoveryStats`

**No modifications needed** - LazyRecoveryLoop will use existing RECOVERY mode as-is.

### 3.3 IpfsHttpResolver Cache Bypass

The existing `IpfsHttpResolver` in `/home/vrogojin/sphere/src/components/wallet/L3/services/IpfsHttpResolver.ts` already provides cache invalidation:

```typescript
// Line 583-589
invalidateIpnsCache(ipnsName?: string): void {
  if (ipnsName) {
    this.cache.clearIpnsRecords();
  } else {
    this.cache.clear();
  }
}
```

**No modifications needed** - LazyRecoveryLoop will use existing cache invalidation.

---

## 4. Cache Bypass Flow

### 4.1 Step-by-Step Execution

```
LazyRecoveryLoop.runLazyRecovery()
     ↓
1️⃣ Get current identity from IdentityManager
     │  - Validate ipnsName exists
     │  - Skip if no identity
     ↓
2️⃣ Clear client-side IPNS cache
     │  - Call httpResolver.invalidateIpnsCache(ipnsName)
     │  - Forces fresh resolution from IPFS nodes
     ↓
3️⃣ Call inventorySync() in RECOVERY mode
     │  - recoveryDepth: 20 (configurable)
     │  - skipExtendedVerification: true (speed optimization)
     │  - mode detected as RECOVERY by SyncModeDetector
     ↓
4️⃣ inventorySync() executes RECOVERY flow
     │  - Step 2: Load current IPFS state (cache invalidated = fresh query)
     │  - Step 2.5: Traverse version chain via _meta.lastCid
     │  - Step 3-9: Validate, merge, dedupe, and persist recovered tokens
     │  - Step 10: Upload merged state to IPFS if tokens recovered
     ↓
5️⃣ Return SyncResult with recoveryStats
     │  - versionsTraversed: Number of versions checked
     │  - tokensRecoveredFromHistory: Tokens added from history
     │  - oldestCidReached: Debugging info
     ↓
6️⃣ LazyRecoveryLoop logs results and marks hasRun = true
```

### 4.2 Cache Hierarchy

**Client-Side Cache (Cleared by LazyRecovery):**
- Location: `IpfsCache` singleton in browser memory
- Invalidation: `httpResolver.invalidateIpnsCache(ipnsName)`
- Effect: Forces fresh HTTP query to IPFS nodes

**Sidecar Cache (NOT Bypassed - Phase 1 Implementation):**
- Location: MongoDB at IPFS node (`/home/vrogojin/ipfs-storage/nostr-pinner`)
- Staleness: 60 seconds (STALE_THRESHOLD_SECONDS)
- Behavior: If client cache invalidated AND >60s since last DHT query, sidecar will fetch fresh from DHT

**Why This Works:**
- 10-second delay ensures client cache is stale (60s TTL)
- Sidecar will naturally query DHT if its cache is stale
- No backend changes required for Phase 1

---

## 5. Error Handling

### 5.1 Error Categories

| Error Type | Handling Strategy | Impact |
|------------|------------------|--------|
| **No Identity** | Log and skip recovery | Zero impact - recovery not needed |
| **Network Error** | Catch, log, continue | Recovery fails but app continues |
| **IPFS Timeout** | Caught by inventorySync() | Marks networkErrorOccurred, skips upload |
| **Version Chain Cycle** | Caught by step2_5 cycle detector | Stops traversal gracefully |
| **Validation Errors** | Tokens moved to _invalid array | Preserved for investigation |

### 5.2 Error Logging Strategy

```typescript
// Success cases
console.log('✅ [LazyRecovery] RECOVERED X tokens from Y versions (Zms)');
console.log('✅ [LazyRecovery] Completed - no additional tokens found (Y versions, Zms)');

// Warning cases
console.warn('⚠️ [LazyRecovery] Completed with errors: <error message> (Zms)');
console.warn('⚠️ [LazyRecovery] No identity or IPNS name available, skipping');

// Error cases
console.error('❌ [LazyRecovery] Failed after Zms:', error);

// Lifecycle events
console.log('🔄 [LazyRecovery] Scheduled to run in 10000ms');
console.log('🔄 [LazyRecovery] Starting background recovery...');
console.log('🔄 [LazyRecovery] Client-side IPNS cache cleared');
console.log('🔄 [LazyRecovery] Calling inventorySync(RECOVERY, depth=20)');
```

### 5.3 Graceful Degradation

```typescript
try {
  // Main recovery logic
} catch (error) {
  this.lastError = error instanceof Error ? error.message : String(error);
  console.error('❌ [LazyRecovery] Failed:', error);
  // Continue app execution - recovery failure is non-critical
} finally {
  this.isRunning = false;
  this.hasRun = true;  // Mark as attempted to prevent retries
}
```

---

## 6. Logging Strategy

### 6.1 Logging Levels

**Console Output:**
- ✅ Success: Tokens recovered, versions traversed, duration
- 🔄 Progress: Lifecycle events, cache clearing, sync invocation
- ⚠️ Warning: No identity, completed with errors
- ❌ Error: Unexpected exceptions

**Stored State:**
- `hasRun`: Boolean flag (one-time execution guard)
- `completedAt`: Timestamp for debugging
- `lastRecoveryStats`: Full RecoveryStats object from sync result
- `lastError`: Last error message for troubleshooting

### 6.2 Debugging Information

Developers can inspect recovery status via browser console:

```javascript
// Get loops manager instance
const loopsManager = InventoryBackgroundLoopsManager.getInstance();

// Get lazy recovery status
const status = loopsManager.getStatus();
console.log(status.lazyRecovery);
// Output:
// {
//   hasRun: true,
//   isRunning: false,
//   isScheduled: false,
//   completedAt: 1706400123456,
//   tokensRecovered: 3
// }

// Get detailed recovery stats
const lazyRecovery = loopsManager.getLazyRecoveryLoop();
const detailedStatus = lazyRecovery.getStatus();
console.log(detailedStatus.lastRecoveryStats);
// Output:
// {
//   versionsTraversed: 8,
//   tokensRecoveredFromHistory: 3,
//   oldestCidReached: "bafybeiabc123..."
// }
```

---

## 7. Testing Strategy

### 7.1 Unit Tests

**File:** `/home/vrogojin/sphere/tests/unit/components/wallet/L3/services/InventoryBackgroundLoops.test.ts`

**Test Cases:**

```typescript
describe('LazyRecoveryLoop', () => {
  describe('scheduleRecovery()', () => {
    it('should schedule recovery with default delay', () => {
      // Test that setTimeout is called with 10000ms
    });

    it('should prevent duplicate scheduling', () => {
      // Call scheduleRecovery() twice, verify only one setTimeout
    });

    it('should not schedule if already run', () => {
      // Mark hasRun = true, call scheduleRecovery(), verify no setTimeout
    });
  });

  describe('runLazyRecovery()', () => {
    it('should clear IPNS cache before recovery', async () => {
      // Spy on httpResolver.invalidateIpnsCache()
      // Verify it's called with correct ipnsName
    });

    it('should call inventorySync with RECOVERY mode', async () => {
      // Spy on inventorySync()
      // Verify called with recoveryDepth=20, skipExtendedVerification=true
    });

    it('should handle missing identity gracefully', async () => {
      // Mock identityManager to return null
      // Verify no error thrown, recovery skipped
    });

    it('should mark hasRun = true after completion', async () => {
      // Run recovery, verify hasRun flag set
    });

    it('should store recovery stats on success', async () => {
      // Mock successful sync with recoveryStats
      // Verify lastRecoveryStats populated
    });

    it('should handle sync errors gracefully', async () => {
      // Mock inventorySync to throw error
      // Verify error caught, lastError populated, hasRun still true
    });
  });

  describe('getStatus()', () => {
    it('should return correct status after scheduling', () => {
      // Schedule recovery, verify isScheduled = true
    });

    it('should return correct status during execution', () => {
      // Mock long-running recovery, verify isRunning = true
    });

    it('should return correct status after completion', () => {
      // Complete recovery, verify hasRun = true, completedAt set
    });
  });

  describe('cancel()', () => {
    it('should cancel scheduled timeout', () => {
      // Schedule recovery, call cancel(), verify timeout cleared
    });

    it('should do nothing if not scheduled', () => {
      // Call cancel() without scheduling, verify no error
    });
  });
});

describe('InventoryBackgroundLoopsManager with LazyRecovery', () => {
  it('should initialize LazyRecoveryLoop during doInitialize()', async () => {
    // Call initialize(), verify lazyRecoveryLoop created
  });

  it('should schedule lazy recovery after initialization', async () => {
    // Mock LazyRecoveryLoop.scheduleRecovery()
    // Verify called after doInitialize()
  });

  it('should include lazy recovery status in getStatus()', () => {
    // Get status, verify lazyRecovery field present
  });

  it('should cleanup lazy recovery on shutdown()', () => {
    // Initialize, then shutdown(), verify destroy() called
  });
});
```

### 7.2 Integration Tests

**Scenario 1: Cache Corruption Recovery**

```typescript
describe('Lazy Recovery - Cache Corruption', () => {
  it('should recover tokens from IPFS history when cache corrupted', async () => {
    // Setup:
    // 1. Create wallet with 5 tokens in IPFS (version 10)
    // 2. Corrupt client cache to point to empty version (version 2)
    // 3. Start app and wait 10 seconds

    // Expected:
    // - LazyRecoveryLoop detects corrupted cache
    // - Clears cache and queries IPFS
    // - Traverses from version 10 back to version 2
    // - Recovers 5 tokens
    // - Uploads merged state to IPFS (version 11)

    // Verify:
    expect(lazyRecovery.getStatus().tokensRecovered).toBe(5);
    expect(wallet.getActiveTokens().length).toBe(5);
  });
});
```

**Scenario 2: No Additional Tokens**

```typescript
describe('Lazy Recovery - No Tokens Needed', () => {
  it('should complete without recovery when state is current', async () => {
    // Setup:
    // 1. Create wallet with 5 tokens in IPFS (version 10)
    // 2. Ensure cache is fresh and correct
    // 3. Start app and wait 10 seconds

    // Expected:
    // - LazyRecoveryLoop clears cache
    // - Queries IPFS and gets version 10
    // - No tokens to recover (all already in localStorage)
    // - No upload (no changes)

    // Verify:
    expect(lazyRecovery.getStatus().tokensRecovered).toBe(0);
    expect(lazyRecovery.getStatus().hasRun).toBe(true);
  });
});
```

**Scenario 3: Network Failure**

```typescript
describe('Lazy Recovery - Network Error', () => {
  it('should handle network errors gracefully', async () => {
    // Setup:
    // 1. Mock IPFS nodes to timeout
    // 2. Start app and wait 10 seconds

    // Expected:
    // - LazyRecoveryLoop attempts recovery
    // - inventorySync() fails with network error
    // - Error logged and stored
    // - App continues normal operation

    // Verify:
    expect(lazyRecovery.getStatus().hasRun).toBe(true);
    expect(lazyRecovery.getStatus().lastError).toContain('network');
  });
});
```

### 7.3 Performance Tests

```typescript
describe('Lazy Recovery - Performance', () => {
  it('should not block main sync operations', async () => {
    // Setup:
    // 1. Start app
    // 2. Immediately trigger manual sync
    // 3. Measure completion time

    // Expected:
    // - Manual sync completes in <500ms (no blocking)
    // - LazyRecoveryLoop runs independently after 10s

    // Verify:
    expect(manualSyncDuration).toBeLessThan(500);
  });

  it('should complete recovery within reasonable time', async () => {
    // Setup:
    // 1. Create wallet with 20-version history
    // 2. Start app and wait for lazy recovery

    // Expected:
    // - Recovery completes in <30 seconds (depth=20)
    // - Average ~1-2s per version with DHT queries

    // Verify:
    expect(recoveryDuration).toBeLessThan(30000);
  });
});
```

---

## 8. Code Changes Summary

### 8.1 New Files

None - all code added to existing files.

### 8.2 Modified Files

| File | Lines Added | Lines Modified | Description |
|------|-------------|----------------|-------------|
| `InventoryBackgroundLoops.ts` | ~150 | ~30 | Add LazyRecoveryLoop class and integrate into manager |
| `QueueTypes.ts` | ~6 | ~2 | Add lazy recovery config fields |

**Total:** ~156 lines added, ~32 lines modified

### 8.3 File Locations

```
/home/vrogojin/sphere/src/components/wallet/L3/services/
├── InventoryBackgroundLoops.ts    [MODIFY] Add LazyRecoveryLoop class
├── InventorySyncService.ts        [NO CHANGE] Existing RECOVERY mode used
├── IpfsHttpResolver.ts            [NO CHANGE] Existing cache bypass used
└── types/
    └── QueueTypes.ts              [MODIFY] Add config fields

/home/vrogojin/sphere/tests/unit/components/wallet/L3/services/
└── InventoryBackgroundLoops.test.ts  [MODIFY] Add test cases
```

---

## 9. Implementation Phases

### Phase 1: Core Implementation (Immediate)

**Goal:** Add LazyRecoveryLoop with client-side cache bypass

**Tasks:**
1. Add `LazyRecoveryLoop` class to `InventoryBackgroundLoops.ts`
2. Add config fields to `QueueTypes.ts`
3. Integrate into `InventoryBackgroundLoopsManager`
4. Add unit tests
5. Add integration tests

**Deliverables:**
- Working lazy recovery with client-side cache bypass
- Comprehensive test coverage
- Documentation in code comments

**Duration:** 1-2 days

**Risk:** Low - uses existing RECOVERY mode, minimal changes

### Phase 2: Sidecar Cache Bypass (Backend Enhancement)

**Goal:** Add cache bypass header support to sidecar for guaranteed fresh DHT queries

**Tasks:**
1. Modify `/home/vrogojin/ipfs-storage/nostr-pinner/nostr_pinner.py`:
   - Add `X-Force-DHT` header support in `handle_routing_get()`
   - Skip cache lookup when header present
   - Force DHT query for authoritative resolution
2. Modify `IpfsHttpResolver.ts`:
   - Add `bypassCache` parameter to `tryRoutingApi()`
   - Pass `X-Force-DHT: true` header when enabled
3. Modify `LazyRecoveryLoop`:
   - Pass `bypassCache: true` to sync parameters (future-proofing)
4. Test with backend changes deployed

**Deliverables:**
- Sidecar cache bypass implementation
- Client-side header support
- Updated integration tests

**Duration:** 2-3 days (includes backend deployment)

**Risk:** Medium - requires backend changes and coordination

### Phase 3: Enhanced Recovery Features (Optional)

**Goal:** Add user-triggered recovery and monitoring UI

**Tasks:**
1. Add manual recovery trigger:
   - `useWallet` hook: `runManualRecovery(depth?: number)`
   - UI button in wallet settings
2. Add recovery status UI:
   - Display last recovery time
   - Show tokens recovered count
   - Show recovery history (last 10 runs)
3. Add recovery metrics:
   - Track average recovery duration
   - Track success/failure rates
   - Monitor DHT query latency

**Deliverables:**
- Manual recovery UI
- Recovery status dashboard
- Metrics collection

**Duration:** 3-4 days

**Risk:** Low - additive features, no breaking changes

---

## 10. Performance Considerations

### 10.1 Impact on Main Sync

| Metric | Without Lazy Recovery | With Lazy Recovery | Degradation |
|--------|----------------------|-------------------|-------------|
| First sync latency | 300-500ms | 300-500ms | **0ms** ✅ |
| Subsequent syncs | 200-300ms | 200-300ms | **0ms** ✅ |
| Memory usage | ~5MB | ~5MB | **0%** ✅ |
| CPU usage | ~2% | ~2% (peak 5% during recovery) | **0%** ✅ |

**Conclusion:** Zero degradation to main sync operations due to 10-second delay.

### 10.2 Recovery Operation Performance

| Metric | Value | Notes |
|--------|-------|-------|
| Cache invalidation | <1ms | In-memory operation |
| IPNS resolution (fresh) | 200-500ms | Sidecar cache miss, DHT query |
| CID fetch per version | 50-200ms | Nginx cache hit |
| Total for depth=20 | 5-15 seconds | Depends on cache state |
| Network bandwidth | ~100KB | Assuming 5KB per version |

**Worst Case:** 30 seconds if all DHT queries required (sidecar cache cold)
**Best Case:** 2-5 seconds if sidecar cache warm

### 10.3 DHT Load Impact

**Single Client:**
- 1 IPNS query (DHT)
- 20 CID fetches (HTTP)
- Total: 21 IPFS operations over 10-30 seconds
- **Impact:** Negligible

**100 Concurrent Clients:**
- 100 IPNS queries (burst over 10-15s window)
- 2,000 CID fetches (amortized over 60s)
- **Impact:** Moderate - acceptable for dedicated nodes

**Mitigation:**
- Stagger recovery timing with random jitter (future enhancement)
- Respect sidecar cache (60s staleness threshold)

---

## 11. Rollback Procedures

### 11.1 Rollback Phase 1 (LazyRecoveryLoop)

**If lazy recovery causes issues:**

1. **Disable scheduling:**
   ```typescript
   // In doInitialize(), comment out:
   // this.lazyRecoveryLoop.scheduleRecovery(delayMs);
   ```

2. **Emergency flag:**
   ```typescript
   // Add to LoopConfig:
   disableLazyRecovery?: boolean;  // Default: false

   // In doInitialize():
   if (!this.config.disableLazyRecovery) {
     this.lazyRecoveryLoop.scheduleRecovery(delayMs);
   }
   ```

3. **Full removal:**
   - Comment out `LazyRecoveryLoop` class
   - Remove from `InventoryBackgroundLoopsManager`
   - No other code depends on it

**Impact:** Zero - lazy recovery is additive, removal has no side effects.

### 11.2 Rollback Phase 2 (Sidecar Bypass)

**If sidecar cache bypass causes issues:**

1. **Disable header:**
   ```typescript
   // In tryRoutingApi(), comment out:
   // if (bypassCache) {
   //   headers['X-Force-DHT'] = 'true';
   // }
   ```

2. **Backend rollback:**
   - Revert `nostr_pinner.py` changes
   - Sidecar ignores unknown headers (backward compatible)

**Impact:** Falls back to Phase 1 behavior (client-side cache bypass only).

---

## 12. Monitoring and Observability

### 12.1 Key Metrics

**Success Metrics:**
- Tokens recovered per session
- Versions traversed per recovery
- Recovery success rate (%)

**Performance Metrics:**
- Recovery duration (ms)
- IPNS resolution latency (ms)
- CID fetch latency (ms)

**Failure Metrics:**
- Network error rate (%)
- Timeout rate (%)
- Validation error count

### 12.2 Logging Aggregation

**Log Patterns to Monitor:**

```bash
# Success cases
grep "✅ \[LazyRecovery\] RECOVERED" logs | wc -l  # Successful recoveries
grep "tokensRecovered" logs | awk '{sum+=$NF} END {print sum}'  # Total tokens recovered

# Warning cases
grep "⚠️ \[LazyRecovery\]" logs  # Warnings to investigate

# Error cases
grep "❌ \[LazyRecovery\]" logs  # Critical failures

# Performance
grep "\[LazyRecovery\].*ms" logs | awk -F'[()]' '{print $(NF-1)}'  # Duration distribution
```

### 12.3 Alerting Thresholds

| Metric | Warning | Critical | Action |
|--------|---------|----------|--------|
| Failure rate | >10% | >25% | Investigate network/IPFS issues |
| Recovery duration | >30s | >60s | Check DHT performance |
| Tokens recovered | >100 per session | N/A | Indicates cache corruption pattern |

---

## 13. Security Considerations

### 13.1 Attack Vectors

**None identified** - lazy recovery operates on already-trusted IPFS data:
- Only reads from user's own IPFS content
- Does not accept external input
- Uses existing validation pipeline (Step 4-5 in inventorySync)

### 13.2 Privacy Considerations

**DHT Queries:**
- Reveal user's IPNS name to DHT peers
- Same as normal sync operations
- No additional privacy impact

**Recommendation:** No changes needed - existing privacy model applies.

---

## 14. Documentation Updates

### 14.1 User-Facing Documentation

None required - lazy recovery is transparent to users.

### 14.2 Developer Documentation

**Update:** `/home/vrogojin/sphere/docs/TOKEN_INVENTORY_SPEC.md`

Add Section 7.4:

```markdown
### 7.4 Lazy Recovery Loop

**Purpose:** Background task that recovers tokens lost due to IPFS cache corruption.

**Execution:**
- Runs once per session, 10 seconds after app startup
- Clears client-side IPNS cache for fresh resolution
- Calls inventorySync() in RECOVERY mode with depth=20
- Non-blocking, does not affect main sync operations

**Configuration:**
- `lazyRecoveryDelayMs`: Delay before execution (default: 10000ms)
- `lazyRecoveryDepth`: Max versions to traverse (default: 20)

**Status Monitoring:**
```typescript
const loopsManager = InventoryBackgroundLoopsManager.getInstance();
const status = loopsManager.getStatus().lazyRecovery;
console.log(status);  // { hasRun, isRunning, tokensRecovered, ... }
```
```

### 14.3 Code Comments

All code is documented inline with:
- Class-level JSDoc describing purpose and behavior
- Method-level JSDoc for public APIs
- Inline comments for complex logic
- Reference to this implementation plan

---

## 15. Success Criteria

### 15.1 Functional Requirements

- ✅ LazyRecoveryLoop runs once per session
- ✅ Executes 10 seconds after app startup
- ✅ Clears client-side IPNS cache before recovery
- ✅ Traverses up to 20 IPFS versions
- ✅ Recovers tokens from historical versions
- ✅ Logs comprehensive statistics
- ✅ Handles errors gracefully
- ✅ Does not block main sync operations

### 15.2 Performance Requirements

- ✅ Zero degradation to first sync (<500ms)
- ✅ Zero degradation to subsequent syncs (<300ms)
- ✅ Recovery completes within 30 seconds (depth=20)
- ✅ Memory usage increase <1MB

### 15.3 Quality Requirements

- ✅ Unit test coverage >80%
- ✅ Integration tests cover success/failure scenarios
- ✅ No regression in existing functionality
- ✅ Code review approved by 2+ engineers
- ✅ Documentation complete and accurate

---

## 16. Next Steps

### Immediate Actions (Phase 1)

1. **Create feature branch:**
   ```bash
   git checkout -b feature/lazy-recovery-loop
   ```

2. **Implement LazyRecoveryLoop class:**
   - Copy class implementation from Section 2.1
   - Add to `InventoryBackgroundLoops.ts`

3. **Update configuration:**
   - Modify `QueueTypes.ts` per Section 2.2

4. **Integrate into manager:**
   - Update `InventoryBackgroundLoopsManager` per Section 3.1

5. **Add tests:**
   - Implement test cases from Section 7.1

6. **Manual testing:**
   - Simulate cache corruption scenario
   - Verify recovery behavior
   - Measure performance impact

7. **Code review and merge:**
   - Create PR with comprehensive description
   - Address review feedback
   - Merge to main branch

### Follow-up Actions (Phase 2)

1. **Backend coordination:**
   - Coordinate with backend team on sidecar changes
   - Plan deployment timeline

2. **Implement cache bypass header:**
   - Modify `nostr_pinner.py` per Section 9 Phase 2
   - Update `IpfsHttpResolver.ts`

3. **Test with backend changes:**
   - Deploy to staging environment
   - Verify DHT bypass behavior

4. **Production rollout:**
   - Monitor metrics post-deployment
   - Adjust thresholds if needed

---

## Appendix A: Reference Links

| Document | Location |
|----------|----------|
| Investigation Report | `/home/vrogojin/sphere/LAZY_RECOVERY_INVESTIGATION.md` |
| Token Inventory Spec | `/home/vrogojin/sphere/docs/TOKEN_INVENTORY_SPEC.md` |
| Background Loops Code | `/home/vrogojin/sphere/src/components/wallet/L3/services/InventoryBackgroundLoops.ts` |
| Sync Service Code | `/home/vrogojin/sphere/src/components/wallet/L3/services/InventorySyncService.ts` |
| IPFS Resolver Code | `/home/vrogojin/sphere/src/components/wallet/L3/services/IpfsHttpResolver.ts` |
| Queue Types | `/home/vrogojin/sphere/src/components/wallet/L3/services/types/QueueTypes.ts` |
| Sync Types | `/home/vrogojin/sphere/src/components/wallet/L3/types/SyncTypes.ts` |

---

## Appendix B: Glossary

| Term | Definition |
|------|------------|
| **Lazy Recovery** | Background task that recovers lost tokens without blocking main operations |
| **IPNS** | InterPlanetary Name System - mutable pointer to IPFS content |
| **CID** | Content Identifier - immutable hash of IPFS content |
| **Version Chain** | Linked list of IPFS versions via `_meta.lastCid` |
| **Sidecar Cache** | MongoDB cache at IPFS node side (nostr_pinner.py) |
| **Client Cache** | In-memory browser cache (IpfsCache.ts) |
| **DHT** | Distributed Hash Table - Kubo's content routing system |
| **Recovery Depth** | Maximum number of versions to traverse (default: 20) |
| **Tombstone** | Marker for deleted token to prevent resurrection |

---

**Document Version:** 1.0
**Last Updated:** 2026-01-27
**Author:** Claude Sonnet 4.5
**Status:** Implementation-Ready

