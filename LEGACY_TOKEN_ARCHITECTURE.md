# Legacy Token newStateHash - Architecture & Flow Diagrams

## System Architecture

### Current (Broken) Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     Inventory Sync                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Step 7: Verify Tombstones                                      │
│  ├─ for each tombstone:                                          │
│  │  └─ findMatchingProofForTombstone(sentEntry, stateHash)      │
│  │                                                              │
│  │     ❌ BROKEN: tx.newStateHash === stateHash                 │
│  │     └─ For legacy tokens: undefined !== stateHash (always!)  │
│  │                                                              │
│  │     Falls back to:                                           │
│  │     └─ Aggregator query (500-1000ms per token)               │
│  │        └─ Network dependent                                  │
│  │        └─ Slow for 50+ tokens (25-50 seconds total)          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Proposed (Fixed) Flow

```
┌──────────────────────────────────────────────────────────────────┐
│                     Inventory Sync                               │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  Create: stateHashComputation = new StateHashComputation()       │
│                                                                   │
│  Step 3: Validate Token Chain                                    │
│  ├─ for each token:                                               │
│  │  └─ if missing newStateHash:                                  │
│  │     └─ computed = stateHashComputation.get(token, txIndex)   │
│  │        └─ cached result or SDK computation (< 100ms)         │
│  │                                                              │
│  Step 7: Verify Tombstones                                      │
│  ├─ for each tombstone:                                          │
│  │  └─ findMatchingProofForTombstone(                            │
│  │       sentEntry,                                             │
│  │       stateHash,                                             │
│  │       stateHashComputation  // ← NEW                         │
│  │     )                                                        │
│  │                                                              │
│  │     ✓ FIXED: tx.newStateHash === stateHash                   │
│  │     ├─ Check stored: if present, use immediately            │
│  │     └─ Compute: if missing, get from cache/computation      │
│  │        └─ Local verification (< 100ms per token)             │
│  │        └─ Network independent                                │
│  │        └─ Fast for 50+ tokens (2-5 seconds total)            │
│  │                                                              │
│  Cleanup: stateHashComputation.clearCache()                      │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

---

## Data Flow Diagram: Tombstone Verification

```
┌─────────────────────────────────────────────────────────────────────┐
│                        TOMBSTONE ENTRY                              │
│  { tokenId, stateHash: "0000xyz...", timestamp }                   │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │ SENT FOLDER     │
                    │ (has proofs)    │
                    │ for this token  │
                    └────────┬────────┘
                             │
                 ┌───────────┴───────────┐
                 ▼                       ▼
        ┌──────────────────┐   ┌─────────────────────────┐
        │ Store newStateHash   │ Missing newStateHash   │
        │ (new tokens)      │   │ (legacy tokens)       │
        │                  │   │                       │
        │ Direct check:    │   │ Computation flow:     │
        │ if tx.newState   │   │ 1. stateHashComp.get()│
        │ Hash ===         │   │    .getTransaction    │
        │ tombstone →      │   │    NewStateHash()     │
        │ MATCH ✓          │   │                       │
        │                  │   │ 2. Check cache        │
        └──────────────────┘   │    ├─ Hit? Use (1ms)  │
                               │    └─ Miss?           │
                               │                       │
                               └──────┬────────────────┘
                                      │
                          ┌───────────┴──────────┐
                          ▼                      ▼
                   ┌─────────────┐      ┌──────────────────┐
                   │ Cache Hit   │      │ SDK Computation  │
                   │ <1ms        │      │ Token.fromJSON() │
                   │             │      │ .state.calcHash()│
                   │ Return:     │      │ ~50-100ms        │
                   │ newStateHash│      │                  │
                   └────┬────────┘      │ Cache result     │
                        │              └──────┬───────────┘
                        │                      │
                        └──────────┬───────────┘
                                   ▼
                           ┌────────────────────┐
                           │ newStateHash value │
                           │ (computed/cached)  │
                           └────────┬───────────┘
                                    │
                                    ▼
                    ┌──────────────────────────────┐
                    │ Compare with tombstoneHash   │
                    │ if computed ===              │
                    │ tombstoneStateHash           │
                    │ → MATCH FOUND ✓              │
                    └──────────┬───────────────────┘
                               │
                               ▼
                    ┌──────────────────────────────┐
                    │ Use proof from Sent folder   │
                    │ for local verification       │
                    │ (no aggregator query needed) │
                    └──────────────────────────────┘
