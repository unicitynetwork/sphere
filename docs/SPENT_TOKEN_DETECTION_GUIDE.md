# Unspent Token Recovery Analysis

## Executive Summary

This document analyzes the codebase to understand how "unspent token recovery" works during page reload and provides guidance on adding this functionality to IPFS sync.

**Current State:**
- ✅ Unspent token recovery **DOES happen during IPFS sync** (in `importRemoteData`)
- ✅ Archive recovery check **ALSO happens after IPFS import** (at line 2678)
- ⚠️ The mechanism is already in place, but may need optimization/consolidation

## Key Findings

### 1. Where Unspent Token Check Happens

There are **THREE** places where archived/tombstoned tokens are checked for unspent status:

#### A. During IPFS Import (`importRemoteData` - Line 2354)
**File:** `/home/vrogojin/sphere/src/components/wallet/L3/services/IpfsStorageService.ts`

**Flow:**
1. **Line 2433-2440**: Sanity check new tombstones from remote
   ```typescript
   if (newTombstones.length > 0) {
     const result = await this.sanityCheckTombstones(newTombstones, walletRepo);
     validTombstones = result.validTombstones;
     tokensToRestore = result.tokensToRestore;
   }
   ```

2. **Line 2447-2449**: Restore tokens rejected by sanity check
   ```typescript
   for (const { tokenId, txf } of allTokensToRestore) {
     walletRepo.restoreTokenFromArchive(tokenId, txf);
   }
   ```

3. **Line 2414-2418**: Check for missing tokens
   ```typescript
   const tokensToPreserveFromMissing = await this.sanityCheckMissingTokens(
     localTokens,
     remoteTokenIds,
     remoteTombstoneIds
   );
   ```

#### B. After IPFS Import (`checkArchivedTokensForRecovery` - Line 2678)
**File:** `/home/vrogojin/sphere/src/components/wallet/L3/services/IpfsStorageService.ts`

**Flow:**
```typescript
// Line 2673-2683
// ARCHIVE RECOVERY CHECK
// Safety net for IPNS eventual consistency: check if any archived tokens
// should be restored (not active, not tombstoned, and still unspent on Unicity)
const archivedRecoveryCount = await this.checkArchivedTokensForRecovery(walletRepo);
if (archivedRecoveryCount > 0) {
  importedCount += archivedRecoveryCount;
  window.dispatchEvent(new Event("wallet-updated"));
}
```

#### C. Periodic Tombstone Recovery (Background Task)
**File:** `/home/vrogojin/sphere/src/components/wallet/L3/services/IpfsStorageService.ts`
**Line:** 3532-3571

Runs periodically to check tombstones and restore unspent tokens.

---

## 2. How Unspent Verification Works

### Core Method: `checkUnspentTokens` (TokenValidationService)
**File:** `/home/vrogojin/sphere/src/components/wallet/L3/services/TokenValidationService.ts`
**Line:** 695-761

**Signature:**
```typescript
async checkUnspentTokens(
  tokens: Map<string, TxfToken>,
  publicKey: string,
  options?: { treatErrorsAsUnspent?: boolean }
): Promise<string[]>
```

**How it determines spent/unspent:**

1. **Queries aggregator** using `client.isTokenStateSpent(trustBase, sdkToken, pubKeyBytes)`
2. **Uses SDK's inclusion/exclusion proof logic**:
   - **Inclusion proof** (authenticator !== null) → Token is **SPENT**
   - **Exclusion proof** (authenticator === null) → Token is **UNSPENT**

3. **Caching behavior**:
   - SPENT results cached **forever** (immutable)
   - UNSPENT results cached for **5 minutes** (could change)

4. **Dev mode bypass**: Skips trust base verification if `ServiceProvider.isTrustBaseVerificationSkipped()` returns true

5. **Error handling**: `treatErrorsAsUnspent` option controls behavior
   - `true` (default): Errors → assume UNSPENT (safe for live tokens)
   - `false`: Errors → assume SPENT (safe for tombstone recovery)

---

## 3. Archive Recovery Logic (`checkArchivedTokensForRecovery`)

**File:** `/home/vrogojin/sphere/src/components/wallet/L3/services/IpfsStorageService.ts`
**Line:** 2044-2145

**What it does:**

1. **Identifies candidates** (Line 2069-2088):
   - Archived tokens NOT in active set
   - NOT tombstoned with current state hash

2. **Checks with aggregator** (Line 2108-2112):
   ```typescript
   const unspentTokenIds = await validationService.checkUnspentTokens(
     candidatesForRecovery,
     publicKey,
     { treatErrorsAsUnspent: false }  // Errors → assume spent → don't restore
   );
   ```

3. **Restores unspent tokens** (Line 2117-2136):
   ```typescript
   for (const [tokenId, txfToken] of candidatesForRecovery) {
     if (unspentSet.has(tokenId)) {
       walletRepo.removeTombstonesForToken(tokenId);  // Remove invalid tombstones
       walletRepo.restoreTokenFromArchive(tokenId, txfToken);
       restoredCount++;
     }
   }
   ```

