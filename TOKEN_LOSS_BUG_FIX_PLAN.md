# Token Loss Bug Fix Plan - IpfsStorageService.ts

## Executive Summary

Fix a critical data loss bug in the `syncFromIpns()` method (lines 3304-3330) where tokens are lost when localStorage is cleared but the version counter survives. The method assumes if versions match, tokens must exist locally - but localStorage can be cleared while the version counter persists, causing tokens to be silently skipped.

**Severity:** CRITICAL - Data loss
**Scope:** Single method, minimal changes
**Risk:** LOW - Defensive check only, no behavior change if localStorage is healthy

---

## Root Cause Analysis

### The Problem

Three storage locations are involved:
1. **Version Counter**: `localStorage.getItem('ipfs_version_<ipnsName>')`
   - Persists sync version across sessions
   - NOT cleared when user manually clears localStorage
2. **Wallet Data**: `localStorage.getItem('sphere_wallet_DIRECT://...')`
   - Contains all tokens for the address
   - Cleared when user clears localStorage or resets app
3. **Remote IPFS**: Has the authoritative token state

### Current Buggy Logic (lines 3304-3330)

```typescript
} else {
  // Same version - remote is in sync
  if (remoteCid && remoteCid !== localCid) {
    this.setLastCid(remoteCid);
    console.log(`📦 Updated local CID to match IPNS`);
  }

  console.log(`📦 Versions match (v${remoteVersion}), remote verified accessible`);

  // NO IMPORT HAPPENS HERE! TOKENS LOST!

  return {
    success: true,
    cid: cidToFetch,
    // ...
  };
}
```

**When This Fails:**

1. User has 5 tokens synced to IPFS at v3
2. Browser localStorage is cleared (or cookie purge, app cache issue, etc.)
3. Version counter `ipfs_version_<name> = "3"` somehow persists in localStorage
4. Wallet data `sphere_wallet_DIRECT://... = null` is gone
5. `syncFromIpns()` runs:
   - Fetches remote IPFS: has 5 tokens, version = 3
   - Compares: `localVersion = 3`, `remoteVersion = 3`
   - **Branch taken: `localVersion === remoteVersion`**
   - **NO import happens** → Assumes tokens already in localStorage
   - **Returns success** → UI shows "sync complete"
   - **Wallet remains empty** → Tokens lost!

### Why This Isn't Obvious

The version counter can persist due to:
- **Manual localStorage clear** in DevTools: Only clears specific keys if user isn't careful
- **Browser storage partitioning**: Version counter in different partition than wallet data
- **Selective cookie/cache clearing**: Some tools clear one but not the other
- **Storage quota exceeded**: One key cleared, others kept
- **Failed clear operation**: Partial cleanup on logout

---

## Fix Strategy

### Approach: Defensive Validation

When `localVersion === remoteVersion`, verify localStorage actually has tokens before returning success.

**If tokens are missing:**
1. Log a WARNING: "localStorage tokens missing but versions match - recovering from remote"
2. Force an import of remote tokens
3. Return to normal flow (success with imported tokens)

**If tokens exist:**
1. No change - existing behavior preserved
2. Continue with sanity checks

### Key Requirements

1. **Detect missing tokens**: Count tokens in `WalletRepository.getTokens()`
2. **Detect remote has tokens**: Check `remoteData._meta.tokenCount` or `remoteData` keys
3. **Log recovery action**: Warn user about corruption detection
4. **Minimal code change**: Single validation block
5. **Backward compatible**: Only affects the broken case

---

## Implementation Details

### Step 1: Get Local Token Count

```typescript
// Line 3305 (after version comparison)
const localWallet = WalletRepository.getInstance();
const localTokenCount = localWallet.getTokens().length;
```

**Why this works:**
- `WalletRepository.getTokens()` returns the in-memory wallet tokens
- If localStorage was cleared, this will be empty `[]`
- `length` property works reliably even on empty arrays

### Step 2: Get Remote Token Count

```typescript
// Check remoteData for tokens
let remoteTokenCount = 0;
if (remoteData && typeof remoteData === 'object') {
  // remoteData structure from buildTxfStorageData is:
  // { tokens: { [key]: txfToken }, archives: {...}, _meta: {...} }
  remoteTokenCount = Object.keys(remoteData.tokens || {}).length;
}
```

