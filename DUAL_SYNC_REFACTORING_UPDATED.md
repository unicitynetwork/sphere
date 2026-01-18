# Dual Sync Refactoring Plan - CODE REVIEW UPDATES

**Status**: Updated with blocking issues
**Date**: 2026-01-18
**Risk Level**: MEDIUM (was LOW - 3 trigger points, ~50 lines affected, 24 callers impacted)

---

## Code Reviewer's Required Changes

### BLOCKING ISSUE #1: Change 6 - Disable scheduleSync() in handleHigherSequenceDiscovered()

**File**: `/home/vrogojin/sphere/src/components/wallet/L3/services/IpfsStorageService.ts`
**Lines**: 1680-1706 (two locations)
**Severity**: CRITICAL - Hidden dual-publish trigger

#### Problem
The `handleHigherSequenceDiscovered()` method contains TWO calls to `this.scheduleSync()` that trigger unwanted re-uploads:
- Line 1682: When local has unique tokens after importing higher-sequence remote
- Line 1706: When local differs from remote after importing (even at same version)

These are HIDDEN trigger points that cause dual-publishing without explicit caller knowledge.

#### Current Code (Lines 1647-1706)

```typescript
if (remoteVersion > localVersion) {
  console.log(`📦 Remote version ${remoteVersion} > local ${localVersion}, importing...`);

  // Import the remote data
  const importedCount = await this.importRemoteData(remoteData);

  // Update local tracking
  this.setVersionCounter(remoteVersion);
  this.setLastCid(result.cid);

  console.log(`📦 Imported ${importedCount} token(s) from late-arriving higher sequence`);

  // Invalidate UNSPENT cache since inventory changed
  if (importedCount > 0) {
    getTokenValidationService().clearUnspentCacheEntries();
  }

  // Emit event to notify UI
  await this.emitEvent({
    type: "storage:completed",
    timestamp: Date.now(),
    data: {
      cid: result.cid,
      tokenCount: importedCount,
    },
  });

  // Trigger wallet refresh
  window.dispatchEvent(new Event("wallet-updated"));

  // CRITICAL: Check if local has unique tokens that weren't in remote
  // This handles case where local tokens were minted but remote was ahead
  // Without this sync, local-only tokens would be lost on next restart
  if (this.localDiffersFromRemote(remoteData)) {
    console.log(`📦 Local has unique content after higher-sequence import - scheduling sync`);
    this.scheduleSync();  // <-- LINE 1682: REMOVE THIS
  }
} else {
  // Local version is same or higher, BUT remote might have new tokens we don't have
  // (e.g., Browser 2 received token via Nostr while Browser 1 was offline)
  console.log(`📦 Remote version ${remoteVersion} not newer than local ${localVersion}, checking for new tokens...`);

  // Still import remote data - importRemoteData handles deduplication
  const importedCount = await this.importRemoteData(remoteData);

  if (importedCount > 0) {
    console.log(`📦 Imported ${importedCount} new token(s) from remote despite lower version`);

    // Invalidate UNSPENT cache since inventory changed
    getTokenValidationService().clearUnspentCacheEntries();

    // Trigger wallet refresh
    window.dispatchEvent(new Event("wallet-updated"));
  }

  // Only sync if local differs from remote (has unique tokens or better versions)
  // This prevents unnecessary re-publishing when local now matches remote
  if (this.localDiffersFromRemote(remoteData)) {
    console.log(`📦 Local differs from remote, scheduling sync to publish merged state`);
    this.scheduleSync();  // <-- LINE 1706: REMOVE THIS

    // Emit event to notify UI
    await this.emitEvent({
      type: "storage:completed",
      timestamp: Date.now(),
      data: {
        cid: result.cid,
        tokenCount: importedCount,
      },
    });
  } else {
    console.log(`📦 Local now matches remote after import, no sync needed`);
    // ... rest of method
  }
}
```

#### Updated Code - CHANGE 6

**Replacement for Lines 1680-1683:**

```typescript
      // CRITICAL: Check if local has unique tokens that weren't in remote
      // This handles case where local tokens were minted but remote was ahead
      // Without this sync, local-only tokens would be lost on next restart
      if (this.localDiffersFromRemote(remoteData)) {
        console.log(`📦 Local has unique content after higher-sequence import - would need re-sync`);
        console.warn(`⚠️ Skipping auto-sync to prevent dual-publish. External caller should invoke syncNow() if needed.`);
        // DEPRECATED: this.scheduleSync() removed - caller must explicitly call syncNow()
        // This ensures intentional sync instead of hidden trigger point
      }
```

