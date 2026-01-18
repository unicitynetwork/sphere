# IpfsStorageService Refactoring - Risk Analysis & Edge Cases

---

## Risk Matrix

### High Priority (Must Mitigate)

#### Risk 1: Data Loss During Merge

**Description**: Existing `importRemoteData()` has sanity checks (missing token detection, tombstone validation) that prevent data loss. If these are not replicated in InventorySyncService, tokens could be silently dropped.

**Impact**: Lost tokens irretrievable (data loss)

**Likelihood**: Medium (if Step 5/7 validation skipped)

**Mitigation**:
- ✓ InventorySyncService Step 4 validates commitments
- ✓ InventorySyncService Step 5 validates tokens against SDK
- ✓ InventorySyncService Step 7 detects spent tokens
- ✓ Add explicit test: "import removes no unspent tokens"
- ✓ Monitor: Validate token count before/after sync

**Acceptance Criteria**:
- All tokens present in local or remote appear in merged inventory
- Spent tokens correctly identified and moved to Sent folder
- Tombstone processing never removes unspent tokens

---

#### Risk 2: IPNS Downgrade Attack (Older Device Wins)

**Description**: If Device A publishes sequence N+1, then Device B (offline) publishes sequence N, the network could end up serving Device B's stale content.

**Current Code**: IpfsStorageService.publishToIpns() handles this with:
- Tracks `lastKnownRemoteSequence` from gateways
- Uses `max(localSeq, lastKnownRemoteSequence) + 1`

**Risk in Refactoring**: If IpfsTransport loses this logic, could regress.

**Impact**: Other devices see stale token inventory (data loss/corruption)

**Likelihood**: Low (code logic stays same)

**Mitigation**:
- ✓ Keep sequence number tracking in IpfsStorageService
- ✓ Document sequence increment logic in IpfsTransport.publishIpns()
- ✓ Add test: "publish with higher local sequence always wins"
- ✓ Monitor: Check IPNS sequence numbers in metrics

**Acceptance Criteria**:
- Sequence numbers strictly increase
- Device with lower sequence can't downgrade IPNS
- Late-arriving high sequences trigger merge

---

#### Risk 3: Race Condition Between Two Syncs

**Description**: If Device A syncs at T1 (pushes version 5) and Device B syncs at T2 (before seeing version 5), Device B might push version 5 with different content, causing divergence.

**Current Code**:
- SyncQueue serializes syncs (one at a time)
- SyncCoordinator prevents cross-tab races

**Risk in Refactoring**: If sync queue changes, could have concurrent syncs

**Impact**: IPNS points to incorrect content, merge failures

**Likelihood**: Low (SyncQueue stays unchanged)

**Mitigation**:
- ✓ Keep SyncQueue (NOT part of refactoring)
- ✓ Add explicit test: "concurrent syncs are serialized"
- ✓ Monitor: Check for concurrent sync attempts

**Acceptance Criteria**:
- SyncQueue.enqueue() always processes one at a time
- `this.isSyncing` flag prevents concurrent execution
- CID unchanged → no republish (optimization still works)

---

### Medium Priority (Should Mitigate)

#### Risk 4: IPFS Upload Timeout

**Description**: Gateway upload might timeout, leaving orphaned CID on IPFS but not published to IPNS.

**Current Code**: IpfsStorageService.executeSyncInternal():
- Accepts upload if ANY gateway succeeds
- Marks as `ipnsPublishPending` if publish fails
- Retries IPNS publish in background

**Risk in Refactoring**: If upload method doesn't handle partial failures, could lose sync

**Impact**: Sync incomplete, manual recovery needed

**Likelihood**: Medium (network timeouts happen)

**Mitigation**:
- ✓ IpfsTransport.uploadContent() handles partial failures
- ✓ Returns success if ≥1 gateway accepts
- ✓ InventorySyncService only publishes if upload succeeds
- ✓ Background retry loop in IpfsStorageService.publishIpns()
- ✓ Monitor: Track upload timeout frequency

**Acceptance Criteria**:
- Timeout on 1 gateway doesn't fail if another succeeds
- Partial uploads are re-attempted with exponential backoff
- CID is consistent across attempts

---

#### Risk 5: IPNS Record Verification Fails

**Description**: HTTP publish returns 200 OK, but actual record not written (gateway memory-only). Verification check catches this, but then publish is considered failed.

**Current Code**: IpfsStorageService.publishToIpns():
- Publishes via HTTP
- Verifies record exists with 3 retries
- On failure, starts background retry loop

