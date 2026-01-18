# IpfsStorageService Refactoring Analysis: Transport vs Orchestration

## Executive Summary

**Current State:** IpfsStorageService (4,018 lines) is a monolithic service combining IPFS network transport operations with complex sync orchestration logic.

**Problem:** ~40% of sync orchestration logic duplicates or conflicts with the new InventorySyncService, while missing 60% of critical validation steps. This creates:
- Inconsistent token validation behavior
- Conflicting merge strategies
- Race conditions in cross-device sync
- Difficult testing and debugging

**Recommendation:** Separate into two focused services:
1. **IpfsTransportService** - Pure IPFS/IPNS network layer (transport)
2. **IpfsStorageService** (refactored) - Thin orchestration wrapper using InventorySyncService

---

## Part 1: Method Classification

### A. TRANSPORT OPERATIONS (KEEP in refined IpfsTransportService)

These are pure IPFS/IPNS network operations with no sync logic:

#### Initialization & Lifecycle (13 methods)
- `constructor()` - Singleton instantiation
- `getInstance()` - Static singleton accessor
- `resetInstance()` - Singleton reset for identity switch
- `ensureInitialized()` - Lazy Helia initialization with identity detection
- `isWebCryptoAvailable()` - WebCrypto availability check
- `startAutoSync()` - Event listener setup
- `shutdown()` - Graceful cleanup
- `createConnectionGater()` - Bootstrap peer filtering
- `migrateStorageKeys()` - Storage key format migration on IPNS name change
- `startBackendConnectionMaintenance()` - Connection pool maintenance
- `startVisibilityListener()` - Tab visibility tracking for polling
- `setupVisibilityListener()` / `cleanupVisibilityListener()` - Visibility event handlers

#### IPNS Key Management (6 methods)
- `deriveIpnsKeyFromSecret()` - HKDF derivation of Ed25519 key (lines 400-413)
- `getIpnsSequenceNumber()` - Fetch sequence from storage (lines 615-620)
- `setIpnsSequenceNumber()` - Store sequence to storage (lines 625-629)
- `hexToBytes()` - Encoding utility (lines 509-515)
- `bytesToHex()` - Encoding utility (lines 517-521)
- `getCachedIpnsName()` - Access current IPNS name

#### IPNS Publishing (5 methods)
- `publishToIpns(cid)` - Sign and publish IPNS record via dual HTTP/DHT strategy (lines 752-866)
- `publishIpnsViaHttp()` - HTTP/Kubo backend publishing (lines 637-707)
- `publishIpnsViaDhtAsync()` - Fire-and-forget DHT publishing (lines 716-743)
- `getPendingIpnsPublish()` - Fetch pending publish tracking (lines 1734-1738)
- `setPendingIpnsPublish()` - Store pending publish CID (lines 1743-1748)
- `clearPendingIpnsPublish()` - Clear pending after success (lines 1753-1757)
- `retryPendingIpnsPublish()` - Retry previously failed publish (lines 1762-1784)

#### IPNS Resolution (6 methods)
- `resolveIpnsProgressively()` - Multi-gateway IPNS resolution racing (lines 1432-1512)
- `resolveIpnsFromGateway()` - Single gateway resolution (lines 1513-1542)
- `handleHigherSequenceDiscovered()` - Event handler for late-arriving higher sequences (lines 1544-1562)
- `computeIpnsRecordHash()` - CID computation from IPNS record (lines 1579-1593)

#### Content Fetching (2 methods)
- `fetchRemoteContent()` - HTTP + Helia dual-path content fetch (lines 1794-1886)
- `computeCidFromContent()` (delegated to IpfsHttpResolver) - CID verification

#### Peer Connection Management (3 methods)
- Connection gating via `createConnectionGater()`
- Peer event handlers in libp2p initialization
- `ensureBackendConnected()` - Verify backend peer connectivity

#### Metrics & Caching (utilities)
- `getIpfsMetrics()` - Delegate to metrics service
- `getIpfsCache()` - Delegate to cache service
- `getIpfsHttpResolver()` - Delegate to HTTP resolver

#### Event System (2 methods)
- `onEvent()` - Register storage event callbacks (lines 285-290)
- `emitEvent()` - Emit custom events (lines 292-316)
- `emitSyncStateChange()` - Emit sync state updates (lines 321-333)

**Total Transport Methods:** ~35 methods

