# Dual Sync Anti-Pattern: Detailed Code Changes

**File:** `/home/vrogojin/sphere/src/components/wallet/L3/services/IpfsStorageService.ts`
**Total Changes:** 5 specific modifications
**Risk Level:** LOW (backward compatible, only removes auto-trigger)

---

## Change 1: Disable wallet-updated Event Listener (Line 240)

### Location
File: `IpfsStorageService.ts`
Method: `startAutoSync()`
Lines: 233-250

### Current Code
```typescript
/**
 * Start listening for wallet changes and enable auto-sync
 * Safe to call multiple times - will only initialize once
 */
startAutoSync(): void {
  if (this.autoSyncEnabled) {
    return; // Already enabled
  }

  // Create bound handler to allow proper cleanup
  this.boundSyncHandler = () => this.scheduleSync();
  window.addEventListener("wallet-updated", this.boundSyncHandler);  // ← LINE 240
  this.autoSyncEnabled = true;
  console.log("📦 IPFS auto-sync enabled");

  // Set up IPNS polling with visibility-based control
  this.setupVisibilityListener();

  // On startup, run IPNS-based sync to discover remote state
  // This resolves IPNS, verifies remote content, and merges if needed
  this.syncFromIpns().catch(console.error);
}
```

### Modified Code
```typescript
/**
 * Start listening for wallet changes and enable auto-sync
 * Safe to call multiple times - will only initialize once
 *
 * DEPRECATED (2026-01-18): Auto-sync now delegated to InventorySyncService
 * See: https://github.com/UnicitySphere/sphere/issues/XXX (Dual Sync Anti-Pattern)
 */
startAutoSync(): void {
  if (this.autoSyncEnabled) {
    return; // Already enabled
  }

  // DEPRECATED: wallet-updated listener removed to prevent dual-publish race conditions
  // Auto-sync is now handled by InventorySyncService.inventorySync()
  // which orchestrates the full 10-step validation pipeline.
  //
  // Create bound handler to allow proper cleanup
  // this.boundSyncHandler = () => this.scheduleSync();
  // window.addEventListener("wallet-updated", this.boundSyncHandler);

  this.autoSyncEnabled = true; // Keep flag for backward compatibility
  console.log("📦 IPFS auto-sync disabled (delegated to InventorySyncService)");
  console.warn("⚠️  DEPRECATED: IpfsStorageService.startAutoSync() is deprecated in favor of InventorySyncService");

  // DEPRECATED: IPNS polling moved to InventorySyncService background loops
  // this.setupVisibilityListener();

  // DEPRECATED: Startup IPNS sync moved to DashboardLayout/ServicesProvider
  // Background loops (InventoryBackgroundLoopsManager) handle initial inventory discovery
  // this.syncFromIpns().catch(console.error);
}
```

### Rationale
- **Prevents race condition:** Two independent services no longer both publish to same IPNS name
- **Sequence number conflicts eliminated:** Only InventorySyncService publishes (seq=8,9)
- **Backward compatible:** Flag `autoSyncEnabled` still set, method still callable
- **Clear deprecation path:** Warnings guide developers to InventorySyncService

### Testing Impact
- **Tests that check for "wallet-updated" listener:** Will fail
  - **Fix:** Update test to verify `console.warn` deprecation message instead
  - **Example:**
    ```typescript
    // Before:
    expect(addEventListenerSpy).toHaveBeenCalledWith("wallet-updated", expect.any(Function));

    // After:
    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("DEPRECATED"));
    ```

---

## Change 2: Update shutdown() to Handle Null boundSyncHandler (Lines 256-260)

### Location
File: `IpfsStorageService.ts`
Method: `shutdown()`
Lines: 255-270

### Current Code
```typescript
/**
 * Graceful shutdown
 */
async shutdown(): Promise<void> {
  // Remove event listener
  if (this.boundSyncHandler) {
    window.removeEventListener("wallet-updated", this.boundSyncHandler);  // ← SAFE (already null)
    this.boundSyncHandler = null;
  }
  this.autoSyncEnabled = false;

  // Clean up IPNS polling and visibility listener
  this.cleanupVisibilityListener();

  // Shutdown sync queue
  if (this.syncQueue) {
    this.syncQueue.shutdown();
    this.syncQueue = null;
  }
  // ... rest of shutdown code
}
```

