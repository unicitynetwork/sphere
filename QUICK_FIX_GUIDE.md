# Quick Fix Guide: Changes 6 & 7

**Status**: Ready to implement
**Time to fix**: ~15 minutes
**Risk**: MEDIUM (well-documented, minimal code changes)

---

## Change 6: Remove 2 Lines (scheduleSync calls)

### Fix #1: Line ~1682

**File**: `src/components/wallet/L3/services/IpfsStorageService.ts`

**Find this:**
```typescript
      if (this.localDiffersFromRemote(remoteData)) {
        console.log(`📦 Local has unique content after higher-sequence import - scheduling sync`);
        this.scheduleSync();
      }
```

**Replace with:**
```typescript
      if (this.localDiffersFromRemote(remoteData)) {
        console.log(`📦 Local has unique content after higher-sequence import - would need re-sync`);
        console.warn(`⚠️ Skipping auto-sync to prevent dual-publish. External caller must invoke syncNow() if needed.`);
        // DEPRECATED: scheduleSync() removed by Change 6 - prevents hidden trigger point
      }
```

### Fix #2: Line ~1706

**File**: `src/components/wallet/L3/services/IpfsStorageService.ts`

**Find this:**
```typescript
      if (this.localDiffersFromRemote(remoteData)) {
        console.log(`📦 Local differs from remote, scheduling sync to publish merged state`);
        this.scheduleSync();

        // Emit event to notify UI
        await this.emitEvent({
```

**Replace with:**
```typescript
      if (this.localDiffersFromRemote(remoteData)) {
        console.log(`📦 Local differs from remote - would need re-sync`);
        console.warn(`⚠️ Skipping auto-sync to prevent dual-publish. External caller must invoke syncNow() if needed.`);
        // DEPRECATED: scheduleSync() removed by Change 6 - prevents hidden trigger point

        // Emit event to notify UI
        await this.emitEvent({
```

---

## Change 7: Add Documentation

### Addition #1: startAutoSync() method docs (~15 lines)

**File**: `src/components/wallet/L3/services/IpfsStorageService.ts`

**Find the `startAutoSync(): void` method** (around line 233)

**Add this comment ABOVE the method:**
```typescript
  /**
   * Start listening for wallet changes and enable auto-sync
   * Safe to call multiple times - will only initialize once
   *
   * CHANGES 1 & 7 - CRITICAL UPDATES:
   * - wallet-updated listener DISABLED (was causing Trigger Point #3)
   * - IPNS polling listener DISABLED (was causing Trigger Points #1 & #2)
   *
   * WHY DISABLED (Dual-Sync Architecture):
   * Background polling + manual sync create race conditions:
   * 1. Polling detects remote update → handleHigherSequenceDiscovered()
   * 2. That method calls scheduleSync() (now removed by Change 6)
   * 3. Meanwhile, user clicks "Sync" button → syncNow()
   * 4. Both queue uploads simultaneously → DUAL-PUBLISH
   *
   * Solution: Remove all hidden trigger points, require explicit syncNow()
   * Only exception: Initial syncFromIpns() on startup (imports remote, no upload)
   *
   * NEW BEHAVIOR:
   * - Manual syncNow() is the ONLY way to upload to IPFS
   * - Polling only IMPORTS tokens, never uploads
   * - wallet-updated events do NOT trigger sync
   * - Deterministic behavior: caller controls when sync happens
   */
```

**Then INSIDE the method, find and update these lines:**

```typescript
    // DEPRECATED: Removed by Change 1 - wallet-updated listener
    // Reason: External storage sync should not auto-trigger on token changes
    // this.boundSyncHandler = () => this.scheduleSync();
    // window.addEventListener("wallet-updated", this.boundSyncHandler);

    this.autoSyncEnabled = true;
    console.log("📦 IPFS auto-sync enabled (listener-based sync disabled by Change 6)");

    // DEPRECATED: Removed by Change 7 - IPNS polling listener
    // Reason: Prevents Trigger Points #1 & #2 (dual-publish race conditions)
    // If re-enabling: ensure handleHigherSequenceDiscovered() has NO scheduleSync()
    // this.setupVisibilityListener();
```

### Addition #2: setupVisibilityListener() method docs (~60 lines)

**File**: `src/components/wallet/L3/services/IpfsStorageService.ts`

**Find the `private setupVisibilityListener(): void` method** (around line 1847)

