# IpfsStorageService Refactoring: Practical Code Examples

## Overview
This document provides side-by-side code examples showing the transformation from current monolithic design to separated concerns.

---

## Example 1: syncFromIpns() - Before and After

### BEFORE: Current Monolithic (268 lines with duplicate logic)

```typescript
async syncFromIpns(): Promise<StorageResult> {
  console.log(`📦 Starting IPNS-based sync...`);

  this.isInitialSyncing = true;
  this.isInsideSyncFromIpns = true;
  this.initialSyncCompletePromise = new Promise<void>((resolve) => {
    this.initialSyncCompleteResolver = resolve;
  });
  this.emitSyncStateChange();

  try {
    const initialized = await this.ensureInitialized();
    if (!initialized) {
      console.warn(`📦 Not initialized, skipping IPNS sync`);
      return { success: false, timestamp: Date.now(), error: "Not initialized" };
    }

    // TRANSPORT: Resolve IPNS (good)
    const resolution = await this.resolveIpnsProgressively(
      (lateResult) => this.handleHigherSequenceDiscovered(lateResult)
    );
    const remoteCid = resolution.best?.cid || null;

    // TRANSPORT: Fetch content (good)
    let remoteData: TxfStorageData | null = null;
    if (resolution.best?._cachedContent && resolution.best.cid === cidToFetch) {
      // CID verification...
      remoteData = resolution.best._cachedContent;
    } else {
      remoteData = await this.fetchRemoteContent(cidToFetch);
    }

    if (!remoteData) {
      // Error handling...
      return { success: false, timestamp: Date.now(), error: "..." };
    }

    // ⚠️ PROBLEM: Version comparison (duplicate logic)
    const localVersion = this.getVersionCounter();
    const remoteVersion = remoteData._meta.version;

    if (remoteVersion > localVersion) {
      console.log(`📦 Remote is newer, importing...`);

      // ⚠️ PROBLEM: importRemoteData duplicates InventorySyncService logic!
      // This method (342 lines) contains:
      // - sanityCheckTombstones()
      // - compareTokenVersions()
      // - sanityCheckMissingTokens()
      // - Token merge logic
      // ALL of which are duplicated in InventorySyncService
      const importedCount = await this.importRemoteData(remoteData);

      // ⚠️ PROBLEM: Running separate sanity checks AFTER import
      // Should be integrated into sync, not reactive
      await this.runSpentTokenSanityCheck();
      await this.runTombstoneRecoveryCheck();

      return {
        success: true,
        cid: cidToFetch,
        ipnsName: this.cachedIpnsName || undefined,
        timestamp: Date.now(),
        version: remoteVersion,
      };
    } else if (remoteVersion < localVersion) {
      console.log(`📦 Local is newer, checking for new remote tokens...`);

      // ⚠️ PROBLEM: importRemoteData called again!
      const importedCount = await this.importRemoteData(remoteData);
      if (importedCount > 0) {
        window.dispatchEvent(new Event("wallet-updated"));
      }

      // ⚠️ PROBLEM: localDiffersFromRemote also uses compareTokenVersions()
      if (this.localDiffersFromRemote(remoteData)) {
        console.log(`📦 Local differs from remote, syncing...`);
        return this.syncNow({ forceIpnsPublish: ipnsNeedsRecovery });
      } else {
        // Local now matches remote
        this.setLastCid(cidToFetch);
        this.setVersionCounter(remoteVersion);

        await this.runSpentTokenSanityCheck();
        await this.runTombstoneRecoveryCheck();

        return { success: true, cid: cidToFetch, version: remoteVersion };
      }
    } else {
      // Same version - remote is in sync
      console.log(`📦 Versions match (v${remoteVersion}), remote verified accessible`);

      await this.runSpentTokenSanityCheck();
      await this.runTombstoneRecoveryCheck();

      return { success: true, cid: cidToFetch, version: remoteVersion };
    }
  } finally {
    this.isInitialSyncing = false;
    this.isInsideSyncFromIpns = false;
    if (this.initialSyncCompleteResolver) {
      this.initialSyncCompleteResolver();
      this.initialSyncCompleteResolver = null;
      this.initialSyncCompletePromise = null;
    }
    this.emitSyncStateChange();
  }
}
```