### Modified Code
```typescript
/**
 * Graceful shutdown
 */
async shutdown(): Promise<void> {
  // Remove event listener
  // NOTE: boundSyncHandler is null in new implementation (startAutoSync doesn't set it)
  // But keeping this defensive cleanup in case old code paths call startAutoSync
  if (this.boundSyncHandler) {
    window.removeEventListener("wallet-updated", this.boundSyncHandler);
    this.boundSyncHandler = null;
  }
  this.autoSyncEnabled = false;

  // DEPRECATED: cleanupVisibilityListener is defensive only (no-op in new implementation)
  // IPNS polling moved to InventorySyncService background loops
  this.cleanupVisibilityListener();

  // Shutdown sync queue
  if (this.syncQueue) {
    this.syncQueue.shutdown();
    this.syncQueue = null;
  }
  // ... rest of shutdown code
}
```

### Rationale
- **No functional change** - `boundSyncHandler` is already null (never set)
- **Defensive cleanup** - preserves safety for any code paths that might call `startAutoSync()`
- **Comments explain deprecation** - clarifies intent for future maintainers

### Testing Impact
- **No test changes needed** - shutdown behavior unchanged
- **Tests that verify listener removal:** Still pass (null check prevents error)

---

## Change 3: Add Deprecation Warning to scheduleSync() (Lines 3004-3016)

### Location
File: `IpfsStorageService.ts`
Method: `scheduleSync()`
Lines: 3004-3016

### Current Code
```typescript
/**
 * Schedule a debounced sync using the queue with LOW priority (auto-coalesced)
 * The SyncQueue handles coalescing of multiple LOW priority requests
 */
private scheduleSync(): void {
  if (this.syncTimer) {
    clearTimeout(this.syncTimer);
  }
  // Use a small delay to batch rapid-fire wallet-updated events
  this.syncTimer = setTimeout(() => {
    this.syncNow({
      priority: SyncPriority.LOW,
      callerContext: 'auto-sync',
      coalesce: true,
    }).catch(console.error);
  }, SYNC_DEBOUNCE_MS);
}
```

### Modified Code
```typescript
/**
 * Schedule a debounced sync using the queue with LOW priority (auto-coalesced)
 * The SyncQueue handles coalescing of multiple LOW priority requests
 *
 * DEPRECATED (2026-01-18): No longer called by startAutoSync()
 * Use InventorySyncService.inventorySync() directly instead.
 */
private scheduleSync(): void {
  console.warn("⚠️  DEPRECATED: IpfsStorageService.scheduleSync() is deprecated. Use InventorySyncService.inventorySync() instead.");

  if (this.syncTimer) {
    clearTimeout(this.syncTimer);
  }
  // Use a small delay to batch rapid-fire wallet-updated events
  this.syncTimer = setTimeout(() => {
    this.syncNow({
      priority: SyncPriority.LOW,
      callerContext: 'auto-sync',
      coalesce: true,
    }).catch(console.error);
  }, SYNC_DEBOUNCE_MS);
}
```

### Rationale
- **Method kept for compatibility** - may be called by external code
- **Warning added** - guides developers away from deprecated code path
- **Still functional** - continues to work if called, but logs deprecation

### Testing Impact
- **No breaking changes** - deprecation warning doesn't affect tests
- **May spam console in test output** - consider setting env var to suppress in CI

---

## Change 4: Add Deprecation Warning to syncFromIpns() (Lines 3031-3050)

### Location
File: `IpfsStorageService.ts`
Method: `syncFromIpns()`
Lines: 3031-3050