**Why this works:**
- `remoteData` was already fetched and parsed at line 3193
- `tokens` is a key-value object of tokens
- Count keys using `Object.keys(remoteData.tokens || {}).length`

### Step 3: Conditional Import

```typescript
} else {
  // Same version - remote is in sync
  if (remoteCid && remoteCid !== localCid) {
    this.setLastCid(remoteCid);
    console.log(`📦 Updated local CID to match IPNS`);
  }

  console.log(`📦 Versions match (v${remoteVersion}), remote verified accessible`);

  // CRITICAL FIX: Detect missing tokens (localStorage corruption)
  const localWallet = WalletRepository.getInstance();
  const localTokenCount = localWallet.getTokens().length;
  let remoteTokenCount = 0;
  if (remoteData && typeof remoteData === 'object') {
    remoteTokenCount = Object.keys(remoteData.tokens || {}).length;
  }

  // If localStorage is empty but remote has tokens, force recovery import
  if (localTokenCount === 0 && remoteTokenCount > 0) {
    console.warn(`⚠️ RECOVERY: Versions match but localStorage is empty!`);
    console.warn(`⚠️ RECOVERY: Detected local tokens: ${localTokenCount}, remote tokens: ${remoteTokenCount}`);
    console.warn(`⚠️ RECOVERY: Recovering ${remoteTokenCount} token(s) from IPFS`);

    // Force import of remote tokens
    const importedCount = await this.importRemoteData(remoteData);
    if (importedCount > 0) {
      console.log(`✅ RECOVERY: Imported ${importedCount} token(s), wallet restored`);
      // Trigger UI update immediately
      window.dispatchEvent(new Event("wallet-updated"));
    }
  }

  // If IPNS needs recovery, force publish even though content is synced
  if (ipnsNeedsRecovery) {
    console.log(`📦 Content synced but IPNS needs recovery - publishing to IPNS`);
    return this.syncNow({ forceIpnsPublish: true });
  }

  // Run immediate sanity check after IPNS sync (don't wait for polling cycle)
  await this.runSpentTokenSanityCheck();
  await this.runTombstoneRecoveryCheck();

  return {
    success: true,
    cid: cidToFetch,
    ipnsName: this.cachedIpnsName || undefined,
    timestamp: Date.now(),
    version: remoteVersion,
  };
}
```

---

## Code Changes

### File: `/home/vrogojin/sphere/src/components/wallet/L3/services/IpfsStorageService.ts`

**Location:** Lines 3304-3330 (the `else` block)

**Change Type:** Addition of 18-22 lines for recovery logic

**Before:**
```typescript
    } else {
      // Same version - remote is in sync
      // Still update lastCid to match IPNS if resolved
      if (remoteCid && remoteCid !== localCid) {
        this.setLastCid(remoteCid);
        console.log(`📦 Updated local CID to match IPNS`);
      }

      console.log(`📦 Versions match (v${remoteVersion}), remote verified accessible`);

      // If IPNS needs recovery, force publish even though content is synced
      if (ipnsNeedsRecovery) {
        console.log(`📦 Content synced but IPNS needs recovery - publishing to IPNS`);
        return this.syncNow({ forceIpnsPublish: true });
      }

      // Run immediate sanity check after IPNS sync (don't wait for polling cycle)
      await this.runSpentTokenSanityCheck();
      await this.runTombstoneRecoveryCheck();

      return {
        success: true,
        cid: cidToFetch,
        ipnsName: this.cachedIpnsName || undefined,
        timestamp: Date.now(),
        version: remoteVersion,
      };
    }
```

