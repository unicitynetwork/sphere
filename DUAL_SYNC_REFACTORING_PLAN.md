# Dual Sync Anti-Pattern Refactoring Plan

**Date:** 2026-01-18
**Status:** PLANNING
**Objective:** Eliminate race conditions and sequence number conflicts by transforming IpfsStorageService into a pure transport layer

---

## Problem Statement

Two services are both publishing to the same IPNS name, causing race conditions and sequence number conflicts:

| Service | Role | Publishes | Issue |
|---------|------|-----------|-------|
| **InventorySyncService** | Orchestrator | Steps 8, 9, 10 seq=8,9 | Canonical sync flow, missing from legacy auto-sync |
| **IpfsStorageService** | Transport+Auto-sync | Legacy auto-sync seq=10 | Duplicates logic, missing 60% of validation, publishes independent seqs |

**Evidence:** `/home/vrogojin/.claude/plans/tingly-booping-kahn.md` (lines 262-274):
> "IpfsStorageService duplicates ~40% of InventorySyncService while MISSING 60% of critical validation (proof validation, spent detection, boomerang handling)."
>
> "Recommendation: IpfsStorageService should become a **pure IPFS transport layer**, delegating ALL sync logic to InventorySyncService."

---

## Architecture Decision

### Current (Broken)
```
┌─────────────────────┐         ┌──────────────────────┐
│ InventorySyncService│         │ IpfsStorageService   │
│                     │         │                      │
│ ✓ 10-step flow      │         │ ✗ Legacy auto-sync   │
│ ✓ Full validation   │         │ ✗ Seq conflicts      │
│ ✓ Pub seq=8,9       │         │ ✗ Pub seq=10         │
│ ✗ NOT auto-triggered│         │ ✓ Auto-triggered     │
└──────────┬──────────┘         └──────────┬───────────┘
           │                              │
           └──────────────┬───────────────┘
                          │
                    ┌─────▼──────┐
                    │ IPNS Name  │
                    │ (CONFLICT) │
                    └────────────┘
```

### Target (Fixed)
```
┌─────────────────────────────────────────────┐
│       InventorySyncService                  │
│ ═════════════════════════════════════════  │
│ ✓ Orchestration (Steps 0-10)               │
│ ✓ Full validation pipeline                 │
│ ✓ Sync mode detection                      │
│ ✓ SINGLE sequence publication              │
└────────────────┬────────────────────────────┘
                 │
    ┌────────────▼────────────┐
    │   IpfsTransport         │
    │   (Pure IPFS Layer)     │
    ├─────────────────────────┤
    │ • resolveIpns()         │
    │ • uploadContent()       │
    │ • publishIpns()         │
    │ • getIpnsName()         │
    │ • ensureInitialized()   │
    │ • setLastCid()          │
    └────────────────────────┘
```

---

## Refactoring Scope

### Phase 1: Disable Auto-Sync (SAFE, NON-BREAKING)

**Goal:** Stop IpfsStorageService from auto-syncing on wallet-updated events while preserving its transport methods.

**Files to Modify:** 1 file

#### `/home/vrogojin/sphere/src/components/wallet/L3/services/IpfsStorageService.ts`

| Line(s) | Current Behavior | Change | Reason |
|---------|------------------|--------|--------|
| 240 | `addEventListener("wallet-updated", ...)` | Remove event listener | No longer auto-sync |
| 258 | `removeEventListener("wallet-updated", ...)` | Keep in shutdown (no-op if disabled) | Defensive cleanup |
| 3004-3016 | `scheduleSync()` method | Keep but never called | May be used elsewhere, prevents breaking changes |
| 3031-3107 | `syncFromIpns()` startup sync | Disable auto-call in `startAutoSync()` | Use InventorySyncService instead |
| 233-250 | `startAutoSync()` method | Disable IPNS polling, keep structure | Flag for deprecation |

**Specific Code Changes:**