**Problems with this approach:**
1. **Duplicate token validation** - Also done in InventorySyncService
2. **Duplicate conflict resolution** - Also done in ConflictResolutionService
3. **Duplicate version comparison** - compareTokenVersions() method exists
4. **Reactive sanity checks** - Run AFTER import instead of being integrated
5. **Inconsistent logic** - Different code paths for different situations
6. **Hard to test** - Need to mock too many dependencies

### AFTER: Clean Delegation (80 lines with clear responsibilities)

```typescript
async syncFromIpns(): Promise<StorageResult> {
  console.log(`📦 Starting IPNS-based sync...`);

  this.isInitialSyncing = true;
  this.isInsideSyncFromIpns = true;
  this.initialSyncCompletePromise = new Promise<void>((resolve) => {
    this.initialSyncCompleteResolver = resolve;
  });
  this.emitSyncStateChange();

  try {
    const initialized = await this.transport.ensureInitialized();
    if (!initialized) {
      console.warn(`📦 Not initialized, skipping IPNS sync`);
      return { success: false, timestamp: Date.now(), error: "Not initialized" };
    }

    // TRANSPORT: Resolve IPNS progressively from multiple gateways
    const resolution = await this.transport.resolveIpnsProgressively();
    if (!resolution?.best) {
      console.warn(`📦 IPNS resolution failed`);
      return { success: false, timestamp: Date.now(), error: "IPNS resolution failed" };
    }

    const remoteCid = resolution.best.cid;
    console.log(
      `📦 IPNS resolved: seq=${resolution.best.sequence}, ` +
      `${resolution.respondedCount}/${resolution.totalGateways} gateways responded`
    );

    // TRANSPORT: Fetch remote content
    const remoteData = await this.transport.fetchRemoteContent(remoteCid);
    if (!remoteData) {
      // If can't fetch but local is empty, don't overwrite remote
      const localTokenCount = WalletRepository.getInstance().getTokens().length;
      if (localTokenCount === 0) {
        console.error(`🚨 Cannot fetch remote and local wallet is EMPTY!`);
        return {
          success: false,
          timestamp: Date.now(),
          error: "Blocked: refusing to overwrite remote with empty local state"
        };
      }
      // Local has content - safe to republish
      console.warn(`📦 Failed to fetch remote content, will republish local`);
      return this.syncNow({ forceIpnsPublish: true });
    }

    // ORCHESTRATION: Delegate to InventorySyncService for merge
    // This service owns the 10-step sync flow with proper validation
    const mergeResult = await this.inventorySync.mergeRemoteInventory(remoteData);

    if (!mergeResult.success) {
      return { success: false, timestamp: Date.now(), error: mergeResult.error };
    }

    // TRANSPORT: Publish merged state to IPNS
    const publishResult = await this.transport.publishContent(mergeResult.data);

    console.log(`📦 IPNS sync completed: v${mergeResult.version}`);

    return {
      success: true,
      cid: publishResult.cid,
      ipnsName: this.transport.getIpnsName() || undefined,
      timestamp: Date.now(),
      version: mergeResult.version,
    };
  } finally {
    this.isInitialSyncing = false;
    this.isInsideSyncFromIpns = false;
    if (this.initialSyncCompleteResolver) {
      this.initialSyncCompleteResolver();
      this.initialSyncCompleteResolver = null;
      this.initialSyncCompletePromise = null;
    }
    this.emitSyncStateChange();
  }
}
```

**Improvements:**
- ✅ Clear separation: Transport (IPFS operations) vs Orchestration (sync logic)
- ✅ No duplication: All merge logic delegated to InventorySyncService
- ✅ Single source of truth: InventorySyncService owns validation/merge
- ✅ Easier to test: Can test IpfsTransportService, InventorySyncService separately
- ✅ 70% less code: Removes 188 lines of duplicate logic

---

## Example 2: importRemoteData() - Before and After

### BEFORE: Giant Method with Duplicate Logic (342 lines)

