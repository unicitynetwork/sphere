# IpfsStorageService Refactoring - Implementation Guide

**Phase-by-phase code changes with specific line numbers and examples**

---

## Phase 1: Create Transport Interface

### Create New File: `src/components/wallet/L3/services/IpfsTransport.ts`

```typescript
/**
 * IpfsTransport Interface
 *
 * Provides clean abstraction for IPFS/IPNS network operations.
 * Implementations handle all low-level network details.
 *
 * This interface enables InventorySyncService to orchestrate sync
 * without knowing transport implementation details.
 */

import type { TxfStorageData } from './types/TxfTypes';

/**
 * Result of IPNS resolution
 */
export interface IpnsResolution {
  /** CID of current IPNS record target, or null if not found */
  cid: string | null;

  /** IPNS sequence number, or 0n if not available */
  sequence: bigint;

  /** Cached content from gateway (optional, may be null) */
  content?: TxfStorageData | null;

  /** Gateway(s) that responded, for metrics */
  respondingGateways?: number;
}

/**
 * Result of content upload to IPFS
 */
export interface IpfsUploadResult {
  /** CID of uploaded content */
  cid: string;

  /** Whether upload succeeded */
  success: boolean;

  /** Error message if failed */
  error?: string;
}

/**
 * Result of IPNS publish
 */
export interface IpnsPublishResult {
  /** IPNS name (peer ID) if successful */
  ipnsName: string | null;

  /** Whether publish succeeded (HTTP endpoint at least accepted record) */
  success: boolean;

  /** Error message if failed */
  error?: string;

  /** Whether IPNS publish is pending (retry in progress) */
  publishPending?: boolean;
}

/**
 * Transport layer for IPFS/IPNS operations
 *
 * Responsibilities:
 * - IPNS name resolution (DNS-like lookup to CID)
 * - IPFS content fetch (retrieve data by CID)
 * - IPFS content upload (add data, get CID back)
 * - IPNS publishing (bind CID to IPNS name)
 * - Version tracking (localStorage metadata)
 *
 * NOT responsible for:
 * - Token validation or transformation
 * - Merge logic or conflict resolution
 * - Sync orchestration or workflow control
 */
export interface IpfsTransport {
  // =====================================================
  // Lifecycle
  // =====================================================

  /**
   * Ensure transport is initialized and ready to use.
   *
   * @returns true if initialized successfully, false if WebCrypto unavailable
   */
  ensureInitialized(): Promise<boolean>;

  /**
   * Graceful shutdown of transport.
   */
  shutdown(): Promise<void>;

  // =====================================================
  // IPNS Operations (Step 2 - resolve, Step 10 - publish)
  // =====================================================

  /**
   * Resolve IPNS name to get current CID and metadata.
   *
   * **Used in Step 2 (Load from IPFS):**
   * - Determines which content to fetch
   * - Returns cached content if available (avoids re-fetch)
   *
   * @returns Resolution with CID and optional cached content
   *
   * Implementation notes:
   * - Uses progressive multi-gateway resolution (racing)
   * - Returns fastest result (typically <100ms with cache)
   * - Continues fetching late-arriving responses in background
   * - Never blocks on slow gateways
   *
   * @example
   * const resolution = await transport.resolveIpns();
   * if (resolution.cid) {
   *   // Use cached content if available
   *   const data = resolution.content || await transport.fetchContent(resolution.cid);
   * }
   */
  resolveIpns(): Promise<IpnsResolution>;

  /**
   * Publish CID to IPNS name.
   *
   * **Used in Step 10 (Upload to IPFS):**
   * - Makes new content discoverable via IPNS
   * - Uses HTTP as primary, DHT as fallback
   * - Handles sequence number management (prevents downgrade attacks)
   *
   * @param cid Content to publish
   * @returns Success indicator and IPNS name
   *
   * Implementation notes:
   * - Signs IPNS record with wallet's ed25519 key
   * - Publishes to backend nodes (HTTP) - fast, reliable
   * - Also publishes to DHT in background - slow but decentralized
   * - Verifies HTTP publish success before returning
   * - Starts background retry loop if verification fails
   * - Sequence number prevents older devices from downgrading IPNS
   *
   * @example
   * const result = await transport.publishIpns(cidString);
   * if (result.success) {
   *   console.log(`Published to ${result.ipnsName}`);
   * } else if (result.publishPending) {
   *   console.log("Background retry in progress");
   * }
   */
  publishIpns(cid: string): Promise<IpnsPublishResult>;

  // =====================================================
  // IPFS Content Operations (Step 2, Step 10)
  // =====================================================

  /**
   * Fetch content from IPFS by CID.
   *
   * **Used in Step 2 (Load from IPFS):**
   * - Retrieves token inventory data uploaded by this or other device
   * - Returns TxfStorageData (serialized tokens, tombstones, metadata)
   *
   * @param cid CID to fetch
   * @returns Deserialized TxfStorageData or null if not found
   *
   * Implementation notes:
   * - Uses HTTP resolver with multi-node parallel racing
   * - Falls back to cached content if available
   * - Verifies CID matches returned content (prevents cache attacks)
   * - Timeout: 30 seconds per attempt
   *
   * @example
   * const data = await transport.fetchContent(cidString);
   * if (data) {
   *   const tokens = data._tokens || [];
   *   const tombstones = data._tombstones || [];
   * }
   */
  fetchContent(cid: string): Promise<TxfStorageData | null>;

  /**
   * Upload content to IPFS.
   *
   * **Used in Step 10 (Upload to IPFS):**
   * - Persists merged token inventory to IPFS
   * - Makes content available for other devices via CID
   * - Computes deterministic CID for deduplication
   *
   * @param data TxfStorageData to upload
   * @returns CID and success status
   *
   * Implementation notes:
   * - Serializes to JSON
   * - Uploads to all configured backend nodes (parallel)
   * - Verifies returned CID matches computed CID
   * - Returns success if at least one node accepts
   * - Timeout: 30 seconds per gateway
   *
   * @example
   * const result = await transport.uploadContent({
   *   _meta: { version: 2, ... },
   *   _tokens: [...],
   *   _tombstones: [...]
   * });
   * if (result.success) {
   *   console.log(`Uploaded to CID: ${result.cid}`);
   * }
   */
  uploadContent(data: TxfStorageData): Promise<IpfsUploadResult>;

  // =====================================================
  // Version Tracking (localStorage metadata)
  // =====================================================

  /**
   * Get current version counter for this wallet.
   *
   * Version is incremented on each sync to detect remote changes.
   * Used in Step 2 to decide whether to import remote state.
   *
   * @returns Version number (0 if not set)
   */
  getVersionCounter(): number;

  /**
   * Set version counter to specific value.
   *
   * Called after successful merge to track that we're now at remote version.
   * Persisted to localStorage.
   *
   * @param version New version number
   */
  setVersionCounter(version: number): void;

  /**
   * Get last CID this device published to IPNS.
   *
   * Used in Step 2 to detect whether IPNS has been updated by another device.
   * Also used in Step 10 to avoid redundant uploads (CID unchanged).
   *
   * @returns CID string or null if not set
   */
  getLastCid(): string | null;

  /**
   * Store last CID published to IPNS.
   *
   * Persisted to localStorage. Enables:
   * - Detecting remote changes (Step 2)
   * - Avoiding redundant republish (Step 10)
   * - Recovery after sync interruption
   *
   * @param cid CID to store
   */
  setLastCid(cid: string): void;

  // =====================================================
  // Metadata Access (for logging/debugging)
  // =====================================================

  /**
   * Get current IPNS name (peer ID).
   * Only available after initialization.
   */
  getIpnsName(): string | null;

  /**
   * Get browser's peer ID in IPFS network.
   * Only available after initialization.
   */
  getPeerId(): string | null;
}

/**
 * Get the singleton IpfsTransport instance
 */
export function getIpfsTransport(): IpfsTransport {
  // Implemented by IpfsStorageService
  const service = IpfsStorageService.getInstance(IdentityManager.getInstance());
  // Cast to IpfsTransport (service implements the interface)
  return service as unknown as IpfsTransport;
}
```

