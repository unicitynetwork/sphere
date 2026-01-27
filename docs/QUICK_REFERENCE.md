# IpfsStorageService Refactoring - Quick Reference

## One-Page Overview

### Problem
- IpfsStorageService: 4000 lines mixing transport + orchestration
- InventorySyncService: 1500 lines implementing 10-step sync
- 40% duplicate code
- 60% validation checks missing from IpfsStorageService

### Solution
Separate concerns:
- **IpfsStorageService** → Pure transport layer
- **InventorySyncService** → Orchestration with all 10 steps

### Result
- 30% code reduction (1200 lines)
- 100% validation coverage
- Zero duplication
- Better testability

---

## Key Files to Understand

### 1. **InventorySyncService.ts** (~1500 lines)
**10-step sync flow** (the template for what orchestration should do):
- Step 0: Input processing
- **Step 1: Load localStorage** ✅
- **Step 2: Load IPFS** ← Uses transport.resolveIpns() + fetchContent()
- **Step 3: Normalize proofs** ✅
- **Step 4: Validate commitments** ✅ (missing from IpfsStorageService)
- **Step 5: Validate tokens with SDK** ✅ (missing from IpfsStorageService)
- **Step 6: Deduplicate** ✅
- **Step 7: Detect spent tokens** ✅ (missing from IpfsStorageService)
- **Step 8: Merge inventory** ✅
- **Step 9: Prepare storage** ✅
- **Step 10: Upload IPFS** ← Uses transport.uploadContent() + publishIpns()

### 2. **IpfsStorageService.ts** (45KB, ~4000 lines)
**Current problem areas:**

| Section | Lines | Status | Issue |
|---------|-------|--------|-------|
| Helia init | 300 | ✅ Keep | Pure transport |
| IPNS publish | 400 | ✅ Keep | Pure transport |
| IPNS polling | 250 | ✅ Keep | Pure transport |
| IPFS upload/fetch | 500 | ✅ Keep | Pure transport |
| importRemoteData() | 330 | ❌ DELETE | Duplicate merge logic |
| syncFromIpns() | 250 | ❌ DELETE | Duplicate orchestration |
| executeSyncInternal() | 1000+ | ❌ DELETE | Old sync pipeline |
| sanityCheckXxx() | 400 | ❌ DELETE | Validation logic |

---

## Refactoring Steps

### Phase 1: Create Interface (0.5 day)
```typescript
// New file: IpfsTransport.ts
export interface IpfsTransport {
  ensureInitialized(): Promise<boolean>;
  resolveIpns(): Promise<IpnsResolution>;      // Step 2
  fetchContent(cid: string): Promise<TxfStorageData>;  // Step 2
  uploadContent(data: TxfStorageData): Promise<IpfsUploadResult>;  // Step 10
  publishIpns(cid: string): Promise<IpnsPublishResult>;  // Step 10
  getVersionCounter(): number;
  setVersionCounter(version: number): void;
  getLastCid(): string | null;
  setLastCid(cid: string): void;
}
```

### Phase 2: Implement Interface (1 day)
Add to IpfsStorageService:
```typescript
// Make these public (currently private)
async resolveIpns(): Promise<IpnsResolution> { ... }
async fetchContent(cid: string): Promise<TxfStorageData> { ... }
async uploadContent(data): Promise<IpfsUploadResult> { ... }
async publishIpns(cid: string): Promise<IpnsPublishResult> { ... }
```

### Phase 3: Update InventorySyncService (1 day)
```typescript
// Step 2
const transport = getIpfsTransport();
const resolution = await transport.resolveIpns();
const content = resolution.content || await transport.fetchContent(resolution.cid);

// Step 10
const uploadResult = await transport.uploadContent(storageData);
const publishResult = await transport.publishIpns(uploadResult.cid);
```

### Phase 4: Testing (2 days)
- Unit tests for transport methods
- Integration tests with InventorySyncService
- Regression tests (existing sync behaviors)
- Edge case tests (10 scenarios documented)

