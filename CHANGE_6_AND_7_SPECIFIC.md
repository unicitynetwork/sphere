# Change 6 & 7: Specific Code Changes

## Change 6: Remove scheduleSync() Calls from handleHigherSequenceDiscovered()

### Location 1: Line ~1680-1683

**FILE**: `/home/vrogojin/sphere/src/components/wallet/L3/services/IpfsStorageService.ts`

**BEFORE:**
```typescript
      // CRITICAL: Check if local has unique tokens that weren't in remote
      // This handles case where local tokens were minted but remote was ahead
      // Without this sync, local-only tokens would be lost on next restart
      if (this.localDiffersFromRemote(remoteData)) {
        console.log(`📦 Local has unique content after higher-sequence import - scheduling sync`);
        this.scheduleSync();
      }
```

**AFTER:**
```typescript
      // CRITICAL: Check if local has unique tokens that weren't in remote
      // This handles case where local tokens were minted but remote was ahead
      // Without this sync, local-only tokens would be lost on next restart
      if (this.localDiffersFromRemote(remoteData)) {
        console.log(`📦 Local has unique content after higher-sequence import - would need re-sync`);
        console.warn(`⚠️ Skipping auto-sync to prevent dual-publish. External caller must invoke syncNow() if needed.`);
        // DEPRECATED: scheduleSync() removed by Change 6
        // Reason: Hidden trigger point causes dual-publish with manual syncNow() calls
      }
```

---

### Location 2: Line ~1704-1706

**FILE**: `/home/vrogojin/sphere/src/components/wallet/L3/services/IpfsStorageService.ts`

**BEFORE:**
```typescript
      // Only sync if local differs from remote (has unique tokens or better versions)
      // This prevents unnecessary re-publishing when local now matches remote
      if (this.localDiffersFromRemote(remoteData)) {
        console.log(`📦 Local differs from remote, scheduling sync to publish merged state`);
        this.scheduleSync();

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
```

**AFTER:**
```typescript
      // Only sync if local differs from remote (has unique tokens or better versions)
      // This prevents unnecessary re-publishing when local now matches remote
      if (this.localDiffersFromRemote(remoteData)) {
        console.log(`📦 Local differs from remote - would need re-sync`);
        console.warn(`⚠️ Skipping auto-sync to prevent dual-publish. External caller must invoke syncNow() if needed.`);
        // DEPRECATED: scheduleSync() removed by Change 6
        // Reason: Hidden trigger point causes dual-publish with manual syncNow() calls

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
```

---

## Change 7: Document IPNS Polling Disable Rationale

### Part A: Update startAutoSync() Comments (Lines ~233-250)

**FILE**: `/home/vrogojin/sphere/src/components/wallet/L3/services/IpfsStorageService.ts`

**BEFORE:**
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

**AFTER:**
```typescript
  /**
   * Start listening for wallet changes and enable auto-sync
   * Safe to call multiple times - will only initialize once
   *
   * DEPRECATED BY CHANGES 1 & 7: wallet-updated listener and IPNS polling disabled
   * REASON: In dual-sync architecture, sync must be explicit to prevent race conditions
   *
   * Background polling + manual syncNow() create race conditions where:
   * 1. IPNS poll detects remote update → handleHigherSequenceDiscovered()
   * 2. That triggers scheduleSync() (via hidden trigger point)
   * 3. Meanwhile, user clicks manual sync → syncNow()
   * 4. Both upload simultaneously → dual-publish
   *
   * Solution: Remove all auto-triggers, require explicit syncNow() calls
   * External code controls when sync happens = deterministic behavior
   */
  startAutoSync(): void {
    if (this.autoSyncEnabled) {
      return; // Already enabled
    }

    // DEPRECATED: Removed by Change 1 - wallet-updated listener
    // Reason: External storage sync should not auto-trigger on token changes
    // Callers must explicitly call syncNow() when they want to sync
    // this.boundSyncHandler = () => this.scheduleSync();
    // window.addEventListener("wallet-updated", this.boundSyncHandler);

    this.autoSyncEnabled = true;
    console.log("📦 IPFS auto-sync enabled (see startAutoSync() docs for disabled behaviors)");

    // DEPRECATED: Removed by Change 7 - IPNS polling listener
    // Reason: See detailed comment above - prevents dual-publish race conditions
    // If re-enabling polling in future, ensure:
    // 1. handleHigherSequenceDiscovered() NEVER calls scheduleSync()
    // 2. Implement debouncing to prevent thrashing
    // 3. Add telemetry to detect dual-publish
    // this.setupVisibilityListener();

    // On startup, run IPNS-based sync once to discover remote state
    // This resolves IPNS, verifies remote content, and merges if needed
    // But does NOT set up continuous polling (disabled by Change 7)
    this.syncFromIpns().catch(console.error);
  }
```

---

### Part B: Add Comment to setupVisibilityListener() Method

**FILE**: `/home/vrogojin/sphere/src/components/wallet/L3/services/IpfsStorageService.ts`

**Location**: Find `private setupVisibilityListener(): void {` (around line 1847)

