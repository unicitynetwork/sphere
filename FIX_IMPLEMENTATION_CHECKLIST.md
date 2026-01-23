# Fix Implementation Checklist

## Overview

This checklist provides exact file locations and code changes to fix the deprecated recovery flow issues identified in the console logs.

---

## Files to Modify

### 1. `/home/vrogojin/sphere/src/components/wallet/L3/hooks/useWallet.ts` (LINE 246-248)

**Current Code**:
```typescript
if (identity) {
  const storageService = IpfsStorageService.getInstance(identityManager);
  storageService.startAutoSync();  // ← DEPRECATED
}
```

**Fixed Code**:
```typescript
if (identity && identity.address && identity.publicKey && identity.ipnsName) {
  // Use new InventorySyncService instead of deprecated IpfsStorageService.startAutoSync()
  import { inventorySync } from '../services/InventorySyncService';

  inventorySync({
    address: identity.address,
    publicKey: identity.publicKey,
    ipnsName: identity.ipnsName,
    mode: 'AUTO'  // Auto-detect sync mode based on context
  }).catch(error => {
    console.error('Failed to start inventory sync:', error);
  });
}
```

**Note**: You may need to set up a polling interval if auto-sync requires periodic execution. Check the original `startAutoSync()` implementation for polling logic.

---

### 2. `/home/vrogojin/sphere/src/components/wallet/L3/hooks/useIpfsStorage.ts` (LINE 79)

**Current Code**:
```typescript
useEffect(() => {
  if (!storageService) return;
  storageService.startAutoSync();  // ← DEPRECATED
  setIsServiceReady(true);
  // ...
}, [storageService]);
```

**Analysis**: This hook appears to be for a different purpose (IPFS storage events, not wallet inventory). Check if this is still needed or if it should be removed entirely.

**Options**:

**Option A - Remove if no longer needed**:
```typescript
// If useIpfsStorage is only used for wallet sync, consider deprecating this hook
// and using InventorySyncService directly instead
```

**Option B - Keep but don't call startAutoSync()**:
```typescript
useEffect(() => {
  if (!storageService) return;
  // startAutoSync() is deprecated - sync is now managed by InventorySyncService
  // via useWallet.ts. This hook only handles storage events.
  setIsServiceReady(true);
  // ...
}, [storageService]);
```

**Recommendation**: Review usages of `useIpfsStorage` hook. If it's only used for wallet sync, deprecate it and use `inventorySync()` directly.

---

### 3. `/home/vrogojin/sphere/src/components/wallet/L3/services/IpfsStorageService.ts` (LINE ~252)

**Current Code**:
```typescript
async startAutoSync() {
  if (!this.isIpfsEnabled()) {
    console.log(`📦 IPFS disabled, skipping auto-sync`);
    return;
  }

  console.log(`📦 IPFS auto-sync enabled (auto-triggers disabled - use InventorySyncService)`);
  console.warn('⚠️ [DEPRECATED] IpfsStorageService.startAutoSync() - auto-sync delegated to InventorySyncService');

  // ... rest of deprecated implementation
}
```

**Fixed Code** (make it fail loudly):
```typescript
async startAutoSync() {
  throw new Error(
    'DEPRECATED: IpfsStorageService.startAutoSync() has been removed. ' +
    'Use InventorySyncService.inventorySync() instead. ' +
    'See FIX_IMPLEMENTATION_CHECKLIST.md for migration guide.'
  );
}
```

**Purpose**: This ensures any missed call sites fail immediately with a clear error message rather than executing deprecated code.

---

### 4. `/home/vrogojin/sphere/src/components/wallet/L3/services/IpfsStorageService.ts` (LINE ~3088)

**Current Code**:
```typescript
async syncFromIpns(forceDownload = false) {
  console.log(`📦 Starting IPNS-based sync...`);
  console.warn('⚠️ [DEPRECATED] IpfsStorageService.syncFromIpns() is deprecated. Use InventorySyncService.inventorySync() instead.');
  // ... rest of implementation
}
```

