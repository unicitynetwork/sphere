# Token Loss Bug Fix - Deployment Guide

## Quick Start (Copy-Paste Ready)

### 1. Navigate to the file
```bash
cd /home/vrogojin/sphere
```

### 2. Open in your editor
```bash
# Using VS Code
code src/components/wallet/L3/services/IpfsStorageService.ts

# Or vim
vim src/components/wallet/L3/services/IpfsStorageService.ts

# Or nano
nano src/components/wallet/L3/services/IpfsStorageService.ts
```

### 3. Go to line 3312
```bash
# In VS Code: Ctrl+G (or Cmd+G on Mac), type 3312
# In vim: :3312
# In nano: Ctrl+_ (goto line)
```

### 4. Find this line
```typescript
      console.log(`📦 Versions match (v${remoteVersion}), remote verified accessible`);
```

### 5. Position cursor at end of that line and add new line

### 6. Insert this code
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

### 7. Save file

### 8. Verify changes
```bash
npm run build
```
Expected output: Build succeeds without errors

### 9. Type check (optional)
```bash
npx tsc --noEmit
```
Expected output: No errors

### 10. Commit
```bash
git add src/components/wallet/L3/services/IpfsStorageService.ts
git commit -m "fix: prevent token loss when localStorage corrupted but version persists

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

Fixes: Token loss when localStorage is corrupted while IPFS remains intact"
```

### 11. Push
```bash
git push origin @cryptohog/ipfs
```

---

## Testing the Fix

### Manual Test in Browser

1. Open browser DevTools (F12 or Cmd+Option+I)

2. Go to Application/Storage → LocalStorage

3. Find key: `ipfs_version_<ipnsName>` (should contain a version number like "3")

4. Create some test data (if needed):
   ```javascript
   // Create a simple version entry
   localStorage.setItem('ipfs_version_test', '3');
   ```

5. Clear wallet data:
   ```javascript
   // Find wallet keys (start with "sphere_wallet_DIRECT://")
   for (let i = 0; i < localStorage.length; i++) {
     const key = localStorage.key(i);
     if (key && key.includes('sphere_wallet_DIRECT://')) {
       console.log('Deleting: ' + key);
       localStorage.removeItem(key);
     }
   }
   ```

6. Refresh the page:
   ```javascript
   location.reload();
   ```

7. Check console for recovery logs:
   - Should see: `⚠️ RECOVERY: Versions match but localStorage is empty!`
   - Should see: `✅ RECOVERY: Imported X token(s), wallet restored`

8. Verify tokens appear in wallet UI

### Regression Test (Normal Sync)

1. Create and sync tokens normally (no manual localStorage clearing)

2. Refresh page

3. Check console: Should NOT have "RECOVERY:" logs

4. Verify normal sync logs appear

### Build Verification

```bash
npm run build
```

Expected:
- TypeScript compilation succeeds
- Vite build succeeds
- No errors or warnings related to your changes

---

## Troubleshooting

### Build Fails with TypeScript Errors

**Problem:** Compilation errors about undefined variables

**Check:**
1. Did you insert code at the right location? (After line 3312)
2. Are all variable names spelled correctly?
3. Did you preserve indentation?

**Solution:**
- Delete your changes
- Re-read the exact code from TOKEN_LOSS_BUG_QUICK_REFERENCE.md
- Copy-paste exactly (including indentation)

### Console Still Shows No Recovery Logs

**Problem:** Fix is deployed but recovery logs don't appear

**Check:**
1. Is the fix in the right method? (`syncFromIpns`)
2. Is the fix in the right branch? (the `else` block, line ~3304)
3. Did sync actually run? (Check for any sync logs)
4. Is localStorage actually empty? (Check in DevTools)

**Solution:**
- Verify change was saved: `git diff src/components/wallet/L3/services/IpfsStorageService.ts`
- Rebuild: `npm run build`
- Clear browser cache: Hard refresh (Ctrl+Shift+R or Cmd+Shift+R)
- Trigger sync manually: Navigate to wallet, wait for auto-sync, or manually refresh

### Build Succeeds but App Breaks

**Problem:** Build passes but app crashes on wallet sync

**Check:**
1. Any console errors? (Check DevTools console)
2. Any network errors? (Check Network tab)
3. Does app crash or just show blank wallet?

**Solution:**
- Check browser console for specific error message
- Verify remoteData is available (add debug log before your code)
- Verify importRemoteData method exists
- Try rollback: `git revert HEAD` and `npm run build`

---

## Before & After

### Before (Buggy)

```bash
$ npm run build  # Works
$ location.reload()  # Triggers sync
# Console shows:
# 📦 Versions match (v3), remote verified accessible
# 📦 Spent token sanity check...
# (Wallet is now empty - tokens lost!)
```

### After (Fixed)