**Change 1: Disable wallet-updated listener (Line 240)**
```typescript
// BEFORE:
this.boundSyncHandler = () => this.scheduleSync();
window.addEventListener("wallet-updated", this.boundSyncHandler);

// AFTER:
// DEPRECATED: Auto-sync now handled by InventorySyncService
// wallet-updated event listener removed to prevent dual-publish race conditions
// this.boundSyncHandler = () => this.scheduleSync();
// window.addEventListener("wallet-updated", this.boundSyncHandler);
```

**Change 2: Skip IPNS polling in startAutoSync (Line 244-249)**
```typescript
// BEFORE:
startAutoSync(): void {
  if (this.autoSyncEnabled) return;
  this.boundSyncHandler = () => this.scheduleSync();
  window.addEventListener("wallet-updated", this.boundSyncHandler);
  this.autoSyncEnabled = true;
  console.log("📦 IPFS auto-sync enabled");
  this.setupVisibilityListener();
  this.syncFromIpns().catch(console.error);  // <-- Remove this
}

// AFTER:
startAutoSync(): void {
  if (this.autoSyncEnabled) return;
  // DEPRECATED: Auto-sync now delegated to InventorySyncService
  // See https://github.com/UnicitySphere/sphere/issues/XXX
  this.autoSyncEnabled = true;  // Keep flag for compatibility
  console.log("📦 IPFS auto-sync disabled (delegated to InventorySyncService)");
  // Removed: wallet-updated listener
  // Removed: IPNS polling via setupVisibilityListener()
  // Removed: syncFromIpns() startup call
}
```

**Change 3: Update shutdown to remove orphaned cleanup (Line 256-260)**
```typescript
// BEFORE:
async shutdown(): Promise<void> {
  if (this.boundSyncHandler) {
    window.removeEventListener("wallet-updated", this.boundSyncHandler);
    this.boundSyncHandler = null;
  }
  this.autoSyncEnabled = false;
  this.cleanupVisibilityListener();
  // ...
}

// AFTER:
async shutdown(): Promise<void> {
  // boundSyncHandler already null (was never set in new startAutoSync)
  // but keeping for defensive cleanup
  if (this.boundSyncHandler) {
    window.removeEventListener("wallet-updated", this.boundSyncHandler);
    this.boundSyncHandler = null;
  }
  this.autoSyncEnabled = false;
  // DEPRECATED: IPNS polling moved to InventorySyncService
  // Keep cleanupVisibilityListener for safety
  this.cleanupVisibilityListener();
  // ...
}
```

**Change 4: Add deprecation warnings to auto-sync methods**

```typescript
// Add to startAutoSync() and scheduleSync()
console.warn("⚠️ DEPRECATED: IpfsStorageService.startAutoSync() is deprecated in favor of InventorySyncService");
console.warn("⚠️ DEPRECATED: IpfsStorageService.scheduleSync() is deprecated in favor of InventorySyncService");
```

---

## Transport Methods to Keep (Stable Public API)

These methods form the **IpfsTransport** interface and are called by **InventorySyncService**:

```typescript
// IpfsStorageService methods that InventorySyncService depends on:
public async resolveIpns(): Promise<IpfsResolutionResult>
public async uploadContent(data: TxfStorageData): Promise<IpfsUploadResult>
public async publishIpns(cid: string): Promise<IpfsPublishResult>
public async getIpnsName(): Promise<string>
public async ensureInitialized(): Promise<boolean>
public setLastCid(cid: string): void
public isWebCryptoAvailable(): boolean
```

✓ **These are safe to keep - they are pure transport methods with no side effects.**

---

## Integration Point: InventorySyncService

**File:** `/home/vrogojin/sphere/src/components/wallet/L3/services/InventorySyncService.ts`

**Current Integration (Lines 30-31):**
```typescript
import { getIpfsTransport } from './IpfsStorageService';
import type { IpfsTransport } from './types/IpfsTransport';
```

**Step 10 Upload (Lines 1514-1568):** Already calls transport methods correctly:
```typescript
const transport = getIpfsTransport();
const uploadResult = await transport.uploadContent(storageData);
const publishResult = await transport.publishIpns(uploadResult.cid);
```