**Fixed Code** (make it fail loudly):
```typescript
async syncFromIpns(forceDownload = false) {
  throw new Error(
    'DEPRECATED: IpfsStorageService.syncFromIpns() has been removed. ' +
    'Use InventorySyncService.inventorySync() instead. ' +
    'See FIX_IMPLEMENTATION_CHECKLIST.md for migration guide.'
  );
}
```

---

### 5. `/home/vrogojin/sphere/src/components/wallet/L3/services/IpfsStorageService.ts` (LINE 3346-3367)

**Current Code** (false emergency detection):
```typescript
// CRITICAL FIX: Detect missing tokens (localStorage corruption scenario)
const localWallet = WalletRepository.getInstance();
const localTokenCount = localWallet.getTokens().length;  // ← WRONG: returns 0 if wallet not initialized
let remoteTokenCount = 0;
for (const key of Object.keys(remoteData)) {
  if (isTokenKey(key)) {
    remoteTokenCount++;
  }
}

if (localTokenCount === 0 && remoteTokenCount > 0) {
  console.warn(`⚠️ RECOVERY: Versions match but localStorage is empty!`);
  console.warn(`⚠️ RECOVERY: Detected tokens - local: ${localTokenCount}, remote: ${remoteTokenCount}`);
  console.warn(`⚠️ RECOVERY: Recovering ${remoteTokenCount} token(s) from IPFS`);

  const importedCount = await this.importRemoteData(remoteData);
  // ...
}
```

**Fixed Code** (Option A - Delete entirely, recommended):
```typescript
// REMOVED: This recovery scenario is now handled by InventorySyncService.inventorySync()
// The false positive occurred because WalletRepository.getTokens() returns 0 when
// the wallet isn't initialized, even if tokens exist in localStorage.
```

**Fixed Code** (Option B - Fix the check if you want to keep it):
```typescript
// Use new query path instead of WalletRepository
import { getTokensForAddress } from './InventorySyncService';

const address = (remoteData._meta as TxfMeta)?.address;
const localTokenCount = address ? getTokensForAddress(address).length : 0;
let remoteTokenCount = 0;
for (const key of Object.keys(remoteData)) {
  if (isTokenKey(key)) {
    remoteTokenCount++;
  }
}

if (localTokenCount === 0 && remoteTokenCount > 0) {
  console.warn(`⚠️ RECOVERY: Versions match but localStorage is empty!`);
  console.warn(`⚠️ RECOVERY: Detected tokens - local: ${localTokenCount}, remote: ${remoteTokenCount}`);
  console.warn(`⚠️ RECOVERY: This should be handled by InventorySyncService, not IpfsStorageService`);
  // Don't import - let InventorySyncService handle it
}
```

**Recommendation**: Delete the entire block (Option A). Recovery is InventorySyncService's responsibility.

---

### 6. Zod Validation Investigation

**File**: `/home/vrogojin/sphere/src/components/wallet/L3/services/TxfSerializer.ts` (LINE ~515)

**Add temporary debugging** to understand the validation failure:

```typescript
const validation = validateTxfToken(txfToken);
if (!validation.isValid) {
  // Add detailed logging to understand the failure
  console.error(`❌ Token ${tokenId} validation failed:`, validation.error);
  console.error('Token data structure:', JSON.stringify(storageData[key], null, 2));
  console.error('Expected schema:', 'TxfToken (see TxfTypes.ts for definition)');

  result.validationErrors.push(`Token ${tokenId}: ${validation.error || "validation failed"}`);
  // ... existing fallback code
}
```

**Action**: Run the app, check console for the detailed error, then:
1. Identify which field has the wrong type
2. Update Zod schema OR add migration logic
3. Remove the debugging logs after fix is confirmed

---

## Implementation Order