```typescript
// Lines 2372-2714 in current IpfsStorageService
private async importRemoteData(remoteTxf: TxfStorageData): Promise<number> {
  const walletRepo = WalletRepository.getInstance();

  const { tokens: remoteTokens, nametag, tombstones: remoteTombstones } =
    parseTxfStorageData(remoteTxf);

  // ... imports outbox, mint outbox, invalidated nametags ...

  // PROBLEM 1: Calls sanityCheckTombstones() - DUPLICATE
  if (newTombstones.length > 0) {
    const result = await this.sanityCheckTombstones(newTombstones, walletRepo);
    validTombstones = result.validTombstones;
    tokensToRestore = result.tokensToRestore;
  }

  // Apply tombstones
  const removedCount = walletRepo.mergeTombstones(tombstonesToApply);

  // PROBLEM 2: Loops through tokens and calls compareTokenVersions()
  for (const remoteToken of remoteTokens) {
    const tokenId = remoteTxf.genesis.data.tokenId;
    const localToken = localTokenMap.get(tokenId);

    if (!localToken) {
      walletRepo.addToken(remoteToken);
      importedCount++;
    } else {
      // PROBLEM: compareTokenVersions() is duplicated logic!
      const comparison = this.compareTokenVersions(localTxf, remoteTxf);

      if (comparison === "remote") {
        // Archive local fork if different state
        walletRepo.storeForkedToken(tokenId, localStateHash, localTxf);
        walletRepo.updateToken(remoteToken);
        importedCount++;
      } else if (comparison === "local") {
        // Archive remote fork if different state
        walletRepo.storeForkedToken(tokenId, remoteStateHash, remoteTxf);
      }
    }
  }

  // ... imports archived, forked, nametag ...

  return importedCount;
}
```

**Problems:**
1. **342 lines** of merge logic that InventorySyncService should own
2. **Calls sanityCheckTombstones()** - 75 line duplicate method
3. **Calls compareTokenVersions()** - 65 line duplicate method
4. **Embedded validation** - Not separated from merge
5. **Hard to test** - Tightly coupled to WalletRepository, InventorySyncService, etc.

### AFTER: Deleted (InventorySyncService Handles It)

```typescript
// DELETE THIS METHOD ENTIRELY!
//
// Instead, call InventorySyncService which has:
//   mergeRemoteInventory(remoteData): Promise<{
//     success: boolean
//     data: TxfStorageData      // Merged state
//     version: number
//     error?: string
//   }>
//
// InventorySyncService already implements:
// - Token validation (validateAllTokens)
// - Version comparison (compareTokens)
// - Tombstone verification (sanityCheckTombstones)
// - Conflict resolution (resolveConflict)
// - Missing token recovery (sanityCheckMissingTokens)
//
// All in one coordinated 10-step flow with proper error handling
//
// Usage in syncFromIpns():
const mergeResult = await this.inventorySync.mergeRemoteInventory(remoteData);
if (!mergeResult.success) {
  return { success: false, error: mergeResult.error };
}
return { success: true, data: mergeResult.data, version: mergeResult.version };
```

**Improvement:**
- ✅ 342 lines removed
- ✅ Single source of truth (InventorySyncService owns merge)
- ✅ Consistent behavior (one code path for all sync scenarios)
- ✅ Easier to debug (trace through InventorySyncService, not two places)
- ✅ Easier to test (test InventorySyncService merge behavior separately)

---

## Example 3: Token Version Comparison - Before and After

### BEFORE: Duplicate compareTokenVersions()

```typescript
// Lines 2234-2298 in IpfsStorageService
private compareTokenVersions(localTxf: TxfToken, remoteTxf: TxfToken): "local" | "remote" | "equal" {
  // Count committed transactions
  const countCommitted = (txf: TxfToken): number => {
    return txf.transactions.filter(tx => tx.inclusionProof !== null).length;
  };

  const localCommitted = countCommitted(localTxf);
  const remoteCommitted = countCommitted(remoteTxf);

  // 1. Committed beats pending
  if (localCommitted > 0 && remoteCommitted === 0 && remoteHasPending) {
    return "local";
  }
  if (remoteCommitted > 0 && localCommitted === 0 && localHasPending) {
    return "remote";
  }

  // 2. Compare committed chain lengths
  if (localCommitted > remoteCommitted) return "local";
  if (remoteCommitted > localCommitted) return "remote";

  // 3. Compare proof counts
  // ... 20 more lines of logic ...

  // 4. Deterministic tiebreaker
  // ... 10 more lines ...

  return "local";
}
```

