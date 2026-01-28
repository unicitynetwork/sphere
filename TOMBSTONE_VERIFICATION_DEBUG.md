# Tombstone Verification Debug Investigation

## Problem Statement

The tombstone verification optimization shows:
```
✓ Verified 45 tombstones in 1044ms (local: 0, aggregator: 45, false positives: 0)
```

**Expected:** `local: 45` (most tombstones verified locally using Sent folder proofs)
**Actual:** `local: 0` (all tombstones falling through to aggregator verification)

Despite the upgrade logic being added, no tombstones are being upgraded and none are verified locally.

## Investigation Approach

### 1. Added Debug Logging

Modified `/home/vrogojin/sphere/src/components/wallet/L3/services/InventorySyncService.ts` to add comprehensive debug logging:

**In `step7_5_verifyTombstones` (lines 2089-2145):**
- Log first 3 tombstones with their stateHash format
- Check if stateHash starts with "0000"
- Log upgrade attempts and results
- Log proof matching attempts
- Log verification results

**In `findMatchingProofForTombstone` (lines 2222-2275):**
- Log all transaction newStateHash values
- Log when computed newStateHash is used
- Log when matches are found
- Log all authenticator checks

### 2. Diagnostic Questions

The debug logs will answer:

1. **Do tombstones have valid stateHash format?**
   - Check: `startsWithZeros: true/false`
   - If false, they need upgrading

2. **Is `computeFinalStateHashCached()` working?**
   - Check: Does it return a value starting with "0000"?
   - Check: Does it match any transaction's newStateHash?

3. **Are Sent tokens structured correctly?**
   - Check: How many transactions do they have?
   - Check: Do transactions have `newStateHash` populated?
   - Check: Do transactions have `inclusionProof.authenticator`?

4. **Is the matching logic correct?**
   - Check: Does `txNewStateHash === tombstoneStateHash`?
   - Or: Does `tx.inclusionProof.authenticator.stateHash === tombstoneStateHash`?

## Expected Output

When you run sync now, you should see logs like:

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

Or if tombstones need upgrading:

```
  🔍 DEBUG Tombstone 0: {
    tokenId: 'abc123...',
    stateHash: 'abc123...',  // <-- WRONG! This is the tokenId!
    startsWithZeros: false,  // <-- NOT VALID!
    hasMatchingSent: true,
    sentTxCount: 1
  }
    ⚠️ Invalid stateHash detected (doesn't start with 0000), computing...
    Computed hash: 0000deadbeef... (starts with 0000: true)
    ✅ Upgraded tombstone 0: abc123... -> 0000deadbeef...
    Finding proof match for state 0000deadbeef...
```

## Root Cause Hypotheses

### Hypothesis 1: Tombstones Already Have Valid Format
If logs show `startsWithZeros: true` for all tombstones, then:
- The upgrade logic is correctly NOT running (tombstones don't need upgrading)
- The problem is in the proof matching logic

**Fix:** Check why `findMatchingProofForTombstone` isn't finding matches

### Hypothesis 2: Computed Hash Doesn't Match Transaction newStateHash
If logs show:
- Tombstone upgraded successfully
- But no match found in transactions

Then the issue is:
- `computeFinalStateHashCached()` computes the current state hash
- But Sent tokens might have been modified after they were sent
- The transaction's `newStateHash` might not match the computed hash

**Fix:** Need to understand the relationship between:
- Tombstone stateHash (what state was spent)
- Sent token final state (might have changed)
- Transaction newStateHash (state immediately after that tx)

### Hypothesis 3: Transactions Missing newStateHash Field
If logs show:
- `newStateHash = missing...` for most transactions
- Only last transaction gets computed

Then the issue is:
- Old tokens don't have `newStateHash` on every transaction
- We only compute it for the LAST transaction
- But tombstone might reference an earlier state

**Fix:** Compute `newStateHash` for ALL transactions, not just the last one

### Hypothesis 4: Proof Structure Mismatch
If logs show:
- Match found
- But verification fails

Then the issue is:
- The proof structure doesn't match what `verifyInclusionProofLocally` expects
- Or the publicKey doesn't match
- Or the RequestId derivation is wrong

**Fix:** Check proof verification logic

## Next Steps

1. **Run the app** and trigger a sync
2. **Check console logs** for the debug output
3. **Identify which hypothesis** matches the actual behavior
4. **Implement the appropriate fix** based on findings

## Code Changes Made

### File: `/home/vrogojin/sphere/src/components/wallet/L3/services/InventorySyncService.ts`

**Function:** `step7_5_verifyTombstones` (lines ~2086-2145)
- Added debug logging for first 3 tombstones
- Added detailed upgrade tracking
- Added proof matching and verification logging

**Function:** `findMatchingProofForTombstone` (lines ~2222-2290)
- Added comprehensive transaction scanning logs
- Added match detection logs
- Added fallback check logs

These changes are **diagnostic only** and don't change behavior. Once we understand the root cause from the logs, we'll implement a proper fix.

## Testing Instructions

1. Open the app in browser
2. Navigate to L3 wallet
3. Trigger a sync (refresh page or send/receive token)
4. Open browser console
5. Look for "🔍 [Step 7.5] Verify tombstones" section
6. Copy the debug output
7. Analyze based on hypotheses above