**Replace the JSDoc comment with:**
```typescript
  /**
   * Set up visibility change listener for polling control
   *
   * STATUS: DEPRECATED IN CHANGE 7 - NO LONGER CALLED
   *
   * DETAILED RATIONALE FOR DISABLING IPNS POLLING:
   *
   * The dual-sync architecture requires explicit sync triggers to prevent race conditions.
   * Continuous IPNS polling violates this by creating hidden trigger points.
   *
   * THE PROBLEM (Before Changes 6 & 7):
   * ──────────────────────────────────────
   * Background polling runs every 30-90 seconds:
   * 1. setInterval calls poll()
   * 2. Remote IPNS has newer content → handleHigherSequenceDiscovered()
   * 3. That method has embedded scheduleSync() at lines 1682, 1706 ← Trigger Points #1 & #2
   * 4. Sync is queued without caller knowledge (HIDDEN!)
   * 5. Meanwhile, user clicks "Sync" button → syncNow() ← Trigger Point #3
   * 6. SyncQueue executes BOTH operations → DUAL-PUBLISH to IPFS
   *
   * IMPACT OF DUAL-PUBLISH:
   * ──────────────────────
   * - Two identical POST requests to IPFS gateway
   * - Different serialization order → Different CIDs generated
   * - IPNS record updated twice
   * - Last one published "wins"
   * - If first had better metadata → Appearance of data loss
   * - Confuses users: "Why is my sync not saving?"
   *
   * THE SOLUTION (Changes 6 & 7):
   * ──────────────────────────────
   * Change 6: Remove scheduleSync() from handleHigherSequenceDiscovered() ✓
   *   - Lines 1682 & 1706 no longer call scheduleSync()
   *   - Polling now only IMPORTS tokens (doesn't upload)
   *   - Caller has no way to know sync is needed
   *
   * Change 7: Disable IPNS polling listener ✓
   *   - setupVisibilityListener() no longer called from startAutoSync()
   *   - startIpnsPolling() no longer runs
   *   - No background checks of remote state
   *
   * NEW ARCHITECTURE:
   * ─────────────────
   * - Manual syncNow() = ONLY way to upload
   * - Polling (if re-enabled) = IMPORT ONLY, no upload
   * - wallet-updated events = NO LISTENER
   * - Deterministic: explicit calls only
   *
   * COST OF THIS CHANGE:
   * ────────────────────
   * - Slightly slower discovery of updates from other devices
   * - User must click "Sync" to get latest from other browsers
   * - No automatic push of updates between tabs/windows
   * - Polling no longer runs, so:
   *   * No periodic IPNS resolution
   *   * No automatic detection of remote changes
   *   * User must manually trigger syncFromIpns()
   *
   * BENEFIT OF THIS CHANGE:
   * ──────────────────────
   * - No more dual-publish
   * - No more race conditions
   * - Cleaner, predictable behavior
   * - Easier to debug (all syncs are explicit)
   * - Better for low-bandwidth scenarios (less polling)
   * - SyncQueue handles sequential execution correctly
   *
   * HOW TO RE-ENABLE IN FUTURE:
   * ───────────────────────────
   * If polling is needed again:
   * 1. Verify handleHigherSequenceDiscovered() has NO scheduleSync() (Change 6 check)
   * 2. Verify lines 1682 & 1706 are removed (do grep search)
   * 3. Add this.setupVisibilityListener() back to startAutoSync()
   * 4. Add feature flag: ENABLE_IPNS_POLLING=true/false
   * 5. Add debouncing to prevent excessive polling
   * 6. Add telemetry to detect dual-publish scenarios
   * 7. Document clearly that polling is an optimization only
   * 8. Run multi-device sync tests extensively
   */
```

---

## Validation Steps

After making changes:

```bash
# 1. Check syntax
npx tsc --noEmit

# 2. Run tests
npm run test

# 3. Verify scheduleSync removed
grep -n "this.scheduleSync()" src/components/wallet/L3/services/IpfsStorageService.ts
# Should show: 0 matches (or only in deprecation warnings)

# 4. Verify setupVisibilityListener NOT called from startAutoSync
grep -A 20 "startAutoSync" src/components/wallet/L3/services/IpfsStorageService.ts | grep setupVisibilityListener
# Should show: 0 matches (not called anymore)

# 5. Verify other syncNow() callers still work
npm run build
```

If all checks pass ✅, changes are complete.

---

## Summary of Changes

| Line | Change | Type | Impact |
|------|--------|------|--------|
| 1682 | Remove `this.scheduleSync()` | DELETE | Prevents auto-sync on IPNS discovery |
| 1706 | Remove `this.scheduleSync()` | DELETE | Prevents auto-sync on version mismatch |
| Both | Add `console.warn()` | ADD | Explains why sync was skipped |
| ~233 | Add startAutoSync() docs | DOCUMENT | Explains disabled behaviors |
| ~1847 | Add setupVisibilityListener() docs | DOCUMENT | Explains polling disable + re-enable path |

**Total Deletions**: 2 code statements
**Total Additions**: ~75 lines of documentation
**Files Changed**: 1 (IpfsStorageService.ts)
**Breaking Changes**: 0 (all changes are internal)
**Risk**: MEDIUM (well-documented, hidden trigger points removed)

---

## Files to Reference

1. **Main file to edit**: `/home/vrogojin/sphere/src/components/wallet/L3/services/IpfsStorageService.ts`
2. **Full details**: `/home/vrogojin/sphere/CHANGE_6_AND_7_SPECIFIC.md`
3. **Why changes needed**: `/home/vrogojin/sphere/TRIGGER_POINT_ANALYSIS.md`
4. **Full plan**: `/home/vrogojin/sphere/DUAL_SYNC_REFACTORING_UPDATED.md`
5. **Code review summary**: `/home/vrogojin/sphere/CODE_REVIEW_SUMMARY.md`

---

## Need Help?

1. **What should I change?** → Read CHANGE_6_AND_7_SPECIFIC.md
2. **Why remove these lines?** → Read TRIGGER_POINT_ANALYSIS.md
3. **How does this fit the plan?** → Read DUAL_SYNC_REFACTORING_UPDATED.md
4. **Executive summary?** → Read CODE_REVIEW_SUMMARY.md

---

## Time Estimate

- Find and replace line 1682: 2 minutes
- Find and replace line 1706: 2 minutes
- Add startAutoSync() docs: 3 minutes
- Add setupVisibilityListener() docs: 5 minutes
- Run validation: 3 minutes
- **Total**: ~15 minutes

Changes are SMALL but CRITICAL to fixing dual-publish.
