# Legacy Token newStateHash Refactoring Plan

## Executive Summary

Legacy tokens sent before a bug fix are missing the `newStateHash` field on their transfer transactions. This breaks tombstone verification in the inventory sync system because `findMatchingProofForTombstone()` checks `tx.newStateHash === tombstoneStateHash`, which fails when `newStateHash` is `undefined`.

**Impact**: Tombstone verification falls back to expensive aggregator queries instead of using local proofs, degrading performance and increasing network load.

**Solution Strategy**: Implement a lazy-compute approach for `newStateHash` that derives it from the token's state without modifying stored data, maintaining backward compatibility.

---

## Problem Analysis

### Root Cause
- **Before**: SDK's `Token.fromJSON()` recalculates state hashes internally, but didn't populate `newStateHash` field in serialized output
- **Current**: `TxfTransaction.newStateHash` is optional (`newStateHash?: string`) for backward compatibility
- **Impact**: Tombstone matching logic relies on exact field equality, failing silently for legacy tokens

### Current Code Issues

**TxfTypes.ts (Line 153)**:
```typescript
export interface TxfTransaction {
  previousStateHash: string;
  newStateHash?: string;     // Optional for backwards compatibility with older tokens
  predicate: string;
  inclusionProof: TxfInclusionProof | null;
  data?: Record<string, unknown>;
}
```

**InventorySyncService.ts (Line 2211)**:
```typescript
if (tx.newStateHash === tombstoneStateHash && tx.inclusionProof?.authenticator) {
  // This fails silently when tx.newStateHash is undefined
  return { proof: tx.inclusionProof, verifyStateHash: tx.inclusionProof.authenticator.stateHash };
}
```

### Why This Matters
1. **Performance**: Local verification (100ms) vs. aggregator query (500-1000ms) for each tombstone
2. **Reliability**: Network errors prevent tombstone verification entirely
3. **User Experience**: Slow wallet sync, wallet appears "stuck" during inventory verification
4. **Scale**: With 50+ tokens, missing optimization compounds to 25-50 seconds of unnecessary latency

---

## Design: Lazy Computation Strategy

### Key Principles
1. **Non-destructive**: Don't modify stored token data (backward compatibility)
2. **Lazy**: Compute only when needed (tombstone matching phase)
3. **Deterministic**: Computation must match SDK's internal calculation
4. **Efficient**: Cache results to avoid repeated computation
5. **Fallback-safe**: If computation fails, gracefully degrade to aggregator query

### How newStateHash Should Be Computed

The `newStateHash` represents the **output state** after a transaction is applied.

From TxfSerializer.ts (repairMissingStateHash function, lines 895-952), the proper way to compute it:

```
1. Parse the TXF token using SDK's Token.fromJSON()
   - SDK internally validates and calculates all state hashes
2. Get the calculated state hash via sdkToken.state.calculateHash()
3. Convert to JSON string using calculateHash().toJSON()
4. This gives us the exact newStateHash the transaction produced
```

**Why this works**:
- SDK's state calculation is deterministic (same input = same hash)
- Token.state already includes the transaction's output
- calculateHash() is the canonical method for computing state hashes

### Two Computation Paths

#### Path A: Single Transaction (Most Common)
For tokens with **one transaction**, compute from that transaction's output state:

```
Input:  TxfToken with transactions[0] (missing newStateHash)
Output: Computed newStateHash from token.state.calculateHash()

Determinism:
- Token.fromJSON(txf) is deterministic
- state.calculateHash() is deterministic
- Result = exact value SDK would have written to newStateHash
```

#### Path B: Multiple Transactions (Rare)
For tokens with **multiple transactions**, we need to know which transaction creates the target state:

Option 1: Compute for all transactions (slow but guaranteed)
```
for each tx in transactions:
  - Reconstruct intermediate state up to that tx
  - Compute state hash
  - Check if matches tombstone
```

Option 2: Binary search optimization (fast)
```
- Check last transaction first (most common = target is current state)
- Check first transaction second (legacy send = target is post-transfer state)
- Fall back to full search if neither matches
```

**Recommendation**: Start with Option 1 (full search), optimize to Option 2 if needed after profiling.

---

## Implementation Plan

### Phase 1: Core Computation Utility (Week 1)

#### File: `src/components/wallet/L3/services/StateHashComputation.ts` (NEW)