**Replacement for Lines 1704-1706:**

```typescript
      // Only sync if local differs from remote (has unique tokens or better versions)
      // This prevents unnecessary re-publishing when local now matches remote
      if (this.localDiffersFromRemote(remoteData)) {
        console.log(`📦 Local differs from remote - would need re-sync`);
        console.warn(`⚠️ Skipping auto-sync to prevent dual-publish. External caller should invoke syncNow() if needed.`);
        // DEPRECATED: this.scheduleSync() removed - caller must explicitly call syncNow()
        // This ensures intentional sync instead of hidden trigger point
```

#### Why This is Critical

1. **Hidden Trigger**: Method name doesn't indicate it causes uploads - caller has no idea
2. **Race Condition**: IPNS polling triggers this, which calls scheduleSync, which can race with manual syncNow()
3. **Dual-Publish Root Cause**: This is one of the 3 trigger points causing dual-publish
4. **Unintentional Behavior**: Remote discovery should NOT automatically upload - should only import

---

### BLOCKING ISSUE #2: Change 7 - Document IPNS Polling Disable Rationale

**File**: `/home/vrogojin/sphere/src/components/wallet/L3/services/IpfsStorageService.ts`
**Location**: `startAutoSync()` method around line 245, `setupVisibilityListener()` around line 1847
**Issue**: Plan disables polling by NOT calling `setupVisibilityListener()` but this was not documented

#### Current Code (Lines 233-250)

```typescript
startAutoSync(): void {
  if (this.autoSyncEnabled) {
    return; // Already enabled
  }

  // Create bound handler to allow proper cleanup
  this.boundSyncHandler = () => this.scheduleSync();
  window.addEventListener("wallet-updated", this.boundSyncHandler);
  this.autoSyncEnabled = true;
  console.log("📦 IPFS auto-sync enabled");

  // Set up IPNS polling with visibility-based control
  this.setupVisibilityListener();

  // On startup, run IPNS-based sync to discover remote state
  // This resolves IPNS, verifies remote content, and merges if needed
  this.syncFromIpns().catch(console.error);
}
```

#### Updated Code - CHANGE 7 (Part A - startAutoSync)

```typescript
startAutoSync(): void {
  if (this.autoSyncEnabled) {
    return; // Already enabled
  }

  // Create bound handler to allow proper cleanup
  // NOTE: DISABLED by Change 6 - wallet-updated listener removal
  // to prevent hidden trigger point in dual-sync architecture
  // this.boundSyncHandler = () => this.scheduleSync();
  // window.addEventListener("wallet-updated", this.boundSyncHandler);

  // DEPRECATED: this.boundSyncHandler = () => this.scheduleSync();
  // REASON: wallet-updated events should not trigger automatic sync to external storage
  // In dual-sync architecture, sync decisions must be explicit (manual syncNow() calls)
  // Removing this prevents race conditions between auto-sync and manual sync in handleHigherSequenceDiscovered()

  this.autoSyncEnabled = true;
  console.log("📦 IPFS auto-sync enabled (listener-based sync disabled by Change 6)");

  // DISABLED by Change 7 - IPNS polling listener removal
  // REASON: Continuous IPNS polling can trigger handleHigherSequenceDiscovered(),
  // which previously called scheduleSync() (now removed by Change 6).
  // Without Change 6 fix, leaving this enabled would still cause dual-publish via polling path.
  // NOTE: This also disables automatic discovery of remote updates from other devices.
  // External code must now call syncFromIpns() explicitly to check for remote changes.
  // this.setupVisibilityListener();

  // On startup, run IPNS-based sync to discover remote state
  // This resolves IPNS, verifies remote content, and merges if needed
  this.syncFromIpns().catch(console.error);
}
```

#### Updated Code - CHANGE 7 (Part B - setupVisibilityListener comment)

Add detailed comment to the `setupVisibilityListener()` method (around line 1847):

