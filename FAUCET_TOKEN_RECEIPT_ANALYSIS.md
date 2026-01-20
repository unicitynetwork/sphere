# Faucet Token Receipt - Console Log Analysis

**Date:** 2026-01-18
**Context:** Analysis of console logs during 4-token faucet request for @superduper
**Status:** Multiple non-critical issues identified, one deprecated method warning

---

## Executive Summary

The faucet token receipt flow functionally **succeeded** - all 4 tokens were received, validated, and synced to IPFS. However, the logs reveal 5 anomalies that indicate technical debt and potential performance/reliability issues:

1. **MEDIUM** - Excessive duplicate query calls (11-12 refetches for batch receipt)
2. **LOW** - Zod validation failures with fallback (backward compatibility, expected)
3. **HIGH** - Missing stateHash on all tokens (breaks tombstone conflict resolution)
4. **LOW** - Version mismatch local v6 vs remote v4 (normal conflict resolution)
5. **LOW** - Deprecated method warning (cleanup needed)

---

## Anomaly Breakdown

### ANOMALY 1: Excessive Query Calls (MEDIUM SEVERITY)

**Observation:**
```
useWallet.ts:251 📦 [tokensQuery] Running spent check for 2 token(s)... (x11)
useWallet.ts:251 📦 [tokensQuery] Running spent check for 4 token(s)... (x12)
```

**Root Cause:**
Multiple components/events triggering `wallet-updated` during batch token receipt, overwhelming the debounce mechanism.

**Evidence from Code:**
- `useWallet.ts:46-66` - Debounce implementation (200ms window)
- `InventoryBackgroundLoops.ts:86` - Batch queue fires `wallet-updated` per token
- `IpfsStorageService.ts:240` - Auto-sync listens to `wallet-updated`
- `NostrService.ts:631` - Each finalized token triggers separate event

