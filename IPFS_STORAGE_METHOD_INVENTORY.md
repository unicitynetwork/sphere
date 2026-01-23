# IpfsStorageService: Complete Method Inventory

## Overview
This document provides a line-by-line breakdown of all methods in IpfsStorageService.ts (4,018 lines) for precise refactoring targeting.

---

## SECTION 1: KEEP (Pure Transport)

### 1.1 Initialization & Lifecycle

| Line | Method | Visibility | Purpose | Status |
|------|--------|-----------|---------|--------|
| 191 | `constructor()` | private | Singleton setup | KEEP - essential lifecycle |
| 195 | `getInstance(identityManager)` | static public | Singleton accessor | KEEP - required public API |
| 207 | `resetInstance()` | static async | Reset for identity switch | KEEP - required public API |
| 223 | `startAutoSync()` | public | Enable wallet-updated event listener | KEEP - required public API |
| 245 | `shutdown()` | async public | Cleanup on unmount | KEEP - required public API |

### 1.2 WebCrypto & Availability Checks

| Line | Method | Visibility | Purpose | Status |
|------|--------|-----------|---------|--------|
| 342 | `isWebCryptoAvailable()` | private | Check crypto.subtle availability | KEEP - transport check |
| 356 | `ensureInitialized()` | async private | Lazy Helia init + identity detection | KEEP - core transport lifecycle |

**Note on ensureInitialized():** Contains identity change detection (lines 357-375) which is transport-level concern.

### 1.3 Event System

| Line | Method | Visibility | Purpose | Status |
|------|--------|-----------|---------|--------|
| 285 | `onEvent(callback)` | public | Register event listener | KEEP - public API |
| 292 | `emitEvent(event)` | async private | Emit storage events | KEEP - event dispatch |
| 321 | `emitSyncStateChange()` | private | Emit UI state updates | KEEP - UI notification |

### 1.4 Key Derivation (IPNS Cryptography)

| Line | Method | Visibility | Purpose | Status |
|------|--------|-----------|---------|--------|
| 509 | `hexToBytes(hex)` | private | Encoding utility | KEEP - crypto support |
| 517 | `bytesToHex(bytes)` | private | Encoding utility | KEEP - crypto support |
| 526 | `migrateStorageKeys(oldName, newName)` | private | Storage migration on IPNS name change | KEEP - format migration |
| 400-413 | Key derivation in ensureInitialized | private | HKDF Ed25519 derivation from wallet secret | KEEP - inline in transport |

### 1.5 Connection Gating (Peer Filtering)

| Line | Method | Visibility | Purpose | Status |
|------|--------|-----------|---------|--------|
| 561 | `createConnectionGater(bootstrapPeers)` | private | Restrict connections to bootstrap peers | KEEP - peer filtering |

**Lines 464-486:** Peer event handlers in Helia initialization - KEEP inline

### 1.6 IPNS Sequence Management

| Line | Method | Visibility | Purpose | Status |
|------|--------|-----------|---------|--------|
| 615 | `getIpnsSequenceNumber()` | private | Fetch sequence from localStorage | KEEP - state tracking |
| 625 | `setIpnsSequenceNumber(seq)` | private | Store sequence to localStorage | KEEP - state persistence |

**Used by:** publishToIpns() (line 768-771), IPNS retry loop (line 937)

### 1.7 IPNS Publishing (Dual HTTP + DHT Strategy)

| Line | Method | Visibility | Purpose | Status |
|------|--------|-----------|---------|--------|
| 637 | `publishIpnsViaHttp(marshalledRecord)` | async private | HTTP/Kubo backend publishing | KEEP - primary publish path |
| 716 | `publishIpnsViaDhtAsync(routingKey, marshalledRecord)` | private | Fire-and-forget DHT publish | KEEP - fallback path |
| 752 | `publishToIpns(cid)` | async private | Main IPNS publish orchestrator | KEEP - core transport operation |

**Note:** publishToIpns includes verification logic (lines 799-848) which is transport-level (confirms HTTP publish success).

