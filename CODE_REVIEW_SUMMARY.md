# Code Review Summary: Dual Sync Refactoring Plan

**Date**: 2026-01-18
**Status**: UPDATED - Code Review Feedback Incorporated
**Risk Level**: MEDIUM (Updated from LOW)

---

## What Changed?

The original refactoring plan for IpfsStorageService was REJECTED by code review due to critical gaps in identifying dual-publish trigger points. This document incorporates the reviewer's required fixes.

### Key Findings

1. **Hidden Trigger Points**: Original plan only identified 1, but there are actually 3
   - IPNS polling line 1682: `handleHigherSequenceDiscovered()` → `scheduleSync()`
   - IPNS polling line 1706: Same method, different condition
   - Wallet-updated line 239: `startAutoSync()` listener → `scheduleSync()`

2. **Code Affected**: ~50 lines (not ~30)

3. **Callers Impacted**: 24 across 11 files (not just internal)

4. **Risk Severity**: Elevated from LOW to MEDIUM due to:
   - 3 trigger points (not 1)
   - ~50 lines of changes (not ~30)
   - 24 external callers that depend on current behavior
   - High-frequency polling triggers
   - Wallet-updated is a core event

---

## The Problem (In 30 Seconds)

IpfsStorageService has THREE hidden sync triggers that cause DUAL-PUBLISH:

```
Remote Update Detected          User Clicks "Sync"
       ↓                              ↓
       └─→ handleHigherSequenceDiscovered()  →─┐
           └─→ scheduleSync()                   ├→ SyncQueue
                                                │
       └─→ syncNow() ─────────────────────────→─┘

Result: 2 uploads to IPFS simultaneously
        → Wasted bandwidth
        → Duplicate IPNS records
        → Appearance of data loss
```

### Why Hidden?

- `handleHigherSequenceDiscovered()` is called from IPNS polling
- Its name suggests "handle discovery" not "trigger upload"
- Contains TWO embedded `scheduleSync()` calls
- Caller (polling loop) has no idea it's triggering uploads
- No observable difference between "import" and "upload"

---

## The Solution: Changes 1-7

### Changes 1-5 (Original Plan - APPROVED ✅)

| # | Change | File | Lines | Status |
|---|--------|------|-------|--------|
| 1 | Remove wallet-updated listener | IpfsStorageService.ts | 239-240 | ✅ APPROVED |
| 2 | Update shutdown() comments | IpfsStorageService.ts | 255-260 | ✅ APPROVED |
| 3 | Add scheduleSync() deprecation | IpfsStorageService.ts | 3004+ | ✅ APPROVED |
| 4 | Add syncFromIpns() deprecation | IpfsStorageService.ts | (varies) | ✅ APPROVED |
| 5 | Document transport API | IpfsTransport.ts | (varies) | ✅ APPROVED |

### Changes 6-7 (NEW - CODE REVIEW FEEDBACK 🔴)

| # | Change | File | Lines | Status | Risk |
|---|--------|------|-------|--------|------|
| 6 | Remove scheduleSync() from handleHigherSequenceDiscovered() | IpfsStorageService.ts | **1682, 1706** | **CRITICAL** | **HIGH** |
| 7 | Document IPNS polling disable rationale | IpfsStorageService.ts | **239-250, 1847** | **CRITICAL** | **MEDIUM** |

---

## Change 6: Remove scheduleSync() from handleHigherSequenceDiscovered()

### Two Locations

**Location 1 (Line ~1682):**
```typescript
// BEFORE:
if (this.localDiffersFromRemote(remoteData)) {
  console.log(`📦 Local has unique content after higher-sequence import - scheduling sync`);
  this.scheduleSync();  // ← REMOVE THIS
}

// AFTER:
if (this.localDiffersFromRemote(remoteData)) {
  console.log(`📦 Local has unique content after higher-sequence import - would need re-sync`);
  console.warn(`⚠️ Skipping auto-sync to prevent dual-publish. External caller must invoke syncNow() if needed.`);
  // DEPRECATED: scheduleSync() removed by Change 6
}
```

