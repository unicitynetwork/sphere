# Token Loss Bug Fix - Exact Implementation

## File Path
```
/home/vrogojin/sphere/src/components/wallet/L3/services/IpfsStorageService.ts
```

## Location
Lines 3304-3330 (the `else` block in `syncFromIpns()` method)

## The Change

### Before (Current Buggy Code)

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

### After (Fixed Code)

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

## Lines Added

Insert these lines after line 3312 (`console.log(\`📦 Versions match...`):

```typescript
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
```

## Variables Used

All variables are already available in the method scope:

| Variable | Type | Source | Used For |
|----------|------|--------|----------|
| `remoteData` | `TxfStorageData` | Line 3193: fetched from IPFS | Extract token count |
| `remoteVersion` | `number` | Line 3217 | Already in scope |
| `localVersion` | `number` | Line 3216 | Already in scope |
| `remoteCid` | `string` | Earlier in method | Already in scope |
| `cidToFetch` | `string` | Line 3183 | Already in scope |
| `ipnsNeedsRecovery` | `boolean` | Line 3168 | Already in scope |

## Implementation Notes

### Key Decisions

1. **Count method**: Use `Object.keys(remoteData.tokens || {}).length`
   - Safe: handles undefined tokens with `|| {}`
   - Efficient: O(n) where n = token count (small)
   - Accurate: reflects actual token count

2. **Condition**: `localTokenCount === 0 && remoteTokenCount > 0`
   - Only triggers on actual corruption
   - Prevents unnecessary imports on normal sync
   - Handles case where both are empty (legitimate state)

3. **Recovery action**: Call existing `importRemoteData(remoteData)`
   - Reuses battle-tested conflict resolution logic
   - Maintains consistency with other branches
   - Returns count of imported tokens

4. **Event dispatch**: `window.dispatchEvent(new Event("wallet-updated"))`
   - Triggers UI refresh immediately
   - Complements the import action
   - Matches existing pattern in codebase

### Type Safety

- `WalletRepository.getInstance()` returns `WalletRepository` (never null per singleton pattern)
- `.getTokens()` returns `Token[]` (see WalletRepository.ts:663)
- `.length` is native array property
- `remoteData` has `tokens?: Record<string, TxfToken>` (see TxfSerializer.ts)
- `Object.keys()` safe with guard `remoteData && typeof remoteData === 'object'`

### Error Handling

- If `importRemoteData()` throws: Error propagates (caught by parent try-catch)
- If `remoteData` is undefined: Guard prevents access
- If `remoteData.tokens` is missing: `|| {}` provides empty object
- If import returns 0: Skips event dispatch (legitimate case)

---

## Integration Points

### Dependencies

All required classes/methods already imported and available:

1. **WalletRepository** - Line 13
   ```typescript
   import { WalletRepository, type NametagData } from "../../../../repositories/WalletRepository";
   ```

2. **importRemoteData()** - Instance method of IpfsStorageService
   ```typescript
   private async importRemoteData(data: TxfStorageData): Promise<number>
   ```

3. **remoteData** - Local variable from line 3193
   ```typescript
   const remoteData = parseTxfStorageData(cidToFetch, response);
   ```

### Related Methods

- `syncNow()` - Line 3317 - Already called in same block
- `runSpentTokenSanityCheck()` - Line 3321 - Already called in same block
- `runTombstoneRecoveryCheck()` - Line 3322 - Already called in same block

---

## Execution Flow

### Current (Buggy) Flow

```
syncFromIpns()
├─ Fetch remote IPFS
├─ Version comparison:
│  ├─ remoteVersion > localVersion → import & sync
│  ├─ remoteVersion < localVersion → import new + maybe sync
│  └─ remoteVersion === localVersion → RETURN (BUG: no import!)
└─ Return success
```

### Fixed Flow