**BEFORE:**
```typescript
  /**
   * Set up visibility change listener for polling control
   */
  private setupVisibilityListener(): void {
    if (this.boundVisibilityHandler) {
      return; // Already set up
    }

    // Initialize visibility state
    this.isTabVisible = document.visibilityState === "visible";

    this.boundVisibilityHandler = this.handleVisibilityChange;
    document.addEventListener("visibilitychange", this.boundVisibilityHandler);
    console.log(`📦 Visibility listener registered (tab ${this.isTabVisible ? "visible" : "hidden"})`);

    // Always start polling (with appropriate interval based on visibility)
    this.startIpnsPolling();
  }
```

**AFTER:**
```typescript
  /**
   * Set up visibility change listener for polling control
   *
   * DEPRECATED IN CHANGE 7: This method is no longer called by startAutoSync()
   *
   * DETAILED RATIONALE FOR DISABLING POLLING:
   *
   * The dual-sync architecture requires explicit sync triggers to prevent race conditions.
   * Continuous IPNS polling violates this by creating hidden trigger points:
   *
   * Hidden trigger sequence (the problem):
   * 1. setInterval polls IPNS every 30-90 seconds
   * 2. Remote is newer → calls handleHigherSequenceDiscovered()
   * 3. That method calls this.scheduleSync() (LINE 1682, 1706)
   * 4. scheduleSync() queues a sync operation (goes to SyncQueue)
   * 5. Meanwhile, user clicks "Sync" button → calls syncNow()
   * 6. Two sync operations execute concurrently → dual-publish to IPFS/IPNS
   *
   * Why this is bad:
   * - User expects "Sync" to upload once, not twice
   * - Dual-publish wastes bandwidth and creates duplicate IPNS records
   * - On slow networks, both uploads complete at different times
   * - Second upload overwrites first with stale data
   * - Creates appearance of data loss ("my sync didn't save")
   *
   * Solution (Change 6 + 7):
   * - Remove scheduleSync() from handleHigherSequenceDiscovered() [Change 6]
   * - Disable continuous polling [Change 7]
   * - Only import remote tokens, never auto-sync
   * - User/code must explicitly call syncNow() when ready
   *
   * New behavior:
   * - IPNS polling is DISABLED (no continuous background checks)
   * - External code calls syncFromIpns() explicitly to check for remote updates
   * - External code calls syncNow() explicitly to upload
   * - No hidden sync operations
   *
   * Cost:
   * - Slightly slower discovery of updates from other devices (requires manual refresh)
   * - User must click "Sync" button to get latest from other browsers
   * - Plus: No accidental dual-publishes, cleaner behavior
   *
   * If polling is re-enabled in future:
   * - Ensure handleHigherSequenceDiscovered() only imports (no scheduleSync)
   * - Add feature flag for gradual rollout
   * - Add telemetry to detect dual-publish scenarios
   * - Consider SyncCoordinator-based debouncing
   * - Document the race condition in code
   */
  private setupVisibilityListener(): void {
    if (this.boundVisibilityHandler) {
      return; // Already set up
    }

    // Initialize visibility state
    this.isTabVisible = document.visibilityState === "visible";

    this.boundVisibilityHandler = this.handleVisibilityChange;
    document.addEventListener("visibilitychange", this.boundVisibilityHandler);
    console.log(`📦 Visibility listener registered (tab ${this.isTabVisible ? "visible" : "hidden"})`);

    // Always start polling (with appropriate interval based on visibility)
    this.startIpnsPolling();
  }
```

---

## Summary Table

| Change | File | Lines | Deletions | Additions | Type |
|--------|------|-------|-----------|-----------|------|
| **6a** | IpfsStorageService.ts | 1682 | `this.scheduleSync()` | `console.warn()` msg + comment | DELETE + WARN |
| **6b** | IpfsStorageService.ts | 1706 | `this.scheduleSync()` | `console.warn()` msg + comment | DELETE + WARN |
| **7a** | IpfsStorageService.ts | 233-250 | 2 lines + `setupVisibilityListener()` call | Detailed deprecation docs | COMMENT + DELETE |
| **7b** | IpfsStorageService.ts | 1847 | None | Extensive rationale comment | DOCUMENT |

**Total Deletions**: 3 code statements (scheduleSync × 2, setupVisibilityListener call × 1)
**Total Additions**: ~100 lines of documentation/warnings
**Net Change**: -3 LOC + 100 LOC documentation = +97 LOC (but simpler behavior)

---

## Validation Checklist

After making these changes:

```bash
# 1. Verify syntax
npx tsc --noEmit

# 2. Run tests
npm run test

# 3. Check no other scheduleSync() calls in handleHigherSequenceDiscovered
grep -n "handleHigherSequenceDiscovered" src/components/wallet/L3/services/IpfsStorageService.ts

# 4. Verify setupVisibilityListener is no longer called from startAutoSync
grep -A 20 "startAutoSync" src/components/wallet/L3/services/IpfsStorageService.ts | grep setupVisibilityListener

# 5. Check all 24 callers still work
npx tsc --noEmit
npm run build
```

If all checks pass, Changes 6 & 7 are complete and safe to merge.