**Location 2 (Line ~1706):**
```typescript
// BEFORE:
if (this.localDiffersFromRemote(remoteData)) {
  console.log(`📦 Local differs from remote, scheduling sync to publish merged state`);
  this.scheduleSync();  // ← REMOVE THIS

  // Emit event...
}

// AFTER:
if (this.localDiffersFromRemote(remoteData)) {
  console.log(`📦 Local differs from remote - would need re-sync`);
  console.warn(`⚠️ Skipping auto-sync to prevent dual-publish. External caller must invoke syncNow() if needed.`);
  // DEPRECATED: scheduleSync() removed by Change 6

  // Emit event...
}
```

### Why Critical

This removes the ROOT CAUSE of dual-publish when IPNS polling detects remote updates. Without this fix, the entire refactoring plan fails.

### Impact

- Polling no longer triggers uploads
- Remote updates are only IMPORTED (tokens pulled in)
- Caller must explicitly call syncNow() to upload
- Prevents race conditions with manual sync

---

## Change 7: Document IPNS Polling Disable

### Why This Exists

The original plan accidentally disables IPNS polling by NOT calling `setupVisibilityListener()` in `startAutoSync()`. This is a SIDE EFFECT, not an intentional design. Change 7 makes it explicit and documents WHY.

### Part A: startAutoSync() Documentation

```typescript
// BEFORE: (no documentation of why listeners are removed)
startAutoSync(): void {
  // ... code ...
  this.setupVisibilityListener();
}

// AFTER: (explicit docs explaining the architecture)
/**
 * Start listening for wallet changes and enable auto-sync
 *
 * DEPRECATED BY CHANGES 1 & 7: wallet-updated listener and IPNS polling disabled
 * REASON: In dual-sync architecture, sync must be explicit to prevent race conditions
 */
startAutoSync(): void {
  // DEPRECATED: Removed by Change 1 - wallet-updated listener
  // Reason: External storage sync should not auto-trigger on token changes
  // this.boundSyncHandler = () => this.scheduleSync();
  // window.addEventListener("wallet-updated", this.boundSyncHandler);

  // DEPRECATED: Removed by Change 7 - IPNS polling listener
  // Reason: Prevents dual-publish race conditions
  // this.setupVisibilityListener();

  // ... rest ...
}
```

### Part B: setupVisibilityListener() Documentation

Add 50+ line comment explaining:
1. Why polling is disabled
2. The race condition that occurs with polling
3. The 4-step sequence of dual-publish
4. How to re-enable safely in the future
5. What conditions must be met

---

## The 3 Trigger Points (Full Explanation)

### Trigger Point #1: IPNS Polling (Line 1682)

```
Timeline:
T0: Remote publishes newer token
T1: Polling fires (30-90s later)
T2: handleHigherSequenceDiscovered() called
T3: Detects local differs from remote
T4: Calls this.scheduleSync()  ← LINE 1682
T5: Sync queued
T6: User clicks "Sync" button
T7: syncNow() called
T8: Two syncs execute → DUAL-PUBLISH
```

**Activation**: Every 30-90 seconds while polling active
**Visibility**: HIDDEN - polling doesn't know it's triggering uploads
**Frequency**: Continuous background triggers

### Trigger Point #2: IPNS Polling (Line 1706)

```
Same sequence as #1, but:
- Condition: remoteVersion <= localVersion (different logic)
- Still calls scheduleSync()
- Still hidden from polling caller
- Happens more often (includes same-version conflicts)
```

**Why Separate from #1**: Different condition, but same problem

### Trigger Point #3: Wallet-Updated Event (Line 239)