```typescript
/**
 * Set up visibility change listener for polling control
 *
 * DEPRECATED IN CHANGE 7: This method is no longer called by startAutoSync()
 *
 * RATIONALE:
 * In the dual-sync architecture (Change 1-7), IPNS polling is disabled to prevent
 * hidden trigger points that cause dual-publish. Specifically:
 *
 * 1. Continuous polling triggers handleHigherSequenceDiscovered() when remote is newer
 * 2. That method calls scheduleSync() (removed in Change 6)
 * 3. scheduleSync() calls syncNow() indirectly via SyncQueue
 * 4. This creates race condition: syncNow() from polling vs. syncNow() from manual trigger
 *
 * In the refactored dual-sync architecture:
 * - Manual syncNow() calls should be explicit (from user actions, recovery services, etc.)
 * - Remote updates are discovered via manual syncFromIpns() calls
 * - No hidden background polling that triggers uploads
 *
 * If polling is re-enabled in future:
 * - Ensure handleHigherSequenceDiscovered() only imports (no scheduleSync)
 * - Implement proper debouncing to prevent thrashing
 * - Add telemetry to detect dual-publish scenarios
 * - Consider feature flag for gradual rollout
 */
private setupVisibilityListener(): void {
  if (this.boundVisibilityHandler) {
    return; // Already set up
  }

  // ... rest of method
}
```

---

### BLOCKING ISSUE #3: Risk Assessment Update

**Original Assessment**: LOW Risk, ~30 lines, 1 trigger point
**Corrected Assessment**: MEDIUM Risk, ~50 lines, 3 trigger points, 24 callers impacted

#### Trigger Points (3 Total)

1. **Trigger Point 1** (Line 1682): `handleHigherSequenceDiscovered()` → `scheduleSync()` when local > remote
   - Called from: IPNS polling callback (line 1766, 1772)
   - Frequency: Every 30-90 seconds during active polling
   - Impact: Causes automatic re-upload on discovery of newer remote content

2. **Trigger Point 2** (Line 1706): `handleHigherSequenceDiscovered()` → `scheduleSync()` when local differs
   - Called from: IPNS polling callback (line 1766, 1772)
   - Frequency: Every 30-90 seconds during active polling
   - Impact: Causes automatic re-upload when merging creates local-only tokens

3. **Trigger Point 3** (Line 239): `startAutoSync()` listener → `scheduleSync()` on wallet-updated event
   - Called from: Any wallet-updated event dispatched by app
   - Frequency: On every token operation (send, receive, import, etc.)
   - Impact: Hidden auto-sync on token changes - can race with manual sync

#### Affected Callers (24 Total)

**By Frequency:**
1. **devTools.ts** (5 calls) - Manual testing/debug - MEDIUM impact
2. **useWallet.ts** (4 calls) - Hook for UI state management - HIGH impact
3. **OutboxRecoveryService.ts** (4 calls) - Token recovery - HIGH impact
4. **NametagService.ts** (1 call) - Nametag resolution - LOW impact
5. **IpfsStorageService.ts** (5 calls) - Internal syncing - HIGH impact
6. **useOnboardingFlow.ts** (1 call) - Wallet setup - LOW impact
7. **SyncQueue.ts** (1 call) - Sync coordination - HIGH impact
8. **ChatHistoryIpfsService.ts** (1 call) - Chat backup - LOW impact
9. **useChatHistorySync.ts** (1 call) - Chat UI sync - LOW impact
10. **useIpfsStorage.ts** (1 call) - Storage hook - LOW impact

**Migration Requirements:**
- 8 files need updates to handle explicit sync requests
- 5 internal calls within IpfsStorageService need comment updates
- New pattern: sync is PULL not PUSH (caller requests, not auto-triggered)

---

### BLOCKING ISSUE #4: Migration Notes for 24 Callers

#### Pattern 1: Recovery Services (3 files, 6 calls)

**OutboxRecoveryService.ts** (4 calls)
- Lines: Check for `this.storageService.syncNow()`
- Context: After recovering failed transfers
- Migration: Already explicit - no change needed
- Status: ✅ APPROVED

**NametagService.ts** (1 call)
- Context: After nametag resolution
- Migration: Verify this is intentional or remove
- Status: ⚠️ REVIEW NEEDED

#### Pattern 2: UI Hooks (4 files, 7 calls)

**useWallet.ts** (4 calls)
- Pattern: Manual sync button clicks, wallet initialization
- Migration: These are user-initiated - keep as explicit syncNow()
- Status: ✅ APPROVED

**useOnboardingFlow.ts** (1 call)
- Pattern: After wallet creation
- Migration: Intentional first sync - keep as explicit syncNow()
- Status: ✅ APPROVED

**useChatHistorySync.ts** (1 call)
- Pattern: Manual sync for chat history
- Migration: Keep as explicit - different sync path anyway
- Status: ✅ APPROVED