**Used by:**
- Line 2348: `localDiffersFromRemote()` - Check if local is better
- Line 2586: `importRemoteData()` - Compare versions during import

**Problem:** This logic ALSO exists in InventorySyncService for conflict resolution. Two implementations = inconsistent behavior.

### AFTER: Single Implementation in InventorySyncService

```typescript
// IpfsStorageService: REMOVE compareTokenVersions()
//
// InventorySyncService: Use existing implementation
//   compareTokens(local: TxfToken, remote: TxfToken): "local" | "remote" | "equal"
//   {
//     // All comparison logic here (already exists!)
//     // Counts committed transactions
//     // Compares chain lengths
//     // Handles pending vs committed
//     // Uses genesis hash tiebreaker
//   }
//
// When you need to compare tokens in IpfsStorageService:
const comparison = this.inventorySync.compareTokens(localTxf, remoteTxf);
if (comparison === "remote") {
  // Remote is better
}
```

**Benefit:**
- ✅ 65 lines removed
- ✅ Single source of truth
- ✅ Test logic once, use everywhere
- ✅ Consistent behavior

---

## Example 4: Sanity Checks - Before and After

### BEFORE: Three Reactive Sanity Check Methods

```typescript
// Lines 1897-1971: sanityCheckTombstones() - 75 lines
async sanityCheckTombstones(tombstones, walletRepo): Promise<{
  validTombstones: TombstoneEntry[]
  invalidTombstones: TombstoneEntry[]
  tokensToRestore: Array<{tokenId, txf}>
}> {
  // Build token map from archived versions
  // Call TokenValidationService.checkUnspentTokens()
  // Categorize valid vs invalid
  // Return tokens to restore
}

// Lines 1978-2043: sanityCheckMissingTokens() - 66 lines
async sanityCheckMissingTokens(localTokens, remoteTokenIds, remoteTombstoneIds): Promise<...> {
  // Find tokens in local but not remote (not tombstoned)
  // Check which are unspent on Unicity
  // Return tokens to preserve
}

// Lines 2078-2130: runSpentTokenSanityCheck() - 53 lines
async runSpentTokenSanityCheck(): Promise<void> {
  // Get all tombstoned tokens
  // Verify they're still spent on Unicity
  // Archive any that shouldn't be spent
}

// Lines 2132-2167: runTombstoneRecoveryCheck() - 36 lines
async runTombstoneRecoveryCheck(): Promise<void> {
  // Recover false tombstones
  // Restore tokens that shouldn't be spent
}

// Called from syncFromIpns():
await this.runSpentTokenSanityCheck();     // Line 2918
await this.runTombstoneRecoveryCheck();    // Line 2919
```

**Problems:**
1. **230 lines total** of validation logic
2. **4 separate methods** doing validation steps
3. **Reactive pattern** - Checks run AFTER sync instead of being integrated
4. **Duplicate of InventorySyncService** - Already does comprehensive validation
5. **Race conditions** - Multiple checks instead of coordinated validation

### AFTER: Integrated into InventorySyncService

```typescript
// IpfsStorageService: REMOVE all sanity check methods
//   - Remove sanityCheckTombstones()      (75 lines)
//   - Remove sanityCheckMissingTokens()   (66 lines)
//   - Remove runSpentTokenSanityCheck()   (53 lines)
//   - Remove runTombstoneRecoveryCheck()  (36 lines)
//
// InventorySyncService: Already implements comprehensive validation
//   mergeRemoteInventory() includes:
//     1. validateAllTokens() - Verify tokens exist on-chain
//     2. sanityCheckTombstones() - Verify tokens are actually spent
//     3. sanityCheckMissingTokens() - Recover tokens missing from remote
//     4. resolveConflict() - Handle version conflicts
//     5. mergeTokens() - Combine local + remote
//     6. verifyMergedState() - Post-merge validation
//
// No need for separate sanity checks - all integrated!
const mergeResult = await this.inventorySync.mergeRemoteInventory(remoteData);
// Validation already happened inside mergeRemoteInventory()
```

**Improvements:**
- ✅ 230 lines removed (5.7% of file)
- ✅ Integrated validation (not reactive)
- ✅ Single coordinated flow
- ✅ No race conditions
- ✅ Easier to test