```
Timeline:
T0: User sends/receives token
T1: Token operation completes
T2: dispatchEvent("wallet-updated")  ← Custom event
T3: startAutoSync listener fires
T4: Bound handler calls scheduleSync()  ← LINE 239
T5: Sync queued
T6: Later: User might click "Sync" button
T7: syncNow() called
T8: Two syncs execute → DUAL-PUBLISH
```

**Activation**: Every token operation (send, receive, import)
**Visibility**: HIDDEN - generic wallet-updated event, no sync indication
**Frequency**: Very high (multiple times per user action)

---

## Migration Notes: 24 Callers

### By File

```
1. devTools.ts (5 calls)
   Status: ✅ SAFE - Dev-only code

2. useWallet.ts (4 calls)
   Status: ✅ SAFE - User-initiated sync buttons

3. OutboxRecoveryService.ts (4 calls)
   Status: ✅ SAFE - Explicit recovery flows

4. IpfsStorageService.ts (5 calls)
   Status: 🔴 CRITICAL - Must remove/update by Changes 6-7

5. NametagService.ts (1 call)
   Status: ⚠️ REVIEW - Is this intentional?

6. useOnboardingFlow.ts (1 call)
   Status: ✅ SAFE - Initial setup, explicit

7. SyncQueue.ts (1 call)
   Status: ⚠️ REVIEW - Still needed?

8. ChatHistoryIpfsService.ts (1 call)
   Status: ✅ SAFE - Separate service

9. unicityIdValidator.ts (1 call)
   Status: ⚠️ REVIEW - Unexpected location

10. useChatHistorySync.ts (1 call)
    Status: ✅ SAFE - Chat-specific

11. useIpfsStorage.ts (1 call)
    Status: ⚠️ REVIEW - Hook-based sync
```

### Safe to Keep ✅

These callers are already using explicit `syncNow()` calls:
- useWallet.ts: Button clicks (user-initiated)
- OutboxRecoveryService.ts: Recovery flows (intentional)
- useOnboardingFlow.ts: Wallet setup (one-time)
- devTools.ts: Testing tools (dev-only)

### Must Remove 🔴

Inside IpfsStorageService.ts:
- Line 239: wallet-updated listener in `startAutoSync()`
- Line 1682: scheduleSync() in `handleHigherSequenceDiscovered()`
- Line 1706: scheduleSync() in `handleHigherSequenceDiscovered()`

### Must Review ⚠️

Verify these are intentional:
- NametagService.ts: Does nametag lookup need to trigger sync?
- SyncQueue.ts: Does internal queue manager need sync?
- useIpfsStorage.ts: Does storage hook need sync?
- unicityIdValidator.ts: Why is validator calling sync?

---

## Testing Requirements

### Unit Tests (Mandatory)

```typescript
test('handleHigherSequenceDiscovered does not call scheduleSync', async () => {
  const spy = vi.spyOn(service, 'scheduleSync');
  await service['handleHigherSequenceDiscovered'](mockResult);
  expect(spy).not.toHaveBeenCalled();
});

test('startAutoSync does not register wallet-updated listener', () => {
  const spy = vi.spyOn(window, 'addEventListener');
  service.startAutoSync();
  expect(spy).not.toHaveBeenCalledWith('wallet-updated', expect.any(Function));
});

test('setupVisibilityListener is not called by startAutoSync', () => {
  const spy = vi.spyOn(service as any, 'setupVisibilityListener');
  service.startAutoSync();
  expect(spy).not.toHaveBeenCalled();
});
```

### Integration Tests (Recommended)

```typescript
test('manual syncNow does not race with IPNS discovery', async () => {
  // Simultaneously trigger manual and polling sync
  // Verify only one upload happens
  // Verify SyncQueue orders them sequentially
});

test('token operations do not trigger auto-sync', async () => {
  // Perform token send/receive
  // Verify wallet-updated is dispatched
  // Verify syncNow is NOT called
});

test('IPNS polling only imports, does not upload', async () => {
  // Simulate polling finding newer remote
  // Verify tokens are imported
  // Verify no upload to IPFS
  // Verify last CID is not updated
});
```