---

## Phase 2: Refactor IpfsStorageService

### Step 2a: Add Interface Implementation Declaration

**File**: `src/components/wallet/L3/services/IpfsStorageService.ts`

**Around line 152 (class declaration):**

```typescript
// BEFORE:
export class IpfsStorageService {
  private static instance: IpfsStorageService | null = null;
  // ...
}

// AFTER:
export class IpfsStorageService implements IpfsTransport {
  private static instance: IpfsStorageService | null = null;
  // ...

  // Implement IpfsTransport interface methods (see below)
}
```

### Step 2b: Extract Public Transport Methods

**Extract from private to public methods in IpfsStorageService:**

```typescript
// =====================================================
// IpfsTransport Implementation
// =====================================================

/**
 * Resolve IPNS name via progressive multi-gateway resolution.
 * Public implementation of IpfsTransport.resolveIpns()
 */
async resolveIpns(): Promise<IpnsResolution> {
  const initialized = await this.ensureInitialized();
  if (!initialized) {
    return { cid: null, sequence: 0n };
  }

  const result = await this.resolveIpnsProgressively();

  return {
    cid: result.best?.cid || null,
    sequence: result.best?.sequence || 0n,
    content: result.best?._cachedContent,
    respondingGateways: result.respondedCount,
  };
}

/**
 * Fetch content from IPFS by CID.
 * Public implementation of IpfsTransport.fetchContent()
 */
async fetchContent(cid: string): Promise<TxfStorageData | null> {
  return this.fetchRemoteContent(cid);
}

/**
 * Upload content to IPFS.
 * Public implementation of IpfsTransport.uploadContent()
 *
 * Extracted from executeSyncInternal around line 3200+
 */
async uploadContent(data: TxfStorageData): Promise<IpfsUploadResult> {
  try {
    // 1. Serialize to JSON
    const json = JSON.stringify(data);
    const jsonBlob = new Blob([json], { type: 'application/json' });

    // 2. Get configured gateways
    const gatewayUrls = getAllBackendGatewayUrls();
    if (gatewayUrls.length === 0) {
      console.warn("📦 No IPFS gateways configured");
      return { cid: '', success: false, error: 'No gateways' };
    }

    // 3. Compute expected CID
    let expectedCid: string;
    try {
      expectedCid = await computeCidFromContent(data);
    } catch (e) {
      return { cid: '', success: false, error: 'Failed to compute CID' };
    }

    // 4. Check if CID changed from last upload (optimization)
    const previousCid = this.getLastCid();
    if (previousCid === expectedCid) {
      console.log(`📦 CID unchanged (${expectedCid.slice(0, 16)}...) - skipping upload`);
      return { cid: expectedCid, success: true };
    }

    // 5. Upload to all gateways in parallel
    console.log(`📦 Uploading to ${gatewayUrls.length} IPFS node(s)...`);

    const uploadPromises = gatewayUrls.map(async (gatewayUrl) => {
      try {
        const formData = new FormData();
        formData.append('file', jsonBlob, 'wallet.json');

        const response = await fetch(
          `${gatewayUrl}/api/v0/add?pin=true&cid-version=1`,
          {
            method: 'POST',
            body: formData,
            signal: AbortSignal.timeout(30000),
          }
        );

        if (response.ok) {
          const result = await response.json();
          const returnedCid = result.Hash || result.Cid;
          const hostname = new URL(gatewayUrl).hostname;
          console.log(`    ✓ Uploaded to ${hostname}: ${returnedCid?.slice(0, 16)}...`);
          return { success: true, cid: returnedCid };
        }

        const errorText = await response.text().catch(() => '');
        console.warn(`    ⚠️ Upload to ${new URL(gatewayUrl).hostname} failed: HTTP ${response.status}`);
        return { success: false, error: `HTTP ${response.status}` };
      } catch (error) {
        const hostname = new URL(gatewayUrl).hostname;
        console.warn(`    ⚠️ Upload to ${hostname} failed:`, error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    });

    const results = await Promise.allSettled(uploadPromises);
    const successful = results.filter(
      (r) => r.status === 'fulfilled' && r.value.success
    ) as PromiseFulfilledResult<{ success: true; cid: string }>[];

    if (successful.length === 0) {
      console.error(`❌ Upload failed on all gateways`);
      return { cid: '', success: false, error: 'Upload failed' };
    }

    const returnedCid = successful[0].value.cid;
    if (returnedCid !== expectedCid) {
      console.warn(`⚠️ CID mismatch: expected ${expectedCid.slice(0, 16)}..., got ${returnedCid?.slice(0, 16)}...`);
    }

    console.log(`✓ Content uploaded to ${successful.length}/${gatewayUrls.length} nodes`);
    return { cid: returnedCid || expectedCid, success: true };
  } catch (error) {
    console.error('Failed to upload content:', error);
    return { cid: '', success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Publish CID to IPNS.
 * Public implementation of IpfsTransport.publishIpns()
 */
async publishIpns(cid: string): Promise<IpnsPublishResult> {
  if (!this.helia || !this.ipnsKeyPair) {
    return { ipnsName: null, success: false, error: 'Not initialized' };
  }

  try {
    const { CID } = await import('multiformats/cid');
    const cidObj = CID.parse(cid);
    const result = await this.publishToIpns(cidObj);

    if (result) {
      return {
        ipnsName: result,
        success: true,
        publishPending: false,
      };
    } else {
      // Check if retry loop started
      const isPending = this.ipnsSyncRetryActive;
      return {
        ipnsName: this.cachedIpnsName || null,
        success: false,
        publishPending: isPending,
        error: 'IPNS publish verification failed'
      };
    }
  } catch (error) {
    return {
      ipnsName: null,
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Get IPNS name (for metadata access)
 */
getIpnsName(): string | null {
  return this.cachedIpnsName;
}

/**
 * Get peer ID (for metadata access)
 */
getPeerId(): string | null {
  return this.helia?.libp2p.peerId.toString() || null;
}
```