✓ **InventorySyncService is already designed to orchestrate the full sync flow.**

---

## Methods to Disable (Never Called After This Refactoring)

| Method | Location | Disable Method | Reason |
|--------|----------|-----------------|--------|
| `scheduleSync()` | Line 3004 | Add deprecation warning | Auto-sync disabled |
| `syncFromIpns()` | Line 3031 | Add deprecation warning, NO LONGER CALLED | Legacy startup sync |
| `setupVisibilityListener()` | (Referenced) | Add deprecation warning | IPNS polling disabled |
| `cleanupVisibilityListener()` | (Referenced) | Add deprecation warning | IPNS polling cleanup disabled |
| Internal IPNS polling | (Lines 244-245) | Remove call | Delegated to InventorySyncService |

---

## Deprecation and Migration Path

### For Callers of Deprecated Methods

**Old Code Pattern:**
```typescript
const ipfsService = IpfsStorageService.getInstance();
ipfsService.startAutoSync();
```

**New Code Pattern:**
```typescript
// InventorySyncService is called automatically by background loops
// No explicit call needed - sync happens via:
// 1. InventoryBackgroundLoopsManager (token receive/send)
// 2. Explicit inventorySync(params) calls for manual sync
// 3. UI handlers for user-initiated actions
```

**Migration Examples:**

1. **FaucetService** (calls `window.dispatchEvent("wallet-updated")`)
   - No change needed - event dispatch continues
   - But now it triggers InventorySyncService indirectly (via background loops)

2. **NostrService** (handles incoming transfers)
   - No change needed - queues token in ReceiveTokensToInventoryLoop
   - Loop calls inventorySync(FAST) automatically

3. **OutboxRecoveryService** (recovery logic)
   - Update to call `inventorySync({ outboxTokens })` directly
   - No longer needs `syncNow()` as fallback

---

## Rollback Strategy

If issues arise during deployment:

### Rollback Step 1: Re-enable listener (1 minute)
```typescript
// Restore line 240:
this.boundSyncHandler = () => this.scheduleSync();
window.addEventListener("wallet-updated", this.boundSyncHandler);
```

### Rollback Step 2: Re-enable startup sync (1 minute)
```typescript
// Restore line 249:
this.syncFromIpns().catch(console.error);
```

### Rollback Step 3: Re-enable visibility polling (5 minutes if needed)
```typescript
// Restore line 245:
this.setupVisibilityListener();
```

**Total Rollback Time:** <10 minutes
**Data Loss Risk:** None (both layers read from same localStorage)

---

## Build and Test Verification

### Pre-Deployment Checks

```bash
# 1. TypeScript compilation (must pass)
npx tsc --noEmit

# 2. Linting (must pass)
npm run lint

# 3. Unit tests (should pass, may need updates)
npm run test:run -- InventorySyncService

# 4. Integration tests (should pass)
npm run test:run -- InventorySync.test.ts

# 5. Manual browser test
npm run dev
# - Open wallet
# - Receive token via Nostr
# - Verify sync completes without seq conflicts
# - Check browser console for "AUTO-SYNC DISABLED" message
```

---

## Expected Test Failures and Fixes

### Test: `IpfsStorageService.startAutoSync enables listener`
**Status:** EXPECTED FAILURE
**Fix:** Update test to verify deprecation warning instead
```typescript
// Before:
expect(addEventListener).toHaveBeenCalledWith("wallet-updated", ...);

// After:
expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("DEPRECATED"));
```

### Test: `wallet-updated event triggers sync`
**Status:** EXPECTED FAILURE
**Fix:** Remove test or update to verify InventorySyncService handles it
```typescript
// Move test from IpfsStorageService → InventorySyncService
// Verify inventorySync() is called by background loops instead
```

---

## File-by-File Checklist