### Phase 1: Stop Calling Deprecated Methods (Critical)
1. ✅ Fix `useWallet.ts` line 246-248 (replace `startAutoSync()` with `inventorySync()`)
2. ✅ Fix `useIpfsStorage.ts` line 79 (remove or comment out `startAutoSync()` call)
3. ✅ Make deprecated methods throw errors (IpfsStorageService lines ~252, ~3088)

### Phase 2: Remove False Warnings (High Priority)
4. ✅ Delete false emergency detection (IpfsStorageService lines 3346-3367)
5. ✅ Add Zod validation debugging (TxfSerializer line ~515)

### Phase 3: Fix Validation (Medium Priority)
6. ✅ Analyze Zod validation errors from logs
7. ✅ Update schema or add migration
8. ✅ Remove debugging logs

### Phase 4: Cleanup (Low Priority)
9. Delete deprecated methods entirely (after confidence period)
10. Remove deprecation warnings from documentation

---

## Testing After Each Phase

### After Phase 1
- [ ] App starts without errors
- [ ] No `⚠️ [DEPRECATED] startAutoSync()` warnings
- [ ] Tokens still display correctly
- [ ] IPFS sync still works (check by adding/removing token)

**If errors occur**: Check stack trace to find any missed call sites for `startAutoSync()` or `syncFromIpns()`

### After Phase 2
- [ ] No "RECOVERY: Versions match but localStorage is empty!" messages (when tokens exist)
- [ ] Tokens still display correctly

### After Phase 3
- [ ] No Zod validation fallback warnings
- [ ] All tokens validate successfully
- [ ] Tokens still display correctly

---

## Rollback Plan

If any phase causes issues:

1. **Revert the specific file** that caused the problem
2. **Keep previous phases** if they worked
3. **File bug report** with:
   - Exact error message
   - Stack trace
   - Console logs
   - Which phase failed

The old deprecated flow will continue working (with warnings) until the root cause is debugged.

---

## Success Criteria

After all phases complete, the console should show:

```
✅ No ⚠️ [DEPRECATED] warnings
✅ No "Wallet not initialized!" errors
✅ No "RECOVERY: Versions match but localStorage is empty!" messages
✅ No Zod validation fallback warnings
✅ Tokens display correctly (3 tokens shown)
✅ IPFS sync works (version counter increments)
✅ Multi-device sync works (test by importing wallet on second device)
```

---

## Additional Notes

### Auto-Sync Polling

If `startAutoSync()` was setting up a polling interval, you'll need to replicate that for `inventorySync()`:

```typescript
useEffect(() => {
  if (!identity?.address || !identity?.publicKey || !identity?.ipnsName) return;

  // Initial sync
  inventorySync({
    address: identity.address,
    publicKey: identity.publicKey,
    ipnsName: identity.ipnsName,
    mode: 'AUTO'
  });

  // Set up polling (check original startAutoSync() for interval duration)
  const intervalId = setInterval(() => {
    inventorySync({
      address: identity.address,
      publicKey: identity.publicKey,
      ipnsName: identity.ipnsName,
      mode: 'AUTO'
    }).catch(error => {
      console.error('Auto-sync failed:', error);
    });
  }, 30000);  // 30 seconds (adjust based on original interval)

  return () => clearInterval(intervalId);
}, [identity]);
```

### Chat History Sync

The files `ChatHistoryIpfsService.ts` and `useChatHistorySync.ts` also call `startAutoSync()`, but these are for chat history, not wallet tokens. Handle these separately if needed.

---

## Questions?

If you encounter any issues or need clarification:
1. Check `/home/vrogojin/sphere/CONSOLE_LOGS_DETAILED_ANALYSIS.md` for full context
2. Check `/home/vrogojin/sphere/RECOVERY_FLOW_FIX_GUIDE.md` for additional guidance
3. Review the implementation of `InventorySyncService.inventorySync()` to understand the new flow
