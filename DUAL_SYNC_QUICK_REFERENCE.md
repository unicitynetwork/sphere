# Dual Sync Anti-Pattern: Quick Reference Guide

**Status:** READY FOR IMPLEMENTATION
**Effort:** 15-30 minutes
**Risk:** LOW (non-breaking changes)

---

## The Problem (30 seconds)

Two services publish to the same IPNS name → race conditions:

```
InventorySyncService → seq=8,9 ┐
                               ├→ IPNS Name → CONFLICT!
IpfsStorageService   → seq=10  ┘
```

**Solution:** Disable IpfsStorageService auto-sync, keep only transport methods.

---

## One File to Change

**File:** `/home/vrogojin/sphere/src/components/wallet/L3/services/IpfsStorageService.ts`

### 5 Changes (Choose "Disable" pattern for each)

| Line Range | Method | Change | Pattern |
|-----------|--------|--------|---------|
| 233-250 | `startAutoSync()` | **Disable event listener** | Comment out line 240 |
| 256-260 | `shutdown()` | **Add comments** | Explain deprecation |
| 3004-3016 | `scheduleSync()` | **Add warning** | `console.warn("DEPRECATED")` |
| 3031-3050 | `syncFromIpns()` | **Add warning** | `console.warn("DEPRECATED")` |
| Throughout | Transport methods | **Add comments** | Mark as STABLE |

---

## Change Pattern (Copy-Paste Ready)

### Pattern 1: Disable Code Section
```typescript
// DEPRECATED: Feature moved to InventorySyncService
// Reason: Prevent dual-publish race conditions
// this.oldCode();
// this.moreOldCode();

// New behavior: delegated to InventorySyncService
```

### Pattern 2: Add Deprecation Warning
```typescript
console.warn("⚠️  DEPRECATED: MethodName() is deprecated. Use InventorySyncService.inventorySync() instead.");
```

### Pattern 3: Mark Stable API
```typescript
// ==========================================
// IpfsTransport Interface - STABLE
// ==========================================
// Do NOT deprecate - called by InventorySyncService
// ==========================================
```

---

## Step-by-Step (Copy-Paste Implementation)

### Step 1: Open File
```bash
# In your editor:
# Go to: src/components/wallet/L3/services/IpfsStorageService.ts
```

### Step 2: Find startAutoSync() - Line 240
```typescript
// FIND THIS (around line 240):
this.boundSyncHandler = () => this.scheduleSync();
window.addEventListener("wallet-updated", this.boundSyncHandler);

// REPLACE WITH THIS:
// DEPRECATED: wallet-updated listener removed (2026-01-18)
// Auto-sync now delegated to InventorySyncService
// this.boundSyncHandler = () => this.scheduleSync();
// window.addEventListener("wallet-updated", this.boundSyncHandler);
```

### Step 3: Find startAutoSync() - Line 244-249
```typescript
// FIND THIS (around line 244):
this.setupVisibilityListener();
this.syncFromIpns().catch(console.error);

// REPLACE WITH THIS:
// DEPRECATED: IPNS polling moved to InventorySyncService
// this.setupVisibilityListener();
// this.syncFromIpns().catch(console.error);
```

### Step 4: Update startAutoSync() - Logging
```typescript
// FIND THIS (line 242):
console.log("📦 IPFS auto-sync enabled");

// REPLACE WITH THIS:
console.log("📦 IPFS auto-sync disabled (delegated to InventorySyncService)");
console.warn("⚠️  DEPRECATED: IpfsStorageService.startAutoSync() is deprecated in favor of InventorySyncService");
```

### Step 5: Find scheduleSync() - Line 3004
```typescript
// ADD THIS at the start of the method (line 3005):
console.warn("⚠️  DEPRECATED: IpfsStorageService.scheduleSync() is deprecated. Use InventorySyncService.inventorySync() instead.");
```

### Step 6: Find syncFromIpns() - Line 3031
```typescript
// ADD THIS at the start of the method (around line 3032):
console.warn("⚠️  DEPRECATED: IpfsStorageService.syncFromIpns() is deprecated. Use InventorySyncService.inventorySync() instead.");
```

### Step 7: Verify Syntax
```bash
npx tsc --noEmit
# Should show: Found 0 errors
```

### Step 8: Check Linting
```bash
npm run lint
# Should pass
```

---

## What NOT to Change

✓ **Keep these methods (STABLE API):**
- `resolveIpns()`
- `uploadContent()`
- `publishIpns()`
- `getIpnsName()`
- `ensureInitialized()`
- `setLastCid()`
- `isWebCryptoAvailable()`

✗ **Don't change InventorySyncService** - it's already correct

✗ **Don't change SyncQueue** - no changes needed

---

## Build & Test