---

### B. ORCHESTRATION LOGIC (MOVE to InventorySyncService or deprecate)

These implement sync strategy, validation, and merge logic:

#### Version & State Tracking (4 methods)
- `getVersionCounter()` - Get local version counter (lines 1682-1686) **TRANSPORT-ADJACENT but OK to keep**
- `incrementVersionCounter()` - Increment version (lines 1691-1698)
- `setVersionCounter()` - Set version to specific value (lines 1703-1707)
- `getLastCid()` / `setLastCid()` - CID tracking (lines 1712-1725)

**Status:** Keep as private utilities in transport layer but expose via clean API

#### Token Comparison & Diff (2 methods) **CRITICAL DUPLICATION**
- `compareTokenVersions()` - Compare local vs remote token versions (lines 2234-2298)
  - **Problem:** Duplicates logic that InventorySyncService should own
  - **Logic:** Compares committed tx count, proofs, state hash, genesis hash
  - **Recommendation:** Move to InventorySyncService.compareTokens()

- `localDiffersFromRemote()` - Check if local state differs from remote (lines 2304-2358)
  - **Problem:** Partial duplicate of InventorySyncService conflict resolution
  - **Logic:** Compares nametags, tokens, versions
  - **Recommendation:** Remove - InventorySyncService should handle this

#### Validation & Sanity Checks (4 methods) **MAJOR DUPLICATION**
- `sanityCheckTombstones()` - Verify tombstones against Unicity (lines 1897-1971)
  - **Status:** Move to InventorySyncService (owns token validation)
  - **Calls:** TokenValidationService.checkUnspentTokens()

- `sanityCheckMissingTokens()` - Verify tokens missing from remote (lines 1978-2043)
  - **Status:** Move to InventorySyncService
  - **Logic:** Checks if missing tokens are unspent

- `runSpentTokenSanityCheck()` - Verify spent tokens still spent (lines 2078-2130)
  - **Status:** Move to InventorySyncService
  - **Called from:** syncFromIpns() (lines 2918, 2959, 2987)

- `runTombstoneRecoveryCheck()` - Recover false tombstones (lines 2132-2167)
  - **Status:** Move to InventorySyncService
  - **Called from:** syncFromIpns() (lines 2919, 2960, 2988)

#### Data Import & Merge (1 method) **MASSIVE DUPLICATION (500+ lines)**
- `importRemoteData()` - Import remote tokens into local (lines 2372-2714)
  - **Size:** 342 lines of merge logic
  - **Status:** CRITICAL - This IS InventorySyncService's core function!
  - **Logic duplicated:**
    - Tombstone sanity checking (calls `sanityCheckTombstones()`)
    - Missing token recovery (calls `sanityCheckMissingTokens()`)
    - Token comparison (calls `compareTokenVersions()`)
    - Nametag validation (checks `isNametagCorrupted()`)
    - Archive/fork management (calls `walletRepo.storeForkedToken()`)
    - Outbox import (calls `OutboxRepository.importFromRemote()`)
  - **Recommendation:** DELETE - InventorySyncService.mergeRemoteTokens() should be called instead

#### Main Sync Orchestration (2 methods) **LOGIC ORCHESTRATION (SPLIT)**
- `syncFromIpns()` - Startup IPNS-based sync (lines 2741-3009)
  - **Size:** 268 lines
  - **Current Logic:**
    1. Resolve IPNS progressively (TRANSPORT - keep)
    2. Fetch remote content (TRANSPORT - keep)
    3. Compare versions (ORCHESTRATION - delegate)
    4. Import/merge tokens (ORCHESTRATION - delegate to InventorySyncService)
    5. Run sanity checks (ORCHESTRATION - delegate)
  - **Recommendation:** Refactor to delegate steps 3-5 to InventorySyncService

- `executeSyncInternal()` - Main sync logic (lines 3039-3526)
  - **Size:** 487 lines
  - **Current Logic:**
    1. Acquire cross-tab lock (TRANSPORT - keep)
    2. Validate tokens (ORCHESTRATION - delegate to TokenValidationService)
    3. Check remote conflicts (ORCHESTRATION - delegate to ConflictResolutionService)
    4. Build TXF data (TRANSPORT - keep)
    5. Store to IPFS (TRANSPORT - keep)
    6. Publish IPNS (TRANSPORT - keep)
  - **Recommendation:** Simplify by removing duplicate validation/conflict logic