```bash
$ npm run build  # Works
$ location.reload()  # Triggers sync
# Console shows:
# 📦 Versions match (v3), remote verified accessible
# ⚠️ RECOVERY: Versions match but localStorage is empty!
# ⚠️ RECOVERY: Detected tokens - local: 0, remote: 5
# ⚠️ RECOVERY: Recovering 5 token(s) from IPFS
# ✅ RECOVERY: Imported 5 token(s), wallet restored
# (Wallet now has 5 tokens - recovered!)
```

---

## Rollback (If Something Goes Wrong)

### Quick Rollback

```bash
# Revert the commit
git revert HEAD

# Or reset to before the fix
git reset --hard HEAD~1

# Rebuild
npm run build

# The app will be back to original state
# No data cleanup needed
```

### Verify Rollback

```bash
# Check that fix is removed
git show HEAD:src/components/wallet/L3/services/IpfsStorageService.ts | grep -A 5 "RECOVERY:"
# Should return nothing (no match)
```

---

## Validation Checklist (Final)

Before considering the fix complete:

- [ ] Code inserted at line 3312 (after "Versions match" log)
- [ ] Indentation matches surrounding code (2-space indent)
- [ ] All variable names spelled correctly
- [ ] No syntax errors: `npm run build` succeeds
- [ ] Manual test performed (recovery logs appear)
- [ ] Regression test performed (normal sync has no recovery logs)
- [ ] Code committed with provided message template
- [ ] Code pushed to correct branch (@cryptohog/ipfs)
- [ ] No unexpected changes in git diff (only your 18 lines added)
- [ ] Ready for code review

---

## Code Review Checklist

For reviewers of this fix:

- [ ] Change is at correct location (lines 3304-3330 block)
- [ ] Code is readable and well-commented
- [ ] Recovery condition is correct: `localTokenCount === 0 && remoteTokenCount > 0`
- [ ] Doesn't affect normal cases (condition is very specific)
- [ ] Uses existing importRemoteData() method (not new code)
- [ ] Event dispatch follows existing patterns
- [ ] Logging is distinct and helpful (RECOVERY: prefix)
- [ ] No new imports needed (all variables in scope)
- [ ] Build succeeds
- [ ] No compilation errors or warnings
- [ ] Risk assessment is accurate (minimal change, defensive)

---

## Post-Deployment Monitoring

### First 24 Hours

Monitor for:
- [ ] No unexpected errors in error logs
- [ ] No spam of "RECOVERY:" logs (should be rare)
- [ ] User reports of token recovery working
- [ ] No performance degradation

### First Week

Check:
- [ ] How many times did recovery happen? (count "RECOVERY:" logs)
- [ ] Were all recoveries successful?
- [ ] Any edge cases encountered?
- [ ] User feedback on fix effectiveness

### Ongoing

- [ ] Monitor "RECOVERY:" logs monthly (should decrease as users update)
- [ ] Track if users report successful token recovery
- [ ] Update documentation if patterns emerge
- [ ] Plan user outreach for those who lost tokens (consider recovery tools)

---

## Support Information

If users report issues after fix is deployed:

### User Reports Token Recovery

Response:
```
Thank you for reporting! This is expected behavior. Our system detected
that your wallet data was cleared but tokens still existed in our backup
system. The recovery was automatic - your tokens should now be visible
in your wallet. If you still don't see them, please:

1. Refresh your browser (Ctrl+F5 or Cmd+Shift+R)
2. Wait 30 seconds for sync to complete
3. Check your token list

If tokens still don't appear, contact support with your address.
```

### User Reports Tokens Still Missing

Response:
```
We're sorry to hear that. Token recovery requires the tokens to be
present in our backup system. If this didn't work:

1. Check when you last synced tokens to the network
2. Verify your account address is correct
3. Contact support with:
   - Your account address
   - Number of tokens expected
   - When they were last synced

We'll investigate what happened and may be able to recover them.
```

---

## Additional Documentation

For deeper understanding, refer to:

- **Quick Reference:** TOKEN_LOSS_BUG_QUICK_REFERENCE.md (5 min read)
- **Full Plan:** TOKEN_LOSS_BUG_FIX_PLAN.md (15 min read)
- **Implementation:** TOKEN_LOSS_BUG_FIX_IMPLEMENTATION.md (10 min read)
- **Visual Analysis:** TOKEN_LOSS_BUG_VISUAL_ANALYSIS.md (12 min read)
- **Index Guide:** TOKEN_LOSS_BUG_FIX_INDEX.md (for navigation)
- **Summary:** TOKEN_LOSS_BUG_FIX_SUMMARY.md (executive overview)

---

## Contacts

**Questions about implementation?**
→ See TOKEN_LOSS_BUG_FIX_IMPLEMENTATION.md (Integration Points section)

**Questions about why?**
→ See TOKEN_LOSS_BUG_FIX_PLAN.md (Root Cause Analysis section)

**Questions about safety?**
→ See TOKEN_LOSS_BUG_VISUAL_ANALYSIS.md (Risk Assessment section)

**Questions about testing?**
→ See TOKEN_LOSS_BUG_QUICK_REFERENCE.md (Testing section)

---

**Version:** 1.0
**Last Updated:** 2026-01-18
**Status:** Ready for Deployment