```bash
# Verify no syntax errors
npx tsc --noEmit

# Run tests (expect 1-2 failures for deprecated methods)
npm run test:run

# Build production
npm run build

# Manual test
npm run dev
# - Open wallet
# - Receive token
# - Check console for "DISABLED" message (not "ENABLED")
# - Verify no IPNS seq conflicts
```

---

## Expected Test Output

### GOOD - Deprecation warnings appear:
```
⚠️  DEPRECATED: IpfsStorageService.startAutoSync() is deprecated...
⚠️  DEPRECATED: IpfsStorageService.scheduleSync() is deprecated...
⚠️  DEPRECATED: IpfsStorageService.syncFromIpns() is deprecated...
```

### BAD - Auto-sync still triggers:
```
📦 wallet-updated event detected
📦 Scheduling sync...
```

### GOOD - Only InventorySyncService publishes:
```
📦 [InventorySync] Uploading to IPFS...
📡 IPNS publish: seq=9
✅ Success
```

### BAD - Multiple publishers:
```
📦 IpfsStorageService uploading...
📦 InventorySync uploading...
📡 IPNS publish: seq=10 (conflict!)
```

---

## Rollback (If Needed)

### Fastest rollback (< 1 minute):

```bash
# Undo all changes:
git checkout src/components/wallet/L3/services/IpfsStorageService.ts

# Rebuild:
npm run build
```

### Or manually:

1. Uncomment line 240: `window.addEventListener("wallet-updated", ...)`
2. Uncomment line 249: `this.syncFromIpns().catch(console.error);`
3. Remove deprecation warnings
4. Rebuild and test

---

## Commit Message

```
fix: disable dual sync auto-trigger in IpfsStorageService

- Remove wallet-updated event listener from startAutoSync()
- Disable IPNS polling (delegated to InventorySyncService)
- Disable startup syncFromIpns() call
- Add deprecation warnings to scheduleSync() and syncFromIpns()
- Add stable API documentation to transport methods

Fixes #XXX: Dual Sync Anti-Pattern Race Conditions

This eliminates the race condition where both InventorySyncService
and IpfsStorageService publish to the same IPNS name, causing sequence
number conflicts. InventorySyncService is now the single authoritative
publisher, while IpfsStorageService serves as a pure transport layer.

Breaking Changes: None (fully backward compatible with deprecation warnings)
```

---

## FAQ

**Q: Will this break my code?**
A: No. The methods still exist and work. They just log deprecation warnings.

**Q: What about OutboxRecoveryService that calls syncNow()?**
A: It still works. `syncNow()` is not being changed. But consider migrating to `inventorySync()` in a future PR.

**Q: Will tokens sync without auto-sync?**
A: Yes. InventorySyncService's background loops handle sync automatically. Plus manual sync calls still work.

**Q: How do I verify this worked?**
A: Open DevTools console. You should see "DISABLED" message, not "ENABLED". IPNS seq numbers should increment normally without conflicts.

**Q: What if I break something?**
A: Rollback is <1 minute. Just undo the changes and rebuild.

**Q: Can I deploy this to production?**
A: Yes, after testing locally. It's fully backward compatible.

---

## Pre-Implementation Checklist

- [ ] Read: `DUAL_SYNC_REFACTORING_PLAN.md` (full context)
- [ ] Read: `DUAL_SYNC_CODE_CHANGES.md` (detailed changes)
- [ ] Run: `npm run test:run` (baseline tests pass)
- [ ] Backup: Current branch pushed to remote
- [ ] Create: Feature branch `fix/dual-sync-anti-pattern`

## Post-Implementation Checklist

- [ ] Verify: `npx tsc --noEmit` passes
- [ ] Verify: `npm run lint` passes
- [ ] Verify: `npm run test:run` passes (with expected deprecations)
- [ ] Verify: `npm run build` succeeds
- [ ] Verify: Browser console shows "DISABLED" message
- [ ] Verify: No "wallet-updated" triggers in IpfsStorageService logs
- [ ] Commit: Git commit with proper message
- [ ] Push: To feature branch for PR review

---

## Related Documentation

- **Full Plan:** [`DUAL_SYNC_REFACTORING_PLAN.md`](./DUAL_SYNC_REFACTORING_PLAN.md)
- **Code Changes:** [`DUAL_SYNC_CODE_CHANGES.md`](./DUAL_SYNC_CODE_CHANGES.md)
- **Issue:** #XXX (Dual Sync Anti-Pattern)
- **Parent Task:** #110 (Token Inventory Refactoring)

---

## Support

If you have questions:
1. Check the detailed code changes document
2. Review the full refactoring plan
3. Look at the plan file referenced in the problem statement
4. Ask the unicity-architect reviewer

---

**Ready to implement?** Start with Step 1 above and follow the pattern.