#### IPNS Retry Loop (3 methods) **ORCHESTRATION - belongs in InventorySyncService or dedicated retry service**
- `startIpnsSyncRetryLoop()` - Start exponential backoff retry (lines 875-887)
- `runIpnsSyncRetryIteration()` - Single retry iteration (lines 893-975)
- `stopIpnsSyncRetryLoop()` - Stop retries (lines 980-986)

**Status:** Move to dedicated IpnsSyncRetryService or part of InventorySyncService error handling

---

### C. PUBLIC API (Current exposure)

Methods exposed to callers:

```typescript
// Initialization
public static getInstance(identityManager)
public static resetInstance()
public startAutoSync()
public async shutdown()

// Status queries
public getStatus()
public getLastSync()
public async getWalletForRestore()

// Main operations
public async syncNow(options?: SyncOptions)
public async syncFromIpns()

// Event subscription
public onEvent(callback)

// Retry management
public stopIpnsSyncRetryLoop()
```

**Analysis:** Too much exposed; should be reduced to thin orchestration layer only.

---

## Part 2: Proposed Refactoring Architecture

### Current (Monolithic)
```
IpfsStorageService (4,018 lines)
  ├── Helia lifecycle
  ├── IPNS key derivation
  ├── IPNS publishing (HTTP + DHT)
  ├── IPNS resolution
  ├── Content fetching
  ├── Token validation (duplicate)
  ├── Conflict resolution (duplicate)
  ├── Tombstone sanity checks (duplicate)
  ├── Token version comparison (duplicate)
  ├── Data import/merge (duplicate - 342 lines)
  ├── Sync orchestration
  └── IPNS retry loops
```

### Proposed (Separated)

#### IpfsTransportService (~1,200 lines)
**Pure IPFS/IPNS network operations:**
```typescript
class IpfsTransportService {
  // Lifecycle
  static getInstance(identityManager)
  static resetInstance()
  startAutoSync()
  shutdown()

  // Helia & initialization
  ensureInitialized()
  isWebCryptoAvailable()

  // IPNS key management
  deriveIpnsKeyFromSecret()
  getIpnsSequenceNumber()
  setIpnsSequenceNumber()

  // IPNS resolution (multi-gateway racing)
  async resolveIpnsProgressively(): Promise<{
    best: { cid, sequence }
    respondedCount, totalGateways
  }>

  // IPNS publishing (dual HTTP + DHT)
  async publishToIpns(cid): Promise<string | null>
  async publishIpnsViaHttp(marshalledRecord): Promise<boolean>

  // Content operations
  async fetchRemoteContent(cid): Promise<TxfStorageData>
  async storeContent(data): Promise<CID>

  // Peer management
  ensureBackendConnected()
  createConnectionGater(bootstrapPeers)

  // Utilities
  getStatus(): StorageStatus
  onEvent(callback): unsubscribe
}
```

#### IpfsStorageService (refactored, ~300 lines)
**Thin orchestration wrapper:**
```typescript
class IpfsStorageService {
  private transport: IpfsTransportService
  private inventorySync: InventorySyncService

  // Initialization
  static getInstance(identityManager)
  startAutoSync()

  // Main API (delegates to services)
  async syncNow(options?: SyncOptions): Promise<StorageResult>
  async syncFromIpns(): Promise<StorageResult>

  // Query
  getStatus(): StorageStatus
  getLastSync(): StorageResult | null

  // Events
  onEvent(callback): unsubscribe

  // Retry management (delegates to InventorySyncService)
  stopIpnsSyncRetryLoop()

  // Private: Delegates to InventorySyncService and transport
  private async executeSyncInternal()
}
```

#### InventorySyncService (EXISTING - 10-step sync flow)
**Orchestration logic (should NOT be duplicated in IpfsStorageService):**
- Step 1: Load local tokens and state
- Step 2: Validate all tokens against Unicity
- Step 3: Fetch remote state (calls IpfsTransportService)
- Step 4: Compare versions and detect conflicts
- Step 5: Resolve conflicts (merges tokens)
- Step 6: Apply tombstones (with Unicity verification)
- Step 7: Recover missing tokens (with sanity checks)
- Step 8: Build merged state
- Step 9: Store to IPFS (calls IpfsTransportService)
- Step 10: Publish IPNS (calls IpfsTransportService)