```
syncFromIpns()
├─ Fetch remote IPFS
├─ Version comparison:
│  ├─ remoteVersion > localVersion → import & sync
│  ├─ remoteVersion < localVersion → import new + maybe sync
│  └─ remoteVersion === localVersion
│     ├─ Check local token count
│     ├─ If local=0 && remote>0 → IMPORT & dispatch event
│     └─ Continue with sanity checks
└─ Return success
```

---

## Testing Instructions

### Pre-Fix Verification

1. **Identify the bug scenario:**
   ```bash
   # In browser DevTools console:
   const v = localStorage.getItem('ipfs_version_...');  // Has value, e.g., "3"
   const w = localStorage.getItem('sphere_wallet_DIRECT://...');  // null or missing
   ```

2. **Reproduce:**
   - Create and sync 5 tokens to IPFS
   - Run: `localStorage.removeItem('sphere_wallet_DIRECT://...')` (but keep version key)
   - Refresh page
   - Call sync
   - **Result (before fix)**: Wallet empty, no recovery attempt

### Post-Fix Verification

1. **Execute fix and rebuild:**
   ```bash
   npm run build
   ```

2. **Test recovery:**
   ```bash
   # In browser DevTools:
   localStorage.removeItem('sphere_wallet_DIRECT://...');  // Clear wallet only
   location.reload();  // Trigger sync on reload
   ```

3. **Check logs:**
   ```
   ⚠️ RECOVERY: Versions match but localStorage is empty!
   ⚠️ RECOVERY: Detected tokens - local: 0, remote: 5
   ⚠️ RECOVERY: Recovering 5 token(s) from IPFS
   ✅ RECOVERY: Imported 5 token(s), wallet restored
   ```

4. **Verify result:**
   - Wallet displays all 5 tokens
   - No error messages
   - UI responsive

### Regression Testing

1. **Normal sync (tokens exist):**
   - Create/sync tokens normally
   - Refresh page
   - **Result**: No "RECOVERY:" logs, normal sync logs

2. **Version mismatch:**
   - Create 5 tokens (v1)
   - Manually increment version to v2
   - Refresh
   - **Result**: Takes `remoteVersion > localVersion` path, imports normally

---

## Code Quality Checklist

- [x] Uses existing methods/variables only
- [x] No new imports required
- [x] Proper null/undefined guards
- [x] Consistent logging style (⚠️ for warnings, ✅ for success)
- [x] Preserves existing behavior when condition false
- [x] Async/await handled correctly
- [x] No type errors or implicit `any`
- [x] Minimal code footprint (18 lines added)
- [x] Comments explain purpose and context
- [x] Follows existing code patterns

---

## Commit Message Template

```
fix: prevent token loss when localStorage corrupted but version persists

When localStorage wallet data is cleared but the version counter survives
(due to storage partitioning, selective cache clear, etc.), syncFromIpns()
would see matching versions and skip import, causing tokens to be lost.

Added validation: if versions match but local has no tokens while remote
does, force recovery import. This preserves existing behavior for healthy
cases while preventing data loss in corruption scenarios.

- Check local vs remote token count when versions match
- Force import if localStorage is empty but remote has tokens
- Dispatch wallet-updated event after recovery
- Log recovery attempt distinctly for debugging

Fixes: Token loss when localStorage is corrupted while IPFS remains intact
```

---

## Risk Summary

| Aspect | Risk | Mitigation |
|--------|------|-----------|
| **New bugs** | LOW | Only adds defensive check, doesn't change logic |
| **Regression** | LOW | New code path only taken on corruption (empty localStorage) |
| **Performance** | LOW | O(n) token count only when versions match (not hot path) |
| **Type safety** | LOW | All variables properly typed, guards in place |
| **Import reliability** | LOW | Reuses existing `importRemoteData()` method |
| **Event dispatch** | LOW | Uses standard `window.dispatchEvent()` pattern |

**Overall Risk Assessment: LOW** - Fix is defensive, isolated, and uses existing code paths.