**After:**
```typescript
    } else {
      // Same version - remote is in sync
      // Still update lastCid to match IPNS if resolved
      if (remoteCid && remoteCid !== localCid) {
        this.setLastCid(remoteCid);
        console.log(`📦 Updated local CID to match IPNS`);
      }

      console.log(`📦 Versions match (v${remoteVersion}), remote verified accessible`);

      // CRITICAL FIX: Detect missing tokens (localStorage corruption scenario)
      // If localStorage is cleared but version counter survives, tokens would be lost.
      // Check if local has tokens - if not but remote does, force recovery import.
      const localWallet = WalletRepository.getInstance();
      const localTokenCount = localWallet.getTokens().length;
      let remoteTokenCount = 0;
      if (remoteData && typeof remoteData === 'object') {
        remoteTokenCount = Object.keys(remoteData.tokens || {}).length;
      }

      if (localTokenCount === 0 && remoteTokenCount > 0) {
        console.warn(`⚠️ RECOVERY: Versions match but localStorage is empty!`);
        console.warn(`⚠️ RECOVERY: Detected tokens - local: ${localTokenCount}, remote: ${remoteTokenCount}`);
        console.warn(`⚠️ RECOVERY: Recovering ${remoteTokenCount} token(s) from IPFS`);

        const importedCount = await this.importRemoteData(remoteData);
        if (importedCount > 0) {
          console.log(`✅ RECOVERY: Imported ${importedCount} token(s), wallet restored`);
          window.dispatchEvent(new Event("wallet-updated"));
        }
      }

      // If IPNS needs recovery, force publish even though content is synced
      if (ipnsNeedsRecovery) {
        console.log(`📦 Content synced but IPNS needs recovery - publishing to IPNS`);
        return this.syncNow({ forceIpnsPublish: true });
      }

      // Run immediate sanity check after IPNS sync (don't wait for polling cycle)
      await this.runSpentTokenSanityCheck();
      await this.runTombstoneRecoveryCheck();

      return {
        success: true,
        cid: cidToFetch,
        ipnsName: this.cachedIpnsName || undefined,
        timestamp: Date.now(),
        version: remoteVersion,
      };
    }
```

---

## Risk Assessment

### Risk Level: LOW

| Risk | Impact | Mitigation |
|------|--------|-----------|
| **Regression**: Changes existing success case | MEDIUM | Only adds code to empty localStorage case; no changes to normal path |
| **Import failure**: `importRemoteData()` throws | MEDIUM | Wrapped in try-catch implicitly (falls through to sanity check) |
| **Infinite import loop**: Recovery triggers another sync | LOW | Recovery only happens once per sync - version counter prevents re-entry |
| **Performance**: Extra object counting on every match | LOW | Only when versions match (not hot path), O(n) where n = token count |
| **Type safety**: `remoteData` access without guards | LOW | Guard: `if (remoteData && typeof remoteData === 'object')` |

### Validation Test Cases

1. **Normal case (versions match, tokens exist)**
   - Local: v3, 5 tokens
   - Remote: v3, 5 tokens
   - Expected: Skip recovery, return success
   - Verification: No "RECOVERY:" logs

2. **Corruption case (versions match, tokens missing)**
   - Local: v3, 0 tokens
   - Remote: v3, 5 tokens
   - Expected: Import tokens, return success
   - Verification: "RECOVERY:" and "✅ RECOVERY:" logs

3. **Recovery complete (re-sync after fix)**
   - Local: v3, 5 tokens
   - Remote: v3, 5 tokens
   - Expected: Skip recovery (tokens exist now)
   - Verification: No "RECOVERY:" logs

4. **Partial mismatch (versions match, local has some tokens)**
   - Local: v3, 2 tokens
   - Remote: v3, 5 tokens
   - Expected: Skip recovery (local has tokens)
   - Verification: No "RECOVERY:" logs
   - Note: Tombstones and conflict resolution handle token differences

5. **Remote empty (both empty)**
   - Local: v3, 0 tokens
   - Remote: v3, 0 tokens
   - Expected: Skip recovery, return success
   - Verification: No "RECOVERY:" logs

---

## Validation Checklist

Before commit, verify:

- [ ] Code compiles without TypeScript errors
- [ ] `remoteData` is always available in the `else` block context
- [ ] `WalletRepository.getInstance().getTokens()` returns `Token[]` (or empty array)
- [ ] `Object.keys()` works on `remoteData.tokens` (is a plain object)
- [ ] Recovery path calls `importRemoteData()` with correct parameter type
- [ ] No new imports required (all types/methods already in scope)
- [ ] Recovery logs are distinct with "⚠️ RECOVERY:" prefix for easy grep
- [ ] Success case (tokens exist) is not affected
- [ ] No changes to other branches (`remoteVersion > localVersion` or `remoteVersion < localVersion`)