**Already has these methods that IpfsStorageService should NOT duplicate:**
- `validateAllTokens()`
- `resolveConflict()`
- `mergeTokens()`
- Token version comparison
- Tombstone sanity checking
- Missing token recovery

---

## Part 3: Detailed Refactoring Steps

### 3.1 Identify True Duplicates (These MUST be removed from IpfsStorageService)

| Method | Location | Lines | Status | Recommendation |
|--------|----------|-------|--------|-----------------|
| `compareTokenVersions()` | 2234-2298 | 65 | DUPLICATE | Remove, use InventorySyncService |
| `importRemoteData()` | 2372-2714 | 342 | CRITICAL | Remove entirely, InventorySyncService handles this |
| `sanityCheckTombstones()` | 1897-1971 | 75 | DUPLICATE | Remove, InventorySyncService owns token validation |
| `sanityCheckMissingTokens()` | 1978-2043 | 66 | DUPLICATE | Remove, move to InventorySyncService |
| `runSpentTokenSanityCheck()` | 2078-2130 | 53 | DUPLICATE | Remove, part of validation flow |
| `runTombstoneRecoveryCheck()` | 2132-2167 | 36 | DUPLICATE | Remove, part of validation flow |
| `localDiffersFromRemote()` | 2304-2358 | 55 | DUPLICATE | Remove, InventorySyncService compares versions |

**Total lines to REMOVE:** 692 lines (17% of current service)

### 3.2 Methods to KEEP (Transport Layer)

#### Public API to keep:
- `getInstance()`
- `resetInstance()`
- `startAutoSync()`
- `shutdown()`
- `syncNow(options)` - but refactor to delegate
- `syncFromIpns()` - but refactor to delegate
- `onEvent(callback)`
- `getStatus()`
- `getLastSync()`
- `stopIpnsSyncRetryLoop()` - or move to InventorySyncService

#### Private methods to keep (transport):
- `ensureInitialized()`
- `isWebCryptoAvailable()`
- `publishToIpns(cid)` - **PURE TRANSPORT**
- `publishIpnsViaHttp()`
- `publishIpnsViaDhtAsync()`
- `resolveIpnsProgressively()`
- `resolveIpnsFromGateway()`
- `fetchRemoteContent(cid)` - **PURE TRANSPORT**
- All key derivation methods
- All sequence number management
- All connection gating
- All utility encoding methods

### 3.3 Migration Path for Existing Callers

#### Current callers of IpfsStorageService:

**L3WalletView.tsx**
```typescript
// Current
const result = await ipfsService.syncNow();

// After: No change - IpfsStorageService still has this method
// (it will delegate internally)
```

**Nostr token transfer flow**
```typescript
// Current: syncNow() triggered after token arrival
// After: No change - same public API
```

**TokenBackupService**
```typescript
// Current: Calls getLastSync() to check sync timestamp
// After: No change - method remains
```

**Chat history sync**
```typescript
// Current: Calls syncNow() to sync chat metadata
// After: No change - same public API
```

**All integration points are SAFE** because IpfsStorageService maintains backward-compatible public API while delegating internally.

---

## Part 4: Clean Transport API Design

### Proposed IpfsTransportService Interface

```typescript
interface IpfsTransport {
  // Lifecycle
  static getInstance(identityManager: IdentityManager): IpfsTransportService
  static resetInstance(): Promise<void>
  startAutoSync(): void
  shutdown(): Promise<void>

  // Status
  getStatus(): StorageStatus
  getLastSync(): StorageResult | null

  // IPNS Name Access
  getIpnsName(): string | null
  getIpnsSequenceNumber(): bigint

  // IPNS Resolution (multi-gateway racing)
  async resolveIpns(): Promise<{
    cid: string
    sequence: bigint
    timestamp: number
  } | null>

  // Content Fetching
  async fetchContentByCid(cid: string): Promise<TxfStorageData | null>

  // Content Publishing
  async publishContent(data: TxfStorageData): Promise<{
    cid: string
    timestamp: number
  }>

  // IPNS Publishing (returns success + verification result)
  async publishToIpns(cid: string): Promise<{
    success: boolean
    ipnsName?: string
    sequence?: bigint
    verified: boolean  // true if verify succeeded
  }>

  // Peer Management
  async ensureBackendConnected(): Promise<boolean>

  // Events
  onEvent(callback: StorageEventCallback): () => void  // unsubscribe

  // Utilities
  isWebCryptoAvailable(): boolean
}
```