### Step 2c: Remove Duplicate Orchestration Code

**DELETE these methods entirely (they'll be replaced by InventorySyncService):**

Around lines in IpfsStorageService.ts:
- Line ~2372: `importRemoteData()` - ENTIRE METHOD
- Line ~2741: `syncFromIpns()` - ENTIRE METHOD
- Line ~3031+: `executeSyncInternal()` - ENTIRE METHOD
- Line ~2200: `sanityCheckMissingTokens()` - ENTIRE METHOD
- Line ~2250: `sanityCheckTombstones()` - ENTIRE METHOD
- Line ~2100: `compareTokenVersions()` - ENTIRE METHOD
- Line ~2050: `localDiffersFromRemote()` - ENTIRE METHOD
- Line ~1320: `handleHigherSequenceDiscovered()` - ENTIRE METHOD
- Line ~3500+: `checkArchivedTokensForRecovery()` - ENTIRE METHOD
- Line ~3600+: `verifyIntegrityInvariants()` - ENTIRE METHOD
- Line ~3700+: `runSpentTokenSanityCheck()` - ENTIRE METHOD
- Line ~3800+: `runTombstoneRecoveryCheck()` - ENTIRE METHOD

**Keep these helper methods (they're used by transport):**
- Line ~1000: `resolveIpnsProgressively()` - RENAME to be called by public `resolveIpns()`
- Line ~1800: `fetchRemoteContent()` - RENAME to be called by public `fetchContent()`
- Line ~600: `publishToIpns()` - Keep as-is, called by public `publishIpns()`

### Step 2d: Add Backward Compatibility Wrapper

**Add this around line 3031 (where old `syncNow` was):**

```typescript
/**
 * DEPRECATED: Use inventorySync() instead.
 * This now delegates to InventorySyncService for compatibility.
 */
async syncNow(options?: SyncOptions): Promise<StorageResult> {
  console.warn(
    '⚠️ IpfsStorageService.syncNow() is deprecated. Use inventorySync() instead. ' +
    'Delegating to InventorySyncService...'
  );

  // Get current wallet identity
  const identity = await this.identityManager.getCurrentIdentity();
  if (!identity) {
    return {
      success: false,
      timestamp: Date.now(),
      error: 'No wallet identity'
    };
  }

  // Delegate to InventorySyncService
  const { inventorySync } = await import('./InventorySyncService');
  const syncResult = await inventorySync({
    address: identity.address,
    publicKey: identity.publicKey,
    ipnsName: this.cachedIpnsName || '',
    local: options?.callerContext === 'local',
    nametag: false
  });

  // Convert SyncResult format to StorageResult for backward compatibility
  return {
    success: syncResult.status === 'SUCCESS' || syncResult.status === 'PARTIAL_SUCCESS',
    cid: syncResult.lastCid,
    ipnsName: syncResult.ipnsName,
    version: syncResult.version,
    timestamp: syncResult.timestamp,
    ipnsPublished: syncResult.ipnsPublished,
    ipnsPublishPending: syncResult.ipnsPublishPending,
    error: syncResult.status === 'ERROR' ? syncResult.errorMessage : undefined
  };
}

/**
 * DEPRECATED: Use inventorySync() instead.
 */
async syncFromIpns(): Promise<StorageResult> {
  console.warn('⚠️ IpfsStorageService.syncFromIpns() is deprecated. Use inventorySync() instead.');
  return this.syncNow();
}
```

---

## Phase 3: Update InventorySyncService

### Step 3a: Add Transport Import

**File**: `src/components/wallet/L3/services/InventorySyncService.ts`

**Around line 30 (after other imports):**

```typescript
import { getIpfsTransport } from './IpfsTransport';
import type { IpfsTransport } from './IpfsTransport';
```

### Step 3b: Update Step 2 (Load IPFS)

**Replace lines ~395-514 (current step2_loadIpfs):**

```typescript
async function step2_loadIpfs(ctx: SyncContext): Promise<void> {
  console.log(`🌐 [Step 2] Load from IPFS`);

  // Early validation: skip IPFS loading if IPNS name is not available
  if (!ctx.ipnsName || ctx.ipnsName.trim().length === 0) {
    console.log(`  ⏭️ Skipping IPFS load: no IPNS name configured (new wallet or LOCAL mode)`);
    return;
  }

  const transport = getIpfsTransport();

  try {
    // 1. Resolve IPNS name to get CID and metadata
    const resolution = await transport.resolveIpns();

    if (!resolution.cid) {
      console.log(`  IPNS resolution returned no CID`);
      return;
    }

    ctx.remoteCid = resolution.cid;
    console.log(`  Resolved IPNS: CID=${resolution.cid.slice(0, 16)}..., seq=${resolution.sequence}`);

    // 2. Get content (use cached if available from resolution)
    let remoteData = resolution.content;

    if (!remoteData) {
      console.log(`  Fetching content from IPFS...`);
      remoteData = await transport.fetchContent(resolution.cid);

      if (!remoteData) {
        console.warn(`  Failed to fetch content for CID ${resolution.cid.slice(0, 16)}...`);
        return;
      }
    }

    // 3. Extract remote metadata
    if (remoteData._meta) {
      ctx.remoteVersion = remoteData._meta.version || 0;
      console.log(`  Remote version: ${ctx.remoteVersion}, Local version: ${ctx.localVersion}`);
    }

    // 4. Merge remote tokens into context
    let tokensImported = 0;
    for (const key of Object.keys(remoteData)) {
      if (isTokenKey(key)) {
        const remoteTxf = remoteData[key] as TxfToken;
        if (!remoteTxf || !remoteTxf.genesis?.data?.tokenId) continue;

        const tokenId = remoteTxf.genesis.data.tokenId;
        const localTxf = ctx.tokens.get(tokenId);

        // Prefer remote if: no local, or remote has more transactions
        if (!localTxf || shouldPreferRemote(localTxf, remoteTxf)) {
          ctx.tokens.set(tokenId, remoteTxf);
          if (!localTxf) tokensImported++;
        }
      }
    }

    // 5-7. Merge remote tombstones, sent tokens, invalid tokens (existing code...)
    // (Keep existing merge logic from lines ~449-504)

    // 8. Merge remote nametag if present
    if (remoteData._nametag && ctx.nametags.length === 0) {
      ctx.nametags.push(remoteData._nametag);
      console.log(`  Imported nametag: ${remoteData._nametag.name}`);
    }

    ctx.stats.tokensImported = tokensImported;
    console.log(`  ✓ Loaded from IPFS: ${tokensImported} new tokens, ${ctx.tombstones.length} tombstones`);

  } catch (error) {
    console.error(`  Error loading from IPFS:`, error);
    ctx.errors.push(`IPFS load error: ${error}`);
  }
}
```

### Step 3c: Update Step 10 (Upload IPFS)

**Replace lines ~1342-1467 (current step10_uploadIpfs):**

```typescript
async function step10_uploadIpfs(ctx: SyncContext): Promise<void> {
  console.log(`☁️ [Step 10] Upload to IPFS`);

  // Skip upload if not needed (no changes or LOCAL mode)
  if (!ctx.uploadNeeded) {
    console.log(`  ⏭️ No upload needed (no changes)`);
    return;
  }

  // 1. Read the prepared TxfStorageData from localStorage
  const storageKey = STORAGE_KEY_GENERATORS.walletByAddress(ctx.address);
  const json = localStorage.getItem(storageKey);
  if (!json) {
    console.error(`  ❌ No storage data found at ${storageKey}`);
    ctx.errors.push('No storage data to upload');
    return;
  }

  let storageData: TxfStorageData;
  try {
    storageData = JSON.parse(json) as TxfStorageData;
  } catch (e) {
    console.error(`  ❌ Failed to parse storage data:`, e);
    ctx.errors.push('Failed to parse storage data for upload');
    return;
  }

  const transport = getIpfsTransport();

  // 2. Upload to IPFS
  console.log(`📤 Uploading to IPFS...`);
  const uploadResult = await transport.uploadContent(storageData);

  if (!uploadResult.success) {
    console.error(`  ❌ Upload failed: ${uploadResult.error}`);
    ctx.errors.push(`Upload failed: ${uploadResult.error}`);
    return;
  }

  // 3. Update context with CID
  ctx.remoteCid = uploadResult.cid;
  transport.setLastCid(uploadResult.cid);

  console.log(`✓ Content uploaded: CID=${uploadResult.cid.slice(0, 16)}...`);

  // 4. Update localStorage meta with new CID
  storageData._meta.lastCid = uploadResult.cid;
  localStorage.setItem(storageKey, JSON.stringify(storageData));

  // 5. Publish to IPNS
  console.log(`📤 Publishing to IPNS...`);
  const publishResult = await transport.publishIpns(uploadResult.cid);

  if (publishResult.success) {
    console.log(`✅ IPNS record published (name: ${publishResult.ipnsName})`);
    ctx.stats.ipnsPublished = true;
  } else if (publishResult.publishPending) {
    console.log(`⏳ IPNS publish pending (background retry in progress)`);
  } else {
    console.warn(`⚠️ IPNS publish failed: ${publishResult.error}`);
    // Non-fatal - content is still on IPFS, just not discoverable yet
  }

  console.log(`✓ Upload complete: CID=${uploadResult.cid.slice(0, 16)}...`);
}
```

### Step 3d: Add Helper to Get Transport

**Add this new function near top of InventorySyncService.ts (after imports):**

```typescript
/**
 * Get IpfsTransport instance for this wallet
 * Ensures InventorySyncService can call transport operations
 */
function getIpfsTransport(): IpfsTransport {
  return import('./IpfsTransport').then(m => m.getIpfsTransport());
}
```

---

## Phase 4: Testing Strategy

### Test File: `tests/unit/services/IpfsTransport.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IpfsStorageService } from '@/components/wallet/L3/services/IpfsStorageService';
import { IdentityManager } from '@/components/wallet/L3/services/IdentityManager';
import type { TxfStorageData } from '@/components/wallet/L3/services/types/TxfTypes';

describe('IpfsTransport Interface', () => {
  let service: IpfsStorageService;

  beforeEach(() => {
    const identityManager = vi.mocked(IdentityManager.getInstance());
    service = IpfsStorageService.getInstance(identityManager);
  });

  describe('resolveIpns', () => {
    it('returns null CID when IPNS not found', async () => {
      const result = await service.resolveIpns();
      expect(result.cid).toBeNull();
      expect(result.sequence).toBe(0n);
    });

    it('returns CID and sequence when IPNS resolved', async () => {
      // Mock gateway response
      // Mock HTTP calls
      // Call resolveIpns()
      // Verify result format
    });

    it('includes cached content when available', async () => {
      // Setup mock to return cached content
      const result = await service.resolveIpns();
      expect(result.content).toBeDefined();
    });
  });

  describe('fetchContent', () => {
    it('fetches content by CID', async () => {
      // Mock HTTP gateway response
      const data = await service.fetchContent('bafk...');
      expect(data?._meta).toBeDefined();
    });

    it('returns null for missing CID', async () => {
      const data = await service.fetchContent('bafk_nonexistent');
      expect(data).toBeNull();
    });
  });

  describe('uploadContent', () => {
    it('uploads content and returns CID', async () => {
      const testData: TxfStorageData = {
        _meta: { version: 1, address: 'test', ipnsName: 'test' }
      };

      const result = await service.uploadContent(testData);
      expect(result.success).toBe(true);
      expect(result.cid).toMatch(/^bafy/);
    });

    it('handles upload failure gracefully', async () => {
      // Mock all gateways to fail
      const result = await service.uploadContent({} as TxfStorageData);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('publishIpns', () => {
    it('publishes CID to IPNS', async () => {
      // Mock HTTP publish success
      const result = await service.publishIpns('bafy123...');
      expect(result.success).toBe(true);
      expect(result.ipnsName).toBeDefined();
    });

    it('indicates publish pending on verification failure', async () => {
      // Mock HTTP accept but verification fail
      const result = await service.publishIpns('bafy123...');
      expect(result.publishPending).toBe(true);
    });
  });

  describe('Version tracking', () => {
    it('gets and sets version counter', () => {
      service.setVersionCounter(5);
      expect(service.getVersionCounter()).toBe(5);
    });

    it('gets and sets last CID', () => {
      const cid = 'bafy123...';
      service.setLastCid(cid);
      expect(service.getLastCid()).toBe(cid);
    });
  });
});
```

### Test File: `tests/integration/services/InventorySyncService.test.ts`

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { inventorySync } from '@/components/wallet/L3/services/InventorySyncService';
import { getIpfsTransport } from '@/components/wallet/L3/services/IpfsTransport';
import type { SyncParams } from '@/components/wallet/L3/services/InventorySyncService';

describe('InventorySyncService with IpfsTransport', () => {
  let params: SyncParams;

  beforeEach(() => {
    params = {
      address: 'test_address',
      publicKey: 'test_pub_key',
      ipnsName: 'test_ipns_name'
    };
  });

  describe('Step 2 - Load IPFS', () => {
    it('calls transport.resolveIpns()', async () => {
      const transport = getIpfsTransport();
      const spy = vi.spyOn(transport, 'resolveIpns');

      await inventorySync(params);

      expect(spy).toHaveBeenCalled();
    });

    it('calls transport.fetchContent() for remote data', async () => {
      const transport = getIpfsTransport();
      const spy = vi.spyOn(transport, 'fetchContent');

      // Mock resolveIpns to return a CID
      vi.spyOn(transport, 'resolveIpns').mockResolvedValue({
        cid: 'bafy123...',
        sequence: 1n
      });

      await inventorySync(params);

      expect(spy).toHaveBeenCalledWith('bafy123...');
    });
  });

  describe('Step 10 - Upload IPFS', () => {
    it('calls transport.uploadContent()', async () => {
      const transport = getIpfsTransport();
      const spy = vi.spyOn(transport, 'uploadContent');

      // Trigger sync with something to upload
      await inventorySync({
        ...params,
        incomingTokens: [/* ... */]
      });

      expect(spy).toHaveBeenCalled();
    });

    it('calls transport.publishIpns() after upload', async () => {
      const transport = getIpfsTransport();
      const publishSpy = vi.spyOn(transport, 'publishIpns');

      await inventorySync({
        ...params,
        incomingTokens: [/* ... */]
      });

      expect(publishSpy).toHaveBeenCalled();
    });
  });
});
```

---

## Migration Checklist

- [ ] Create `IpfsTransport.ts` interface file
- [ ] Add interface implementation to `IpfsStorageService`
- [ ] Extract `uploadContent()` method from `executeSyncInternal()`
- [ ] Wrap `publishToIpns()` in `publishIpns()` public method
- [ ] Update `InventorySyncService` Step 2 to call transport
- [ ] Update `InventorySyncService` Step 10 to call transport
- [ ] Add backward compatibility wrapper for `syncNow()`
- [ ] Delete old orchestration methods (in separate PR)
- [ ] Update CLAUDE.md with new architecture
- [ ] Run full test suite
- [ ] Merge and monitor production for 2 weeks
- [ ] Remove deprecated methods (Phase 2)

---

## Files Changed Summary

| File | Lines Added | Lines Removed | Net Change | Type |
|------|-------------|---------------|------------|------|
| IpfsTransport.ts | +300 | 0 | +300 | New |
| IpfsStorageService.ts | +200 | -1500 | -1300 | Modified |
| InventorySyncService.ts | +100 | 0 | +100 | Modified |
| tests/unit/IpfsTransport.test.ts | +200 | 0 | +200 | New |
| tests/integration/sync.test.ts | +100 | 0 | +100 | Modified |
| CLAUDE.md | +50 | 0 | +50 | Modified |
| **TOTAL** | **950** | **1500** | **-550** | |