### Current Code
```typescript
/**
 * Sync from IPNS on startup - resolves IPNS and merges with local state
 * Uses progressive multi-gateway resolution for conflict detection
 *
 * Flow:
 * 0. Retry any pending IPNS publishes from previous failed syncs
 * 1. Resolve IPNS progressively from all gateways (highest sequence wins)
 * 2. Compare with local CID - if different, fetch remote content
 * 3. Version comparison: remote > local → import; local > remote → sync to update IPNS
 * 4. Always verify remote is fetchable (handles interrupted syncs)
 * 5. If fetch fails, fall back to normal sync (republish local)
 * 6. Late-arriving higher sequences trigger automatic merge
 */
async syncFromIpns(): Promise<StorageResult> {
  console.log(`📦 Starting IPNS-based sync...`);

  // Set initial syncing flag for UI feedback
  this.isInitialSyncing = true;
  // ... rest of implementation
}
```

### Modified Code
```typescript
/**
 * Sync from IPNS on startup - resolves IPNS and merges with local state
 * Uses progressive multi-gateway resolution for conflict detection
 *
 * DEPRECATED (2026-01-18): Startup IPNS sync moved to InventorySyncService
 * Use inventorySync({ local: false }) to trigger full sync instead.
 *
 * Flow:
 * 0. Retry any pending IPNS publishes from previous failed syncs
 * 1. Resolve IPNS progressively from all gateways (highest sequence wins)
 * 2. Compare with local CID - if different, fetch remote content
 * 3. Version comparison: remote > local → import; local > remote → sync to update IPNS
 * 4. Always verify remote is fetchable (handles interrupted syncs)
 * 5. If fetch fails, fall back to normal sync (republish local)
 * 6. Late-arriving higher sequences trigger automatic merge
 */
async syncFromIpns(): Promise<StorageResult> {
  console.log(`📦 Starting IPNS-based sync...`);
  console.warn("⚠️  DEPRECATED: IpfsStorageService.syncFromIpns() is deprecated. Use InventorySyncService.inventorySync() instead.");

  // Set initial syncing flag for UI feedback
  this.isInitialSyncing = true;
  // ... rest of implementation
}
```

### Rationale
- **Startup sync moved** - InventorySyncService handles full 10-step flow
- **Method kept for compatibility** - may be called by external code (OutboxRecoveryService)
- **Warning guides migration** - points developers to correct API

### Testing Impact
- **OutboxRecoveryService may call this** - verify it migrates to inventorySync()
- **Deprecation warning in tests** - expected, document in test comments
- **Integration tests may need update** - if they directly test this method

---

## Change 5: Update Method Comments for Transport Interface (No Code Changes)

### Location
File: `IpfsStorageService.ts`
Methods: All public transport methods (lines vary)

### Methods to Document
```typescript
// These methods remain STABLE - they form the IpfsTransport interface
public async resolveIpns(): Promise<IpfsResolutionResult>
public async uploadContent(data: TxfStorageData): Promise<IpfsUploadResult>
public async publishIpns(cid: string): Promise<IpfsPublishResult>
public async getIpnsName(): Promise<string>
public async ensureInitialized(): Promise<boolean>
public setLastCid(cid: string): void
public isWebCryptoAvailable(): boolean
```

### Change: Add Comment Block
```typescript
// ==========================================
// IpfsTransport Interface - STABLE API
// ==========================================
// These methods form the core IPFS transport layer
// and are called by InventorySyncService in Step 10.
//
// Do NOT deprecate - these are the canonical transport methods.
// ==========================================

/**
 * Resolve IPNS name to content
 * Part of IpfsTransport interface - DO NOT DEPRECATE
 */
public async resolveIpns(): Promise<IpfsResolutionResult> {
  // ...
}

/**
 * Upload content to IPFS
 * Part of IpfsTransport interface - DO NOT DEPRECATE
 */
public async uploadContent(data: TxfStorageData): Promise<IpfsUploadResult> {
  // ...
}

// ... etc for other transport methods
```

### Rationale
- **Clarifies API stability** - transport methods are NOT deprecated
- **Guides future refactoring** - marks public API boundaries
- **Prevents accidental removal** - clearly distinguishes transport from auto-sync

### Testing Impact
- **No test changes needed** - documentation only

---

## Summary of Changes

