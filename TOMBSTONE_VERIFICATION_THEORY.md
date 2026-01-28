# Tombstone Verification Theory & Analysis

## Background: How Tombstone Verification Should Work

### The Tombstone Lifecycle

1. **Token is sent** (completed transfer)
   - Token moved from Active to Sent folder
   - Tombstone created: `{ tokenId, stateHash, timestamp }`
   - StateHash = the final state of the token when sent

2. **Later sync** needs to verify tombstones
   - For each tombstone, check if that state was actually spent on-chain
   - If spent → keep tombstone (token is truly gone)
   - If unspent → remove tombstone, recover token (false positive)

### The Optimization

Instead of querying aggregator for all 45 tombstones (slow), use local Sent folder:
- Sent folder contains the full token with all transactions and proofs
- If we can find a transaction whose `newStateHash === tombstoneStateHash`, we can verify locally
- The transaction's `inclusionProof` proves that transaction was committed
- If the transaction was committed, the state transition happened, so the state is spent

## Current Implementation Analysis

### Step 1: Build Sent Lookup Map
```typescript
const sentLookupMap = buildSentLookupMap(ctx.sent);
// Key: tokenId → SentTokenEntry
```

**Issue:** We key by tokenId only, not by tokenId:stateHash. This is correct because:
- A tombstone might reference any state in the token's history
- The Sent entry has the full token with all transactions
- We need to search through transactions to find the matching state

### Step 2: For Each Tombstone, Try Local Verification
```typescript
const sentEntry = sentLookupMap.get(tombstone.tokenId);
if (sentEntry?.token) {
  const match = await findMatchingProofForTombstone(sentEntry, tombstone.stateHash);
  if (match) {
    const isValid = await validationService.verifyInclusionProofLocally(...);
    if (isValid) {
      verifiedLocal++;
      continue;
    }
  }
}
```

### Step 3: Fallback to Aggregator
If no local match, query aggregator in parallel batches.

## Theoretical Issues

### Issue 1: StateHash Format Evolution

**Problem:** Old tombstones might have invalid stateHash values.

**Why this happens:**
- Before the stateHash fix, tombstones might have been created with `tokenId` as stateHash
- Or with empty string
- Or with some other invalid format

**Current fix attempt:**
```typescript
if (!effectiveStateHash.startsWith('0000')) {
  const computedHash = await computeFinalStateHashCached(sentEntry.token);
  if (computedHash && computedHash.startsWith('0000')) {
    tombstone.stateHash = computedHash;
    effectiveStateHash = computedHash;
    tombstonesUpgraded++;
  }
}
```

**Potential problem with this fix:**
- `computeFinalStateHashCached()` computes the CURRENT final state of the Sent token
- But the Sent token might have been modified after the tombstone was created
- Example:
  1. Token sent at state `S1`, tombstone created with (invalid) stateHash `tokenId`
  2. Later, same token updated to state `S2` in Sent folder
  3. Now we compute `S2`, but tombstone should have been `S1`
  4. Matching will fail because no transaction has `newStateHash === S2`

### Issue 2: Missing newStateHash in Legacy Transactions

**Problem:** Old tokens don't have `newStateHash` populated on every transaction.

**Code analysis:**
```typescript
for (let i = 0; i < token.transactions.length; i++) {
  const tx = token.transactions[i];
  let txNewStateHash = tx.newStateHash;

  // For the LAST transaction only, compute newStateHash if missing
  if (!txNewStateHash && i === token.transactions.length - 1) {
    txNewStateHash = (await computeFinalStateHashCached(token)) ?? undefined;
  }

  if (txNewStateHash === tombstoneStateHash && tx.inclusionProof?.authenticator) {
    return { proof: tx.inclusionProof, verifyStateHash: ... };
  }
}
```

**Potential problem:**
- We only compute newStateHash for the LAST transaction
- If a tombstone references an intermediate state (from transaction 0 or 1), we won't find it
- All non-last transactions with missing newStateHash will fail to match

### Issue 3: State vs Previous State Confusion

**The verification logic uses TWO different state hashes:**

1. **Tombstone stateHash** = The state that was spent (newStateHash of some transaction)
2. **Proof authenticator stateHash** = The state BEFORE that transaction (previousStateHash)

**Example:**
```
Transaction 0:
  previousState: 0000genesis...  (this is what proof authenticates)
  newState:      0000after1tx...  (this is what tombstone records)
  inclusionProof: { authenticator: { stateHash: "0000genesis..." } }
```

**The matching logic:**
```typescript
if (txNewStateHash === tombstoneStateHash && tx.inclusionProof?.authenticator) {
  return {
    proof: tx.inclusionProof,
    verifyStateHash: tx.inclusionProof.authenticator.stateHash,  // previousStateHash!
  };
}
```

