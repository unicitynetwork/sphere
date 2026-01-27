/**
 * IPFS Storage Provider (Browser-specific)
 *
 * Implements TokenStorageProvider interface using IPFS/IPNS.
 * Uses HTTP gateways for publishing and resolution.
 * Optionally uses Helia for DHT redundancy.
 */

import type { TxfStorageDataBase, TxfMeta } from '../../types/txf';
import type {
  TokenStorageProvider,
  StorageStatus,
  SaveResult,
  LoadResult,
  SyncResult,
  StorageEventCallback,
  StorageEvent,
} from '../../storage/types';
import { ConflictResolutionService } from '../../storage/conflict-resolution';

import type {
  IpfsStorageConfig,
  IpfsStorageStatus,
} from './ipfs-types';
import {
  deriveIpnsKeyPair,
  createSignedIpnsRecord,
  publishIpnsToGateways,
  resolveIpnsProgressively,
  fetchIpfsContent,
  uploadIpfsContent,
} from './ipns-client';
import type { PrivateKey } from "@libp2p/interface";
import type { IpfsStatePersistence } from '../../storage/ipfs-state-persistence';
import { InMemoryIpfsStatePersistence } from '../../storage/ipfs-state-persistence';

// ==========================================
// IpfsStorageProvider
// ==========================================

export class IpfsStorageProvider<
  TStorageData extends TxfStorageDataBase = TxfStorageDataBase