**Risk in Refactoring**: If verification removed, could publish incomplete

**Impact**: Other devices can't resolve IPNS (sync blocked)

**Likelihood**: Low (verification code stays same)

**Mitigation**:
- ✓ Keep HTTP verification in IpfsTransport
- ✓ Start retry loop if verification fails
- ✓ Monitor: Track verification failures per gateway
- ✓ Add fallback: Retry to different gateway if primary fails

**Acceptance Criteria**:
- Verification confirms CID matches IPNS
- Retry loop persists until verification succeeds
- Timeout after 30s per attempt

---

### Low Priority (Nice to Have)

#### Risk 6: InventorySyncService Doesn't Validate All Checks

**Description**: IpfsStorageService has 60% missing validation (commitment, SDK, spent detection). If not added to InventorySyncService, tokens could be invalid.

**Impact**: Invalid tokens in inventory (low severity as UI filters them)

**Likelihood**: High (but already documented as gap)

**Mitigation**:
- ✓ InventorySyncService Steps 4, 5, 7 implement this
- ✓ Validation is REQUIRED in 10-step flow
- ✓ Non-optional (throw if any step fails)
- ✓ Tests verify validation runs

**Acceptance Criteria**:
- Step 4 validates commitment format and structure
- Step 5 validates against SDK (cryptographic proof)
- Step 7 detects spent tokens against aggregator

---

#### Risk 7: Backward Compatibility Breaks

**Description**: External code might call deleted methods like `importRemoteData()`, causing runtime errors.

**Impact**: Compile errors or runtime failures for external code

**Likelihood**: Low (methods are private/internal)

**Mitigation**:
- ✓ Keep backward compatibility wrapper for syncNow()
- ✓ Deprecation warnings in old methods
- ✓ Search codebase for callers of deleted methods
- ✓ Update all callers before deleting

**Acceptance Criteria**:
- All public API continues to work
- Private methods can be deleted without impact
- Deprecation warnings guide users to new API

---

## Edge Cases & Test Scenarios

### Edge Case 1: Fresh Wallet (No IPNS Record)

**Scenario**: New wallet, nothing on IPNS yet, first sync

**Current behavior**:
```
IPNS resolution → no CID found
Local version = 0
Upload local state to IPFS
Publish to IPNS for first time
Result: SUCCESS
```

**Testing**:
```typescript
it('first sync of new wallet succeeds', async () => {
  const result = await inventorySync({
    address: 'new_wallet',
    publicKey: 'xxx',
    ipnsName: 'k51...',  // New IPNS name
  });
  expect(result.status).toBe('SUCCESS');
  expect(result.version).toBe(1);
  expect(result.lastCid).toBeDefined();
});
```

**Risk**: None (normal case)

---

### Edge Case 2: Remote Newer Than Local

**Scenario**: Device A has v1, Device B published v3, now Device A syncs

**Current behavior**:
```
Step 2: Resolve IPNS → CID for v3
Step 2: Fetch remote data → v3 tokens
Compare versions: remote(3) > local(1)
Step 2: Import remote tokens
Step 10: Upload → v3 → publish
Result: SUCCESS (now at v3)
```

**Vulnerability**:
- If remote tokens are invalid (Step 4 fails), they still get imported!
- **Fix**: Add Step 4 validation AFTER Step 2 import

**Testing**:
```typescript
it('rejects invalid tokens from remote on import', async () => {
  const remoteData = {
    _meta: { version: 5 },
    [tokenKey]: {
      genesis: { inclusionProof: null }  // INVALID!
    }
  };

  const result = await inventorySync({
    address: 'test',
    incomingTokens: [/* empty */]
  });

  // Should reject invalid token from remote
  expect(result.operationStats?.tokensRemoved).toBeGreaterThan(0);
});
```

---

### Edge Case 3: Local Newer Than Remote (Boomerang)

**Scenario**: Device A has v5, Device B (which also has v5) synced and got new token, now Device A syncs

**Current behavior**:
```
Step 2: Resolve IPNS → CID for v5 (same as local!)
Step 2: Fetch remote → v5 tokens (includes new token!)
Compare versions: local(5) == remote(5), but content differs
Step 2: Merge differences
Step 10: Upload → v6
Result: SUCCESS (now at v6)
```

**Vulnerability**:
- `localDiffersFromRemote()` might miss token splits or state changes
- **Fix**: Use Step 6 deduplication to ensure idempotency