Then verification:
```typescript
const isValid = await validationService.verifyInclusionProofLocally(
  match.proof,                    // The proof
  match.verifyStateHash,          // The previousStateHash (what proof authenticates)
  ctx.publicKey,
  tombstone.tokenId
);
```

**This is actually CORRECT!** The proof authenticates the previous state, and if that proof is valid, it means the transaction happened, which means the new state was created.

But there's also a fallback check:
```typescript
// Also check: maybe the tombstone matches a proof's authenticator directly
for (const tx of token.transactions) {
  if (tx.inclusionProof?.authenticator?.stateHash === tombstoneStateHash) {
    return { proof: tx.inclusionProof, verifyStateHash: tombstoneStateHash };
  }
}
```

This handles the case where the tombstone might have been created with the PREVIOUS state instead of the NEW state.

### Issue 4: Multiple Transactions from Same Token

**Scenario:**
1. Token A sent to Bob (state S1 → S2)
2. Bob sends to Carol (state S2 → S3)
3. Carol sends to Dave (state S3 → S4)
4. Tombstone created for state S4

**Sent folder contains:** Token with ALL transactions (S1→S2→S3→S4)

**Tombstone verification:**
- Look for transaction with `newStateHash === S4`
- Should find transaction 2 (Carol→Dave)
- Verify that transaction's proof
- Success!

**But what if the tombstone was created with state S2?**
- Look for transaction with `newStateHash === S2`
- Should find transaction 0 (Alice→Bob)
- Verify that transaction's proof
- Success!

This should work! But only if:
- Transaction 0 has `newStateHash` populated
- OR it's the last transaction (so we compute it)

## Hypothesis: The Real Problem

Based on the code analysis, I believe the issue is:

**Hypothesis: Tombstones have valid stateHash format (starting with "0000"), but the Sent tokens' transactions are missing the `newStateHash` field for all but the last transaction.**

**Evidence:**
1. The upgrade logic only runs if stateHash doesn't start with "0000"
2. If tombstones already have valid format, upgrade doesn't run
3. But the matching logic only computes newStateHash for the LAST transaction
4. If a tombstone references any state except the final state, matching will fail

**Test this hypothesis:**
Look for these patterns in debug logs:
```
startsWithZeros: true  // ← Tombstone has valid format
sentTxCount: 1         // ← Only one transaction, so should work
[findMatch] Tx 0: newStateHash = 0000abc123..., hasProof=true
✗ NO MATCH FOUND      // ← But still no match!
```

This would indicate the computed hash doesn't match the tombstone hash, even though both are valid.

**OR:**
```
startsWithZeros: true  // ← Valid format
sentTxCount: 3         // ← Multiple transactions
[findMatch] Tx 0: newStateHash = missing...  // ← Old transaction, no newStateHash
[findMatch] Tx 1: newStateHash = missing...
[findMatch] Tx 2 (last): computed newStateHash = 0000xyz...
✗ NO MATCH FOUND      // ← Tombstone references tx 0 or 1, not found!
```

## Proposed Fix (After Debug Confirms Hypothesis)

### Fix Option 1: Compute newStateHash for ALL Transactions
```typescript
for (let i = 0; i < token.transactions.length; i++) {
  const tx = token.transactions[i];
  let txNewStateHash = tx.newStateHash;

  // Compute newStateHash if missing (not just for last tx)
  if (!txNewStateHash) {
    // Reconstruct token state after transaction i
    const tokenUpToI = { ...token, transactions: token.transactions.slice(0, i + 1) };
    txNewStateHash = await computeFinalStateHash(tokenUpToI);
  }

  if (txNewStateHash === tombstoneStateHash && tx.inclusionProof?.authenticator) {
    return { proof: tx.inclusionProof, verifyStateHash: ... };
  }
}
```

**Pro:** Handles all cases
**Con:** Expensive - requires SDK computation for each transaction

### Fix Option 2: Sequential State Computation
```typescript
let currentStateHash = token.genesis.inclusionProof.authenticator.stateHash;
const stateHashes = [currentStateHash];

for (const tx of token.transactions) {
  if (tx.newStateHash) {
    currentStateHash = tx.newStateHash;
  } else {
    // Compute using SDK (reconstruct state chain)
    currentStateHash = await computeNextStateHash(currentStateHash, tx);
  }
  stateHashes.push(currentStateHash);
}

// Now check if any stateHash matches tombstone
```

**Pro:** More efficient, computes chain once
**Con:** Still requires SDK for missing hashes

### Fix Option 3: Aggregator Fallback is OK
Accept that old tokens will use aggregator verification, only optimize for new tokens.

**Pro:** Simple, no risk
**Con:** Doesn't achieve goal of 100% local verification

## Conclusion

The debug logs will reveal the exact issue. Most likely:
1. Tombstones have valid format (no upgrade needed)
2. But Sent tokens have missing newStateHash on non-last transactions
3. Or the computed hash doesn't match due to state evolution

Once confirmed, implement the appropriate fix from the options above.