---

## Example 5: IPNS Retry Loop - Before and After

### BEFORE: Complex Retry Logic Embedded in IpfsStorageService

```typescript
// Lines 875-987: IPNS Retry Loop
private startIpnsSyncRetryLoop(): void {
  if (this.ipnsSyncRetryActive) return;

  this.ipnsSyncRetryActive = true;
  this.ipnsSyncRetryCount = 0;
  console.log(`📦 [RetryLoop] Starting IPNS sync retry loop...`);

  this.runIpnsSyncRetryIteration();
}

private async runIpnsSyncRetryIteration(): Promise<void> {
  if (!this.ipnsSyncRetryActive) return;

  this.ipnsSyncRetryCount++;
  const attempt = this.ipnsSyncRetryCount;

  // Exponential backoff + jitter
  const baseDelay = Math.min(
    this.BASE_IPNS_RETRY_DELAY_MS * Math.pow(1.5, attempt - 1),
    this.MAX_IPNS_RETRY_DELAY_MS
  );
  const jitter = 0.5 + Math.random();
  const delayMs = Math.round(baseDelay * jitter);

  await new Promise(resolve => setTimeout(resolve, delayMs));

  if (!this.ipnsSyncRetryActive) return;

  try {
    // PROBLEM: Calls importRemoteData() - will be deleted!
    const remoteData = await this.fetchRemoteContent(remoteCid);
    if (remoteData) {
      await this.importRemoteData(remoteData);  // ← This will disappear
    }

    const result = await this.syncNow({ forceIpnsPublish: true, isRetryAttempt: true });

    if (result.success && result.ipnsPublished) {
      console.log(`✅ [RetryLoop] IPNS sync succeeded`);
      this.ipnsSyncRetryActive = false;
      return;
    }
  } catch (error) {
    console.error(`📦 [RetryLoop] Attempt ${attempt} failed:`, error);
  }

  // Schedule next iteration
  if (this.ipnsSyncRetryActive) {
    setTimeout(() => this.runIpnsSyncRetryIteration(), 0);
  }
}

private stopIpnsSyncRetryLoop(): void {
  if (this.ipnsSyncRetryActive) {
    console.log(`📦 [RetryLoop] Stopping IPNS sync retry loop`);
    this.ipnsSyncRetryActive = false;
    this.ipnsSyncRetryCount = 0;
  }
}

// Called from executeSyncInternal():
if (!httpSuccess) {
  this.setPendingIpnsPublish(cidString);
  ipnsPublishPending = true;
  if (!isRetryAttempt) {
    this.startIpnsSyncRetryLoop();  // Start exponential backoff retry
  }
}
```

**Problems:**
1. **103 lines** of retry logic
2. **Calls importRemoteData()** which will be deleted
3. **Complex state management** - Tracks retry count, active flag, etc.
4. **Mixes orchestration with transport** - Should be separated

### AFTER: Simplified with InventorySyncService Handling Retries

```typescript
// Option A: Simple delegation to InventorySyncService
private startIpnsSyncRetryLoop(): void {
  // Delegate to InventorySyncService to handle retry logic
  this.inventorySync.startIpnsSyncRetry({
    maxRetries: 10,
    initialDelayMs: 1000,
    maxDelayMs: 30000,
    onAttempt: (attempt) => console.log(`Retry attempt ${attempt}`),
    onSuccess: () => this.stopIpnsSyncRetryLoop(),
  });
}

private stopIpnsSyncRetryLoop(): void {
  this.inventorySync.stopIpnsSyncRetry();
}

// Option B: Or move retry logic entirely to IpnsSyncRetryService
private startIpnsSyncRetryLoop(): void {
  const retryService = new IpnsSyncRetryService(this.transport, this.inventorySync);
  retryService.start({
    remoteData: this.lastRemoteData,
    maxRetries: 10,
  });
}

// Called from executeSyncInternal():
if (!httpSuccess) {
  // Simpler - just start retry, don't manage pending CID manually
  this.startIpnsSyncRetryLoop();
}
```

**Improvements:**
- ✅ Retry logic delegated (simpler IpfsStorageService)
- ✅ No longer calls importRemoteData()
- ✅ Can move to separate service if needed
- ✅ Cleaner error handling