```

---

## Component Interaction Diagram

```
InventorySyncService (Main Flow)
│
├─ Creates ┐
│          └─▶ StateHashComputation (NEW)
│             │
│             ├─ getTransactionNewStateHash()
│             │  ├─ Check stored tx.newStateHash (fast path)
│             │  └─ Compute via SDK if missing (slow path, cached)
│             │
│             ├─ findTransactionProducingState()
│             │  ├─ Get all computed hashes
│             │  └─ Search for match
│             │
│             └─ clearCache()
│
├─ Step 3: Validate Token Chain
│  │
│  └─▶ (Optional) Compute newStateHash for validation
│      └─▶ StateHashComputation.getTransactionNewStateHash()
│
├─ Step 7: Verify Tombstones
│  │
│  └─▶ for each Tombstone
│      │
│      └─▶ findMatchingProofForTombstone(
│          sentEntry,
│          tombstoneStateHash,
│          stateHashComputation  // ← Key integration point
│      )
│      │
│      ├─ Check stored newStateHash first
│      │
│      └─ If missing:
│         └─▶ StateHashComputation.getTransactionNewStateHash()
│            ├─ Cache hit: return in <1ms
│            └─ Cache miss: SDK compute in <100ms
│
└─ End: Cleanup
   └─▶ stateHashComputation.clearCache()


TokenValidationService
│
├─ isPendingTransactionSubmittable()
│  │
│  ├─ Check pending transaction's source state
│  │
│  ├─ Need previous tx's newStateHash
│  │  ├─ Check stored field
│  │  │
│  │  └─ If missing (optional param):
│  │     └─▶ StateHashComputation.getTransactionNewStateHash()
│  │
│  └─ Verify source state not spent
│     └─ Query aggregator (only if newStateHash available)
│
└─ (Future) Could accept StateHashComputation in constructor
```

---

## Cache Architecture

```
StateHashComputation Instance
│
└─ computationCache
   │
   │  Key: tokenId (64-char hex)
   │  Value: StateHashComputationResult[]
   │
   │  [
   │    {
   │      newStateHash: "0000abc...",    // Computed value
   │      txIndex: 0,                     // Which tx produced it
   │      computedAt: 1234567890,        // Cache timestamp
   │      sdkVerified: true              // Computation succeeded
   │    },
   │    {
   │      newStateHash: "0000def...",
   │      txIndex: 1,
   │      computedAt: 1234567890,
   │      sdkVerified: true
   │    }
   │  ]
   │
   └─ Cache Lifecycle
      ├─ Created: When getTransactionNewStateHash() first called
      ├─ Reused: Subsequent calls within TTL (1 hour) hit cache
      ├─ Expired: After 1 hour, cache cleared on next access
      └─ Cleared: On address change/logout via clearCache()
```

---

## State Machine: Token Verification with Legacy Support

```
┌──────────────────────────────────────────────────────────────────────┐
│                      TOKEN VERIFICATION FLOW                         │
└──────────────────────────────────────────────────────────────────────┘

START: Token received from IPFS
│
▼
┌─────────────────────────────────┐
│ Does tx have newStateHash?      │
└─────────────────────────────────┘
│
├─ YES: Use stored value ──────────────┐
│                                       │
└─ NO: Enter computation flow          │
   │                                   │
   ▼                                   │
   ┌─────────────────────────────┐     │
   │ Is computation available?   │     │
   └─────────────────────────────┘     │
   │                                   │
   ├─ YES: Try to compute ───┐         │
   │                         │         │
   │ ┌──────────────────────┐│         │
   │ │ Check cache first    ││         │
   │ └──────────────────────┘│         │
   │    │                     │         │
   │    ├─ Hit? Return ────┐  │         │
   │    │                  │  │         │
   │    └─ Miss?           │  │         │
   │       │               │  │         │
   │       ▼               │  │         │
   │    ┌──────────────────┐  │         │
   │    │ SDK parse token  │  │         │
   │    │ + compute hash   │  │         │
   │    └──────────────────┘  │         │
   │       │                  │         │
   │       ├─ Success?        │         │
   │       │  └─ Cache + return│        │
   │       │                  │         │
   │       └─ Error?          │         │
   │          └─ Return null  │         │
   │                          │         │
   └─ NO: Fallback to null ──┘         │
                                        │
                           ┌────────────┘
                           │
                           ▼
          ┌────────────────────────────┐
          │ Have newStateHash value?   │
          └────────────────────────────┘
          │
          ├─ YES: Use for matching/comparison
          │        └─ ✓ Tombstone verification OK
          │        └─ ✓ State chain validation OK
          │        └─ ✓ Pending tx verification OK
          │
          └─ NO: Cannot verify, fallback
                 └─ Aggregator query
                 └─ Or mark as RETRY_LATER
```

---

## Performance Comparison

### Before (Without Fix)

```
50 tokens with tombstones:
├─ Each tombstone verification:
│  └─ Network query to aggregator: 500-1000ms
│
└─ Total: 50 × ~750ms = 37.5 seconds