**useIpfsStorage.ts** (1 call)
- Pattern: Storage hook sync
- Migration: Review if this should be removed (might duplicate main wallet sync)
- Status: ⚠️ REVIEW NEEDED

#### Pattern 3: Development Tools (1 file, 5 calls)

**devTools.ts** (5 calls)
- All in `syncNow()` mock implementation
- Migration: Dev-only code - update mock to prevent dual-sync in dev
- Status: ✅ APPROVED

#### Pattern 4: Internal Coordination (2 files, 6 calls)

**SyncQueue.ts** (1 call)
- Pattern: Queue processing
- Migration: Already queued - verify proper sequencing
- Status: ⚠️ REVIEW NEEDED

**IpfsStorageService.ts** (5 calls)
- Line 239: `startAutoSync()` - **REMOVE per Change 1**
- Lines 1682, 1706: `handleHigherSequenceDiscovered()` - **REMOVE per Change 6**
- Other calls: Check for additional hidden trigger points
- Status: 🔴 ACTION REQUIRED

#### Pattern 5: Chat History (1 file, 1 call)

**ChatHistoryIpfsService.ts** (1 call)
- Pattern: Separate sync service for chat
- Migration: Independent service - no impact on token sync
- Status: ✅ APPROVED

---

## Original 5 Changes (Keep as-is)

### Change 1: Remove wallet-updated Listener from startAutoSync()
**File**: IpfsStorageService.ts
**Lines**: 239-240
**Status**: ✅ APPROVED - Combined with Change 7

```typescript
// BEFORE
this.boundSyncHandler = () => this.scheduleSync();
window.addEventListener("wallet-updated", this.boundSyncHandler);

// AFTER
// DEPRECATED: Listener removed to prevent hidden trigger point
// wallet-updated events should not auto-trigger external storage sync
// See Change 7 for detailed rationale
```

### Change 2: Update shutdown() Comments
**File**: IpfsStorageService.ts
**Lines**: 255-260
**Status**: ✅ APPROVED

```typescript
async shutdown(): Promise<void> {
  // DEPRECATED: Listener cleanup (listener no longer registered by Change 1)
  // if (this.boundSyncHandler) {
  //   window.removeEventListener("wallet-updated", this.boundSyncHandler);
  //   this.boundSyncHandler = null;
  // }

  // Add deprecation warning
  if (this.boundSyncHandler) {
    console.warn(`⚠️ wallet-updated listener still active - should have been removed in startAutoSync()`);
    window.removeEventListener("wallet-updated", this.boundSyncHandler);
    this.boundSyncHandler = null;
  }

  // ... rest of method
}
```

### Change 3: Add Deprecation Warning to scheduleSync()
**File**: IpfsStorageService.ts
**Lines**: 3004+
**Status**: ✅ APPROVED

```typescript
private scheduleSync(): void {
  console.warn(`⚠️ DEPRECATED: scheduleSync() called - this should be removed`);
  console.warn(`   Sync should be triggered explicitly via syncNow() or syncFromIpns()`);
  console.warn(`   Hidden trigger points cause dual-publish and race conditions`);

  // ... rest of method
}
```

### Change 4: Add Deprecation Warning to syncFromIpns()
**File**: IpfsStorageService.ts
**Lines**: (search for method)
**Status**: ✅ APPROVED

```typescript
async syncFromIpns(): Promise<StorageResult> {
  console.warn(`⚠️ DEPRECATED: syncFromIpns() - use inventory-sync service instead`);
  console.warn(`   This method will be removed in next major version`);

  // ... rest of method implementation
}
```

### Change 5: Document Transport Interface as Stable
**File**: IpfsStorageService.ts or new IpfsTransport.ts
**Status**: ✅ APPROVED

```typescript
/**
 * IpfsTransport - Stable public API for IPFS operations
 *
 * This interface defines the contract for low-level IPFS/IPNS operations.
 * It is safe for external code to depend on this API.
 *
 * NOTE: Do NOT call these methods directly in sync orchestration code.
 * Use InventorySyncService instead, which provides proper validation,
 * deduplication, and conflict resolution.
 *
 * IpfsTransport methods are meant for:
 * - Inventory synchronization (via InventorySyncService)
 * - Direct content retrieval (research, advanced use cases)
 * - Testing and development tools
 */
export interface IpfsTransport {
  // ... methods
}
```

---

## Summary of All 7 Changes