### Phase 5: Merge & Cleanup (1 day)
- Code review
- Monitor production
- Remove deprecated methods (Phase 2 later)

---

## Code Snippets

### Before (Current IpfsStorageService)
```typescript
async syncNow() {
  // 1. IPNS resolution
  const resolution = await this.resolveIpnsProgressively();
  
  // 2. Import remote (has duplicate validation logic)
  const importedCount = await this.importRemoteData(remoteData);
  
  // 3. Upload to IPFS
  // ... 100+ lines of upload logic inline
  
  // 4. Publish IPNS
  // ... 50+ lines of publish logic inline
  
  // 5. Return result
  return { success: true, cid, version };
}
```

### After (Transport API)
```typescript
// IpfsStorageService - Pure transport
async uploadContent(data) { /* 50 lines */ }
async publishIpns(cid) { /* 30 lines */ }

// InventorySyncService - Orchestration
async function step10_uploadIpfs() {
  const transport = getIpfsTransport();
  const uploadResult = await transport.uploadContent(storageData);
  const publishResult = await transport.publishIpns(uploadResult.cid);
  return { success, cid };
}
```

---

## Risk Summary

| Risk | Level | Mitigation |
|------|-------|-----------|
| Data loss | HIGH | All 10-step validation applied |
| IPNS downgrade | LOW | Sequence logic unchanged |
| Race condition | LOW | SyncQueue unchanged |
| Upload timeout | MEDIUM | Partial success handling |
| Genesis tokens | MEDIUM | Repair logic in Step 3 |
| Backward compat | LOW | Wrapper for old API |

---

## Success Criteria Checklist

Code Quality:
- [ ] 30-40% lines reduced (1200+ lines)
- [ ] 90%+ test coverage
- [ ] 50% cyclomatic complexity reduction
- [ ] Zero duplicate code between services

Functionality:
- [ ] All 10 sync steps applied
- [ ] IPNS reliability maintained
- [ ] Backward compatible
- [ ] Performance baseline maintained

Safety:
- [ ] No data loss in any scenario
- [ ] Spent token detection fully operational
- [ ] Race conditions prevented
- [ ] Tombstone recovery functional

Documentation:
- [ ] CLAUDE.md updated
- [ ] Transport API documented
- [ ] Migration guide created
- [ ] Edge cases documented

---

## Files Changed

| File | Change | Impact |
|------|--------|--------|
| IpfsTransport.ts | NEW (+100 lines) | Interface definition |
| IpfsStorageService.ts | REFACTOR (-1300 lines) | Remove orchestration |
| InventorySyncService.ts | MODIFY (+50 lines) | Call transport |
| CLAUDE.md | UPDATE (+20 lines) | Document architecture |
| test files | ADD (+400 lines) | Full test suite |

**Net: -830 lines code**

---

## Related Documentation

- **IPFS_STORAGE_REFACTORING_PLAN.md** - Full 300+ line strategic plan
- **IPFS_STORAGE_IMPLEMENTATION_GUIDE.md** - Code-level implementation (400+ lines)
- **IPFS_STORAGE_RISKS_AND_EDGE_CASES.md** - Risk matrix and 10 edge cases
- **REFACTORING_SUMMARY.md** - Executive summary
- **TOKEN_INVENTORY_SPEC.md** - 10-step sync flow specification

---

## Quick Links

- IpfsStorageService: `/home/vrogojin/sphere/src/components/wallet/L3/services/IpfsStorageService.ts`
- InventorySyncService: `/home/vrogojin/sphere/src/components/wallet/L3/services/InventorySyncService.ts`
- Tests: `/home/vrogojin/sphere/tests/unit/services/`

---

## Questions?

See specific documentation:
- "What's the 10-step sync?" → TOKEN_INVENTORY_SPEC.md Section 6.1
- "How do I implement?" → IPFS_STORAGE_IMPLEMENTATION_GUIDE.md
- "What could go wrong?" → IPFS_STORAGE_RISKS_AND_EDGE_CASES.md
- "Is this safe?" → REFACTORING_SUMMARY.md Risk Assessment