Network dependent:
├─ Aggregator slow: Could reach 1-2 minutes
├─ Network timeout: Verification fails entirely
└─ Fallback to aggregator every time
```

### After (With Fix)

```
50 tokens with tombstones:
├─ Session 1 (cold):
│  ├─ First token: SDK computation ~100ms
│  ├─ Remaining 49: Cache hits ~1ms each
│  └─ Total: 100 + (49 × 1) ≈ 150ms (99.5% speedup)
│
├─ Session 2+ (warm):
│  ├─ All tokens: Cache hits ~1ms each
│  └─ Total: 50ms (99.9% speedup)

Network independent:
├─ Works offline (cache only)
├─ Aggregator availability doesn't affect local verification
└─ Graceful fallback only if SDK unavailable
```

### Memory Impact

```
StateHashComputation Cache:
├─ Per token: ~100 bytes (64-char hex string + metadata)
├─ For 50 tokens: ~5KB
├─ Cache TTL: 1 hour
└─ Cleared on address change
```

---

## Error Handling Flow

```
┌──────────────────────────────────────────────────┐
│ Attempt: Compute newStateHash                    │
└──────────────────────────────────────────────────┘
│
├─ SDK Import Fails
│  │
│  ├─ Log warning
│  │
│  └─ Return null ─────────────────┐
│                                   │
├─ SDK Parse Fails                  │
│  │                                │
│  ├─ Log warning (token malformed) │
│  │                                │
│  └─ Return null ─────────────────┤
│                                   │
├─ Hash Calculation Fails           │
│  │                                │
│  ├─ Log error                     │
│  │                                │
│  └─ Return null ─────────────────┤
│                                   │
└─ Other Unexpected Error           │
   │                                │
   ├─ Log warning + stack trace     │
   │                                │
   └─ Return null ─────────────────┘
                                    │
                                    ▼
                        ┌──────────────────────────┐
                        │ Caller receives: null    │
                        └──────────────────────────┘
                        │
                        ├─ Skip computation path ──┐
                        │                          │
                        └─ Use fallback logic      │
                           ├─ Check stored value
                           ├─ Check other proofs
                           └─ Aggregator query (if needed)
                              │
                              └─ Graceful degradation:
                                 Slower but still works ✓
```

---

## Integration Points

### 1. InventorySyncService

```typescript
// BEFORE:
findMatchingProofForTombstone(sentEntry, stateHash)

// AFTER:
findMatchingProofForTombstone(sentEntry, stateHash, stateHashComputation)
```

**Call Site**: `step7_verifyTombstones()`

```typescript
const stateHashComputation = new StateHashComputation();
// ... use in tombstone verification ...
stateHashComputation.clearCache();
```

### 2. TokenValidationService

```typescript
// BEFORE:
isPendingTransactionSubmittable(token, pendingTxIndex)

// AFTER (optional param):
isPendingTransactionSubmittable(token, pendingTxIndex, stateHashComputation?)
```

**Call Site**: Any validation that checks pending transaction status

### 3. TxfSerializer (Future Enhancement)

```typescript
// Could use StateHashComputation in repairMissingStateHash()
// Current: Uses SDK directly
// Future: Could cache results via StateHashComputation

repairMissingStateHash(txf)
 └─ Uses SDK to compute
 └─ Could eventually leverage StateHashComputation cache
```

---

## Decision Points

### When to Use StateHashComputation?

```
1. REQUIRED:
   ├─ Tombstone verification (findMatchingProofForTombstone)
   └─ State chain validation in Step 3

2. OPTIONAL:
   ├─ Pending transaction validation (isPendingTransactionSubmittable)
   └─ Other verification logic that needs newStateHash

3. NOT NEEDED:
   ├─ Tokens with stored newStateHash (direct check)
   ├─ Genesis-only tokens (no transactions)
   └─ API responses from aggregator (already has hashes)
```

### When to Compute vs. Fall Back?

```
├─ COMPUTE if:
│  ├─ Legacy token (newStateHash missing)
│  ├─ SDK available
│  └─ Performance critical (tombstone matching)
│
└─ FALL BACK if:
   ├─ Computation fails
   ├─ Stored value available
   └─ Can fallback to aggregator query
```

---

## Deployment Checklist

- [ ] StateHashComputation class implemented and tested
- [ ] InventorySyncService integration complete
- [ ] TokenValidationService integration complete
- [ ] All unit tests pass (>95% coverage)
- [ ] Integration tests pass with legacy tokens
- [ ] Performance tests show <5s for 50+ token wallet
- [ ] Error handling tested (SDK unavailable, malformed tokens)
- [ ] Memory impact acceptable (<10KB for typical wallet)
- [ ] Documentation updated
- [ ] Code reviewed and approved
- [ ] Deployed to dev environment
- [ ] User testing with real legacy tokens
- [ ] Monitoring in place for computation failures
- [ ] Production rollout with feature flag

