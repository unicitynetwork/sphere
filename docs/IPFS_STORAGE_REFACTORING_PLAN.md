# IpfsStorageService Refactoring Plan

**Status**: Planning Phase
**Date**: 2026-01-18
**Goal**: Transform IpfsStorageService from hybrid orchestrator+transport into pure IPFS transport layer

## Executive Summary

IpfsStorageService currently combines two distinct responsibilities:
1. **IPFS Transport** (low-level network operations)
2. **Sync Orchestration** (token validation, merging, workflow control)

This violates single responsibility principle and creates 40-60% code duplication with the newly-created InventorySyncService. The refactoring will extract transport operations into a clean API that InventorySyncService can call, eliminating duplication and allowing independent testing.

**Key Impact:**
- Reduces IpfsStorageService from ~4000 lines to ~2000 lines (50% reduction)
- Eliminates 40% duplicated code in sync orchestration
- Enables 60% of missing validation checks from InventorySyncService to be applied
- Creates testable, modular transport layer

---

## Current State Analysis

### IpfsStorageService Scope (45KB file)

**PURE TRANSPORT** (to keep):
- Helia initialization and lifecycle (~300 lines)
- Connection gater & peer management (~200 lines)
- IPNS publishing (HTTP + DHT) (~400 lines)
- IPNS polling & resolution (~600 lines)
- IPFS content upload (HTTP to gateways) (~200 lines)
- IPFS content fetch (HTTP resolver) (~300 lines)

**SYNC ORCHESTRATION** (to remove):
- `importRemoteData()` (~330 lines) - Handles token merging, validation, comparison
- `syncFromIpns()` (~250 lines) - Orchestrates IPNS resolution + local/remote comparison
- `executeSyncInternal()` (~1000+ lines) - Main sync pipeline
- Helper methods: `compareTokenVersions()`, `localDiffersFromRemote()`, `sanityCheckMissingTokens()`, etc.

**DUPLICATE CODE vs InventorySyncService:**

| Operation | InventorySyncService | IpfsStorageService | Overlap |
|-----------|----------------------|-------------------|---------|
| Load localStorage | Step 1 (structured) | implicit in syncNow | 20% |
| Load IPFS | Step 2 (structured) | implicit in syncNow | 40% |
| Token merging | Steps 2,6,8 (3 passes) | importRemoteData() | 40% |
| Proof normalization | Step 3 (explicit) | implicit (no-op) | MISSING in IpfsStorageService |
| Commitment validation | Step 4 (full checks) | implicit (no-op) | **CRITICAL GAP** |
| SDK validation | Step 5 (full checks) | implicit (no-op) | **CRITICAL GAP** |
| Deduplication | Step 6 (explicit) | importRemoteData() | 30% |
| Spent detection | Step 7 (SDK checks) | sanityCheckMissingTokens (partial) | **CRITICAL GAP** |
| Tombstone processing | Step 8 (structured) | mergeTombstones() | 50% |
| Storage prep | Step 9 (explicit) | buildTxfStorageData() | 20% |
| IPNS publish | Step 10 (explicit) | publishToIpns() | 100% match |

---

## Refactoring Strategy

### Phase 1: Define Transport API

Create a clean interface for IpfsStorageService that InventorySyncService will call:

```typescript
// IpfsTransport.ts - New interface
export interface IpfsTransport {
  // Initialization
  ensureInitialized(): Promise<boolean>;

  // IPNS Resolution (Step 2)
  resolveIpns(): Promise<{ cid: string | null; sequence: bigint; content?: TxfStorageData }>;

  // IPFS Content Fetch (Step 2)
  fetchContent(cid: string): Promise<TxfStorageData | null>;

  // IPFS Content Upload (Step 10)
  uploadContent(data: TxfStorageData): Promise<{ cid: string; success: boolean }>;

  // IPNS Publishing (Step 10)
  publishIpns(cid: string): Promise<{ ipnsName: string | null; success: boolean }>;

  // Version tracking
  getVersionCounter(): number;
  setVersionCounter(version: number): void;
  getLastCid(): string | null;
  setLastCid(cid: string): void;
}
```

### Phase 2: Remove Sync Orchestration from IpfsStorageService