### 1.8 Pending IPNS Tracking

| Line | Method | Visibility | Purpose | Status |
|------|--------|-----------|---------|--------|
| 1734 | `getPendingIpnsPublish()` | private | Fetch pending CID from storage | KEEP - recovery mechanism |
| 1743 | `setPendingIpnsPublish(cid)` | private | Store CID for retry | KEEP - recovery mechanism |
| 1753 | `clearPendingIpnsPublish()` | private | Clear after success | KEEP - recovery mechanism |
| 1762 | `retryPendingIpnsPublish()` | async private | Retry previously failed publish | KEEP - recovery mechanism |

### 1.9 IPNS Resolution (Multi-Gateway Racing)

| Line | Method | Visibility | Purpose | Status |
|------|--------|-----------|---------|--------|
| 1432 | `resolveIpnsProgressively(onLateArrival)` | async private | Multi-gateway IPNS resolution racing | KEEP - pure transport |
| 1513 | `resolveIpnsFromGateway(gatewayUrl)` | async private | Single gateway HTTP resolution | KEEP - transport helper |
| 1544 | `handleHigherSequenceDiscovered(lateResult)` | private | Callback for late-arriving higher sequences | KEEP - transport event |

**Note (lines 1544-1562):** Calls `importRemoteData()` - this needs refactoring to NOT call orchestration logic.

### 1.10 Content Fetching (HTTP + Helia Fallback)

| Line | Method | Visibility | Purpose | Status |
|------|--------|-----------|---------|--------|
| 1794 | `fetchRemoteContent(cidString)` | async private | Dual-path content fetch (HTTP + Helia) | KEEP - pure transport |

**Size:** 92 lines (lines 1794-1886)
**Delegation:** Uses IpfsHttpResolver and Helia, not orchestration logic

### 1.11 Storage State Management

| Line | Method | Visibility | Purpose | Status |
|------|--------|-----------|---------|--------|
| 1682 | `getVersionCounter()` | private | Read version from localStorage | KEEP - state access |
| 1691 | `incrementVersionCounter()` | private | Increment and persist version | KEEP - state update |
| 1703 | `setVersionCounter(version)` | private | Set version to specific value | KEEP - state update |
| 1712 | `getLastCid()` | private | Read last CID from localStorage | KEEP - state access |
| 1721 | `setLastCid(cid)` | private | Store last CID to localStorage | KEEP - state persistence |

**Status:** Keep as private utilities (not transport, but associated state)

### 1.12 Backend Connection Management

**Lines 488-489, 1315-1370:** Connection maintenance
- `startBackendConnectionMaintenance()` - Periodic ping to backend peer
- `ensureBackendConnected()` - Verify backend peer connected

**Status:** KEEP - transport-level peer management

### 1.13 Tab Visibility & Polling

**Lines 180-182, 235, 254, 1095-1250:** Visibility listener setup
- `setupVisibilityListener()` - Register visibility change handler
- `cleanupVisibilityListener()` - Unregister listener
- Adapts IPNS polling frequency based on tab visibility

**Status:** KEEP - transport-level optimization

---

## SECTION 2: REMOVE (Orchestration Duplication)

### 2.1 Token Comparison (CRITICAL DUPLICATION)

| Line | Method | Size | Current Purpose | Problem | Action |
|------|--------|------|-----------------|---------|--------|
| 2234 | `compareTokenVersions(localTxf, remoteTxf)` | 65 lines | Compare local vs remote token versions | Duplicates InventorySyncService logic | **REMOVE** |

**Lines 2236-2298:** Logic comparison:
- Lines 2240-2241: Count committed transactions
- Lines 2245-2257: Prefer committed over pending
- Lines 2260-2267: Compare committed chain lengths
- Lines 2270-2280: Compare proof counts
- Lines 2283-2297: Check state hash and use genesis hash tiebreaker

**Used in:**
- Line 2348: localDiffersFromRemote()
- Line 2586: importRemoteData()

**Migration:** InventorySyncService already implements this logic in conflict resolution.