Responsibilities:
- Compute `newStateHash` for transactions missing it
- Cache computation results to avoid redundant SDK calls
- Provide both single-tx and multi-tx computation paths
- Handle SDK import errors gracefully

```typescript
export interface StateHashComputationResult {
  newStateHash: string;          // Computed value
  txIndex: number;               // Which transaction produced it
  computedAt: number;            // Timestamp for cache TTL
  sdkVerified: boolean;          // Did SDK verification succeed?
}

export class StateHashComputation {
  // Computation cache: key = tokenId, value = computed newStateHash values
  private computationCache = new Map<string, StateHashComputationResult[]>();
  private readonly CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

  /**
   * Get or compute newStateHash for a specific transaction in a token
   * @param txf - TXF token (with or without newStateHash on target tx)
   * @param targetTxIndex - Index of transaction to compute newStateHash for
   * @returns Computed newStateHash, or null if computation failed
   */
  async getTransactionNewStateHash(
    txf: TxfToken,
    targetTxIndex: number
  ): Promise<string | null>

  /**
   * Compute all missing newStateHash values in a token
   * @param txf - TXF token that may have missing newStateHash fields
   * @returns Map of txIndex -> computed newStateHash
   */
  async computeAllMissingNewStateHashes(
    txf: TxfToken
  ): Promise<Map<number, string>>

  /**
   * Find the transaction that produces a specific state (for tombstone matching)
   * @param txf - TXF token
   * @param targetStateHash - State hash to search for
   * @returns { txIndex, newStateHash } if found, null otherwise
   */
  async findTransactionProducingState(
    txf: TxfToken,
    targetStateHash: string
  ): Promise<{ txIndex: number; newStateHash: string } | null>

  /**
   * Clear computation cache (call on address change/logout)
   */
  clearCache(): void
}
```

#### Key Implementation Details

**SDK Invocation Pattern**:
```typescript
const { Token } = await import("@unicitylabs/state-transition-sdk/lib/token/Token");
const sdkToken = await Token.fromJSON(txf);
const calculatedStateHash = await sdkToken.state.calculateHash();
const stateHashStr = calculatedStateHash.toJSON();
```

**Caching Strategy**:
- Cache key: `tokenId` (not `tokenId:txIndex` because all transactions computed together)
- Cache value: Array of `StateHashComputationResult` (one per transaction)
- TTL: 1 hour (state hashes never change, so long cache is safe)
- Invalidation: Cleared on address change via TokenValidationService.clearSpentStateCache()

**Error Handling**:
```typescript
try {
  const sdkToken = await Token.fromJSON(txf);
  const hash = await sdkToken.state.calculateHash();
  return hash.toJSON();
} catch (err) {
  console.warn(`Failed to compute newStateHash for token ${txf.genesis.data.tokenId}:`, err);
  return null;  // Graceful degradation - will fall back to aggregator
}
```

---

### Phase 2: Integration with Tombstone Verification (Week 1)

#### File: `src/components/wallet/L3/services/InventorySyncService.ts` (MODIFY)

**Function**: `findMatchingProofForTombstone()` (lines 2200-2242)

**Changes**:
1. Add `stateHashComputation: StateHashComputation` parameter
2. Before checking stored `newStateHash`, attempt to compute it for legacy tokens
3. Fall back to aggregator query only if computation fails

```typescript
async function findMatchingProofForTombstone(
  sentEntry: SentTokenEntry,
  tombstoneStateHash: string,
  stateHashComputation: StateHashComputation  // NEW
): Promise<{ proof: TxfInclusionProof; verifyStateHash: string } | null> {
  const token = sentEntry.token;
  if (!token) return null;

  // Check all transactions
  if (token.transactions && token.transactions.length > 0) {
    for (let i = 0; i < token.transactions.length; i++) {
      const tx = token.transactions[i];

      // Try stored newStateHash first
      let txNewStateHash = tx.newStateHash;

      // If missing, attempt to compute it
      if (!txNewStateHash) {
        txNewStateHash = await stateHashComputation.getTransactionNewStateHash(token, i);
      }

      // Now check if this is the transaction we're looking for
      if (txNewStateHash === tombstoneStateHash && tx.inclusionProof?.authenticator) {
        return {
          proof: tx.inclusionProof,
          verifyStateHash: tx.inclusionProof.authenticator.stateHash,
        };
      }
    }
  }

  // Fallback: Check genesis and previous fallback logic
  // (unchanged from current implementation)
  if (token.transactions && token.transactions.length > 0) {
    for (const tx of token.transactions) {
      if (tx.inclusionProof?.authenticator?.stateHash === tombstoneStateHash) {
        return { proof: tx.inclusionProof, verifyStateHash: tombstoneStateHash };
      }
    }
  }

  if (token.genesis?.inclusionProof?.authenticator?.stateHash === tombstoneStateHash) {
    return { proof: token.genesis.inclusionProof, verifyStateHash: tombstoneStateHash };
  }

  return null;
}
```