| Change # | Method | Lines | Type | Impact | Risk |
|----------|--------|-------|------|--------|------|
| 1 | `startAutoSync()` | 233-250 | Remove listener | Disables auto-trigger | LOW |
| 2 | `shutdown()` | 256-260 | Add comments | Defensive cleanup | LOW |
| 3 | `scheduleSync()` | 3004-3016 | Add warning | Deprecation visible | LOW |
| 4 | `syncFromIpns()` | 3031-3050 | Add warning | Deprecation visible | LOW |
| 5 | Transport methods | Various | Add comments | Clarify stability | NONE |

**Total Lines Changed:** ~30
**Total Lines Added:** ~20 (comments/warnings)
**Files Modified:** 1
**Files Created:** 0
**Breaking Changes:** 0 (fully backward compatible)

---

## Implementation Checklist

### Before Making Changes
- [ ] Create feature branch: `git checkout -b fix/dual-sync-anti-pattern`
- [ ] Read full refactoring plan: `DUAL_SYNC_REFACTORING_PLAN.md`
- [ ] Verify current tests pass: `npm run test:run`

### During Changes
- [ ] Make Change 1: Disable listener in startAutoSync()
- [ ] Make Change 2: Update shutdown() comments
- [ ] Make Change 3: Add warning to scheduleSync()
- [ ] Make Change 4: Add warning to syncFromIpns()
- [ ] Make Change 5: Add transport interface comments
- [ ] Verify no syntax errors: `npx tsc --noEmit`
- [ ] Verify linting: `npm run lint`

### After Changes
- [ ] Update failing tests (expect deprecation warnings)
- [ ] Run full test suite: `npm run test:run`
- [ ] Build project: `npm run build`
- [ ] Manual smoke test in browser
- [ ] Review git diff: `git diff src/components/wallet/L3/services/IpfsStorageService.ts`
- [ ] Commit changes: `git commit -m "fix: disable dual sync auto-trigger in IpfsStorageService"`

---

## Rollback Instructions

If any issues occur, roll back in order:

### Rollback Change 1 (Restore listener)
```diff
- // this.boundSyncHandler = () => this.scheduleSync();
- // window.addEventListener("wallet-updated", this.boundSyncHandler);
+ this.boundSyncHandler = () => this.scheduleSync();
+ window.addEventListener("wallet-updated", this.boundSyncHandler);
```

### Rollback Change 2-5 (Remove comments/warnings)
```bash
git checkout src/components/wallet/L3/services/IpfsStorageService.ts
```

**Total Rollback Time:** <5 minutes
**Data Impact:** None (both stores use same localStorage)

---

## Appendix: Related Code Locations

### Files That Call IpfsStorageService
1. **OutboxRecoveryService.ts** (line 313)
   - Calls: `ipfsService.syncNow()`
   - Status: May need update to use inventorySync()

2. **NametagService.ts** (line 244)
   - Calls: `ipfsService.syncNow()`
   - Status: May need update to use inventorySync()

3. **IpfsStorageService.ts (internal)**
   - Calls: `this.syncNow()`, `this.syncFromIpns()`
   - Status: Already correct pattern, no change needed

### Files That Listen for wallet-updated Event
1. **IpfsStorageService.ts** (line 240)
   - Purpose: Trigger auto-sync
   - Status: DISABLED by this refactoring

2. **Other callers of dispatchEvent("wallet-updated")**
   - **FaucetService** (line 84)
   - **IpfsStorageService** (lines 1675, 1699, 2975, 2990, 3229, 3878, 3953)
   - Status: Events still dispatched (for UI refresh), but no longer trigger auto-sync

### InventorySyncService Integration Points
1. **Step 10: uploadIpfs()** (line 1514)
   - Uses: `getIpfsTransport()` → calls transport methods
   - Status: CORRECT, no changes needed

2. **Initialization** (line 30-31)
   - Imports: IpfsTransport interface
   - Status: CORRECT, no changes needed

---

## Success Criteria Post-Implementation

1. **✓ Build passes** - `npm run build` succeeds
2. **✓ Tests pass** - `npm run test:run` (with expected deprecation warnings)
3. **✓ No console errors** - only deprecation warnings expected
4. **✓ IPNS monotonic** - sequence numbers only increase
5. **✓ Single publisher** - only InventorySyncService publishes
6. **✓ Backward compatible** - old code paths still callable (with warnings)