**Testing**:
```typescript
it('merges new tokens from same-version remote', async () => {
  const localTokens = [{ id: 'token1', ... }];
  const remoteTokens = [
    { id: 'token1', ... },
    { id: 'token2_new', ... }  // New on remote
  ];

  const result = await inventorySync({
    address: 'test',
    incomingTokens: localTokens
  });

  // Should have 2 tokens after merge
  expect(result.inventoryStats?.activeTokens).toBe(2);
});
```

---

### Edge Case 4: Network Failure During Upload

**Scenario**: All gateways timeout during upload

**Current behavior**:
```
Step 10: upload() → all gateways fail → return { success: false }
Step 10: Don't publish IPNS
Return with error
Next sync: Retry upload
```

**Vulnerability**:
- If upload succeeds on ONE gateway but others timeout, we publish?
- **Current code handles this**: Accepts if ANY succeed

**Testing**:
```typescript
it('upload succeeds if any gateway responds', async () => {
  // Mock Gateway A: success
  // Mock Gateway B: timeout

  const result = await transport.uploadContent(data);
  expect(result.success).toBe(true);  // One success is enough
});

it('upload fails only if ALL gateways fail', async () => {
  // Mock all gateways: timeout

  const result = await transport.uploadContent(data);
  expect(result.success).toBe(false);
  expect(result.error).toBeDefined();
});
```

---

### Edge Case 5: Spent Token Detected During Sync

**Scenario**: Device A has token, sends it, local doesn't know yet, Device A re-syncs

**Current behavior** (IpfsStorageService):
```
Step 2: Import remote data
sanityCheckTombstones(): Verify tombstone against Unicity
If tombstone is invalid, don't apply it
Later: runSpentTokenSanityCheck() double-checks all tokens
```

**New behavior** (InventorySyncService):
```
Step 2: Import remote data (may include tombstones from other device)
Step 7: checkSpentTokens() against aggregator
If spent, move to Sent folder and add tombstone
```

**Vulnerability**:
- Different ordering of checks!
- **Fix**: Ensure both approaches validate against aggregator

**Testing**:
```typescript
it('detects spent tokens during sync', async () => {
  // Mock: Aggregator says token is SPENT
  // Local: Still has token in active

  const result = await inventorySync({
    address: 'test',
    incomingTokens: [spentToken]
  });

  // Should detect and move to Sent
  expect(result.operationStats?.tokensRemoved).toBeGreaterThan(0);
  expect(result.inventoryStats?.sentTokens).toBeGreaterThan(0);
});
```

---

### Edge Case 6: Concurrent Syncs (Multiple Tabs)

**Scenario**: Tab A and Tab B both call `sync()` at same time

**Current behavior**:
```
SyncQueue.enqueue() in Tab A → wait for executor
SyncQueue.enqueue() in Tab B → wait in queue
Tab A executes sync (lock acquired)
Tab B waits until Tab A completes
Result: Serialized, no race condition
```

**Vulnerability**:
- If SyncQueue doesn't properly serialize, could have concurrent syncs!
- **Current code**: SyncQueue handles this correctly

**Testing**:
```typescript
it('prevents concurrent syncs in same tab', async () => {
  const promise1 = transport.uploadContent(data1);
  const promise2 = transport.uploadContent(data2);

  // Both in flight, but only one should succeed
  const results = await Promise.all([promise1, promise2]);
  const successCount = results.filter(r => r.success).length;

  expect(successCount).toBe(1);  // Only one uploads
});
```

---

### Edge Case 7: IPNS Sequence Number Conflict

**Scenario**: Two devices (A and B) both publish with same sequence number due to clock skew or race condition

**Current behavior**:
```
Device A publishes seq=100, CID=A
Device B publishes seq=100, CID=B
IPNS resolves to first one it sees: could be either
```

**Vulnerability**:
- **IpfsStorageService.publishToIpns()** handles this:
  - Uses `max(localSeq, lastKnownRemoteSeq) + 1`
  - Ensures strict increment
  - No ties possible

**Testing**:
```typescript
it('ensures sequence numbers strictly increment', async () => {
  // Simulate: lastKnownRemoteSequence = 100
  // Publish attempt 1: uses 101
  // Publish attempt 2: uses 102 (not 101 again)

  const result1 = await transport.publishIpns('cid1');
  const result2 = await transport.publishIpns('cid2');

  // Second publish should have higher sequence
  expect(result2.success).toBe(true);
});
```

---

### Edge Case 8: Genesis-Only Tokens (Never Transferred)