**Call Site Changes**:
In `step7_verifyTombstones()`, pass computation instance:
```typescript
// Create instance at start of sync
const stateHashComputation = new StateHashComputation();

// Use in verification loop
const matchResult = await findMatchingProofForTombstone(
  sentEntry,
  tombstone.stateHash,
  stateHashComputation  // NEW PARAMETER
);
```

---

### Phase 3: Integration with Transaction Validation (Week 1)

#### File: `src/components/wallet/L3/services/TokenValidationService.ts` (MODIFY)

**Function**: `isPendingTransactionSubmittable()` (lines 687-783)

**Current Problem** (Line 717-720):
```typescript
if (!prevTx.newStateHash) {
  // Old token format without newStateHash - can't verify, assume submittable
  return { submittable: true, reason: "Cannot verify - missing newStateHash on previous tx", action: "RETRY_LATER" };
}
```

**Change**: Attempt to compute `newStateHash` before giving up

```typescript
async isPendingTransactionSubmittable(
  token: LocalToken,
  pendingTxIndex: number,
  stateHashComputation?: StateHashComputation  // OPTIONAL - create if not provided
): Promise<{ submittable: boolean; reason?: string; action?: ValidationAction }> {
  // ... existing code ...

  // At line 717, replace with:
  let prevStateHash: string;
  if (pendingTxIndex === 0) {
    prevStateHash = txf.genesis.inclusionProof.authenticator.stateHash;
  } else {
    const prevTx = txf.transactions[pendingTxIndex - 1];
    if (!prevTx) {
      return { submittable: false, reason: "Previous transaction not found", action: "DISCARD_FORK" };
    }

    // TRY TO COMPUTE MISSING newStateHash
    if (!prevTx.newStateHash && stateHashComputation) {
      const computed = await stateHashComputation.getTransactionNewStateHash(txf, pendingTxIndex - 1);
      prevStateHash = computed || undefined;
    } else {
      prevStateHash = prevTx.newStateHash;
    }

    // If still missing and no computation available, can't verify
    if (!prevStateHash) {
      return {
        submittable: true,
        reason: "Cannot verify - missing newStateHash on previous tx",
        action: "RETRY_LATER"
      };
    }
  }

  // ... rest of function unchanged ...
}
```

---

### Phase 4: Transaction Matching in Sync Logic (Week 2)

#### File: `src/components/wallet/L3/services/InventorySyncService.ts` (MODIFY)

**Function**: `step3_categorizeTokens()` (around line 1816-1824)

**Current Check**:
```typescript
if (prevTx?.newStateHash && tx.previousStateHash !== prevTx.newStateHash) {
  console.warn(`  ⚠️ State chain broken`);
}
```

**Enhancement**: Compute newStateHash for legacy tokens before validation

```typescript
if (stateHashComputation) {
  const prevNewStateHash = prevTx?.newStateHash ||
    await stateHashComputation.getTransactionNewStateHash(txf, txIndex - 1);

  if (prevNewStateHash && tx.previousStateHash !== prevNewStateHash) {
    console.warn(`  ⚠️ State chain broken`);
  }
}
```

---

## Edge Cases & Special Handling

### 1. Genesis-Only Tokens
**Scenario**: Token has no transactions, only genesis

**Current Handling** (TxfSerializer.ts lines 815-859):
- Uses `_integrity.currentStateHash` for caching
- Computes via `computeAndPatchStateHash()`

**Change Needed**: StateHashComputation should recognize genesis-only tokens and skip (return null) since they don't have `newStateHash` on transactions.

```typescript
// In StateHashComputation.getTransactionNewStateHash()
if (txf.transactions.length === 0) {
  // Genesis-only token, no transactions to compute for
  return null;
}
```

### 2. Tokens with Multiple Transactions
**Scenario**: Token has 3+ transactions, one from the beginning is being sent

**Risk**: Computing all transactions might be expensive (O(n) SDK calls)

