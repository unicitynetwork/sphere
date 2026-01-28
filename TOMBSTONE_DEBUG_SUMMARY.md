# Tombstone Verification Debug - Summary

## Problem
Tombstone verification optimization shows `local: 0` instead of expected `local: 45`, meaning all 45 tombstones are being verified via aggregator instead of using local Sent folder proofs.

## Changes Made

### Added Comprehensive Debug Logging

Modified `/home/vrogojin/sphere/src/components/wallet/L3/services/InventorySyncService.ts`:

#### 1. In `step7_5_verifyTombstones()` function
**Location:** Lines ~2086-2145

**Added logging for first 3 tombstones:**
- Tombstone structure (tokenId, stateHash, timestamp)
- StateHash format validation (starts with "0000"?)
- Matching Sent entry presence
- Transaction count in Sent token
- Upgrade attempts and results
- Proof matching results
- Verification outcomes

#### 2. In `findMatchingProofForTombstone()` function
**Location:** Lines ~2222-2290

**Added detailed transaction scanning:**
- Log all transactions being checked
- Log newStateHash for each transaction
- Log when computed hash is used (for last tx)
- Log when matches are found
- Log authenticator hash checks
- Log genesis proof checks

### Bug Fixes
- Fixed TypeScript null check errors in proof return statements

## What the Debug Logs Will Show

### Expected Log Output

```
🔍 [Step 7.5] Verify tombstones against aggregator
  Built Sent lookup map: 59 entries (by tokenId)

  🔍 DEBUG Tombstone 0: {
    tokenId: 'abc123...',
    stateHash: '0000deadbeef...',
    startsWithZeros: true,
    hasMatchingSent: true,
    sentTxCount: 1
  }
    ✓ StateHash already valid (starts with 0000)
    Finding proof match for state 0000deadbeef...
      [findMatch] Token abc123... looking for state 0000deadbeef...
      [findMatch] Checking 1 transactions
      [findMatch] Tx 0: newStateHash = 0000deadbeef..., hasProof=true
      [findMatch] ✓ MATCH FOUND at tx 0!
    Match found: true, Match details: {
      verifyStateHash: '0000previous...',
      hasProof: true,
      hasAuthenticator: true
    }
    Proof verification result: VALID ✓
```

## Diagnostic Questions Answered

The logs will reveal:

### 1. Tombstone Format
**Q:** Do tombstones have valid stateHash (starts with "0000")?
**A:** Check `startsWithZeros: true/false`

### 2. Upgrade Logic
**Q:** Is the upgrade logic running?
**A:** Look for "⚠️ Invalid stateHash detected" and "✅ Upgraded tombstone"

### 3. Sent Token Structure
**Q:** Do Sent tokens have the necessary transaction data?
**A:** Check `sentTxCount` and transaction logs

### 4. Proof Matching
**Q:** Why isn't `findMatchingProofForTombstone` finding matches?
**A:** Check the `[findMatch]` logs showing:
- How many transactions are scanned
- What newStateHash each transaction has
- Whether any match the tombstone stateHash

### 5. Verification
**Q:** If a match is found, why doesn't verification succeed?
**A:** Check "Proof verification result: VALID/INVALID"

## Possible Root Causes

Based on the logs, we can identify which scenario is occurring:

### Scenario A: StateHash Mismatch
**Symptoms:**
- `startsWithZeros: true` (tombstones already have valid format)
- `[findMatch] ✗ NO MATCH FOUND`
- Transaction newStateHash values don't match tombstone stateHash

**Cause:** The tombstone records state `X`, but the Sent token's transactions show state `Y`. This could happen if:
- Token was modified after being sent
- Multiple transactions occurred from the same token
- StateHash computation is inconsistent

**Fix:** Need to handle state evolution - a tombstone might reference an intermediate state, not just the final state.

### Scenario B: Missing newStateHash
**Symptoms:**
- `[findMatch] Tx 0: newStateHash = missing...`
- `[findMatch] Tx 1: newStateHash = missing...`
- Only last transaction gets computed hash

**Cause:** Legacy tokens don't have `newStateHash` on every transaction. The code only computes it for the LAST transaction.

**Fix:** Compute `newStateHash` for ALL transactions during the search, not just the last one.

### Scenario C: Invalid Tombstone StateHash
**Symptoms:**
- `startsWithZeros: false`
- `stateHash: 'abc123...'` (looks like a tokenId, not a state hash)
- "⚠️ Invalid stateHash detected"
- "❌ Failed to compute valid hash"

**Cause:** Tombstones were created with invalid stateHash (possibly tokenId was used as fallback).

**Fix:** The upgrade logic should fix this, but if `computeFinalStateHashCached` fails, we need to understand why.

### Scenario D: Proof Verification Failure
**Symptoms:**
- `Match found: true`
- `Proof verification result: INVALID ✗`

**Cause:** The cryptographic proof verification is failing due to:
- Wrong publicKey
- Invalid proof structure
- RequestId derivation mismatch

**Fix:** Debug the `verifyInclusionProofLocally` function.

## Next Steps

1. **Run the application** in development mode
2. **Trigger a sync** (refresh page or perform a token operation)
3. **Examine console logs** for the debug output
4. **Compare with scenarios** above to identify root cause
5. **Implement targeted fix** based on findings
6. **Remove debug logging** once issue is resolved

## Files Modified

- `/home/vrogojin/sphere/src/components/wallet/L3/services/InventorySyncService.ts`
  - Added debug logging to `step7_5_verifyTombstones()`
  - Added debug logging to `findMatchingProofForTombstone()`
  - Fixed TypeScript null check errors

## Build Status

✅ Build successful - code is ready for testing

## Testing Instructions

1. Start dev server: `npm run dev`
2. Open browser console (F12)
3. Navigate to L3 wallet
4. Trigger sync by:
   - Refreshing the page
   - Sending a token
   - Receiving a token
5. Search console for "🔍 [Step 7.5] Verify tombstones"
6. Copy debug output
7. Analyze based on scenarios above
8. Report findings

## Expected Outcome

After running this debug version, we'll know:
- The exact format of tombstone stateHash values
- Whether Sent tokens have transaction data needed for local verification
- Which specific check is failing (format, matching, or verification)
- The precise fix needed to achieve `local: 45` instead of `local: 0`