---

## 4. Tombstone Sanity Check (`sanityCheckTombstones`)

**File:** `/home/vrogojin/sphere/src/components/wallet/L3/services/IpfsStorageService.ts`
**Line:** 1888-1962

**What it does:**

1. **Builds token map** from archived versions (Line 1912-1918)
2. **Checks with aggregator** (Line 1931-1936):
   ```typescript
   const unspentTokenIds = await validationService.checkUnspentTokens(
     tokensToCheck,
     publicKey,
     { treatErrorsAsUnspent: false }  // Errors → don't restore
   );
   ```

3. **Categorizes tombstones** (Line 1939-1955):
   - **Unspent token** → Invalid tombstone → Add to `tokensToRestore`
   - **Spent token** → Valid tombstone → Add to `validTombstones`

---

## 5. Missing Token Sanity Check (`sanityCheckMissingTokens`)

**File:** `/home/vrogojin/sphere/src/components/wallet/L3/services/IpfsStorageService.ts`
**Line:** 1969-2035

**What it does:**

1. **Finds tokens missing from remote** (Line 1977-1987):
   - In local but NOT in remote
   - NOT tombstoned in remote

2. **Checks with aggregator** (Line 2018-2022):
   ```typescript
   const unspentTokenIds = await validationService.checkUnspentTokens(tokensToCheck, publicKey);
   ```

3. **Preserves unspent tokens** (Line 2024-2032)

---

## 6. Repository Methods

### `WalletRepository.restoreTokenFromArchive`
**File:** `/home/vrogojin/sphere/src/repositories/WalletRepository.ts`
**Line:** 1766-1842

**What it does:**

1. Creates `Token` from `TxfToken`
2. Extracts amount, coinId, tokenType from genesis data
3. Adds/updates token in wallet
4. Saves wallet to localStorage

### `WalletRepository.removeTombstonesForToken`
**File:** `/home/vrogojin/sphere/src/repositories/WalletRepository.ts`
**Line:** 1549-1558

**What it does:**
- Removes ALL tombstones for a given tokenId (regardless of stateHash)
- Used when archive recovery detects token is not actually spent

---

## 7. Current Call Flow During IPFS Sync

```
syncFromIpns()
  └─> resolveIpnsProgressively()
      └─> importRemoteData(remoteTxf)
          │
          ├─> sanityCheckTombstones(newTombstones)  [Line 2434]
          │   └─> checkUnspentTokens(tokensToCheck, publicKey, { treatErrorsAsUnspent: false })
          │   └─> Returns: { validTombstones, invalidTombstones, tokensToRestore }
          │
          ├─> sanityCheckMissingTokens(localTokens, remoteTokenIds, remoteTombstoneIds)  [Line 2414]
          │   └─> checkUnspentTokens(tokensToCheck, publicKey)
          │   └─> Returns: tokensToPreserve
          │
          ├─> Restore tokens from both checks  [Line 2447]
          │   └─> walletRepo.restoreTokenFromArchive(tokenId, txf)
          │
          ├─> Import remote tokens  [Line 2490-2653]
          │
          └─> checkArchivedTokensForRecovery(walletRepo)  [Line 2678]
              └─> checkUnspentTokens(candidatesForRecovery, publicKey, { treatErrorsAsUnspent: false })
              └─> restoreTokenFromArchive() for unspent tokens
```

---

## 8. Analysis: Is Unspent Recovery Already Happening During IPFS Sync?

**YES!** The unspent token recovery is **already implemented** during IPFS sync in **multiple places**:

### ✅ Recovery Mechanisms Already Present:

1. **Tombstone Sanity Check** (Line 2434):
   - Verifies new tombstones from remote
   - Restores tokens if tombstone is invalid (token not spent)

2. **Missing Token Check** (Line 2414):
   - Preserves local tokens missing from remote
   - Prevents deletion if token is unspent

3. **Archive Recovery** (Line 2678):
   - Post-import safety net
   - Restores archived tokens that are unspent

### 🔍 What This Means:

The "page reload recovery" described in the context **is actually the IPFS sync recovery**. The check happens:
- ✅ During fresh app start (when IPFS sync populates minimal wallet)
- ✅ After every IPFS import operation
- ✅ Periodically in background (tombstone recovery task)

---

## 9. Potential Improvements

While the mechanism exists, there may be opportunities for optimization:

### A. Consolidation
The recovery logic is spread across three places:
1. `sanityCheckTombstones` (Line 1888)
2. `sanityCheckMissingTokens` (Line 1969)
3. `checkArchivedTokensForRecovery` (Line 2044)

**Recommendation:** These could potentially be consolidated into a single unified recovery method.

### B. Performance
Currently, three separate calls to `checkUnspentTokens`:
1. For new tombstones
2. For missing tokens
3. For archived tokens

**Recommendation:** Could be batched into a single aggregator query with all token IDs.

### C. Caching
- SPENT results cached forever ✅
- UNSPENT results cached for 5 minutes ✅
- Cache cleared after inventory changes ✅