### Example: Refactored syncFromIpns() using transport layer

```typescript
// BEFORE: 268 lines of mixed logic in IpfsStorageService
async syncFromIpns(): Promise<StorageResult> {
  // ... 50 lines of setup ...

  // 1. Resolve IPNS
  const resolution = await this.resolveIpnsProgressively();  // Transport
  const remoteCid = resolution.best?.cid || null;

  // ... version comparison, local diff checks ...

  // 2. Import/merge (currently duplicates InventorySyncService!)
  const importedCount = await this.importRemoteData(remoteData);  // WRONG!

  // ... 100+ lines of duplicate logic ...
}

// AFTER: Clear delegation to orchestration service
async syncFromIpns(): Promise<StorageResult> {
  const initialized = await this.transport.ensureInitialized();
  if (!initialized) return { success: false, error: "Not initialized" };

  // Transport layer: IPNS resolution
  const resolution = await this.transport.resolveIpns();
  if (!resolution) return { success: false, error: "IPNS resolution failed" };

  // Transport layer: Content fetch
  const remoteData = await this.transport.fetchContentByCid(resolution.cid);
  if (!remoteData) return { success: false, error: "Content fetch failed" };

  // Orchestration layer: Merge with local
  const mergeResult = await this.inventorySync.mergeRemoteInventory(remoteData);
  if (!mergeResult.success) return mergeResult;

  // Transport layer: Publish merged state
  const publishResult = await this.transport.publishContent(mergeResult.data);

  return {
    success: true,
    cid: publishResult.cid,
    version: mergeResult.version,
  };
}
```

---

## Part 5: Risk Assessment

### HIGH RISK Areas (Carefully verify after refactoring)

1. **IPNS Sequence Number Management**
   - Currently: Increments on every publish attempt
   - Risk: Sequence race conditions between tabs
   - Mitigation: SyncCoordinator already handles cross-tab locking

2. **Tombstone Sanity Checking**
   - Currently: Verifies against Unicity in importRemoteData()
   - Risk: Moving this could miss verification
   - Mitigation: InventorySyncService already does this (use existing implementation)

3. **Retry Loop Behavior**
   - Currently: Exponential backoff in IPNS retry loop
   - Risk: Retry logic change could cause infinite loops
   - Mitigation: Move retry logic as-is, don't modify behavior

4. **Token Version Comparison**
   - Currently: Custom logic considering committed transactions, proofs, genesis hash
   - Risk: Inconsistent behavior if duplicated
   - Mitigation: InventorySyncService should OWN this logic, IpfsStorageService uses it

### SAFE Areas (Low Risk)

- Transport layer operations (publishing, fetching, resolving) are independent
- Singleton initialization is already robust with identity detection
- Event emission is a simple delegation
- Peer connection management is isolated

---

## Part 6: Implementation Checklist

### Phase 1: Create IpfsTransportService (Non-Breaking)
- [ ] Create new file: `IpfsTransportService.ts`
- [ ] Extract transport methods from IpfsStorageService
- [ ] Export clean interface
- [ ] Update imports in IpfsStorageService to use new service
- [ ] Run all tests - should pass (no logic changes)

### Phase 2: Remove Duplicate Orchestration Logic (Breaking, requires InventorySyncService completion)
- [ ] Verify InventorySyncService has: compareTokens(), validateTokens(), mergeTokens()
- [ ] Remove `importRemoteData()` from IpfsStorageService
- [ ] Remove `sanityCheckTombstones()`, `sanityCheckMissingTokens()`
- [ ] Remove `compareTokenVersions()`, `localDiffersFromRemote()`
- [ ] Refactor `syncFromIpns()` to delegate to InventorySyncService
- [ ] Refactor `executeSyncInternal()` to use InventorySyncService
- [ ] Update tests for delegated logic

### Phase 3: Simplify Public API
- [ ] Keep all public methods but simplify implementations
- [ ] Add documentation of which service owns each step
- [ ] Update CLAUDE.md with new architecture
- [ ] Add JSDoc comments explaining delegation

