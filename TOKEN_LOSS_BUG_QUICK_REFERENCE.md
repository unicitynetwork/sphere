# Token Loss Bug Fix - Quick Reference

## TL;DR

**Problem:** When localStorage wallet data is cleared but version counter survives, `syncFromIpns()` assumes tokens exist and returns success without importing from IPFS. Result: Tokens lost.

**Fix:** Add 18-line defensive check in the `else` block (line 3304) to detect missing tokens and force recovery import.

**Impact:** Prevents data loss, zero regression risk, backward compatible.

---

## Files to Modify

| File | Location | Change Type | Size |
|------|----------|-------------|------|
| `/home/vrogojin/sphere/src/components/wallet/L3/services/IpfsStorageService.ts` | Lines 3304-3330 (else block) | Insert 18 lines | +18 lines |

---

## The Fix (Copy-Paste Ready)

Insert after line 3312 (`console.log(\`📦 Versions match...`):

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

---

## Validation Checklist

Before committing:

- [ ] Code inserted at correct location (after line 3312)
- [ ] No TypeScript compilation errors: `npx tsc --noEmit`
- [ ] Build succeeds: `npm run build`
- [ ] No new imports needed (all already in scope)
- [ ] Recovery logs are distinct (⚠️ RECOVERY: prefix)
- [ ] Success log is distinct (✅ RECOVERY: prefix)
- [ ] Only applies when `localTokenCount === 0 && remoteTokenCount > 0`
- [ ] Doesn't affect normal cases (tokens exist locally)

---

## Testing

### Quick Manual Test

```javascript
// In browser DevTools console:

// 1. Clear wallet data (but keep version counter)
localStorage.removeItem('sphere_wallet_DIRECT://...');  // Remove wallet
// ipfs_version_<name> still exists

// 2. Trigger sync
window.location.reload();

// 3. Check console for recovery logs
// Expected output:
// ⚠️ RECOVERY: Versions match but localStorage is empty!
// ⚠️ RECOVERY: Detected tokens - local: 0, remote: 5
// ⚠️ RECOVERY: Recovering 5 token(s) from IPFS
// ✅ RECOVERY: Imported 5 token(s), wallet restored
```

### Regression Test

```javascript
// Normal sync should work without recovery logs:

// 1. Create and sync tokens normally
// 2. Refresh page
// 3. Check console - should NOT have "RECOVERY:" logs
// Expected: Normal sync logs only
```

---

## Key Variables (Already in Scope)

| Variable | Type | Source |
|----------|------|--------|
| `remoteData` | `TxfStorageData` | Line 3193 |
| `remoteVersion` | `number` | Line 3217 |
| `localVersion` | `number` | Line 3216 |
| `remoteCid` | `string` | Earlier in method |
| `ipnsNeedsRecovery` | `boolean` | Line 3168 |

All needed! No new imports required.

---

## Expected Log Output

### When Recovery Happens (The Bug Case)

```
📦 Versions match (v3), remote verified accessible
⚠️ RECOVERY: Versions match but localStorage is empty!
⚠️ RECOVERY: Detected tokens - local: 0, remote: 5
⚠️ RECOVERY: Recovering 5 token(s) from IPFS
✅ RECOVERY: Imported 5 token(s), wallet restored
```

### When Recovery Doesn't (Normal Case)

```
📦 Versions match (v3), remote verified accessible
// No "RECOVERY:" logs
// Proceeds to sanity checks
```

---

## Risk Assessment

| Risk | Level | Why It's OK |
|------|-------|-----------|
| New bugs | LOW | Only defensive check, doesn't change existing logic |
| Regression | LOW | New code only runs on corruption (empty localStorage) |
| Performance | LOW | O(n) where n=token count (typically 5-50), only on version match |
| Type errors | LOW | All variables properly typed, guards in place |
| Import reliability | LOW | Reuses existing battle-tested `importRemoteData()` |

**Overall: SAFE TO DEPLOY**

---

## Rollback (If Needed)

1. Remove the 18-line recovery block (lines after 3312)
2. Keep the structure unchanged
3. No data migration needed
4. No storage cleanup required

Deployment is reversible with no side effects.

---

## Related Code

### Getting Local Tokens

```typescript
const localWallet = WalletRepository.getInstance();
const localTokenCount = localWallet.getTokens().length;
```
Source: `WalletRepository.ts` line 663

### Getting Remote Tokens

```typescript
const remoteTokenCount = Object.keys(remoteData.tokens || {}).length;
```
Source: `TxfSerializer.ts` - remoteData structure from `buildTxfStorageData()`

### Importing Tokens

```typescript
const importedCount = await this.importRemoteData(remoteData);
```
Source: `IpfsStorageService.ts` - instance method, conflict-aware

### Triggering UI Update

```typescript
window.dispatchEvent(new Event("wallet-updated"));
```
Standard pattern used throughout codebase for wallet refresh

---

## Commit Commands

```bash
# 1. Make the change (manual edit or patch)
# 2. Verify compilation
npx tsc --noEmit

# 3. Build
npm run build

# 4. Run tests (if any)
npm run test:run

# 5. Check git diff
git diff src/components/wallet/L3/services/IpfsStorageService.ts

# 6. Stage and commit
git add src/components/wallet/L3/services/IpfsStorageService.ts
git commit -m "fix: prevent token loss when localStorage corrupted but version persists"

# 7. Push (when ready)
git push origin @cryptohog/ipfs
```

---

## Documentation

Three detailed documents provided:

1. **TOKEN_LOSS_BUG_FIX_PLAN.md** - Full analysis and rationale
2. **TOKEN_LOSS_BUG_FIX_IMPLEMENTATION.md** - Exact code changes and integration
3. **TOKEN_LOSS_BUG_VISUAL_ANALYSIS.md** - Diagrams and state flows
4. **TOKEN_LOSS_BUG_QUICK_REFERENCE.md** - This file

---

## Success Criteria

After deploying this fix:

- [ ] Compilation succeeds without errors
- [ ] Existing tests pass (no regression)
- [ ] Manual test shows recovery logs when localStorage cleared
- [ ] Normal sync shows NO recovery logs (regression check)
- [ ] Users can sync after localStorage corruption
- [ ] No increase in error rates or exceptions
- [ ] Recovery operates silently for users (just logs)

---

## Questions?

Refer to the detailed documents:
- **Why this bug?** → TOKEN_LOSS_BUG_FIX_PLAN.md (Root Cause Analysis)
- **How to implement?** → TOKEN_LOSS_BUG_FIX_IMPLEMENTATION.md (Code changes)
- **Visual explanation?** → TOKEN_LOSS_BUG_VISUAL_ANALYSIS.md (Diagrams)
- **Just the facts?** → This file (Quick Reference)

---

**Status: READY FOR IMPLEMENTATION**
**Severity: CRITICAL**
**Risk: LOW**
**Effort: 5 minutes**