> implements TokenStorageProvider<TStorageData> {
  // Keys
  private ipnsKeyPair: PrivateKey | null = null;
  private ipnsName: string | null = null;

  // State
  private initialized = false;
  private isSyncing = false;
  private lastSync: SyncResult<TStorageData> | null = null;
  private currentVersion = 0;
  private lastCid: string | null = null;
  private ipnsSequenceNumber: bigint = 0n;
  private lastKnownRemoteSequence: bigint = 0n;

  // Services
  private conflictResolver: ConflictResolutionService<TStorageData>;
  private eventCallbacks: StorageEventCallback[] = [];
  private statePersistence: IpfsStatePersistence;

  // Config
  private readonly config: Omit<Required<IpfsStorageConfig>, 'statePersistence'>;

  constructor(config: IpfsStorageConfig) {
    // Extract statePersistence before spreading config
    const { statePersistence, ...restConfig } = config;
    this.config = {
      bootstrapPeers: [],
      backendPeerId: "",
      debug: false,
      ipnsTtlSeconds: 60,
      gatewayTimeoutMs: 10000,
      ...restConfig,
    };
    this.conflictResolver = new ConflictResolutionService<TStorageData>();
    // Use provided persistence or fall back to in-memory
    this.statePersistence = statePersistence ?? new InMemoryIpfsStatePersistence();
  }

  // ==========================================
  // Lifecycle
  // ==========================================

  async initialize(): Promise<boolean> {
    if (this.initialized) return true;

    try {
      this.log("Initializing IPFS storage provider...");

      // Derive IPNS keys from private key
      const { keyPair, ipnsName } = await deriveIpnsKeyPair(this.config.privateKey);
      this.ipnsKeyPair = keyPair;
      this.ipnsName = ipnsName;

      this.log(`IPNS name: ${ipnsName.slice(0, 16)}...`);

      // Load persisted state (version, sequence number, last CID)
      this.loadPersistedState();

      this.initialized = true;
      this.log("Initialized successfully");

      return true;
    } catch (error) {
      this.log(`Initialization failed: ${error}`);
      return false;
    }
  }

  async shutdown(): Promise<void> {
    this.savePersistedState();
    this.initialized = false;
    this.eventCallbacks = [];
    this.log("Shutdown");
  }

  getStatus(): StorageStatus {
    return {
      initialized: this.initialized,
      isSyncing: this.isSyncing,
      currentVersion: this.currentVersion,
      lastSync: this.lastSync as SyncResult | null,
      identifier: this.ipnsName,
      providerInfo: this.getIpfsStatus() as unknown as Record<string, unknown>,
    };
  }

  /**
   * Get IPFS-specific status
   */
  getIpfsStatus(): IpfsStorageStatus {
    return {
      heliaInitialized: false, // This provider doesn't use Helia directly
      keysReady: this.ipnsKeyPair !== null,
      ipnsName: this.ipnsName,
      lastCid: this.lastCid,
      sequenceNumber: this.ipnsSequenceNumber,
      webCryptoAvailable: this.isWebCryptoAvailable(),
    };
  }

  // ==========================================
  // Core Operations
  // ==========================================

  async save(data: TStorageData): Promise<SaveResult> {
    const timestamp = Date.now();

    if (!this.initialized || !this.ipnsKeyPair || !this.ipnsName) {
      return {
        success: false,
        timestamp,
        error: "Provider not initialized",
      };
    }

    try {
      await this.emitEvent({ type: "storage:saving", timestamp });

      // Increment version
      this.currentVersion++;
      const newMeta: TxfMeta = {
        ...data._meta,
        version: this.currentVersion,
        lastModified: timestamp,
      };

      const dataToSave = {
        ...data,
        _meta: newMeta,
      } as TStorageData;

      // Upload to IPFS via gateways
      this.log("Uploading to IPFS...");
      let uploadedCid: string | null = null;

      for (const gatewayUrl of this.config.gatewayUrls) {
        const result = await uploadIpfsContent(
          gatewayUrl,
          dataToSave,
          this.config.gatewayTimeoutMs
        );
        if (result) {
          uploadedCid = result.cid;
          this.log(`Uploaded to ${gatewayUrl}, CID: ${uploadedCid.slice(0, 16)}...`);
          break;
        }
      }

      if (!uploadedCid) {
        throw new Error("Failed to upload to any gateway");
      }

      this.lastCid = uploadedCid;

      // Publish to IPNS
      this.log("Publishing to IPNS...");
      const baseSeq = this.ipnsSequenceNumber > this.lastKnownRemoteSequence
        ? this.ipnsSequenceNumber
        : this.lastKnownRemoteSequence;
      this.ipnsSequenceNumber = baseSeq + 1n;

      const marshalledRecord = await createSignedIpnsRecord(
        this.ipnsKeyPair,
        uploadedCid,
        this.ipnsSequenceNumber
      );

      const publishResult = await publishIpnsToGateways(
        this.config.gatewayUrls,
        this.ipnsName,
        marshalledRecord,
        this.config.gatewayTimeoutMs
      );

      if (!publishResult.success) {
        this.log("IPNS publish failed, but content is stored");
        // Don't fail - content is still accessible via CID
      } else {
        this.log(`IPNS published (seq: ${this.ipnsSequenceNumber})`);
      }

      // Save state
      this.savePersistedState();

      const tokenCount = this.countTokens(dataToSave);

      await this.emitEvent({
        type: "storage:saved",
        timestamp,
        data: {
          identifier: this.ipnsName,
          version: this.currentVersion,
          tokenCount,
        },
      });

      return {
        success: true,
        identifier: uploadedCid,
        version: this.currentVersion,
        tokenCount,
        timestamp,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      await this.emitEvent({
        type: "storage:error",
        timestamp,
        data: { error: errorMsg },
      });

      return {
        success: false,
        timestamp,
        error: errorMsg,
      };
    }
  }

  async load(identifier?: string): Promise<LoadResult<TStorageData>> {
    const timestamp = Date.now();

    if (!this.initialized || !this.ipnsName) {
      return {
        success: false,
        timestamp,
        error: "Provider not initialized",
      };
    }

    try {
      await this.emitEvent({ type: "storage:loading", timestamp });

      let cid = identifier;

      // If no CID provided, resolve from IPNS
      if (!cid) {
        this.log("Resolving IPNS...");
        const resolution = await resolveIpnsProgressively(
          this.config.gatewayUrls,
          this.ipnsName,
          { timeoutMs: this.config.gatewayTimeoutMs }
        );

        if (!resolution.best) {
          return {
            success: false,
            timestamp,
            error: "IPNS resolution failed",
          };
        }

        cid = resolution.best.cid;
        this.lastKnownRemoteSequence = resolution.best.sequence;
        this.log(`Resolved to CID: ${cid.slice(0, 16)}... (seq: ${resolution.best.sequence})`);
      }

      // Fetch content
      this.log("Fetching content...");
      let data: TStorageData | null = null;

      for (const gatewayUrl of this.config.gatewayUrls) {
        data = await fetchIpfsContent<TStorageData>(
          gatewayUrl,
          cid,
          this.config.gatewayTimeoutMs
        );
        if (data) {
          this.log(`Fetched from ${gatewayUrl}`);
          break;
        }
      }

      if (!data) {
        return {
          success: false,
          timestamp,
          error: "Failed to fetch content from any gateway",
        };
      }

      const tokenCount = this.countTokens(data);

      await this.emitEvent({
        type: "storage:loaded",
        timestamp,
        data: {
          identifier: cid,
          version: data._meta?.version,
          tokenCount,
        },
      });

      return {
        success: true,
        data,
        version: data._meta?.version,
        tokenCount,
        timestamp,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      await this.emitEvent({
        type: "storage:error",
        timestamp,
        data: { error: errorMsg },
      });

      return {
        success: false,
        timestamp,
        error: errorMsg,
      };
    }
  }

  async sync(localData: TStorageData): Promise<SyncResult<TStorageData>> {
    const timestamp = Date.now();
    this.isSyncing = true;

    try {
      await this.emitEvent({ type: "sync:started", timestamp });

      // Load remote data
      const loadResult = await this.load();

      // If no remote data, just save local
      if (!loadResult.success || !loadResult.data) {
        this.log("No remote data, saving local");
        const saveResult = await this.save(localData);

        const result: SyncResult<TStorageData> = {
          success: saveResult.success,
          data: localData,
          version: saveResult.version,
          tokenCount: saveResult.tokenCount,
          conflictsResolved: 0,
          newTokens: [],
          removedTokens: [],
          timestamp,
          error: saveResult.error,
        };

        this.lastSync = result;
        this.isSyncing = false;
        return result;
      }

      // Merge local and remote
      this.log("Merging local and remote data...");
      const mergeResult = this.conflictResolver.resolveConflict(
        localData,
        loadResult.data
      );

      if (mergeResult.conflicts.length > 0) {
        await this.emitEvent({
          type: "sync:conflict",
          timestamp,
          data: { conflictsResolved: mergeResult.conflicts.length },
        });
      }

      // Save merged data
      const saveResult = await this.save(mergeResult.merged as TStorageData);

      await this.emitEvent({
        type: "sync:completed",
        timestamp,
        data: {
          version: saveResult.version,
          tokenCount: saveResult.tokenCount,
          conflictsResolved: mergeResult.conflicts.length,
        },
      });

      this.log(`Sync complete: ${saveResult.tokenCount} tokens, ${mergeResult.conflicts.length} conflicts`);

      const result: SyncResult<TStorageData> = {
        success: saveResult.success,
        data: mergeResult.merged as TStorageData,
        version: saveResult.version,
        tokenCount: saveResult.tokenCount,
        conflictsResolved: mergeResult.conflicts.length,
        newTokens: mergeResult.newTokens,
        removedTokens: mergeResult.removedTokens,
        timestamp,
        error: saveResult.error,
      };

      this.lastSync = result;
      this.isSyncing = false;

      return result;
    } catch (error) {
      this.isSyncing = false;
      const errorMsg = error instanceof Error ? error.message : String(error);

      await this.emitEvent({
        type: "sync:error",
        timestamp,
        data: { error: errorMsg },
      });

      return {
        success: false,
        timestamp,
        error: errorMsg,
      };
    }
  }

  // ==========================================
  // Optional Operations
  // ==========================================

  async exists(identifier?: string): Promise<boolean> {
    if (!identifier && !this.ipnsName) return false;

    const loadResult = await this.load(identifier);
    return loadResult.success;
  }

  // ==========================================
  // Events
  // ==========================================

  onEvent(callback: StorageEventCallback): () => void {
    this.eventCallbacks.push(callback);
    return () => {
      this.eventCallbacks = this.eventCallbacks.filter((cb) => cb !== callback);
    };
  }

  // ==========================================
  // Public Getters
  // ==========================================

  /**
   * Get IPNS name (PeerId)
   */
  getIpnsName(): string | null {
    return this.ipnsName;
  }

  /**
   * Get last known CID
   */
  getLastCid(): string | null {
    return this.lastCid;
  }

  // ==========================================
  // Private Helpers
  // ==========================================

  private async emitEvent(event: StorageEvent): Promise<void> {
    for (const callback of this.eventCallbacks) {
      try {
        await callback(event);
      } catch (error) {
        this.log(`Event callback error: ${error}`);
      }
    }
  }

  private countTokens(data: TxfStorageDataBase): number {
    let count = 0;
    for (const key of Object.keys(data)) {
      if (
        key.startsWith("token_") &&
        !key.startsWith("token_archived_") &&
        !key.startsWith("token_forked_")
      ) {
        count++;
      }
    }
    return count;
  }

  private isWebCryptoAvailable(): boolean {
    try {
      return (
        typeof crypto !== "undefined" &&
        crypto.subtle !== undefined &&
        typeof crypto.subtle.digest === "function"
      );
    } catch {
      return false;
    }
  }

  private log(message: string): void {
    if (this.config.debug) {
      console.log(`[IpfsStorage] ${message}`);
    }
  }

  // ==========================================
  // State Persistence (via IpfsStatePersistence interface)
  // ==========================================

  private loadPersistedState(): void {
    if (!this.ipnsName) return;

    try {
      const state = this.statePersistence.load(this.ipnsName);
      if (state) {
        this.currentVersion = state.version;
        this.ipnsSequenceNumber = BigInt(state.sequenceNumber);
        this.lastCid = state.lastCid;
        this.log(`Loaded persisted state: v${state.version}, seq=${state.sequenceNumber}`);
      }
    } catch (error) {
      this.log(`Failed to load persisted state: ${error}`);
    }
  }

  private savePersistedState(): void {
    if (!this.ipnsName) return;

    try {
      this.statePersistence.save(this.ipnsName, {
        version: this.currentVersion,
        sequenceNumber: String(this.ipnsSequenceNumber),
        lastCid: this.lastCid,
      });
    } catch (error) {
      this.log(`Failed to save persisted state: ${error}`);
    }
  }
}

// ==========================================
// Factory Function
// ==========================================

/**
 * Create an IPFS storage provider
 */
export function createIpfsStorageProvider<
  TStorageData extends TxfStorageDataBase = TxfStorageDataBase
>(config: IpfsStorageConfig): IpfsStorageProvider<TStorageData> {
  return new IpfsStorageProvider<TStorageData>(config);
}