**Why It Happens:**
The flow is:
1. 4 tokens arrive via Nostr (4x `wallet-updated` dispatched in rapid succession)
2. InventoryBackgroundLoops batches them BUT IPFS sync happens per batch
3. FAST sync → `wallet-updated` (#5)
4. NORMAL sync → `wallet-updated` (#6)
5. Post-sync validation → potential additional events

The 200ms debounce in `useWallet.ts` successfully coalesces some events, but:
- IPFS sync operations take >200ms, causing debounce windows to reset
- Each sync completion fires new events outside the previous debounce window
- TanStack Query's refetch logic may fire immediately if stale time expired

**Impact:**
- **Performance:** 11-12 spent checks means 11-12 aggregator RPC calls for the same tokens
- **UX:** Potential UI flicker as balance updates multiple times
- **Network:** Unnecessary bandwidth consumption

**Recommendation:**
```typescript
// Option 1: Increase debounce to 500ms (covers IPFS sync duration)
const WALLET_UPDATE_DEBOUNCE_MS = 500;

// Option 2: Use a "settling" flag to skip events during active sync
// Option 3: Batch wallet-updated events at InventoryBackgroundLoops level
```

**File to Fix:** `/home/vrogojin/sphere/src/components/wallet/L3/hooks/useWallet.ts` (line 49)

---

### ANOMALY 2: Zod Validation Failures (LOW SEVERITY)

**Observation:**
```
TxfSerializer.ts:528 Token 6f9d85fd... loaded with fallback (failed Zod validation)
TxfSerializer.ts:566 TXF storage data validation issues: (4) [...'expected string, received object'...]
```

**Root Cause:**
SDK tokens serialize certain fields (tokenId, tokenType, salt, publicKey, signature) as **bytes objects** `{ bytes: [...] }` instead of hex strings. This is the SDK's internal format, but the Zod schemas expect normalized hex strings.

**Evidence from Code:**
- `TxfSerializer.ts:207-252` - `normalizeSdkTokenToStorage()` converts bytes objects to hex
- `TxfSchemas.ts:28-64` - `hexStringOrBytes64` schema accepts both formats
- `TxfSerializer.ts:528` - Fallback path when Zod validation fails

**Why It Happens:**
The normalization happens in `tokenToTxf()` (line 54), but tokens imported from IPFS or received via Nostr may have been serialized by older app versions that didn't normalize before storage. The fallback path successfully parses these tokens anyway.

**Impact:**
- **Functional:** NONE - fallback parsing works correctly
- **Performance:** Minimal - Zod validation is fast even when it fails
- **Logging:** Console warnings clutter the logs

**Recommendation:**
This is **working as designed** for backward compatibility. The fallback ensures older tokens can be parsed. However, all NEW tokens should be normalized before storage.

**Status:** ✅ Already handled correctly - normalization happens at line 54 of `TxfSerializer.ts`

---

### ANOMALY 3: Undefined stateHash (HIGH SEVERITY)

**Observation:**
```
ConflictResolutionService.ts:170 📦 Token 987ab1fc... has undefined stateHash, skipping tombstone check
ConflictResolutionService.ts:170 📦 Token 99fced56... has undefined stateHash, skipping tombstone check
ConflictResolutionService.ts:170 📦 Token 0678d163... has undefined stateHash, skipping tombstone check
ConflictResolutionService.ts:170 📦 Token 6f9d85fd... has undefined stateHash, skipping tombstone check
```

**Root Cause:**
Tokens received from the faucet are **genesis-only tokens** (no transactions yet). The `getCurrentStateHash()` function returns `undefined` for these tokens because:

1. They have `transactions.length === 0` (line 673-678 of `TxfSerializer.ts`)
2. They don't have `_integrity.currentStateHash` computed yet (line 682-685)

**Evidence from Code:**
```typescript
// TxfSerializer.ts:671-689
export function getCurrentStateHash(txf: TxfToken): string | undefined {
  // Handle tokens with transactions - use newStateHash from last transaction
  if (txf.transactions && txf.transactions.length > 0) {
    const lastTx = txf.transactions[txf.transactions.length - 1];
    if (lastTx?.newStateHash) {
      return lastTx.newStateHash;
    }
    return undefined;
  }

  // Genesis-only tokens: check _integrity.currentStateHash (computed post-import)
  if (txf._integrity?.currentStateHash) {
    return txf._integrity.currentStateHash;
  }

  // No stored state hash available - SDK must calculate it
  return undefined;
}
```

**Why It's Critical:**
Tombstone conflict resolution (preventing zombie token resurrection) **requires** stateHash to uniquely identify token states. Without it:
- Tombstone entries can't be matched to tokens (line 174 of `ConflictResolutionService.ts`)
- Deleted tokens on Device A might reappear when syncing from Device B
- Double-spend protection is weakened

**Impact:**
- **Security:** MEDIUM - Tombstone matching is broken for genesis-only tokens
- **Sync Reliability:** HIGH - Conflict resolution can't properly detect spent states
- **Data Integrity:** MEDIUM - Potential for zombie tokens across multi-device sync

**Solution Already Implemented:**
The codebase has `computeAndPatchStateHash()` (line 797-841 of `TxfSerializer.ts`) which:
1. Parses the token with the SDK
2. Calculates `state.calculateHash()`
3. Stores it in `_integrity.currentStateHash`

**Why It Wasn't Applied:**
Looking at `buildTxfStorageData()` (line 262-351 of `TxfSerializer.ts`), the stateHash computation happens at **export time** (line 319-325):

```typescript
// Compute stateHash for genesis-only tokens that don't have it
if (needsStateHashComputation(txf)) {
  try {
    txf = await computeAndPatchStateHash(txf);
  } catch (err) {
    console.warn(`Failed to compute stateHash for token ${token.id.slice(0, 8)}...:`, err);
  }
}
```

**The Problem:**
The faucet tokens were **just received** and immediately used in conflict resolution BEFORE they were exported to IPFS storage. The stateHash computation only happens during `buildTxfStorageData()`, which runs during IPFS sync.

**Recommendation:**
```typescript
// Option 1: Compute stateHash immediately after token receipt (in NostrService)
// Option 2: Compute stateHash in ConflictResolutionService before tombstone check
// Option 3: Make getCurrentStateHash() calculate on-the-fly if undefined

// PREFERRED: Option 3 (most robust)
export async function getCurrentStateHashOrCalculate(txf: TxfToken): Promise<string> {
  const stored = getCurrentStateHash(txf);
  if (stored) return stored;

  // Genesis-only token without stored hash - calculate now
  const { Token } = await import("@unicitylabs/state-transition-sdk/lib/token/Token");
  const sdkToken = await Token.fromJSON(txf);
  const calculatedStateHash = await sdkToken.state.calculateHash();
  return calculatedStateHash.toJSON();
}
```

**Files to Fix:**
- `/home/vrogojin/sphere/src/components/wallet/L3/services/ConflictResolutionService.ts` (line 168)
- `/home/vrogojin/sphere/src/components/wallet/L3/services/TxfSerializer.ts` (add new export)

---

### ANOMALY 4: Version Mismatch (LOW SEVERITY)

**Observation:**
```
IpfsStorageService.ts:3457 📦 Version mismatch detected: local v6 vs remote v4
ConflictResolutionService.ts:50 📦 Resolving conflict: local v6 vs remote v4
```

**Root Cause:**
Normal IPFS sync behavior when local and remote storage have diverged. This happens when:
1. User receives tokens on Device A (local v4 → v5 → v6)
2. User opens wallet on Device B (remote is still v4)
3. Conflict resolution merges local v6 and remote v4 → new v7

**Evidence from Code:**
```typescript
// ConflictResolutionService.ts:43-90
resolveConflict(local: TxfStorageData, remote: TxfStorageData): MergeResult {
  const localVersion = local._meta.version;
  const remoteVersion = remote._meta.version;

  if (remoteVersion > localVersion) {
    // Remote is newer - use remote as base
    baseMeta = { ...remote._meta, version: remoteVersion + 1 };
  } else if (localVersion > remoteVersion) {
    // Local is newer - use local as base
    baseMeta = { ...local._meta, version: localVersion + 1 };
  } else {
    // Same version - use local as base (local wins on tie)
    baseMeta = { ...local._meta, version: localVersion + 1 };
  }
  // ...
}
```

**Why It Happens:**
The version counter increments every time tokens are added/removed/modified. If user operations happen on one device while another is offline, versions diverge. This is **expected** and the conflict resolution handles it correctly.

**Impact:**
- **Functional:** NONE - conflict resolution works as designed
- **Performance:** Minimal overhead for merge logic
- **UX:** Transparent to user

**Recommendation:**
This is **working as intended**. The log is informational, not an error.

**Status:** ✅ No action needed - normal operation

---

### ANOMALY 5: Deprecated Method Warning (LOW SEVERITY)

**Observation:**
```
IpfsStorageService.ts:3830 ⚠️ [DEPRECATED] runSpentTokenSanityCheck() is deprecated. Use InventorySyncService.inventorySync() instead.
```

**Root Cause:**
The `runSpentTokenSanityCheck()` method was replaced by `InventorySyncService` (Step 7 of the 10-step sync flow), but old code paths still call the deprecated method.

**Evidence from Code:**
```typescript
// IpfsStorageService.ts:3829-3830
private async runSpentTokenSanityCheck(): Promise<void> {
  console.warn('⚠️ [DEPRECATED] runSpentTokenSanityCheck() is deprecated. Use InventorySyncService.inventorySync() instead.');
  // ...
}
```

**Call Sites (from grep results):**
- Line 1782 - Auto-sync polling path
- Line 3208 - IPNS publish retry path
- Line 3249 - Conflict resolution after merge
- Line 3277 - Post-import validation

**Impact:**
- **Functional:** NONE - deprecated method still works
- **Performance:** DUPLICATE WORK - both old sanity check AND new InventorySyncService may run
- **Maintainability:** Technical debt - confusing to have two code paths

**Recommendation:**
Remove all calls to `runSpentTokenSanityCheck()` and ensure `InventorySyncService.inventorySync()` is invoked instead with `mode: NORMAL` (which includes Step 7: spent detection).

**Files to Fix:**
- `/home/vrogojin/sphere/src/components/wallet/L3/services/IpfsStorageService.ts` (lines 1782, 3208, 3249, 3277)

**Migration Strategy:**
```typescript
// OLD (deprecated):
await this.runSpentTokenSanityCheck();

// NEW (correct):
await inventorySync({
  address: wallet.address,
  publicKey: identity.publicKey,
  ipnsName: this.ipnsName,
  local: false, // Run NORMAL mode (includes spent detection)
});
```

---

## Summary Table

| Anomaly | Severity | Root Cause | Impact | Fix Required? |
|---------|----------|------------|--------|---------------|
| Excessive query calls (11-12x) | MEDIUM | Debounce window too short for IPFS sync duration | Performance, network overhead | ✅ YES - Increase debounce to 500ms |
| Zod validation failures | LOW | Backward compat with SDK bytes objects | None (fallback works) | ❌ NO - Working as designed |
| Undefined stateHash | HIGH | Genesis tokens don't compute stateHash until export | Tombstone matching broken | ✅ YES - Compute on-demand |
| Version mismatch v6 vs v4 | LOW | Normal multi-device sync behavior | None (conflict resolution works) | ❌ NO - Expected behavior |
| Deprecated method warning | LOW | Old code paths not migrated to InventorySyncService | Duplicate work, tech debt | ✅ YES - Remove deprecated calls |

---

## Action Items

### Priority 1: Fix Undefined stateHash (HIGH)
**Impact:** Breaks tombstone conflict resolution for genesis-only tokens
**Effort:** Medium (2-3 hours)

1. Create `getCurrentStateHashOrCalculate()` async wrapper in `TxfSerializer.ts`
2. Update `ConflictResolutionService.ts` line 168 to use async version
3. Add caching to avoid recalculating same token multiple times
4. Test with genesis-only tokens from faucet

### Priority 2: Reduce Excessive Query Calls (MEDIUM)
**Impact:** 11-12 aggregator RPC calls per batch, UI flicker
**Effort:** Low (30 minutes)

1. Increase `WALLET_UPDATE_DEBOUNCE_MS` from 200ms to 500ms in `useWallet.ts`
2. Add "settling" flag to skip events during active IPFS sync
3. Test batch token receipt (4+ tokens) to verify <3 refetches

### Priority 3: Remove Deprecated Method Calls (LOW)
**Impact:** Technical debt, duplicate work
**Effort:** Low (1 hour)

1. Replace 4 call sites in `IpfsStorageService.ts` with `inventorySync()`
2. Remove `runSpentTokenSanityCheck()` method entirely
3. Verify InventorySyncService Step 7 covers all use cases

---

## Test Cases

### Test 1: Faucet Token Receipt (4 tokens)
**Expected Behavior:**
- ✅ All 4 tokens received and validated
- ✅ IPFS sync completes (FAST then NORMAL)
- ✅ No more than 3 `tokensQuery` refetches (down from 11-12)
- ✅ All tokens have stateHash defined
- ✅ No deprecated method warnings

### Test 2: Multi-Device Sync with Genesis Tokens
**Expected Behavior:**
- ✅ Genesis tokens on Device A have computed stateHash
- ✅ Tombstone conflict resolution works (deleted tokens stay deleted)
- ✅ Version mismatch resolved correctly

### Test 3: Large Batch Receipt (10+ tokens)
**Expected Behavior:**
- ✅ Debounce coalesces events effectively
- ✅ No more than 5 refetches for 10+ tokens
- ✅ All tokens validated in single batch

---

## Performance Metrics

### Current State (Before Fixes)
- **Token Receipt Flow:** 4 tokens → 11-12 refetches → ~2-3 seconds
- **RPC Calls:** 11-12 aggregator calls for spent check
- **IPFS Sync:** 2 syncs (FAST + NORMAL) + auto-sync debounce

### Target State (After Fixes)
- **Token Receipt Flow:** 4 tokens → 2-3 refetches → ~1-2 seconds
- **RPC Calls:** 2-3 aggregator calls (70% reduction)
- **IPFS Sync:** Same (2 syncs) but no excessive refetches

---

## Conclusion

The faucet token receipt flow is **functionally correct** but suffers from:
1. **Performance issues** (excessive refetches)
2. **Reliability gaps** (missing stateHash breaks tombstone matching)
3. **Technical debt** (deprecated method still in use)

All issues are **fixable** with moderate effort. The most critical fix is the undefined stateHash issue, which impacts multi-device sync reliability.

**Estimated Total Fix Time:** 4-5 hours across 3 files