**Methods to DELETE:**
- `importRemoteData()` - Replaced by InventorySyncService orchestration
- `syncFromIpns()` - Replaced by inventory sync flow
- `executeSyncInternal()` - Replaced by inventory sync flow
- `sanityCheckMissingTokens()` - Replaced by InventorySyncService token validation
- `sanityCheckTombstones()` - Replaced by InventorySyncService Step 7
- `compareTokenVersions()` - Replaced by shouldPreferRemote() in InventorySyncService
- `localDiffersFromRemote()` - Replaced by InventorySyncService comparison logic
- `checkArchivedTokensForRecovery()` - Move to recovery service or InventorySyncService
- `verifyIntegrityInvariants()` - Move to integrity service
- `runSpentTokenSanityCheck()` - Replaced by InventorySyncService Step 7
- `runTombstoneRecoveryCheck()` - Replaced by recovery service

**Result**: -1500+ lines removed

### Phase 3: Migrate InventorySyncService to Use Transport API

Update InventorySyncService to call IpfsStorageService methods:

```typescript
// In InventorySyncService
async step2_loadIpfs(ctx: SyncContext): Promise<void> {
  const transport = getIpfsTransport(); // New getter
  const resolution = await transport.resolveIpns();

  if (resolution.cid) {
    ctx.remoteCid = resolution.cid;
    if (!resolution.content) {
      ctx.remoteCid = resolution.cid;
      const content = await transport.fetchContent(resolution.cid);
      // ... process content
    } else {
      // Use cached content from resolution
    }
  }
}

async step10_uploadIpfs(ctx: SyncContext): Promise<void> {
  const transport = getIpfsTransport();

  // Build storage data
  const storageData = buildTxfStorageData(...);

  // Upload to IPFS
  const uploadResult = await transport.uploadContent(storageData);
  if (uploadResult.success) {
    ctx.remoteCid = uploadResult.cid;
    transport.setLastCid(uploadResult.cid);

    // Publish to IPNS
    const publishResult = await transport.publishIpns(uploadResult.cid);
    if (publishResult.success) {
      ctx.ipnsPublished = true;
    }
  }
}
```

### Phase 4: Implement Transport API in IpfsStorageService

Refactor IpfsStorageService to expose the transport interface:

```typescript
// In IpfsStorageService class

// Keep existing (refactor to remove orchestration logic)
async ensureInitialized(): Promise<boolean> { /* ... */ }

// Extract from private to public (with name changes)
async resolveIpns(): Promise<{ cid: string | null; sequence: bigint; content?: TxfStorageData }> {
  // Rename from resolveIpnsProgressively, return standard format
}

async fetchContent(cid: string): Promise<TxfStorageData | null> {
  // Rename from fetchRemoteContent, keep as-is
}

async uploadContent(data: TxfStorageData): Promise<{ cid: string; success: boolean }> {
  // Extract from executeSyncInternal, move here
  // Handle Blob creation, gateway upload, CID computation
}

async publishIpns(cid: string): Promise<{ ipnsName: string | null; success: boolean }> {
  // Rename from publishToIpns, wrap result
  // Start retry loop if needed (keep background retry)
}

// Keep as-is
getVersionCounter(): number { /* ... */ }
setVersionCounter(version: number): void { /* ... */ }
getLastCid(): string | null { /* ... */ }
setLastCid(cid: string): void { /* ... */ }
```

### Phase 5: Maintain Backward Compatibility

Keep public methods that external code uses:

```typescript
// Keep for external callers (delegate to InventorySyncService or direct calls)
async syncNow(options?: SyncOptions): Promise<StorageResult> {
  // Option A: Delegate to InventorySyncService
  const result = await inventorySync({
    address: this.currentAddress,
    publicKey: this.currentPublicKey,
    ipnsName: this.cachedIpnsName!,
    local: false // Auto-detect
  });
  return convertSyncResultFormat(result);

  // Option B: Keep as convenience wrapper (deprecated)
  // Calls internal executeSync that uses transport API
}

async syncFromIpns(): Promise<StorageResult> {
  // DEPRECATED - use inventorySync() instead
  // Kept for compatibility
}
```

---

## Detailed Change Map

### IpfsStorageService Changes

