# Recovery Flow Fix Guide

## Quick Summary

**Problem**: The IPFS auto-sync still uses deprecated `IpfsStorageService` methods instead of `InventorySyncService.inventorySync()`, causing false warnings and unnecessary operations.

**Solution**: Find where auto-sync is triggered and replace with the new inventory sync flow.

---

## Step 1: Find Auto-Sync Trigger Point

Search for where `IpfsStorageService.startAutoSync()` is called:

```bash
grep -r "startAutoSync" src/
```

Likely locations:
- Component mount effects (useEffect)
- Wallet initialization hooks
- Dashboard layout

---

## Step 2: Replace with InventorySyncService

**BEFORE**:
```typescript
import { getIpfsStorageService } from './IpfsStorageService';

useEffect(() => {
  const ipfsService = getIpfsStorageService();
  ipfsService.startAutoSync();  // ← DEPRECATED
}, []);
```

**AFTER**:
```typescript
import { inventorySync } from './InventorySyncService';
import { IdentityManager } from './IdentityManager';

useEffect(() => {
  const identity = IdentityManager.getInstance().getIdentity();
  if (identity?.address && identity?.publicKey && identity?.ipnsName) {
    inventorySync({
      address: identity.address,
      publicKey: identity.publicKey,
      ipnsName: identity.ipnsName,
      mode: 'AUTO'  // Or let it detect automatically
    });
  }
}, []);
```

---

## Step 3: Verify IpfsStorageService Methods Are Not Called

Add runtime checks to deprecated methods to ensure they're never called:

**File**: `/home/vrogojin/sphere/src/components/wallet/L3/services/IpfsStorageService.ts`

```typescript
// Line ~252
async startAutoSync() {
  throw new Error('DEPRECATED: startAutoSync() should not be called. Use InventorySyncService.inventorySync() instead.');
}

// Line ~3088
async syncFromIpns(forceDownload = false) {
  throw new Error('DEPRECATED: syncFromIpns() should not be called. Use InventorySyncService.inventorySync() instead.');
}

// Line ~2713
private async importRemoteData(remoteTxf: TxfStorageData): Promise<number> {
  throw new Error('DEPRECATED: importRemoteData() should not be called. Use InventorySyncService.inventorySync() instead.');
}
```

Run the app - if any deprecated methods are still being called, you'll get a clear error stack trace showing the caller.

---

## Step 4: Fix False Emergency Detection (Optional Cleanup)

If you want to keep the emergency recovery as a fallback (not recommended), fix the check:

**File**: `/home/vrogojin/sphere/src/components/wallet/L3/services/IpfsStorageService.ts:3346-3367`

```typescript
// BEFORE:
const localWallet = WalletRepository.getInstance();
const localTokenCount = localWallet.getTokens().length;  // Wrong: checks uninitialized repo

// AFTER:
import { getTokensForAddress } from './InventorySyncService';
const address = (remoteData._meta as TxfMeta)?.address;
const localTokenCount = address ? getTokensForAddress(address).length : 0;
```

**Better Option**: Delete the entire recovery block (lines 3343-3367) since `inventorySync()` handles this scenario properly.

---

## Step 5: Fix Zod Validation Issues

### Investigation

Add logging to see what structure is failing:

```typescript
// In TxfSerializer.ts, around line 515 where validation happens
if (!validation.isValid) {
  console.error(`Token ${tokenId} validation failed:`, validation.error);
  console.error('Token data:', JSON.stringify(storageData[key], null, 2));
  // ... existing fallback code
}
```

Run the app and check console for the full error details.

### Common Fixes

**If the error is "id input: expected string, received object"**:

The Zod schema expects `id` to be a string, but the stored data has it as an object. Update the schema or add a migration:

```typescript
// Option A: Update Zod schema (TxfTypes.ts)
const TxfTokenSchema = z.object({
  id: z.union([z.string(), z.object({})]),  // Accept both string and object
  // ... rest of schema
});

// Option B: Add migration during load (TxfSerializer.ts)
function normalizeTxfToken(txf: any): TxfToken {
  if (typeof txf.id === 'object') {
    // Extract string ID from object or generate new one
    txf.id = txf.genesis?.data?.tokenId || crypto.randomUUID();
  }
  return txf as TxfToken;
}
```

---

## Step 6: Testing Checklist

After implementing fixes, verify:

- [ ] No `⚠️ [DEPRECATED]` warnings in console
- [ ] No "Wallet not initialized!" errors
- [ ] No "RECOVERY: Versions match but localStorage is empty!" messages (when tokens exist)
- [ ] All tokens pass Zod validation (no fallback warnings)
- [ ] Tokens still display correctly in UI
- [ ] IPFS sync works (check after adding/removing tokens)

---

## Expected Console Output After Fixes

**Clean startup logs should look like**:

```
🔍 [MODULE LOAD] WalletRepository module initializing...
🔍 [MODULE LOAD] Found wallet: key=sphere_wallet_DIRECT://00008ce2b6987a5abc0e5495f43513e175ff6..., size=76064 bytes
🔍 [MODULE LOAD]   id=3df2461f..., tokens=3, nametag=babaika3

📦 [tokensQuery] Loading tokens for address: DIRECT://00008ce2b6987a5...
📦 [tokensQuery] Token list changed (hash: d1294ff3) - running spent check for 3 token(s)...
📦 [tokensQuery] Spent check complete: 0 spent, 3 valid
```

**No warnings, no errors, no deprecated method calls.**

---

## Rollback Plan

If issues occur after changes:

1. Revert auto-sync trigger changes
2. Keep deprecated methods enabled (remove the `throw` statements)
3. File bug report with specific error messages
4. The old flow will continue working (with warnings) until fixes are debugged

---

## Next Steps After Fixes

1. Run full test suite
2. Test wallet import/export flows
3. Test IPFS sync with multiple devices
4. Remove deprecated methods entirely (after confidence period)
5. Update documentation to reflect new sync architecture