**Recommendation:** Current caching strategy is solid. No changes needed.

### D. Error Handling
Different `treatErrorsAsUnspent` settings:
- Tombstone checks: `false` (safe - don't restore on error)
- Missing token checks: `true` (safe - don't delete on error)
- Archive recovery: `false` (safe - don't restore on error)

**Recommendation:** Settings are correct for safety. Network errors won't cause token loss.

---

## 10. Answers to Specific Questions

### Q1: Where exactly does the "unspent token check and restore" happen on page reload?

**A:** It happens in `importRemoteData()` at **three points**:
- Line 2434: `sanityCheckTombstones()` for new tombstones
- Line 2414: `sanityCheckMissingTokens()` for missing tokens
- Line 2678: `checkArchivedTokensForRecovery()` post-import safety net

This is called during `syncFromIpns()` which runs on app startup when a fresh wallet with just a nametag is populated from IPFS.

### Q2: What logic is used to determine if an archived/tombstoned token is actually unspent?

**A:** The `TokenValidationService.checkUnspentTokens()` method (Line 695):
1. Parses TxfToken → SDK Token
2. Calculates current state hash
3. Creates RequestId from publicKey + stateHash
4. Queries aggregator with `client.isTokenStateSpent(trustBase, sdkToken, pubKeyBytes)` (production) or `client.getInclusionProof(requestId)` (dev mode)
5. Interprets proof:
   - Inclusion proof (authenticator !== null) = **SPENT**
   - Exclusion proof (authenticator === null) = **UNSPENT**

### Q3: Where in `importRemoteData` should this check be added?

**A:** **It's already there!** At three different points:
- Lines 2433-2440: Tombstone sanity check
- Lines 2414-2418: Missing token check
- Lines 2678-2683: Archive recovery check

**No additional check needed** - the mechanism is already comprehensive.

### Q4: What's the best way to implement this - reuse existing methods or create new ones?

**A:** **Reuse existing methods** - they are well-designed:
- `sanityCheckTombstones()` - validates tombstones
- `sanityCheckMissingTokens()` - preserves missing tokens
- `checkArchivedTokensForRecovery()` - restores archived tokens
- All three use `TokenValidationService.checkUnspentTokens()` under the hood

**Recommendation:** If optimization is needed, consolidate these three methods into one unified recovery method, but keep the core `checkUnspentTokens()` logic unchanged.

---

## 11. Conclusion

The unspent token recovery mechanism is **already fully implemented** during IPFS sync. The system has multiple safety nets to prevent token loss:

1. ✅ Verifies new tombstones before applying them
2. ✅ Preserves local tokens missing from remote if unspent
3. ✅ Restores archived tokens that shouldn't be deleted
4. ✅ Uses proper error handling to prevent token loss on network errors
5. ✅ Clears cache appropriately after inventory changes

**The "page reload check" described in the context IS the IPFS sync check** - they are the same mechanism, triggered when:
- App starts fresh and syncs from IPFS to populate minimal wallet
- IPFS sync imports remote data
- Background tombstone recovery task runs

No additional implementation is needed unless consolidation/optimization is desired.

---

## 12. Code Reference Map

| Functionality | File | Line | Method |
|---------------|------|------|--------|
| Unspent check (core) | `TokenValidationService.ts` | 695 | `checkUnspentTokens()` |
| Tombstone sanity check | `IpfsStorageService.ts` | 1888 | `sanityCheckTombstones()` |
| Missing token check | `IpfsStorageService.ts` | 1969 | `sanityCheckMissingTokens()` |
| Archive recovery | `IpfsStorageService.ts` | 2044 | `checkArchivedTokensForRecovery()` |
| Import remote data | `IpfsStorageService.ts` | 2354 | `importRemoteData()` |
| Restore from archive | `WalletRepository.ts` | 1766 | `restoreTokenFromArchive()` |
| Remove tombstones | `WalletRepository.ts` | 1549 | `removeTombstonesForToken()` |
| Spent check (single) | `TokenValidationService.ts` | 853 | `checkSingleTokenSpent()` |
| Periodic recovery | `IpfsStorageService.ts` | 3532 | Tombstone recovery task |

---

## 13. Testing Recommendations

If you want to verify the mechanism works correctly:

1. **Test tombstone rejection**:
   - Create token on Device A
   - Transfer on Device B (creates tombstone)
   - Before transfer commits, force sync from Device A
   - Verify: Token NOT deleted (tombstone rejected as invalid)

2. **Test missing token preservation**:
   - Create token on Device A
   - Sync to IPFS
   - Transfer on Device B (removes from active, adds tombstone)
   - Before transfer commits, force sync from Device A
   - Verify: Token preserved (missing but unspent)

3. **Test archive recovery**:
   - Create token
   - Transfer (archives + tombstones)
   - Cancel transfer before commitment
   - Sync from IPFS
   - Verify: Token restored from archive

4. **Test network error safety**:
   - Disconnect network
   - Trigger IPFS sync with remote tombstones
   - Verify: Tokens NOT deleted (error defaults to safe behavior)