**KEEP (Pure Transport):**
| Section | Lines | Status | Notes |
|---------|-------|--------|-------|
| Lifecycle (init, shutdown) | 250 | Keep | Extract initialization only |
| Key derivation (HKDF, key gen) | 100 | Keep | Private utilities |
| Connection gater | 150 | Keep | Peer filtering logic |
| IPNS key management | 150 | Keep | Sequence number, key pair |
| IPNS publishing (HTTP) | 150 | Keep | Kubo API calls |
| IPNS publishing (DHT) | 100 | Keep | Background DHT publish |
| IPNS polling | 250 | REFACTOR | Remove orchestration logic from poll callback |
| IPNS resolution (progressive) | 400 | REFACTOR | Keep resolution, remove merge logic |
| Gateway connection mgmt | 150 | Keep | As-is |
| Version counter mgmt | 100 | Keep | Storage key access |
| CID tracking | 50 | Keep | Storage key access |

**REMOVE (Sync Orchestration):**
| Section | Lines | Status | Why Remove | Replacement |
|---------|-------|--------|------------|-------------|
| importRemoteData() | 330 | DELETE | Token merging logic | InventorySyncService steps 2, 6, 8 |
| syncFromIpns() | 250 | DELETE | IPNS→local orchestration | InventorySyncService entry point |
| executeSyncInternal() | 1000+ | DELETE | Full sync pipeline | InventorySyncService pipeline |
| sanityCheckMissingTokens() | 150 | DELETE | Token loss prevention | InventorySyncService + validation |
| sanityCheckTombstones() | 200 | DELETE | Tombstone validation | TokenValidationService |
| compareTokenVersions() | 50 | DELETE | Version comparison | shouldPreferRemote() in InventorySyncService |
| localDiffersFromRemote() | 100 | DELETE | Inventory comparison | InventorySyncService Step 2 |
| handleHigherSequenceDiscovered() | 150 | DELETE | Remote update handling | InventorySyncService trigger |
| checkArchivedTokensForRecovery() | 100 | DELETE | Archive recovery | InventorySyncService + TokenRecoveryService |
| verifyIntegrityInvariants() | 80 | DELETE | Invariant checking | TokenValidationService |
| runSpentTokenSanityCheck() | 150 | DELETE | Spent token checks | InventorySyncService Step 7 |
| runTombstoneRecoveryCheck() | 100 | DELETE | Tombstone recovery | InventorySyncService + recovery service |

**REFACTOR (Extract Orchestration):**
| Method | Current | After | Notes |
|--------|---------|-------|-------|
| resolveIpnsProgressively() | Private | Public | Rename to resolveIpns(), remove merge logic |
| fetchRemoteContent() | Private | Public | Rename to fetchContent(), keep as-is |
| publishToIpns() | Private | Public | Rename to publishIpns(), keep as-is |

### New InventorySyncService Integration

**Step 2 (Load IPFS):**
```typescript
async function step2_loadIpfs(ctx: SyncContext): Promise<void> {
  if (shouldSkipIpfs(ctx.mode)) return;

  const transport = getIpfsTransport();
  const resolution = await transport.resolveIpns();

  if (!resolution.cid) {
    console.log(`  IPNS resolution returned no CID`);
    return;
  }

  ctx.remoteCid = resolution.cid;

  // Use cached content if available (from resolution)
  let remoteData = resolution.content;

  // Otherwise fetch by CID
  if (!remoteData) {
    remoteData = await transport.fetchContent(resolution.cid);
  }

  if (!remoteData) {
    console.warn(`  Failed to fetch content for CID ${resolution.cid.slice(0, 16)}...`);
    return;
  }

  ctx.remoteVersion = remoteData._meta?.version || 0;
  // ... merge tokens, tombstones, etc. (same as existing Step 2)
}
```

**Step 10 (Upload IPFS):**
```typescript
async function step10_uploadIpfs(ctx: SyncContext): Promise<void> {
  if (!ctx.uploadNeeded || shouldSkipIpfs(ctx.mode)) return;

  const transport = getIpfsTransport();

  // Build storage data (same as before)
  const storageData = buildTxfStorageData(...);

  // Upload to IPFS
  const uploadResult = await transport.uploadContent(storageData);
  if (!uploadResult.success) {
    ctx.errors.push('IPFS upload failed');
    return;
  }

  ctx.remoteCid = uploadResult.cid;
  transport.setLastCid(uploadResult.cid);

  // Publish to IPNS
  const publishResult = await transport.publishIpns(uploadResult.cid);
  if (publishResult.success) {
    ctx.stats.ipnsPublished = true;
    console.log(`✅ IPNS published: ${publishResult.ipnsName}`);
  } else {
    console.warn(`⚠️ IPNS publish failed (will retry in background)`);
  }
}
```