**Mitigation**:
```typescript
async computeAllMissingNewStateHashes(txf: TxfToken): Promise<Map<number, string>> {
  // Cache at token level - compute once, use for all queries
  const cacheKey = txf.genesis.data.tokenId;
  const cached = this.computationCache.get(cacheKey);

  if (cached && Date.now() - cached[0].computedAt < this.CACHE_TTL_MS) {
    // Return cached results
    const map = new Map();
    cached.forEach((result, idx) => map.set(idx, result.newStateHash));
    return map;
  }

  // Compute all at once (single SDK parse)
  const map = new Map<number, string>();
  try {
    const { Token } = await import("@unicitylabs/state-transition-sdk/lib/token/Token");
    const sdkToken = await Token.fromJSON(txf);

    // SDK has all transactions - compute final state only
    const finalHash = await sdkToken.state.calculateHash();
    const finalHashStr = finalHash.toJSON();

    // Last transaction's newStateHash is the final state
    if (txf.transactions.length > 0) {
      map.set(txf.transactions.length - 1, finalHashStr);
    }

    // Cache this result
    this.computationCache.set(cacheKey, [
      {
        newStateHash: finalHashStr,
        txIndex: txf.transactions.length - 1,
        computedAt: Date.now(),
        sdkVerified: true,
      }
    ]);
  } catch (err) {
    console.warn(`Failed to compute state hashes for token:`, err);
  }

  return map;
}
```

### 3. Tokens with Empty Transactions Array
**Scenario**: `txf.transactions = []` (should not happen, but defensive programming)

**Handling**: Return null gracefully
```typescript
if (!txf.transactions || txf.transactions.length === 0) {
  return null;
}
```

### 4. Malformed Token Data
**Scenario**: Token.fromJSON() throws an exception

**Handling**: Catch and log, return null to fall back to aggregator
```typescript
try {
  const sdkToken = await Token.fromJSON(txf);
  // ...
} catch (err) {
  console.warn(`Failed to compute newStateHash - falling back to aggregator:`, err);
  return null;
}
```

---

## Testing Strategy

### Unit Tests

**File**: `tests/unit/services/StateHashComputation.test.ts` (NEW)

```typescript
describe('StateHashComputation', () => {
  let computation: StateHashComputation;

  beforeEach(() => {
    computation = new StateHashComputation();
  });

  describe('getTransactionNewStateHash', () => {
    it('should compute newStateHash for single-transaction token', async () => {
      const txf = createTestToken({ transactions: 1 });
      const hash = await computation.getTransactionNewStateHash(txf, 0);

      expect(hash).toBeDefined();
      expect(hash).toMatch(/^0000[a-f0-9]{60}$/);
    });

    it('should return stored newStateHash if already present', async () => {
      const txf = createTestToken({ transactions: 1 });
      txf.transactions[0].newStateHash = "0000aabbccdd";

      const hash = await computation.getTransactionNewStateHash(txf, 0);
      expect(hash).toBe("0000aabbccdd");
    });

    it('should return null for genesis-only token', async () => {
      const txf = createTestToken({ transactions: 0 });

      const hash = await computation.getTransactionNewStateHash(txf, 0);
      expect(hash).toBeNull();
    });

    it('should return null if SDK parsing fails', async () => {
      const txf = { genesis: { data: { tokenId: "bad" } } }; // Malformed

      const hash = await computation.getTransactionNewStateHash(txf as any, 0);
      expect(hash).toBeNull();
    });

    it('should cache results to avoid redundant computation', async () => {
      const txf = createTestToken({ transactions: 1 });
      const spy = vi.spyOn(Token, 'fromJSON');

      const hash1 = await computation.getTransactionNewStateHash(txf, 0);
      const hash2 = await computation.getTransactionNewStateHash(txf, 0);

      // Should only call SDK once due to caching
      expect(spy).toHaveBeenCalledTimes(1);
      expect(hash1).toBe(hash2);
    });
  });

  describe('findTransactionProducingState', () => {
    it('should find correct transaction by state hash', async () => {
      const txf = createTestToken({ transactions: 2 });
      const targetStateHash = "0000expectedhash";
      txf.transactions[1].newStateHash = targetStateHash;

      const result = await computation.findTransactionProducingState(txf, targetStateHash);

      expect(result?.txIndex).toBe(1);
      expect(result?.newStateHash).toBe(targetStateHash);
    });

    it('should return null if state not found', async () => {
      const txf = createTestToken({ transactions: 1 });

      const result = await computation.findTransactionProducingState(txf, "0000nonexistent");
      expect(result).toBeNull();
    });

    it('should compute missing newStateHash when searching', async () => {
      const txf = createTestToken({ transactions: 1 });
      // Don't set newStateHash - force computation
      txf.transactions[0].newStateHash = undefined;

      // Pre-compute so we know what to search for
      const expectedHash = await computation.getTransactionNewStateHash(txf, 0);

      // Now search for it
      const result = await computation.findTransactionProducingState(txf, expectedHash!);
      expect(result?.txIndex).toBe(0);
    });
  });

  describe('cache management', () => {
    it('should respect cache TTL', async () => {
      const txf = createTestToken({ transactions: 1 });
      const shortTTL = 100; // 100ms for testing
      computation.CACHE_TTL_MS = shortTTL;

      const hash1 = await computation.getTransactionNewStateHash(txf, 0);

      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(resolve, shortTTL + 50));

      // Clear and set new value to detect re-computation
      const hashData = computation.computationCache.get(txf.genesis.data.tokenId);
      expect(hashData).toBeDefined(); // Cached initially

      // After TTL, should recompute
      // (This would require exposing cache internals for proper testing)
    });

    it('should clear cache on demand', () => {
      // Pre-populate cache
      computation.computationCache.set("token1", [{
        newStateHash: "hash1",
        txIndex: 0,
        computedAt: Date.now(),
        sdkVerified: true,
      }]);

      computation.clearCache();

      expect(computation.computationCache.size).toBe(0);
    });
  });
});
```