### 2.2 Local vs Remote Diff Detection (DUPLICATION)

| Line | Method | Size | Current Purpose | Problem | Action |
|------|--------|------|-----------------|---------|--------|
| 2304 | `localDiffersFromRemote(remoteData)` | 55 lines | Check if local state differs from remote | Duplicates version comparison | **REMOVE** |

**Lines 2308-2357:** Logic:
- Lines 2309-2319: Compare nametags
- Lines 2321-2331: Extract remote token map
- Lines 2334-2354: Compare each local token
- Lines 2348-2354: Use compareTokenVersions() for each token

**Used in:**
- Line 2912: syncFromIpns() - checks if local unique after import
- Line 2943: syncFromIpns() - checks if local unique before publish

**Migration:** InventorySyncService mergeRemoteTokens() returns merged data; no need to re-check.

### 2.3 Tombstone Sanity Checking (CRITICAL DUPLICATION)

| Line | Method | Size | Current Purpose | Problem | Action |
|------|--------|------|-----------------|---------|--------|
| 1897 | `sanityCheckTombstones(tombstones, walletRepo)` | 75 lines | Verify tombstones are actually spent on Unicity | Duplicates token validation | **REMOVE** |

**Lines 1897-1971:** Logic:
- Lines 1920-1927: Build token map from archived versions
- Lines 1938-1944: Call TokenValidationService.checkUnspentTokens()
- Lines 1948-1964: Categorize valid vs invalid tombstones
- Lines 1952-1957: Identify tokens to restore

**Used in:**
- Line 2452: importRemoteData() - check new tombstones
- (Missing from syncFromIpns()!)

**Problem:** syncFromIpns() doesn't call this - tokens may be incorrectly deleted!

**Migration:** InventorySyncService owns token validation; use its results.

### 2.4 Missing Token Sanity Check (DUPLICATION)

| Line | Method | Size | Current Purpose | Problem | Action |
|------|--------|------|-----------------|---------|--------|
| 1978 | `sanityCheckMissingTokens(localTokens, remoteTokenIds, remoteTombstoneIds)` | 66 lines | Recover tokens missing from remote (without tombstone) | Duplicates validation | **REMOVE** |

**Lines 1978-2043:** Logic:
- Lines 1986-1995: Find tokens in local but not remote (not tombstoned)
- Lines 2027-2031: Check which are unspent on Unicity
- Lines 2033-2041: Preserve unspent, remove spent

**Used in:**
- Line 2432: importRemoteData() - recover missing tokens

**Migration:** Part of InventorySyncService validation flow.

### 2.5 Spent Token Sanity Check (DUPLICATION)

| Line | Method | Size | Current Purpose | Problem | Action |
|------|--------|------|-----------------|---------|--------|
| 2078 | `runSpentTokenSanityCheck()` | 53 lines | Verify spent tokens still spent on Unicity | Duplicate validation check | **REMOVE** |

**Lines 2078-2130:** Logic:
- Lines 2083-2095: Get all tombstoned tokens
- Lines 2103-2109: Call TokenValidationService to verify spent
- Lines 2110-2127: Log and archive any tokens that shouldn't be spent

**Used in:**
- Line 2918: syncFromIpns() after remote import
- Line 2959: syncFromIpns() after local newer
- Line 2987: syncFromIpns() when versions match

**Migration:** These checks should run as part of InventorySyncService validation, not after sync.

### 2.6 Tombstone Recovery Check (DUPLICATION)

| Line | Method | Size | Current Purpose | Problem | Action |
|------|--------|------|-----------------|---------|--------|
| 2132 | `runTombstoneRecoveryCheck()` | 36 lines | Recover false tombstones (tokens marked spent but unspent) | Duplicate recovery logic | **REMOVE** |

**Lines 2132-2167:** Logic:
- Lines 2140-2143: Get all tombstoned tokens
- Lines 2147-2150: Call TokenValidationService to check unspent
- Lines 2151-2165: Restore any false tombstones