### E2E Tests (Optional but Helpful)

```typescript
test('multi-device sync scenario', async () => {
  // Browser 1 receives token
  // Browser 2 comes online
  // Browser 2 polls and discovers
  // Browser 2 user clicks sync
  // Verify: 1 upload, no dual-publish, no data loss
});
```

---

## Risk Assessment: Now MEDIUM (was LOW)

### Severity Factors

| Factor | Impact | Rating |
|--------|--------|--------|
| Lines of code affected | ~50 (not ~30) | +1 RISK |
| Hidden trigger points | 3 (not 1) | +2 RISK |
| External callers | 24 (not 0) | +1 RISK |
| Polling frequency | Every 30-90s | +1 RISK |
| Event frequency | Per token op | +1 RISK |
| **Overall** | **Multiple high-frequency triggers** | **MEDIUM** |

### Mitigation Strategies

1. **Feature Flag**: `ENABLE_DUAL_SYNC_REFACTOR=true/false`
   - Gradual rollout
   - Quick rollback if issues

2. **Monitoring**: Add telemetry
   - Count sync calls per minute
   - Detect dual-publish scenarios
   - Alert on high frequency

3. **Testing**: Comprehensive test suite
   - Unit tests for all 3 trigger points
   - Integration tests for race conditions
   - E2E tests for multi-device scenarios

4. **Documentation**: Clear explanations
   - Why each change is needed
   - How to re-enable polling safely
   - What symptoms would indicate problems

---

## Approval Checklist

Before merging, reviewer must verify:

- [ ] Change 6: scheduleSync() removed from line 1682
- [ ] Change 6: scheduleSync() removed from line 1706
- [ ] Change 6: console.warn() added explaining deprecation
- [ ] Change 7: startAutoSync() has detailed documentation
- [ ] Change 7: setupVisibilityListener() has detailed documentation
- [ ] Change 7: Rationale explains 3 trigger points
- [ ] Change 7: Re-enable instructions are clear
- [ ] All 24 callers reviewed for safety
- [ ] Unit tests pass (especially trigger point tests)
- [ ] No new console errors on startup
- [ ] Manual sync works (UI button still works)
- [ ] No observable changes from user perspective (except no dual-publish)

---

## Rollback Procedure

If issues occur after merge:

**Immediate** (5 min):
```bash
git revert <commit-hash>
deploy()
```

**Investigation**:
- Review logs for dual-publish symptoms
- Identify which trigger point caused issue
- Check test failures

**Resolution**:
- Fix specific issue in Changes 6 or 7
- Re-run tests
- Re-submit PR

---

## Document Reference

| Document | Purpose |
|----------|---------|
| `/home/vrogojin/sphere/DUAL_SYNC_REFACTORING_UPDATED.md` | Full updated plan with all 7 changes |
| `/home/vrogojin/sphere/CHANGE_6_AND_7_SPECIFIC.md` | Exact code changes needed (copy-paste ready) |
| `/home/vrogojin/sphere/TRIGGER_POINT_ANALYSIS.md` | Detailed analysis of 3 trigger points |
| `/home/vrogojin/sphere/CODE_REVIEW_SUMMARY.md` | This document (executive summary) |

---

## Next Steps

1. **Reviewer**: Read CHANGE_6_AND_7_SPECIFIC.md for exact code changes
2. **Reviewer**: Verify 3 trigger points are addressed
3. **Reviewer**: Approve or request modifications
4. **Developer**: Implement Changes 6 & 7 per CHANGE_6_AND_7_SPECIFIC.md
5. **Developer**: Run full test suite
6. **Developer**: Submit for re-review
7. **Reviewer**: Approve merge when all checks pass

---

**Status**: Awaiting implementation of Changes 6 & 7
**Timeline**: 2-3 days to implement + test + review
**Contact**: Code review team for questions