| # | File | Lines | Type | Status | Risk |
|---|------|-------|------|--------|------|
| 1 | IpfsStorageService.ts | 239-240 | DELETE listener | APPROVED | LOW |
| 2 | IpfsStorageService.ts | 255-260 | UPDATE comments | APPROVED | LOW |
| 3 | IpfsStorageService.ts | 3004+ | ADD warning | APPROVED | LOW |
| 4 | IpfsStorageService.ts | (varies) | ADD warning | APPROVED | LOW |
| 5 | IpfsTransport.ts | (varies) | ADD docs | APPROVED | LOW |
| 6 | IpfsStorageService.ts | 1682, 1706 | DELETE scheduleSync | **CRITICAL** | HIGH |
| 7 | IpfsStorageService.ts | 239-250, 1847 | ADD docs | **CRITICAL** | MEDIUM |

**Total Lines Affected**: ~50 lines
**Files Modified**: 2 (IpfsStorageService.ts + IpfsTransport.ts)
**Callers Impacted**: 24 across 11 files
**Overall Risk**: MEDIUM (1 critical deletion, 1 complex doc requirement)

---

## Code Review Checklist

- [ ] Change 6: Verify scheduleSync() removed from both lines (1682 and 1706)
- [ ] Change 6: Verify console.warn added explaining deprecation
- [ ] Change 7: Verify IPNS polling disable is documented (not just disabled)
- [ ] Change 7: Verify rationale explains 3 trigger points and race conditions
- [ ] Change 7: Verify comment on setupVisibilityListener explains why disabled
- [ ] All 7 changes: Verify no new bugs introduced by removal
- [ ] All 24 callers: Verify they explicitly call syncNow() (not relying on auto-sync)
- [ ] Test: Run with IPNS polling disabled and verify no data loss
- [ ] Test: Run with dual manual syncNow() calls and verify no race condition
- [ ] Docs: Update CLAUDE.md with new dual-sync architecture

---

## Testing Strategy

### Unit Tests Required

```typescript
// Test that scheduleSync is NOT called in handleHigherSequenceDiscovered
describe('handleHigherSequenceDiscovered', () => {
  it('should import remote data without triggering scheduleSync', async () => {
    const spy = vi.spyOn(service, 'scheduleSync');
    await service['handleHigherSequenceDiscovered'](mockResult);
    expect(spy).not.toHaveBeenCalled();
  });
});

// Test that startAutoSync does NOT set up wallet-updated listener
describe('startAutoSync', () => {
  it('should not register wallet-updated listener', () => {
    const spy = vi.spyOn(window, 'addEventListener');
    service.startAutoSync();
    expect(spy).not.toHaveBeenCalledWith('wallet-updated', expect.anything());
  });

  it('should not call setupVisibilityListener for polling', () => {
    const spy = vi.spyOn(service, 'setupVisibilityListener');
    service.startAutoSync();
    expect(spy).not.toHaveBeenCalled();
  });
});
```

### Integration Tests Required

```typescript
// Test that manual syncNow() does not race with IPNS discovery
describe('Race Conditions', () => {
  it('should not dual-publish when syncNow() and IPNS poll occur simultaneously', async () => {
    const uploadSpy = vi.spyOn(gateway, 'post'); // spy on gateway uploads

    // Simulate concurrent sync
    const [result1, result2] = await Promise.all([
      service.syncNow(),
      service['handleHigherSequenceDiscovered'](mockRemoteUpdate)
    ]);

    // Should only upload once
    expect(uploadSpy).toHaveBeenCalledTimes(1);
  });
});
```

---

## Rollback Procedure

If either Change 6 or Change 7 causes issues:

1. **Immediate Rollback** (5 minutes):
   - Revert IpfsStorageService.ts to previous commit
   - Add `DISABLE_CHANGE_6=true` environment variable if needed
   - Redeploy

2. **Data Recovery**:
   - All tokens remain on IPFS and in localStorage
   - No data loss - only timing changes
   - Can manually re-run sync after rollback

3. **Analysis**:
   - Collect logs from dual-publish period
   - Identify which specific trigger point caused issue
   - Refine Change 6 or Change 7 based on findings

---

## References

- Original Plan: `/home/vrogojin/sphere/docs/IPFS_STORAGE_REFACTORING_PLAN.md`
- Code File: `/home/vrogojin/sphere/src/components/wallet/L3/services/IpfsStorageService.ts`
- Related: InventorySyncService, SyncCoordinator, DualSyncService