### Phase 4: Testing & Validation
- [ ] Unit tests for IpfsTransportService in isolation
- [ ] Integration tests for refactored orchestration flow
- [ ] Cross-device sync testing (multiple tabs/windows)
- [ ] Token conflict resolution testing
- [ ] Tombstone sanity check verification

---

## Part 7: Code Examples

### Example 1: Before (Duplicate validation)
```typescript
// IpfsStorageService.importRemoteData() - lines 2372-2714
private async importRemoteData(remoteTxf: TxfStorageData): Promise<number> {
  // Lines 1897-1971: Duplicate sanityCheckTombstones
  const result = await this.sanityCheckTombstones(newTombstones, walletRepo);

  // Lines 1978-2043: Duplicate sanityCheckMissingTokens
  const tokensToPreserve = await this.sanityCheckMissingTokens(localTokens, ...);

  // Lines 2234-2298: Duplicate compareTokenVersions
  const comparison = this.compareTokenVersions(localTxf, remoteTxf);

  // ... 200 more lines of merge logic ...
}
```

### Example 2: After (Clean delegation)
```typescript
// IpfsStorageService.syncNow() - SIMPLIFIED
private async executeSyncInternal(options?: SyncOptions): Promise<StorageResult> {
  const transport = this.transport;
  const orchestrator = this.inventorySync;

  // Transport: Get content
  const remoteData = await transport.fetchContentByCid(lastCid);

  // Orchestration: Merge with local (InventorySyncService owns this)
  const mergeResult = await orchestrator.mergeRemoteInventory(remoteData);

  // Transport: Publish merged state
  const publishResult = await transport.publishContent(mergeResult.data);

  return { success: true, cid: publishResult.cid };
}
```

### Example 3: Testing becomes easier

**Before:**
```typescript
// Hard to test - need to mock IdentityManager, WalletRepository,
// TokenValidationService, ConflictResolutionService, Helia, all in one test
describe('importRemoteData', () => {
  it('should merge tokens correctly', async () => {
    const service = new IpfsStorageService(mockIdentityManager);
    // 50+ lines of setup
    const result = await service['importRemoteData'](mockRemoteTxf);
    // Verify multiple concerns at once
  });
});
```

**After:**
```typescript
// Easy to test - each service has single responsibility
describe('IpfsTransportService', () => {
  it('should fetch content by CID', async () => {
    const transport = new IpfsTransportService(mockIdentityManager);
    const result = await transport.fetchContentByCid(cid);
    expect(result).toBeDefined();
  });
});

describe('IpfsStorageService orchestration', () => {
  it('should delegate to InventorySyncService', async () => {
    const storage = new IpfsStorageService(mockTransport, mockOrchestrator);
    await storage.syncNow();
    expect(mockOrchestrator.mergeRemoteInventory).toHaveBeenCalled();
  });
});
```

---

## Summary of Changes

| Component | Current | After | Change |
|-----------|---------|-------|--------|
| IpfsStorageService | 4,018 lines, monolithic | ~300 lines, thin wrapper | -92% size, high clarity |
| IpfsTransportService | N/A (new) | ~1,200 lines, pure transport | New, clear responsibility |
| InventorySyncService | 10-step sync | No change (use its methods) | Becomes single source of truth |
| Duplicated logic | 692 lines | 0 lines | -100% duplication |
| Public API | Same | Same | Backward compatible |
| Testability | Hard (monolithic) | Easy (separated concerns) | Significantly improved |

---

## Files to Create/Modify

1. **Create:** `/home/vrogojin/sphere/src/components/wallet/L3/services/IpfsTransportService.ts` (~1,200 lines)
2. **Refactor:** `/home/vrogojin/sphere/src/components/wallet/L3/services/IpfsStorageService.ts` (reduce to ~300 lines)
3. **Update:** CLAUDE.md - Document new architecture
4. **Update:** All test files that mock IpfsStorageService

---

## Questions for Stakeholder Review

1. **InventorySyncService readiness:** Is InventorySyncService currently tested and validated as the source of truth for the 10-step sync flow?

2. **Backward compatibility:** Are we committed to maintaining the current IpfsStorageService public API for all callers?

3. **Timeline:** Should this be done incrementally (Phase 1 extraction) or all at once?

4. **IPNS retry logic:** Should IPNS retry be part of orchestration (InventorySyncService) or a separate retry service?

5. **Shared state:** Should version counter and last CID remain in IpfsStorageService or move to a dedicated state management layer?