---

## Example 6: New Public API - Before and After

### BEFORE: Complex Public Interface

```typescript
// Current IpfsStorageService public API is large and unclear:
public async syncNow(options?: SyncOptions): Promise<StorageResult>
public async syncFromIpns(): Promise<StorageResult>
public getStatus(): StorageStatus
public getLastSync(): StorageResult | null
public async getWalletForRestore(): Promise<WalletForRestoreResult>
public onEvent(callback: StorageEventCallback): () => void
public startAutoSync(): void
public async shutdown(): Promise<void>
public stopIpnsSyncRetryLoop(): void
// ... plus many private methods exposed for testing ...
```

**Problem:** Unclear which methods are for what. Hard to understand which service owns what responsibility.

### AFTER: Clear, Focused Public API

```typescript
// IpfsStorageService: Thin wrapper with clear responsibilities
export interface IpfsStorageService {
  // Lifecycle
  static getInstance(identityManager): IpfsStorageService
  static resetInstance(): Promise<void>
  startAutoSync(): void
  shutdown(): Promise<void>

  // Main operations (clear delegation)
  async syncNow(options?: SyncOptions): Promise<StorageResult>
    // Delegates to:
    //   - IpfsTransportService.publishContent()
    //   - InventorySyncService.mergeRemoteInventory()
    //   - IpfsTransportService.publishToIpns()

  async syncFromIpns(): Promise<StorageResult>
    // Delegates to:
    //   - IpfsTransportService.resolveIpnsProgressively()
    //   - IpfsTransportService.fetchRemoteContent()
    //   - InventorySyncService.mergeRemoteInventory()
    //   - IpfsTransportService.publishContent()

  // Status queries
  getStatus(): StorageStatus
  getLastSync(): StorageResult | null

  // Events
  onEvent(callback: StorageEventCallback): () => void

  // Retry management
  stopIpnsSyncRetryLoop(): void
}

// IpfsTransportService: Pure IPFS operations
export interface IpfsTransportService {
  // IPNS resolution
  async resolveIpns(): Promise<{
    cid: string
    sequence: bigint
  } | null>

  // Content operations
  async fetchRemoteContent(cid: string): Promise<TxfStorageData | null>
  async publishContent(data: TxfStorageData): Promise<{ cid: string }>

  // IPNS publishing
  async publishToIpns(cid: string): Promise<{ success: boolean; verified: boolean }>

  // Status
  getStatus(): TransportStatus
  getIpnsName(): string | null
}

// InventorySyncService: Orchestration (unchanged, already focused)
export interface InventorySyncService {
  async mergeRemoteInventory(remote: TxfStorageData): Promise<{
    success: boolean
    data: TxfStorageData  // Merged state
    version: number
    error?: string
  }>

  compareTokens(local: TxfToken, remote: TxfToken): "local" | "remote" | "equal"
  // ... other methods ...
}
```

**Improvements:**
- ✅ Clear separation of concerns
- ✅ Easy to understand which service does what
- ✅ No confusion about responsibilities
- ✅ Each interface is focused and minimal

---

## Summary of Changes

| Aspect | Before | After | Benefit |
|--------|--------|-------|---------|
| **File Size** | 4,018 lines | ~300 lines (IpfsStorageService) | -92% complexity |
| **Duplication** | 692 lines duplicated | 0 lines | Single source of truth |
| **Test Complexity** | High (many dependencies) | Low (clear isolation) | Easier to test |
| **Public API** | Unclear responsibilities | Clear delegation | Obvious usage |
| **Token Merge Logic** | Two implementations | One (InventorySyncService) | Consistent behavior |
| **Token Validation** | Multiple separate checks | Integrated flow | No race conditions |
| **IPNS Publishing** | 200+ lines | ~50 lines (delegated) | Simpler code |
| **Retry Logic** | 103 lines (complex) | ~10 lines (delegated) | Cleaner error handling |

**Total refactoring:**
- Remove: 692 lines (duplicate logic)
- Simplify: 858 lines (delegate to other services)
- Keep: 950 lines (pure transport)
- Add: ~300 lines (thin orchestration wrapper)
- Net: 3,500 lines consolidated into focused services