**Used in:**
- Line 2919: syncFromIpns() after remote import
- Line 2960: syncFromIpns() after local newer
- Line 2988: syncFromIpns() when versions match

**Migration:** Should be preventive (don't create false tombstones) not reactive (recover after sync).

---

## SECTION 3: MASSIVE DUPLICATION (CRITICAL)

### 3.1 Data Import & Merge (THE MAIN PROBLEM)

| Line | Method | Size | Lines | Problem | Action |
|------|--------|------|-------|---------|--------|
| 2372 | `importRemoteData(remoteTxf)` | 342 lines | 2372-2714 | **THIS IS InventorySyncService's core function!** | **DELETE ENTIRELY** |

**Breakdown of lines 2372-2714:**

#### Subsection 3.1a: Outbox/Metadata Import (30 lines, 2381-2401)
```
Lines 2381-2385:   Import outbox entries (delegates to OutboxRepository)
Lines 2388-2392:   Import mint outbox entries (delegates to OutboxRepository)
Lines 2395-2401:   Import invalidated nametags (delegates to WalletRepository)
```
**Status:** These delegations are OK (calling repos), but orchestration of when to call belongs in InventorySyncService.

#### Subsection 3.1b: Sanity Checks (195 lines, 2417-2486)
```
Lines 2421-2436:   Build remote token ID set
Lines 2438-2444:   Get new tombstones
Lines 2450-2459:   CALLS sanityCheckTombstones() ← DUPLICATE
Lines 2462-2467:   Restore invalid tombstones
Lines 2470-2486:   Apply valid tombstones
```
**Status:** All calls to sanityCheckTombstones() should be removed.

#### Subsection 3.1c: Token Import/Update (100+ lines, 2508-2617)
```
Lines 2508-2516:   Iterate remote tokens
Lines 2520-2536:   Repair genesis-only tokens (calls repairMissingStateHash)
Lines 2563-2572:   Skip tombstoned tokens
Lines 2576-2616:   Compare versions & import
   Lines 2586:     CALLS compareTokenVersions() ← DUPLICATE
   Lines 2594-2600: Archive forked versions (delegates to WalletRepository)
   Lines 2602-2604: Update with remote version
   Lines 2609-2613: Archive remote fork (delegates to WalletRepository)
```
**Status:** Token comparison and archive management are orchestration duties.

#### Subsection 3.1d: Nametag Handling (15 lines, 2620-2705)
```
Lines 2653-2668:   Import nametag if not corrupted
```
**Status:** Nametag import is orchestration.

**Total problems in importRemoteData():**
1. Calls `sanityCheckTombstones()` - DUPLICATE
2. Calls `compareTokenVersions()` - DUPLICATE
3. Calls `sanityCheckMissingTokens()` - DUPLICATE
4. Contains entire merge logic - BELONGS IN InventorySyncService
5. Called from `syncFromIpns()` line 2890 and 2934
6. Called from `executeSyncInternal()` line 3198-3203

**Why this must be deleted:**
- InventorySyncService already implements a 10-step sync flow with proper validation
- This creates two different merge strategies (inconsistent)
- Causes token loss if logic differs between paths
- Makes testing impossible (two different implementations)

---

## SECTION 4: SYNC ORCHESTRATION (REFACTOR - Delegate to InventorySyncService)

### 4.1 IPNS-Based Startup Sync

| Line | Method | Size | Current Purpose | Refactor Action |
|------|--------|------|-----------------|-----------------|
| 2741 | `syncFromIpns()` | 268 lines | Startup IPNS resolution + local merge | Refactor to delegate |

**Lines 2741-3009:** Breakdown:

#### Step 1: Resolution (15 lines, 2754-2767)
```
2754:  ensureInitialized() ← TRANSPORT
2760:  retryPendingIpnsPublish() ← TRANSPORT
2763:  resolveIpnsProgressively() ← TRANSPORT
```
**Status:** Keep these (transport operations).

#### Step 2: Version Comparison (90+ lines, 2770-2879)
```
2770-2779:  Compare local vs remote CID
2782-2818:  Handle empty IPNS/recovery scenarios
2820-2878:  Fetch and verify content
```
**Status:** Keep - transport operations.

#### Step 3: Version-Based Decision (200+ lines, 2881-2997)
```
2882-2906:  Remote newer → importRemoteData() ← DUPLICATE!
2928-2970:  Local newer → importRemoteData() ← DUPLICATE!
2970-2996:  Same version → verify accessible
```
**Status:** REFACTOR - Replace importRemoteData() calls with InventorySyncService.mergeRemoteInventory()

**Calls to remove:**
- Line 2890: `await this.importRemoteData(remoteData)`
- Line 2934: `await this.importRemoteData(remoteData)`

**Calls to add:**
```typescript
const mergeResult = await this.inventorySync.mergeRemoteInventory(remoteData);
```

### 4.2 Main Sync Orchestration

| Line | Method | Size | Current Purpose | Refactor Action |
|------|--------|------|-----------------|-----------------|
| 3031 | `syncNow(options)` | 2 lines | Public API - queue sync request | Keep (thin wrapper) |
| 3039 | `executeSyncInternal(options)` | 487 lines | Core sync logic | Refactor to delegate |

**Lines 3039-3526:** Breakdown:

#### Setup (20 lines, 3040-3060)
```
3040-3050:  Wait for initial sync (cross-call protection)
3052-3064:  Acquire cross-tab lock
```
**Status:** Keep - transport/sync coordination.

#### Validation (120 lines, 3074-3137)
```
3075-3098:  Initialize & validate wallet exists
3103-3137:  Validate tokens before sync
   Line 3123: getTokenValidationService().validateAllTokens() ← GOOD
```
**Status:** Keep token validation (correct delegation).

#### Remote Conflict Checking (160 lines, 3140-3315)
```
3143-3159:  Fetch remote data (transport)
3161-3316:  Conflict resolution
   Line 3180: getConflictResolutionService().resolveConflict() ← GOOD
   Lines 3193-3250: Import from mergeResult ← OK (uses ConflictResolutionService)
```
**Status:** Keep - already delegates to ConflictResolutionService.

#### Content Publishing (180 lines, 3320-3455)
```
3323-3360:  Build TXF data
3350-3407:  Store to IPFS & upload to backends (transport)
3409-3425:  Announce to network (transport)
3427-3455:  Publish to IPNS (transport)
```
**Status:** Keep - all transport operations.

---

## SECTION 5: IPNS Retry Loop (ORCHESTRATION - Consider moving)

### 5.1 IPNS Sync Retry Loop

| Line | Method | Size | Current Purpose | Recommendation |
|------|--------|------|-----------------|-----------------|
| 875 | `startIpnsSyncRetryLoop()` | 13 lines | Start exponential backoff retry | Move to InventorySyncService or dedicated service |
| 893 | `runIpnsSyncRetryIteration()` | 83 lines | Single retry iteration with sync | Move to InventorySyncService or dedicated service |
| 980 | `stopIpnsSyncRetryLoop()` | 7 lines | Stop retries | Move to InventorySyncService or dedicated service |

**Lines 875-987:** Details:

```typescript
startIpnsSyncRetryLoop()       // Lines 875-887
  - Sets ipnsSyncRetryActive = true
  - Calls runIpnsSyncRetryIteration()

runIpnsSyncRetryIteration()    // Lines 893-975
  - Line 922-923:    Fetches latest IPNS
  - Line 928-930:    Resolves IPNS
  - Line 940-944:    Fetches remote content
  - Line 943:        CALLS importRemoteData() ← DUPLICATE!
  - Line 949:        CALLS syncNow() with forceIpnsPublish
  - Lines 951-957:   If success, stops retry loop
  - Lines 971-974:   Schedules next iteration with setTimeout

stopIpnsSyncRetryLoop()        // Lines 980-986
  - Sets ipnsSyncRetryActive = false
```

**Issues:**
1. Line 943 calls `importRemoteData()` - will be deleted
2. Retry logic is orchestration (knows about IPNS publish failure)
3. Should be driven by InventorySyncService or separate retry service

**Options:**
- Option A: Move to InventorySyncService as part of sync error handling
- Option B: Create dedicated `IpnsSyncRetryService`
- Option C: Keep in IpfsStorageService but have it call InventorySyncService.mergeRemoteInventory()

---

## SECTION 6: Query & Status Methods

| Line | Method | Visibility | Purpose | Status |
|------|--------|-----------|---------|--------|
| ~410 | `getStatus()` | public | Return StorageStatus with initialized, isSyncing, etc. | KEEP - required public API |
| ~440 | `getLastSync()` | public | Return last StorageResult | KEEP - required public API |
| ~450 | `getWalletForRestore()` | async public | Get wallet data for restore flow | KEEP - required public API |

---

## Summary Table: Line Count by Category

| Category | Lines | Type | Action |
|----------|-------|------|--------|
| Lifecycle & Initialization | ~100 | Transport | KEEP |
| Event System | ~50 | Transport | KEEP |
| IPNS Key Management | ~100 | Transport | KEEP |
| IPNS Publishing (HTTP+DHT) | ~200 | Transport | KEEP |
| IPNS Resolution | ~200 | Transport | KEEP |
| Content Fetching | ~100 | Transport | KEEP |
| Storage State Management | ~50 | Transport/Utility | KEEP |
| Peer Management | ~150 | Transport | KEEP |
| **Subtotal: Transport to KEEP** | **~950** | | |
| | | | |
| Token Comparison | 65 | Orchestration | **REMOVE** |
| Local vs Remote Diff | 55 | Orchestration | **REMOVE** |
| Tombstone Sanity Checks | 75 | Orchestration | **REMOVE** |
| Missing Token Checks | 66 | Orchestration | **REMOVE** |
| Spent Token Checks | 53 | Orchestration | **REMOVE** |
| Tombstone Recovery | 36 | Orchestration | **REMOVE** |
| **Data Import (CRITICAL)** | **342** | Orchestration | **REMOVE** |
| **Subtotal: Orchestration to REMOVE** | **~692** | | |
| | | | |
| syncFromIpns() | 268 | Orchestration | REFACTOR |
| executeSyncInternal() | 487 | Orchestration | REFACTOR |
| IPNS Retry Loop | 103 | Orchestration | MOVE/REFACTOR |
| Query Methods | ~50 | Utility | KEEP |
| Misc Utilities | ~100 | | KEEP |
| **Subtotal: Orchestration to REFACTOR** | **~858** | | |
| | | | |
| **TOTAL FILE** | **4,018** | | |

---

## Refactoring Impact Summary

- **Lines to remove (692):** 17% of file - eliminates duplication
- **Lines to keep (950):** 24% of file - pure transport operations
- **Lines to refactor (858):** 21% of file - delegate to InventorySyncService
- **Lines remaining (518):** 13% of file - new thin wrapper structure
- **Net reduction:** 3,500 lines (87% of original file consolidated into focused services)

---

## Recommended Refactoring Order

1. **Phase 1:** Extract IpfsTransportService (950 lines)
   - No logic changes, same behavior
   - Tests should pass unchanged

2. **Phase 2:** Remove duplicate comparison methods (65 + 55 lines)
   - Verify InventorySyncService has equivalent logic
   - Update calls in importRemoteData()

3. **Phase 3:** Remove duplicate validation methods (75 + 66 + 53 + 36 lines)
   - Ensure InventorySyncService handles all cases
   - Update importRemoteData() to not call these

4. **Phase 4:** Delete importRemoteData() (342 lines)
   - Replace all calls with InventorySyncService.mergeRemoteInventory()
   - Update syncFromIpns() and executeSyncInternal()

5. **Phase 5:** Refactor syncFromIpns() and executeSyncInternal()
   - Simplify by removing now-delegated logic
   - Test cross-device sync scenarios

6. **Phase 6:** Handle IPNS retry loop
   - Move or refactor to use InventorySyncService
   - Maintain exponential backoff behavior