### Integration Tests

**File**: `tests/integration/inventory-sync/tombstone-verification.test.ts` (MODIFY)

```typescript
describe('Tombstone Verification with Legacy Tokens', () => {
  it('should verify tombstone for token with missing newStateHash', async () => {
    const stateHashComputation = new StateHashComputation();
    const sentToken = createLegacyToken(); // Has missing newStateHash
    const sentEntry: SentTokenEntry = { token: sentToken, timestamp: Date.now(), spentAt: Date.now() };
    const tombstone: TombstoneEntry = {
      tokenId: sentToken.genesis.data.tokenId,
      stateHash: "0000expectedstate",
      timestamp: Date.now(),
    };

    const result = await findMatchingProofForTombstone(sentEntry, tombstone.stateHash, stateHashComputation);

    expect(result).toBeDefined();
    expect(result?.proof).toBeDefined();
    expect(result?.verifyStateHash).toBeDefined();
  });

  it('should fall back to aggregator if computation fails', async () => {
    const stateHashComputation = new StateHashComputation();
    // Make SDK unavailable
    vi.mock('@unicitylabs/state-transition-sdk/lib/token/Token', () => ({
      Token: { fromJSON: () => Promise.reject(new Error('SDK unavailable')) }
    }));

    const result = await findMatchingProofForTombstone(sentEntry, tombstone.stateHash, stateHashComputation);

    // Should still return result via fallback logic
    expect(result).toBeDefined();
  });
});
```

### Performance Tests

**File**: `tests/performance/state-hash-computation.bench.ts` (NEW)

```typescript
describe('StateHashComputation Performance', () => {
  it('should compute newStateHash in <100ms for single transaction', async () => {
    const txf = createTestToken({ transactions: 1 });
    const computation = new StateHashComputation();

    const start = performance.now();
    await computation.getTransactionNewStateHash(txf, 0);
    const duration = performance.now() - start;

    expect(duration).toBeLessThan(100);
  });

  it('should use cache for subsequent lookups (<1ms)', async () => {
    const txf = createTestToken({ transactions: 1 });
    const computation = new StateHashComputation();

    // First call: compute
    await computation.getTransactionNewStateHash(txf, 0);

    // Second call: cache hit
    const start = performance.now();
    await computation.getTransactionNewStateHash(txf, 0);
    const cachedDuration = performance.now() - start;

    expect(cachedDuration).toBeLessThan(1);
  });

  it('should process 50 tokens with tombstones in <5 seconds', async () => {
    const computation = new StateHashComputation();
    const tokens = Array.from({ length: 50 }, () => createLegacyToken());

    const start = performance.now();
    for (const token of tokens) {
      await computation.computeAllMissingNewStateHashes(token);
    }
    const duration = performance.now() - start;

    expect(duration).toBeLessThan(5000);
  });
});
```

---

## Backward Compatibility Checklist