---

## Migration Path & Risk Mitigation

### Phase 1: Create Transport Interface (Low Risk)
- Add IpfsTransport interface
- Add getter function `getIpfsTransport()`
- Implement all methods, keep private for now
- **Testing**: Unit tests for each transport method
- **Risk**: None - no breaking changes yet

### Phase 2: Migrate InventorySyncService (Low-Medium Risk)
- Update Step 2 to call transport.resolveIpns() + fetchContent()
- Update Step 10 to call transport.uploadContent() + publishIpns()
- Run full test suite
- **Testing**: Integration tests with InventorySyncService
- **Risk**: May expose bugs in Step 4, 5, 7 validation if called with IPFS data

### Phase 3: Introduce Sync Modes (Medium Risk)
- Add flag to control whether sync uses old or new path
- Option A: Feature flag `USE_INVENTORY_SYNC=true/false`
- Option B: Mode-based: `syncNow({ useInventorySync: true })`
- Run A/B testing in parallel
- **Testing**: Comprehensive integration tests, shadow monitoring
- **Risk**: Two sync paths could cause race conditions - use SyncCoordinator

### Phase 4: Delete Old Orchestration Code (High Risk)
- Only after InventorySyncService is production-stable
- Requires 100% test coverage of migration
- Monitor for 2-4 weeks for regressions
- **Testing**: Full regression test suite, sync stress tests
- **Risk**: Deleting code might break edge cases we don't test

### Phase 5: Publish Transport API (Low Risk)
- Make transport methods public
- Document as official public API
- Add TypeScript types to export
- **Testing**: API contract tests
- **Risk**: None - internal refactoring only

---

## Breaking Changes & Migration Guide

### For External Callers Using IpfsStorageService

**Currently using:**
```typescript
const service = IpfsStorageService.getInstance(identityManager);
const result = await service.syncNow();
const result = await service.syncFromIpns();
const result = await service.restore(txfContent);
```

**After refactoring (Backward compatible):**
```typescript
// Old API still works (delegated)
const service = IpfsStorageService.getInstance(identityManager);
const result = await service.syncNow(); // Delegates to inventorySync
const result = await service.syncFromIpns(); // Delegates to inventorySync

// New API (recommended)
const result = await inventorySync({
  address: wallet.address,
  publicKey: wallet.publicKey,
  ipnsName: wallet.ipnsName,
  local: false
});
```

**Deprecated methods (will log warnings):**
- `service.importRemoteData()` - No replacement, use sync pipeline
- Direct calls to `sanityCheck*` methods - Handled internally
- Direct calls to `compareTokenVersions()` - Use transport.resolveIpns() for comparison

### Storage Schema Changes

**No breaking changes** - localStorage format unchanged:
- Version counter keys remain same
- CID tracking keys remain same
- Pending IPNS publish keys remain same
- TxfStorageData format unchanged

### API Surface Changes

**Removed methods (internal only, no external impact):**
- All private methods: `importRemoteData`, `sanityCheckMissingTokens`, etc.

**New public methods (optional for callers):**
- `getIpfsTransport()` - Access transport layer
- Transport methods via new interface

---

## File Changes Summary

### Files to Modify

| File | Changes | Impact |
|------|---------|--------|
| `IpfsStorageService.ts` | -1500 lines, +100 lines | Core refactor (45KB → 30KB) |
| `InventorySyncService.ts` | +50 lines (calls to transport) | Minor additions |
| `IpfsTransport.ts` | +100 lines (new interface) | New file |
| `TxfSerializer.ts` | Unchanged | No impact |
| `TokenValidationService.ts` | Unchanged | No impact |
| `CLAUDE.md` | +20 lines (update docs) | Documentation |

### Files NOT Affected

- All test files (update test fixtures only)
- All component files (no API changes)
- All repository files (no schema changes)
- All service files (other than InventorySyncService)

---

## Testing Strategy

### Unit Tests (New)