| File | Changes | Lines | Status |
|------|---------|-------|--------|
| `/src/.../IpfsStorageService.ts` | Disable auto-sync | 233-250, 240, 258, 3004-3107 | PLAN |
| `/src/.../InventorySyncService.ts` | No changes needed | — | READY |
| `/src/.../SyncQueue.ts` | No changes needed | — | READY |
| `/tests/.../*.test.ts` | Update/add tests | TBD | PLAN |

---

## Risks and Mitigations

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Wallet stuck in sync loop | HIGH | Monitor console for errors, add timeout guards |
| Missed token updates | HIGH | Verify background loops trigger correctly |
| IPNS sequence conflicts persist | MEDIUM | Add logging to verify single-publisher pattern |
| Tests fail | MEDIUM | Pre-test all changes in local environment |
| Performance regression | LOW | Monitor sync duration metrics |

---

## Success Criteria

1. **Build passes:** `npm run build` completes without errors
2. **Tests pass:** `npm run test:run` passes (with 1-2 expected failures for deprecated tests)
3. **No race conditions:** IPNS sequence numbers increment monotonically
4. **Deprecation visible:** Console shows warnings when old methods called
5. **Backward compatible:** Existing callers continue to work (with warnings)
6. **Clean logs:** No "wallet-updated event triggered sync" messages from IpfsStorageService

---

## Deployment Steps

### Step 1: Code Changes (15 minutes)
1. Edit IpfsStorageService.ts - disable auto-sync listener
2. Add deprecation warnings to auto-sync methods
3. Verify no syntax errors: `npx tsc --noEmit`

### Step 2: Update Tests (30 minutes)
1. Update test expectations for deprecated methods
2. Add tests for InventorySyncService auto-triggering
3. Run tests: `npm run test:run`

### Step 3: Build and Deploy (5 minutes)
1. Build: `npm run build`
2. Deploy to staging
3. Manual smoke test: receive token, verify no seq conflicts

### Step 4: Monitor (24 hours)
1. Watch browser console for deprecation warnings
2. Monitor IPNS sequence numbers in logs
3. Verify no wallet sync failures

### Step 5: Cleanup (Future PR)
1. Remove deprecated method stubs (in 2-3 versions)
2. Remove deprecation warnings
3. Update documentation

---

## Related Issues

- **#110:** Token Inventory Refactoring (parent task)
- **#145-#161:** Subtasks under parent #110
- **#XXX:** Dual sync anti-pattern (to be created)

---

## Notes for Implementation

1. **IpfsTransport Interface** (`/src/.../types/IpfsTransport.ts`) is already properly defined
2. **InventorySyncService** already calls transport methods in Step 10
3. **SyncQueue** coalesces LOW priority requests (no changes needed)
4. **No new files needed** - only modifications to existing services

---

## Appendix: Code Diff Summary

### Summary of Changes

```
File: src/components/wallet/L3/services/IpfsStorageService.ts
─────────────────────────────────────────────────────────────

Lines 233-250: startAutoSync()
  CHANGE: Disable event listener and visibility polling
  REASON: Delegate auto-sync to InventorySyncService

Lines 240: wallet-updated listener setup
  CHANGE: Comment out addEventListener call
  REASON: Prevent dual publishing

Lines 244-249: IPNS polling setup
  CHANGE: Comment out setupVisibilityListener + syncFromIpns
  REASON: Delegated to InventorySyncService

Lines 3004-3016: scheduleSync()
  CHANGE: Add deprecation warning
  REASON: No longer called by startAutoSync()

Lines 3031-3107: syncFromIpns()
  CHANGE: Add deprecation warning
  REASON: Startup sync moved to InventorySyncService

Total Lines Changed: ~20
Total Lines Added: ~10 (warnings/comments)
Breaking Changes: 0 (backward compatible with warnings)
```

---

## Sign-Off Checklist

- [ ] Unicity Architect reviewed and approved plan
- [ ] Legacy Modernizer verified backward compatibility
- [ ] Code reviewer verified test coverage
- [ ] QA performed manual smoke test
- [ ] Deployment checklist completed
- [ ] Monitoring alerts configured
- [ ] Rollback procedure documented and tested