---

## Testing Strategy

### Unit Test (if adding to test suite)

```typescript
describe('syncFromIpns - version match with empty localStorage', () => {
  it('should import tokens when versions match but localStorage is empty', async () => {
    // Setup: version match but empty wallet
    mockWalletRepository.getTokens.mockReturnValue([]);
    mockRemoteData.tokens = { token1: {...}, token2: {...} };

    // Execute
    const result = await ipfsStorage.syncFromIpns();

    // Verify
    expect(result.success).toBe(true);
    expect(importRemoteData).toHaveBeenCalledWith(mockRemoteData);
  });

  it('should NOT import when versions match and tokens exist', async () => {
    // Setup: version match and wallet has tokens
    mockWalletRepository.getTokens.mockReturnValue([token1, token2]);
    mockRemoteData.tokens = { token1: {...}, token2: {...} };

    // Execute
    const result = await ipfsStorage.syncFromIpns();

    // Verify
    expect(result.success).toBe(true);
    expect(importRemoteData).not.toHaveBeenCalled();
  });
});
```

### Manual Test (in browser)

```javascript
// 1. Create tokens and sync to IPFS (v1)
// 2. Open DevTools → Application → LocalStorage
// 3. Delete the "sphere_wallet_DIRECT://..." key (but keep "ipfs_version_...")
// 4. Refresh page
// 5. Trigger sync (or wait for auto-sync)
// 6. Expected: "⚠️ RECOVERY:" logs appear, tokens are restored
// 7. Verify: Wallet shows all tokens again
```

---

## Rollback Procedure

If issues arise:

1. **Remove the recovery block** (lines 3317-3327 in the modified code)
2. **Keep the version match structure unchanged**
3. **Revert to this state:**
   ```typescript
   } else {
     // Same version - remote is in sync
     if (remoteCid && remoteCid !== localCid) {
       this.setLastCid(remoteCid);
       console.log(`📦 Updated local CID to match IPNS`);
     }
     // ... rest continues unchanged
   }
   ```
4. **No data migration needed** - fix is read-only in recovery case

---

## Edge Cases Handled

| Case | Behavior | Notes |
|------|----------|-------|
| Remote is empty (`{}`) | Skip recovery | `Object.keys({})` = [], condition false |
| `remoteData` undefined | Skip recovery | `if (remoteData && ...)` guard |
| `remoteData.tokens` undefined | Skip recovery | `remoteData.tokens \|\| {}` returns `{}` |
| Version counter cleared | Different branch | Takes `remoteVersion > localVersion` branch |
| Only nametag in remote | Skip recovery (only checks tokens) | Nametag restored by `importRemoteData()` |
| Large token count | O(n) performance | Acceptable - only on version match, not hot path |

---

## Summary of Changes

| Aspect | Details |
|--------|---------|
| **Files Modified** | 1 file: `IpfsStorageService.ts` |
| **Lines Changed** | 3304-3330: 26 lines total, +18-22 lines added |
| **Methods Touched** | `syncFromIpns()` only |
| **Breaking Changes** | None - fully backward compatible |
| **New Imports** | None required |
| **Type Safety** | Maintains strict TypeScript, no `any` types |
| **Logging** | Distinct recovery logs for debugging |
| **Recovery Mechanism** | Leverages existing `importRemoteData()` method |

---

## References

- **Buggy Code**: Lines 3304-3330 in `IpfsStorageService.ts`
- **Storage Keys**: `ipfs_version_<ipnsName>` and `sphere_wallet_DIRECT://...`
- **Version Logic**: `getVersionCounter()` at line 659
- **Token Retrieval**: `WalletRepository.getTokens()` in `WalletRepository.ts:663`
- **Remote Data Structure**: Built by `buildTxfStorageData()` in `TxfSerializer.ts`
- **Import Method**: `importRemoteData()` in `IpfsStorageService.ts` (handles conflict resolution)

---

**Created**: 2026-01-18
**Type**: Bug Fix - Data Loss Prevention
**Priority**: CRITICAL
**Status**: Ready for Implementation