**IpfsTransport interface:**
```
tests/unit/services/IpfsTransport.test.ts
- resolveIpns() returns correct format
- fetchContent() handles missing CID
- uploadContent() computes CID correctly
- publishIpns() handles failures
- Version counter get/set
```

**InventorySyncService integration:**
```
tests/unit/services/InventorySyncService.test.ts
- Step 2: loadIpfs calls transport.resolveIpns()
- Step 2: loadIpfs calls transport.fetchContent()
- Step 10: uploadIpfs calls transport.uploadContent()
- Step 10: uploadIpfs calls transport.publishIpns()
```

### Integration Tests (Update Existing)

```
tests/integration/wallet/sync.test.ts
- Full sync roundtrip with IPFS
- IPNS resolution and merge
- Token import/export consistency
- Tombstone processing
```

### E2E Tests (Shadow)

```
tests/e2e/sync-flow.test.ts
- Real wallet sync workflow
- Multi-device sync simulation
- Conflict resolution scenarios
- Network failure recovery
```

### Regression Tests (Mandatory)

```
tests/regression/ipfs-storage.test.ts
- All existing sync behaviors
- Edge cases from production issues
- Performance benchmarks (should be faster)
```

---

## Success Criteria

### Code Quality
- [x] Lines of code reduced by 30-40% (1500+ lines)
- [x] Cyclomatic complexity of sync reduced by 50%
- [x] No duplicate code between services
- [x] Transport API has <10 methods
- [x] 90%+ test coverage of transport layer

### Functionality
- [x] All existing sync features work identically
- [x] No regression in any sync scenario
- [x] IPNS publish reliability maintained or improved
- [x] Performance within 10% of baseline (likely faster due to less allocation)
- [x] Backward compatibility maintained for 1 version

### Safety
- [x] SyncCoordinator prevents race conditions
- [x] All 10-step validation checks applied (vs. current 3-4)
- [x] No data loss in any scenario
- [x] Spent token detection fully operational
- [x] Tombstone recovery functional

### Documentation
- [x] CLAUDE.md updated with new architecture
- [x] IpfsTransport interface documented
- [x] Migration guide for callers
- [x] Deprecation warnings in old methods

---

## Estimated Timeline

| Phase | Duration | Effort | Risk |
|-------|----------|--------|------|
| 1. Design & Interface | 1-2 days | 4h | Low |
| 2. Transport Implementation | 2-3 days | 8h | Low |
| 3. InventorySyncService Integration | 2-3 days | 8h | Medium |
| 4. Testing & QA | 3-4 days | 12h | Medium |
| 5. Code Review & Iteration | 2-3 days | 6h | Low |
| 6. Merge & Monitoring | 1-2 days | 4h | Medium |
| 7. Cleanup & Deprecation | 1-2 days | 4h | Low |

**Total: 12-17 days, 46 hours**

---

## Rollback Plan

### If Issues Detected During Integration

**Level 1: Feature Flag Disable**
- Add `ENABLE_INVENTORY_SYNC` environment variable
- Disable InventorySyncService call, revert to old IpfsStorageService.syncNow()
- **Time to rollback**: 5 minutes (deploy flag change)
- **Data impact**: None

**Level 2: Revert PR**
- Keep old IpfsStorageService code intact during transition
- Revert InventorySyncService changes to not call transport API
- **Time to rollback**: 30 minutes (revert commit + re-deploy)
- **Data impact**: None

**Level 3: Full Rollback**
- Delete new IpfsTransport interface
- Restore all old IpfsStorageService methods
- Remove InventorySyncService changes
- **Time to rollback**: 1 hour (full reversal + test)
- **Data impact**: Potential: if remote IPFS state changed during feature flag period

### Data Recovery Strategy

All user data remains on IPFS/localStorage throughout:
- Sync results are immutable once published to IPNS
- localStorage changes are additive (never destructive)
- Can always manually re-import from IPFS backup
- Wallet files can be exported as .txf for manual recovery

---

## References

- TOKEN_INVENTORY_SPEC.md - Section 6.1 (10-step sync flow)
- InventorySyncService.ts - Current implementation
- IpfsStorageService.ts - Code to refactor
- SyncCoordinator.ts - Coordination mechanism
- TxfSerializer.ts - Token serialization format