- [ ] TxfTransaction interface unchanged (newStateHash still optional)
- [ ] Stored tokens unmodified (no data migration)
- [ ] Fallback to aggregator if computation fails
- [ ] Existing validation logic unaffected
- [ ] Cache cleared on address change/logout
- [ ] SDK import errors handled gracefully
- [ ] No breaking changes to public APIs

---

## Rollout Strategy

### Phase 1: Foundation (1 week)
1. Implement StateHashComputation utility
2. Write comprehensive unit tests
3. Code review and merge to `fix/token-transfer-ui-and-recovery`

### Phase 2: Integration (1 week)
1. Integrate with InventorySyncService
2. Add integration tests
3. Performance testing with 50+ token wallet
4. Stress testing (network failures, SDK unavailable)

### Phase 3: Validation (3-5 days)
1. Manual testing with legacy token imports
2. Performance benchmarking (before/after)
3. Monitor aggregator query reduction
4. User feedback on sync speed improvement

### Phase 4: Production Rollout (1 week)
1. Feature flag for legacy token computation (safe default: enabled)
2. Gradual rollout to 25% → 50% → 100% of users
3. Monitor logs for computation failures
4. Track cache hit rates and timing metrics

---

## Performance Expectations

### Current Behavior (Without Fix)
- 50 tokens with tombstones: ~25-50 seconds (50x aggregator queries @ 500-1000ms each)
- Network dependency: If aggregator slow/unavailable, sync blocked

### After Refactoring
- 50 tokens with tombstones: ~2-5 seconds (local computation)
- Network independent: Even if aggregator unavailable, sync continues
- Cache hit rate: >99% on second sync (same session)

### Metrics to Track
```typescript
{
  computationTime_ms: <duration of single newStateHash computation>,
  cacheHitRate: <percentage of cache hits vs. misses>,
  aggregatorQueriesAvoided: <count of queries that would have hit aggregator>,
  estimatedNetworkSavings_ms: <aggregatorQueriesAvoided * avg_aggregator_latency>,
  failureRate: <percentage of computations that fell back to aggregator>,
}
```

---

## Files Modified / Created

### New Files
1. `src/components/wallet/L3/services/StateHashComputation.ts` (400-500 lines)
2. `tests/unit/services/StateHashComputation.test.ts` (300-400 lines)
3. `tests/integration/inventory-sync/tombstone-verification.test.ts` (200-300 lines)
4. `tests/performance/state-hash-computation.bench.ts` (100-150 lines)

### Modified Files
1. `src/components/wallet/L3/services/InventorySyncService.ts`
   - `findMatchingProofForTombstone()`: Add computation parameter
   - `step3_categorizeTokens()`: Compute newStateHash for validation
   - `step7_verifyTombstones()`: Pass computation instance

2. `src/components/wallet/L3/services/TokenValidationService.ts`
   - `isPendingTransactionSubmittable()`: Attempt computation before falling back
   - Constructor: Optional StateHashComputation parameter

3. `src/components/wallet/L3/services/TxfSerializer.ts`
   - Add utility function: `hasMissingNewStateHashOnTransaction(txf, txIndex): boolean`
   - Update `repairMissingStateHash()`: Leverage StateHashComputation

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| SDK unavailable | Low | Medium | Graceful fallback to aggregator |
| Computation slower than aggregator | Low | Low | Caching + performance tests |
| Cache invalidation issues | Low | Medium | Clear on address change, TTL-based expiry |
| Breaking changes | Very Low | High | Full backward compatibility, interface unchanged |
| Computation diverges from SDK | Low | High | Use exact SDK methods, extensive testing |

---

## Success Criteria

- [ ] All unit tests pass (>95% coverage)
- [ ] Integration tests pass with legacy token imports
- [ ] Performance tests show <5% improvement in sync time for 50 token wallet
- [ ] Zero aggregator query failures due to computation errors
- [ ] No increase in memory usage (caching reasonably bounded)
- [ ] Feature works with SDK v1.6.0+ (current and future versions)
- [ ] User sync time improved from 30-60s to 5-15s for typical wallet

---

## Future Optimizations

1. **Binary Search**: Instead of checking all transactions, binary search for target state
2. **Parallel Computation**: Use Promise.all() for multi-transaction computation
3. **Incremental Repair**: Repair missing newStateHash during IPFS sync export
4. **Streaming Verification**: Verify tombstones as they arrive instead of in batch
5. **Smart Caching**: Persist computation cache to IndexedDB for cross-session reuse