**Scenario**: Token created locally but never transferred (no transactions, no state hash)

**Current behavior** (IpfsStorageService.importRemoteData):
```
Check if token is genesis-only (no transactions)
If so, compute stateHash using SDK
Patch token with computed stateHash
Store in inventory
```

**New behavior** (InventorySyncService):
```
Step 3: Normalize proofs
Step 4: Validate commitments
  - Genesis-only tokens might have undefined stateHash
  - Should still be valid
Step 5: Validate with SDK
Step 6: Deduplicate (should have only one state per tokenId)
```

**Vulnerability**:
- Step 3/4 might reject genesis-only tokens as "missing stateHash"
- **Fix**: Handle genesis-only case explicitly

**Testing**:
```typescript
it('accepts genesis-only tokens (no transactions)', async () => {
  const genesisOnlyToken = {
    genesis: {
      data: { tokenId: 'xxx' },
      inclusionProof: { ... }
    },
    transactions: []  // EMPTY - no transfers yet
  };

  const result = await inventorySync({
    incomingTokens: [genesisOnlyToken]
  });

  expect(result.operationStats?.tokensValidated).toBeGreaterThan(0);
});
```

---

### Edge Case 9: Tombstone Applies But Token Unspent

**Scenario**: Remote sends tombstone for token, but Unicity says token is NOT spent

**Current behavior** (IpfsStorageService):
```
sanityCheckTombstones():
  Check if token actually spent on Unicity
  If unspent, REJECT tombstone and restore token
```

**New behavior** (InventorySyncService):
```
Step 7: Merge tombstones
Step 7: checkSpentTokens() against Unicity
  If token is NOT spent, create a new entry (don't remove)
```

**Vulnerability**:
- **These are DIFFERENT!**
- IpfsStorageService preventively rejects bad tombstones
- InventorySyncService applies them then re-checks
- **Fix**: Ensure Step 7 validation properly restores unspent tokens

**Testing**:
```typescript
it('restores tokens if tombstone validation fails', async () => {
  // Mock: Aggregator says token is UNSPENT
  // Remote: Sent tombstone saying it's SPENT

  const result = await inventorySync({
    address: 'test',
    incomingTokens: [validToken]
  });

  // Token should still be active (not removed by false tombstone)
  expect(result.inventoryStats?.activeTokens).toBeGreaterThan(0);
});
```

---

### Edge Case 10: Missing StateHash on Imported Token

**Scenario**: Old token from version 1.x wallet missing `newStateHash` field on transactions

**Current behavior** (IpfsStorageService.importRemoteData):
```
if (hasMissingNewStateHash(remoteTxf)) {
  repairedTxf = await repairMissingStateHash(remoteTxf)
  stateHash = getCurrentStateHash(repairedTxf)
}
```

**New behavior** (InventorySyncService):
```
Step 2: Load token as-is
Step 3: Normalize proofs (but NOT state hashes)
Step 4: Validate commitments (need stateHash!)
  - If missing, fails validation?
```

**Vulnerability**:
- **InventorySyncService doesn't have repair logic!**
- **Fix**: Add repair logic to Step 2 or Step 3

**Testing**:
```typescript
it('repairs tokens with missing newStateHash', async () => {
  const oldToken = {
    genesis: { ... },
    transactions: [
      {
        inclusionProof: { ... },
        // MISSING: newStateHash
      }
    ]
  };

  const result = await inventorySync({
    incomingTokens: [oldToken]
  });

  expect(result.operationStats?.tokensValidated).toBeGreaterThan(0);
});
```

---

## Validation Checklist

Before removing old code, verify:

- [ ] All edge cases have integration tests
- [ ] All edge cases pass with InventorySyncService
- [ ] All edge cases pass with IpfsTransport
- [ ] Step 4 commitment validation catches missing proofs
- [ ] Step 5 SDK validation catches cryptographic failures
- [ ] Step 7 spent detection matches IpfsStorageService.sanityCheckMissingTokens()
- [ ] IPNS sequence number increment is correct
- [ ] SyncQueue still serializes syncs
- [ ] Genesis-only tokens are handled
- [ ] Tombstone validation works (unspent tokens not removed)
- [ ] Missing stateHash is repaired
- [ ] Partial uploads still succeed (any gateway success)
- [ ] IPNS verify-after-publish still works
- [ ] Retry loop starts on verify failure
- [ ] Backward compatibility wrapper works
- [ ] No deleted code is called anywhere else

