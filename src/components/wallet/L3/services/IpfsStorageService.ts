import { createHelia, type Helia } from "helia";
import { json } from "@helia/json";
import { bootstrap } from "@libp2p/bootstrap";
import { generateKeyPairFromSeed } from "@libp2p/crypto/keys";
import { peerIdFromPrivateKey } from "@libp2p/peer-id";
import { createIPNSRecord, marshalIPNSRecord, unmarshalIPNSRecord, multihashToIPNSRoutingKey } from "ipns";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { sha512 } from "@noble/hashes/sha512";
import * as ed from "@noble/ed25519";
import type { CID } from "multiformats/cid";
import type { PrivateKey, ConnectionGater, PeerId } from "@libp2p/interface";
import type { NametagData } from "./types/TxfTypes";
import { OutboxRepository } from "../../../../repositories/OutboxRepository";
import { WalletRepository } from "../../../../repositories/WalletRepository"; // For deprecated methods only
import { IdentityManager } from "./IdentityManager";
import type { Token } from "../data/model";
import {
  getTokensForAddress,
  getArchivedTokensForAddress,
  getTombstonesForAddress,
  getNametagForAddress,
  clearNametagForAddress,
} from "./InventorySyncService";
import type { TxfStorageData, TxfMeta, TxfToken, TombstoneEntry } from "./types/TxfTypes";
import { isTokenKey, tokenIdFromKey } from "./types/TxfTypes";
import type { IpfsTransport, IpnsResolutionResult, IpfsUploadResult, IpnsPublishResult, GatewayHealth } from "./types/IpfsTransport";
import { buildTxfStorageData, parseTxfStorageData, txfToToken, tokenToTxf, getCurrentStateHash, hasMissingNewStateHash, repairMissingStateHash, computeAndPatchStateHash } from "./TxfSerializer";
import { getTokenValidationService } from "./TokenValidationService";
import { getConflictResolutionService } from "./ConflictResolutionService";
import { getSyncCoordinator } from "./SyncCoordinator";
import { getTokenBackupService } from "./TokenBackupService";
import { SyncQueue, SyncPriority, type SyncOptions } from "./SyncQueue";
// Re-export for callers
export { SyncPriority, type SyncOptions } from "./SyncQueue";
// Note: retryWithBackoff was used for DHT publish, now handled by HTTP primary path
import { getBootstrapPeers, getConfiguredCustomPeers, getBackendPeerId, getAllBackendGatewayUrls, IPNS_RESOLUTION_CONFIG, IPFS_CONFIG } from "../../../../config/ipfs.config";
// Fast HTTP-based IPNS resolution and content fetching (target: <2s sync)
import { getIpfsHttpResolver, computeCidFromContent } from "./IpfsHttpResolver";
import { getIpfsMetrics, type IpfsMetricsSnapshot, type IpfsSource } from "./IpfsMetrics";
import { getIpfsCache } from "./IpfsCache";
import { STORAGE_KEY_PREFIXES } from "../../../../config/storageKeys";
import { isNametagCorrupted } from "../../../../utils/tokenValidation";

// Configure @noble/ed25519 to use sync sha512 (required for getPublicKey without WebCrypto)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(ed.hashes as any).sha512 = (message: Uint8Array) => sha512(message);

// ==========================================
// Module-level Helia Singleton
// ==========================================

/**
 * Shared Helia instance across all IpfsStorageService instances.
 * This is created once on app start and reused to avoid the ~3 second init delay.
 */
let sharedHeliaInstance: Helia | null = null;

/**
 * Promise tracking ongoing Helia initialization (prevents duplicate init)
 */
let heliaInitPromise: Promise<Helia | null> | null = null;

/**
 * Track initialization failures to prevent retry storms.
 */
let heliaInitFailureCount = 0;
const MAX_INIT_FAILURES = 3;

// ==========================================
// Types
// ==========================================

export type StorageEventType =
  | "storage:started"
  | "storage:completed"
  | "storage:failed"
  | "ipns:published"
  | "sync:state-changed";

export interface StorageEvent {
  type: StorageEventType;
  timestamp: number;
  data?: {
    cid?: string;
    ipnsName?: string;
    tokenCount?: number;
    error?: string;
    isSyncing?: boolean;
  };
}

export type StorageEventCallback = (event: StorageEvent) => void | Promise<void>;

export interface StorageResult {
  success: boolean;
  cid?: string;
  ipnsName?: string;
  timestamp: number;
  version?: number;
  tokenCount?: number;
  validationIssues?: string[];
  conflictsResolved?: number;
  ipnsPublished?: boolean;
  ipnsPublishPending?: boolean;  // True if IPNS publish failed and will be retried
  error?: string;
}

export interface RestoreResult {
  success: boolean;
  tokens?: Token[];
  nametag?: NametagData;
  version?: number;
  timestamp: number;
  error?: string;
}

export interface StorageStatus {
  initialized: boolean;
  isSyncing: boolean;
  lastSync: StorageResult | null;
  ipnsName: string | null;
  webCryptoAvailable: boolean;
  currentVersion: number;
  lastCid: string | null;
}

interface StorageData {
  version: number;
  timestamp: number;
  address: string;
  tokens: SerializedToken[];
  nametag?: NametagData;  // One nametag per identity (synced with tokens)
}

interface SerializedToken {
  id: string;
  name: string;
  symbol?: string;
  amount?: string;
  coinId?: string;
  jsonData?: string;
  status: string;
  timestamp: number;
  type: string;
  iconUrl?: string;
}

/**
 * Result of IPNS resolution from a single gateway
 */
interface IpnsGatewayResult {
  cid: string;
  sequence: bigint;
  gateway: string;
  recordData: Uint8Array;
  /** Cached content from gateway path (avoids re-fetch) */
  _cachedContent?: TxfStorageData;
}

/**
 * Result of progressive IPNS resolution across multiple gateways
 */
interface IpnsProgressiveResult {
  best: IpnsGatewayResult | null;
  allResults: IpnsGatewayResult[];
  respondedCount: number;
  totalGateways: number;
}

// ==========================================
// Constants
// ==========================================

const HKDF_INFO = "ipfs-storage-ed25519-v1";
const SYNC_DEBOUNCE_MS = 5000;

// ==========================================
// Static Helper Functions
// ==========================================

/**
 * Create a connection gater that only allows connections to bootstrap peers.
 * This restricts libp2p from connecting to random DHT-discovered peers,
 * reducing browser traffic significantly.
 *
 * Static function for use in early Helia initialization and instance init.
 *
 * @param bootstrapPeers - List of bootstrap multiaddrs containing allowed peer IDs
 */
function createConnectionGaterStatic(bootstrapPeers: string[]): ConnectionGater {
  // Extract peer IDs from bootstrap multiaddrs
  const allowedPeerIds = new Set(
    bootstrapPeers.map((addr) => {
      const match = addr.match(/\/p2p\/([^/]+)$/);
      return match ? match[1] : null;
    }).filter((id): id is string => id !== null)
  );

  console.log(`📦 Connection gater: allowing ${allowedPeerIds.size} peer(s)`);

  return {
    // Allow dialing any multiaddr (peer filtering happens at connection level)
    denyDialMultiaddr: async () => false,

    // Block outbound connections to non-allowed peers
    denyDialPeer: async (peerId: PeerId) => {
      const peerIdStr = peerId.toString();
      const denied = !allowedPeerIds.has(peerIdStr);
      if (denied) {
        console.debug(`📦 Blocked dial to non-bootstrap peer: ${peerIdStr.slice(0, 16)}...`);
      }
      return denied;
    },

    // Allow inbound connections (rare in browser, but don't block)
    denyInboundConnection: async () => false,

    // Block outbound connections to non-allowed peers
    denyOutboundConnection: async (peerId: PeerId) => {
      const peerIdStr = peerId.toString();
      return !allowedPeerIds.has(peerIdStr);
    },

    // Allow encrypted connections (peer already passed connection check)
    denyInboundEncryptedConnection: async () => false,
    denyOutboundEncryptedConnection: async () => false,

    // Allow upgraded connections
    denyInboundUpgradedConnection: async () => false,
    denyOutboundUpgradedConnection: async () => false,

    // Allow all multiaddrs for allowed peers
    filterMultiaddrForPeer: async () => true,
  };
}

/**
 * Initialize Helia early (on app start) without waiting for identity.
 * This creates the libp2p node which takes ~3 seconds.
 * Identity-specific keys are derived later in ensureInitialized().
 *
 * Returns the shared Helia instance or null if initialization failed/disabled.
 */
export async function initializeHeliaEarly(): Promise<Helia | null> {
  // Return cached instance
  if (sharedHeliaInstance) {
    console.log("📦 [Early Init] Using cached Helia instance");
    return sharedHeliaInstance;
  }

  // Return in-progress promise
  if (heliaInitPromise) {
    console.log("📦 [Early Init] Waiting for ongoing Helia initialization...");
    return heliaInitPromise;
  }

  // Check if IPFS is disabled
  if (import.meta.env.VITE_ENABLE_IPFS === 'false') {
    console.log("📦 [Early Init] IPFS disabled via VITE_ENABLE_IPFS=false");
    return null;
  }

  // Check WebCrypto availability
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    console.warn("📦 [Early Init] WebCrypto not available - IPFS disabled");
    return null;
  }

  console.log("📦 [Early Init] Starting Helia initialization...");
  const startTime = performance.now();

  heliaInitPromise = (async () => {
    try {
      const bootstrapPeers = getBootstrapPeers();
      const customPeerCount = getConfiguredCustomPeers().length;

      console.log(`📦 [Early Init] Bootstrap peers: ${bootstrapPeers.length} total (${customPeerCount} custom, ${bootstrapPeers.length - customPeerCount} fallback)`);

      // Create connection gater
      const connectionGater = createConnectionGaterStatic(bootstrapPeers);

      const helia = await createHelia({
        libp2p: {
          connectionGater,
          peerDiscovery: [
            bootstrap({ list: bootstrapPeers }),
          ],
          connectionManager: {
            maxConnections: IPFS_CONFIG.maxConnections,
          },
        },
      });

      sharedHeliaInstance = helia;
      heliaInitFailureCount = 0;  // Reset on success
      const elapsed = performance.now() - startTime;
      const browserPeerId = helia.libp2p.peerId.toString();
      console.log(`📦 [Early Init] Helia ready in ${elapsed.toFixed(0)}ms (Peer ID: ${browserPeerId.slice(0, 20)}...)`);

      return helia;
    } catch (error) {
      heliaInitFailureCount++;
      console.error(`📦 [Early Init] Helia initialization failed (attempt ${heliaInitFailureCount}/${MAX_INIT_FAILURES}):`, error);

      if (heliaInitFailureCount >= MAX_INIT_FAILURES) {
        console.error(`📦 [Early Init] Max failures reached, disabling early init auto-retry`);
        console.error(`📦 [Early Init] Lazy initialization will still be attempted when needed`);
        // Keep heliaInitPromise as null but don't allow more retries from early init
        return null;
      }

      heliaInitPromise = null; // Allow retry
      return null;
    }
  })();

  return heliaInitPromise;
}

/**
 * Shutdown the shared Helia instance.
 * Only call this when the app is closing, not on component unmount.
 */
export async function shutdownSharedHelia(): Promise<void> {
  if (!sharedHeliaInstance) return;

  console.log("📦 Shutting down shared Helia instance");
  try {
    // Add timeout to prevent hanging
    const stopPromise = sharedHeliaInstance.stop();
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Helia stop timeout')), 5000)
    );
    await Promise.race([stopPromise, timeoutPromise]);
  } catch (err) {
    console.warn("📦 Helia shutdown error:", err);
  }
  sharedHeliaInstance = null;
  heliaInitPromise = null;
}

// ==========================================
// IpfsStorageService
// ==========================================

/**
 * IPFS Storage Service - Pure IPFS/IPNS transport layer
 *
 * Implements IpfsTransport interface for low-level IPFS operations.
 * InventorySyncService orchestrates the high-level sync logic.
 */
export class IpfsStorageService implements IpfsTransport {
  private static instance: IpfsStorageService | null = null;

  private helia: Helia | null = null;
  private ed25519PrivateKey: Uint8Array | null = null;
  private ed25519PublicKey: Uint8Array | null = null;
  private cachedIpnsName: string | null = null;
  private ipnsKeyPair: PrivateKey | null = null;
  private ipnsSequenceNumber: bigint = 0n;

  private identityManager: IdentityManager;
  private eventCallbacks: StorageEventCallback[] = [];

  private isInitializing = false;
  private initRetryCount = 0;
  private static readonly MAX_INIT_RETRIES = 50; // 5 seconds max wait
  private isSyncing = false;
  private isInitialSyncing = false;  // Tracks initial IPNS-based sync on startup
  private isInsideSyncFromIpns = false;  // Tracks if we're inside syncFromIpns (to avoid deadlock)
  private initialSyncCompletePromise: Promise<void> | null = null;  // Resolves when initial sync finishes
  private initialSyncCompleteResolver: (() => void) | null = null;  // Resolver for the above promise
  private syncQueue: SyncQueue | null = null; // Lazy-initialized queue for sync requests
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSync: StorageResult | null = null;
  private autoSyncEnabled = false;
  private boundSyncHandler: (() => void) | null = null;
  private connectionMaintenanceInterval: ReturnType<typeof setInterval> | null = null;

  // IPNS polling state
  private ipnsPollingInterval: ReturnType<typeof setInterval> | null = null;
  private boundVisibilityHandler: (() => void) | null = null;
  private lastKnownRemoteSequence: bigint = 0n;
  private isTabVisible: boolean = true; // Track tab visibility for adaptive polling
  private currentIdentityAddress: string | null = null; // Track current identity for key re-derivation on switch

  // IPNS sync retry state - retries until verification succeeds
  private ipnsSyncRetryActive: boolean = false;
  private ipnsSyncRetryCount: number = 0;
  private readonly MAX_IPNS_RETRY_DELAY_MS = 30000; // Max 30 seconds between retries
  private readonly BASE_IPNS_RETRY_DELAY_MS = 1000; // Start with 1 second

  // Gateway health tracking (for IpfsTransport interface)
  private gatewayHealth: Map<string, GatewayHealth> = new Map();

  // Event listener cleanup - store bound handlers for proper removal
  private boundPeerConnectHandler: ((event: CustomEvent) => void) | null = null;
  private boundPeerDisconnectHandler: ((event: CustomEvent) => void) | null = null;
  private initialConnectionLogTimeout: ReturnType<typeof setTimeout> | null = null;

  private constructor(identityManager: IdentityManager) {
    this.identityManager = identityManager;
  }

  static getInstance(identityManager: IdentityManager): IpfsStorageService {
    if (!IpfsStorageService.instance) {
      IpfsStorageService.instance = new IpfsStorageService(identityManager);
    }
    return IpfsStorageService.instance;
  }

  /**
   * Reset the singleton instance.
   * Must be called when the user switches to a different identity/address
   * so that the new identity's IPFS storage is used.
   */
  static async resetInstance(): Promise<void> {
    if (IpfsStorageService.instance) {
      console.log("📦 Resetting IpfsStorageService instance for identity switch...");
      await IpfsStorageService.instance.shutdown();
      IpfsStorageService.instance = null;
    }
  }

  // ==========================================
  // Lifecycle
  // ==========================================

  /**
   * Start listening for wallet changes and enable auto-sync
   * Safe to call multiple times - will only initialize once
   */
  startAutoSync(): void {
    if (this.autoSyncEnabled) {
      return;
    }

    // DEPRECATED: wallet-updated listener removed to prevent dual-publish race conditions
    // Auto-sync is now handled by InventorySyncService.inventorySync()
    // this.boundSyncHandler = () => this.scheduleSync();
    // window.addEventListener("wallet-updated", this.boundSyncHandler);

    this.autoSyncEnabled = true;
    console.log("📦 IPFS auto-sync enabled (auto-triggers disabled - use InventorySyncService)");
    console.warn("⚠️ [DEPRECATED] IpfsStorageService.startAutoSync() - auto-sync delegated to InventorySyncService");

    // DEPRECATED: IPNS polling disabled to prevent dual-publish
    // See setupVisibilityListener() for detailed rationale
    // this.setupVisibilityListener();

    // On startup, run IPNS-based sync once to discover remote state
    this.syncFromIpns().catch(console.error);
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    // NOTE: boundSyncHandler is null in new implementation (startAutoSync doesn't set it)
    // Keeping defensive cleanup for backward compatibility
    if (this.boundSyncHandler) {
      window.removeEventListener("wallet-updated", this.boundSyncHandler);
      this.boundSyncHandler = null;
    }
    this.autoSyncEnabled = false;

    // Clean up IPNS polling and visibility listener
    this.cleanupVisibilityListener();

    // Shutdown sync queue
    if (this.syncQueue) {
      this.syncQueue.shutdown();
      this.syncQueue = null;
    }

    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }
    if (this.connectionMaintenanceInterval) {
      clearInterval(this.connectionMaintenanceInterval);
      this.connectionMaintenanceInterval = null;
    }

    // Clear initial connection log timeout
    if (this.initialConnectionLogTimeout) {
      clearTimeout(this.initialConnectionLogTimeout);
      this.initialConnectionLogTimeout = null;
    }

    // Remove libp2p event listeners (prevent memory leaks)
    if (this.helia?.libp2p) {
      if (this.boundPeerConnectHandler) {
        this.helia.libp2p.removeEventListener("peer:connect", this.boundPeerConnectHandler);
        this.boundPeerConnectHandler = null;
      }
      if (this.boundPeerDisconnectHandler) {
        this.helia.libp2p.removeEventListener("peer:disconnect", this.boundPeerDisconnectHandler);
        this.boundPeerDisconnectHandler = null;
      }
    }

    // Detach from shared Helia but don't stop it
    // (other service instances may still need it)
    if (this.helia) {
      this.helia = null;
      console.log("📦 IPFS storage service detached from shared Helia");
    }
    console.log("📦 IPFS storage service stopped");
  }

  // ==========================================
  // Event System (for future Nostr integration)
  // ==========================================

  /**
   * Register callback for storage events
   * Returns unsubscribe function
   */
  onEvent(callback: StorageEventCallback): () => void {
    this.eventCallbacks.push(callback);
    return () => {
      this.eventCallbacks = this.eventCallbacks.filter((cb) => cb !== callback);
    };
  }

  private async emitEvent(event: StorageEvent): Promise<void> {
    // Dispatch browser event for React components
    window.dispatchEvent(
      new CustomEvent("ipfs-storage-event", { detail: event })
    );

    // Update sync timestamp on successful storage completion
    // This is used by TokenBackupService to determine if backup is needed
    if (event.type === "storage:completed") {
      try {
        getTokenBackupService().updateSyncTimestamp();
      } catch {
        // Ignore errors from backup service
      }
    }

    // Call registered callbacks (for future Nostr integration)
    for (const callback of this.eventCallbacks) {
      try {
        await callback(event);
      } catch (error) {
        console.error("📦 Storage event callback error:", error);
      }
    }
  }

  /**
   * Emit sync state change event for React components to update UI in real-time
   */
  private emitSyncStateChange(): void {
    const isSyncing = this.isSyncing || this.isInitialSyncing;
    console.log(`📦 Sync state changed: isSyncing=${isSyncing}`);
    window.dispatchEvent(
      new CustomEvent("ipfs-storage-event", {
        detail: {
          type: "sync:state-changed",
          timestamp: Date.now(),
          data: { isSyncing },
        } as StorageEvent,
      })
    );
  }

  // ==========================================
  // Initialization
  // ==========================================

  /**
   * Check if WebCrypto is available (required by Helia/libp2p)
   */
  // ==========================================
  // IpfsTransport Interface - STABLE API
  // ==========================================
  // These methods form the core IPFS transport layer
  // and are called by InventorySyncService in Step 10.
  // Do NOT deprecate - these are the canonical transport methods.
  // ==========================================

  // ==========================================
  // IpfsTransport Interface - Initialization
  // ==========================================

  /**
   * Check if WebCrypto API is available (required for IPNS)
   * Part of IpfsTransport interface
   */
  public isWebCryptoAvailable(): boolean {
    try {
      return typeof crypto !== "undefined" &&
             crypto.subtle !== undefined &&
             typeof crypto.subtle.digest === "function";
    } catch {
      return false;
    }
  }

  /**
   * Lazy initialization of Helia and key derivation
   * Detects identity changes and re-derives keys automatically
   * Part of IpfsTransport interface
   */
  public async ensureInitialized(): Promise<boolean> {
    // Check if IPFS is disabled via environment variable
    if (import.meta.env.VITE_ENABLE_IPFS === 'false') {
      console.log("📦 IPFS disabled via VITE_ENABLE_IPFS=false");
      return false;
    }

    // First, check if identity changed - we need to do this BEFORE the early return
    const identity = await this.identityManager.getCurrentIdentity();
    if (!identity) {
      console.warn("📦 No wallet identity - skipping IPFS init");
      return false;
    }

    // If identity changed since last init, clear cached keys to force re-derivation
    // This ensures we sync to the correct IPNS name when switching addresses
    if (this.currentIdentityAddress && this.currentIdentityAddress !== identity.address) {
      console.log(`📦 Identity changed: ${this.currentIdentityAddress.slice(0, 20)}... → ${identity.address.slice(0, 20)}...`);
      console.log(`📦 Clearing cached IPNS keys for re-derivation`);
      this.ed25519PrivateKey = null;
      this.ed25519PublicKey = null;
      this.ipnsKeyPair = null;
      this.cachedIpnsName = null;
      this.ipnsSequenceNumber = 0n;
      // Keep helia alive - only re-derive cryptographic keys
    }

    if (this.helia && this.ed25519PrivateKey) {
      return true;
    }

    if (this.isInitializing) {
      if (this.initRetryCount >= IpfsStorageService.MAX_INIT_RETRIES) {
        console.error("📦 ensureInitialized() timeout - exceeded max retries");
        this.isInitializing = false;
        this.initRetryCount = 0;
        return false;
      }

      this.initRetryCount++;
      await new Promise((resolve) => setTimeout(resolve, 100));
      const result = await this.ensureInitialized();
      this.initRetryCount = 0;
      return result;
    }

    this.isInitializing = true;

    try {
      // 0. Check WebCrypto availability (required by Helia/libp2p)
      if (!this.isWebCryptoAvailable()) {
        console.warn("📦 WebCrypto (crypto.subtle) not available - IPFS sync disabled");
        console.warn("📦 This typically happens in non-secure contexts (HTTP instead of HTTPS)");
        console.warn("📦 Wallet will continue to work, but IPFS backup/sync is unavailable");
        return false;
      }

      // Identity already fetched above, no need to fetch again

      // 2. Derive Ed25519 key from secp256k1 private key using HKDF
      const keyDerivationStart = performance.now();
      const walletSecret = this.hexToBytes(identity.privateKey);
      const derivedKey = hkdf(
        sha256,
        walletSecret,
        undefined, // no salt for deterministic derivation
        HKDF_INFO,
        32
      );
      this.ed25519PrivateKey = derivedKey;
      this.ed25519PublicKey = ed.getPublicKey(derivedKey);

      // 3. Generate libp2p key pair for IPNS from the derived key
      this.ipnsKeyPair = await generateKeyPairFromSeed("Ed25519", derivedKey);
      const ipnsPeerId = peerIdFromPrivateKey(this.ipnsKeyPair);
      console.log(`📦 [Timing] Key derivation took ${(performance.now() - keyDerivationStart).toFixed(0)}ms`);

      // 4. Compute proper IPNS name from peer ID and migrate old storage keys
      const oldIpnsName = `ipns-${this.bytesToHex(this.ed25519PublicKey).slice(0, 32)}`;
      const newIpnsName = ipnsPeerId.toString();
      this.cachedIpnsName = newIpnsName;
      this.currentIdentityAddress = identity.address; // Track which identity we initialized for
      this.migrateStorageKeys(oldIpnsName, newIpnsName);

      // Load last IPNS sequence number from storage
      this.ipnsSequenceNumber = this.getIpnsSequenceNumber();

      // 4. Use shared Helia instance (or wait for early init to complete)
      if (!this.helia) {
        const ensureHeliaStart = performance.now();
        console.log("📦 Waiting for shared Helia instance...");
        this.helia = await initializeHeliaEarly();
        console.log(`📦 [Timing] ensureInitialized() Helia wait took ${(performance.now() - ensureHeliaStart).toFixed(0)}ms`);

        if (!this.helia) {
          console.error("📦 Failed to initialize shared Helia instance");
          return false;
        }
      }

      // Log identity info (Helia is now ready)
      const browserPeerId = this.helia.libp2p.peerId.toString();
      console.log("📦 IPFS storage service initialized");
      console.log("📦 Browser Peer ID:", browserPeerId);
      console.log("📦 IPNS name:", this.cachedIpnsName);
      console.log("📦 Identity address:", identity.address.slice(0, 30) + "...");

      // Set up event handlers only if not already set up
      // (avoid duplicate listeners if this is called multiple times)
      if (!this.connectionMaintenanceInterval) {
        const bootstrapPeers = getBootstrapPeers();

        // Extract bootstrap peer IDs for filtering connection logs
        const bootstrapPeerIds = new Set(
          bootstrapPeers.map((addr) => {
            const match = addr.match(/\/p2p\/([^/]+)$/);
            return match ? match[1] : null;
          }).filter(Boolean) as string[]
        );

        // Set up peer connection event handlers - only log bootstrap peers
        // Store bound handlers for proper cleanup in shutdown()
        this.boundPeerConnectHandler = ((event: CustomEvent) => {
          const remotePeerId = event.detail.toString();
          if (bootstrapPeerIds.has(remotePeerId)) {
            console.log(`📦 Connected to bootstrap peer: ${remotePeerId.slice(0, 16)}...`);
          }
        }) as (event: CustomEvent) => void;

        this.boundPeerDisconnectHandler = ((event: CustomEvent) => {
          const remotePeerId = event.detail.toString();
          if (bootstrapPeerIds.has(remotePeerId)) {
            console.log(`📦 Disconnected from bootstrap peer: ${remotePeerId.slice(0, 16)}...`);
          }
        }) as (event: CustomEvent) => void;

        this.helia.libp2p.addEventListener("peer:connect", this.boundPeerConnectHandler);
        this.helia.libp2p.addEventListener("peer:disconnect", this.boundPeerDisconnectHandler);

        // Log initial connections after a short delay (store timeout for cleanup)
        this.initialConnectionLogTimeout = setTimeout(() => {
          const connections = this.helia?.libp2p.getConnections() || [];
          console.log(`📦 Active connections: ${connections.length}`);
          connections.slice(0, 5).forEach((conn) => {
            console.log(`📦   - ${conn.remotePeer.toString().slice(0, 16)}... via ${conn.remoteAddr.toString()}`);
          });
        }, 5000);

        // Start connection maintenance for backend peer
        this.startBackendConnectionMaintenance();
      }

      return true;
    } catch (error) {
      console.error("📦 Failed to initialize IPFS storage:", error);
      // Provide helpful context for WebCrypto-related errors
      if (error instanceof Error && error.message.includes("crypto")) {
        console.warn("📦 This error is likely due to missing WebCrypto support");
        console.warn("📦 Consider using HTTPS or a secure development environment");
      }
      return false;
    } finally {
      this.isInitializing = false;
    }
  }

  // ==========================================
  // Key Derivation Utilities
  // ==========================================

  private hexToBytes(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return bytes;
  }

  private bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  /**
   * Migrate local storage keys from old IPNS name format to new PeerId format
   */
  private migrateStorageKeys(oldIpnsName: string, newIpnsName: string): void {
    if (oldIpnsName === newIpnsName) return;

    // Migrate version counter
    const oldVersionKey = `${STORAGE_KEY_PREFIXES.IPFS_VERSION}${oldIpnsName}`;
    const newVersionKey = `${STORAGE_KEY_PREFIXES.IPFS_VERSION}${newIpnsName}`;
    const version = localStorage.getItem(oldVersionKey);
    if (version && !localStorage.getItem(newVersionKey)) {
      localStorage.setItem(newVersionKey, version);
      localStorage.removeItem(oldVersionKey);
      console.log(`📦 Migrated version key: ${oldIpnsName} -> ${newIpnsName}`);
    }

    // Migrate last CID
    const oldCidKey = `${STORAGE_KEY_PREFIXES.IPFS_LAST_CID}${oldIpnsName}`;
    const newCidKey = `${STORAGE_KEY_PREFIXES.IPFS_LAST_CID}${newIpnsName}`;
    const lastCid = localStorage.getItem(oldCidKey);
    if (lastCid && !localStorage.getItem(newCidKey)) {
      localStorage.setItem(newCidKey, lastCid);
      localStorage.removeItem(oldCidKey);
      console.log(`📦 Migrated CID key: ${oldIpnsName} -> ${newIpnsName}`);
    }
  }

  // ==========================================
  // Connection Gater (Peer Filtering)
  // ==========================================


  // ==========================================
  // IpfsTransport Interface - IPNS Name Management
  // ==========================================

  /**
   * Get the IPNS name for the current wallet
   * Part of IpfsTransport interface
   */
  public getIpnsName(): string | null {
    return this.cachedIpnsName;
  }

  // ==========================================
  // IpfsTransport Interface - Version and CID Tracking
  // ==========================================

  /**
   * Get current version counter (monotonic)
   * Part of IpfsTransport interface
   */
  public getVersionCounter(): number {
    if (!this.cachedIpnsName) return 0;
    const key = `${STORAGE_KEY_PREFIXES.IPFS_VERSION}${this.cachedIpnsName}`;
    return parseInt(localStorage.getItem(key) || "0", 10);
  }

  /**
   * Set version counter
   * Part of IpfsTransport interface
   */
  public setVersionCounter(version: number): void {
    if (!this.cachedIpnsName) return;
    const key = `${STORAGE_KEY_PREFIXES.IPFS_VERSION}${this.cachedIpnsName}`;
    localStorage.setItem(key, String(version));
  }

  /**
   * Get last published CID
   * Part of IpfsTransport interface
   */
  public getLastCid(): string | null {
    if (!this.cachedIpnsName) return null;
    const key = `${STORAGE_KEY_PREFIXES.IPFS_LAST_CID}${this.cachedIpnsName}`;
    return localStorage.getItem(key);
  }

  /**
   * Set last published CID
   * Part of IpfsTransport interface
   */
  public setLastCid(cid: string): void {
    if (!this.cachedIpnsName) return;
    const key = `${STORAGE_KEY_PREFIXES.IPFS_LAST_CID}${this.cachedIpnsName}`;
    localStorage.setItem(key, cid);
  }

  // ==========================================
  // IpfsTransport Interface - IPNS Sequence Tracking
  // ==========================================

  /**
   * Get current IPNS sequence number (for conflict detection)
   * Part of IpfsTransport interface
   */
  public getIpnsSequence(): bigint {
    return this.ipnsSequenceNumber;
  }

  /**
   * Set IPNS sequence number
   * Part of IpfsTransport interface
   */
  public setIpnsSequence(seq: bigint): void {
    this.ipnsSequenceNumber = seq;
    this.setIpnsSequenceNumber(seq);
  }

  // ==========================================
  // IpfsTransport Interface - Gateway Health Monitoring
  // ==========================================

  /**
   * Get gateway health metrics
   * Used for gateway selection and circuit breaking
   * Part of IpfsTransport interface
   */
  public getGatewayHealth(): Map<string, GatewayHealth> {
    return new Map(this.gatewayHealth);
  }

  /**
   * Update gateway health after an operation
   * @internal Used internally to track gateway reliability
   */
  private updateGatewayHealth(gateway: string, success: boolean): void {
    const current = this.gatewayHealth.get(gateway) || {
      lastSuccess: 0,
      failureCount: 0,
    };

    if (success) {
      this.gatewayHealth.set(gateway, {
        lastSuccess: Date.now(),
        failureCount: 0,
      });
    } else {
      this.gatewayHealth.set(gateway, {
        ...current,
        failureCount: current.failureCount + 1,
      });
    }
  }

  // ==========================================
  // IpfsTransport Interface - IPNS Resolution
  // ==========================================

  /**
   * Resolve IPNS name to CID and fetch content
   * Part of IpfsTransport interface
   * @param options Optional resolution options (e.g., useCacheOnly for FAST mode)
   */
  public async resolveIpns(options?: { useCacheOnly?: boolean }): Promise<IpnsResolutionResult> {
    const result = await this.resolveIpnsProgressively(undefined, options);

    if (!result.best) {
      return {
        cid: null,
        sequence: 0n,
      };
    }

    return {
      cid: result.best.cid,
      sequence: result.best.sequence,
      content: result.best._cachedContent,
    };
  }

  // ==========================================
  // IpfsTransport Interface - IPFS Content Operations
  // ==========================================

  /**
   * Fetch content from IPFS by CID
   * Part of IpfsTransport interface
   */
  public async fetchContent(cid: string): Promise<TxfStorageData | null> {
    return this.fetchRemoteContent(cid);
  }

  /**
   * Upload content to IPFS
   * Part of IpfsTransport interface
   * @param options Optional upload options (e.g., skipExtendedVerification for pre-transfer sync)
   */
  public async uploadContent(data: TxfStorageData, options?: { skipExtendedVerification?: boolean }): Promise<IpfsUploadResult> {
    const uploadStartTime = performance.now();
    try {
      // Ensure initialized
      const initialized = await this.ensureInitialized();
      if (!initialized || !this.helia) {
        return {
          cid: "",
          success: false,
          error: "IPFS not initialized",
        };
      }

      // Upload to local Helia node
      const j = json(this.helia);
      const cid = await j.add(data);
      const cidString = cid.toString();

      // Multi-node upload: directly upload content to all configured IPFS nodes
      // IMPORTANT: Use the CID returned by the backend, not Helia's CID!
      // Helia uses dag-json codec (0x0200), but /api/v0/add uses dag-pb codec (0x70, UnixFS wrapper).
      // We must use a consistent CID for IPNS publishing.
      let backendCid: string | null = null;
      const gatewayUrls = getAllBackendGatewayUrls();
      if (gatewayUrls.length > 0) {
        console.log(`📦 Uploading to ${gatewayUrls.length} IPFS node(s)...`);

        const jsonBlob = new Blob([JSON.stringify(data)], {
          type: "application/json",
        });

        // Upload to all nodes in parallel
        const uploadPromises = gatewayUrls.map(async (gatewayUrl) => {
          try {
            const formData = new FormData();
            formData.append("file", jsonBlob, "wallet.json");

            const response = await fetch(
              `${gatewayUrl}/api/v0/add?pin=true&cid-version=1`,
              { method: "POST", body: formData }
            );

            const success = response.ok;
            this.updateGatewayHealth(gatewayUrl, success);

            if (success) {
              const result = await response.json();
              const hostname = new URL(gatewayUrl).hostname;
              console.log(`📦 Uploaded to ${hostname}: ${result.Hash}`);
              return { success: true, host: gatewayUrl, cid: result.Hash as string };
            }
            return { success: false, host: gatewayUrl, error: response.status };
          } catch (error) {
            this.updateGatewayHealth(gatewayUrl, false);
            const hostname = new URL(gatewayUrl).hostname;
            console.warn(`📦 Upload to ${hostname} failed:`, error);
            return { success: false, host: gatewayUrl, error };
          }
        });

        const results = await Promise.allSettled(uploadPromises);
        const successfulResults = results.filter(
          (r): r is PromiseFulfilledResult<{ success: true; host: string; cid: string }> =>
            r.status === "fulfilled" && r.value.success === true
        );
        console.log(`📦 Content uploaded to ${successfulResults.length}/${gatewayUrls.length} nodes`);

        // Use the first successful backend CID - this is the canonical CID
        if (successfulResults.length > 0) {
          backendCid = successfulResults[0].value.cid;
          const uploadHost = successfulResults[0].value.host;
          console.log(`📦 Using backend CID for IPNS: ${backendCid.slice(0, 16)}...`);

          // Verify content is retrievable (backend might need time to index)
          // This prevents CID mismatch issues when content is fetched immediately after upload
          // Skip extended verification in pre-transfer mode (content is already persisted after POST 200)
          if (options?.skipExtendedVerification) {
            console.log(`⚡ Content upload successful - skipping extended verification (fast mode)`);
          } else {
            const maxRetries = 3;
            const retryDelay = 200; // ms
            for (let attempt = 1; attempt <= maxRetries; attempt++) {
              try {
                const verifyResponse = await fetch(
                  `${uploadHost}/ipfs/${backendCid}`,
                  {
                    method: "HEAD",
                    signal: AbortSignal.timeout(2000),
                  }
                );
                if (verifyResponse.ok) {
                  console.log(`📦 Content verified retrievable (attempt ${attempt})`);
                  break;
                }
                if (attempt < maxRetries) {
                  await new Promise((r) => setTimeout(r, retryDelay));
                }
              } catch {
                if (attempt < maxRetries) {
                  await new Promise((r) => setTimeout(r, retryDelay));
                }
              }
            }
          }
        }
      }

      // Determine which CID to use: prefer backend CID (dag-pb codec) over Helia CID (dag-json codec)
      const canonicalCid = backendCid || cidString;
      const canonicalCidSource = backendCid ? "backend (dag-pb codec)" : "Helia (dag-json codec)";
      if (backendCid && backendCid !== cidString) {
        console.log(`📦 CID codec note: backend=${backendCid.slice(0, 12)}... vs helia=${cidString.slice(0, 12)}... (using ${canonicalCidSource})`);
      }

      // Announce content to DHT (non-blocking) - ONLY if DHT enabled
      if (IPFS_CONFIG.enableDht) {
        const PROVIDE_TIMEOUT = 10000;
        try {
          console.log(`📦 Announcing CID to network: ${canonicalCid.slice(0, 16)}...`);
          // Announce the canonical CID (which may be different from Helia's)
          const { CID: CIDClass } = await import("multiformats/cid");
          const cidToAnnounce = CIDClass.parse(canonicalCid);
          await Promise.race([
            this.helia.routing.provide(cidToAnnounce),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("DHT provide timeout")), PROVIDE_TIMEOUT)
            ),
          ]);
          console.log(`📦 CID announced to network`);
        } catch (provideError) {
          console.warn(`📦 Could not announce to DHT (non-fatal):`, provideError);
        }
      } else {
        console.debug(`📦 DHT provide skipped (disabled via config)`);
      }

      const uploadDuration = performance.now() - uploadStartTime;
      console.log(`⏱️ [IpfsStorage] uploadContent completed in ${uploadDuration.toFixed(1)}ms`);

      return {
        cid: canonicalCid,
        success: true,
      };
    } catch (error) {
      const uploadDuration = performance.now() - uploadStartTime;
      console.log(`⏱️ [IpfsStorage] uploadContent failed after ${uploadDuration.toFixed(1)}ms`);
      return {
        cid: "",
        success: false,
        error: error instanceof Error ? error.message : "Upload failed",
      };
    }
  }

  // ==========================================
  // IpfsTransport Interface - IPNS Publishing
  // ==========================================

  /**
   * Publish CID to IPNS
   * Part of IpfsTransport interface
   * @param options Optional publish options (e.g., skipExtendedVerification for pre-transfer sync)
   */
  public async publishIpns(cid: string, options?: { skipExtendedVerification?: boolean }): Promise<IpnsPublishResult> {
    const publishStartTime = performance.now();
    try {
      const { CID } = await import("multiformats/cid");
      const parsedCid = CID.parse(cid);

      const ipnsName = await this.publishToIpns(parsedCid, options?.skipExtendedVerification);

      if (ipnsName) {
        const publishDuration = performance.now() - publishStartTime;
        console.log(`⏱️ [IpfsStorage] publishIpns completed in ${publishDuration.toFixed(1)}ms`);
        return {
          ipnsName,
          success: true,
          sequence: this.ipnsSequenceNumber,
          verified: true,
        };
      } else {
        const publishDuration = performance.now() - publishStartTime;
        console.log(`⏱️ [IpfsStorage] publishIpns failed after ${publishDuration.toFixed(1)}ms`);
        return {
          ipnsName: this.cachedIpnsName,
          success: false,
          verified: false,
          error: "IPNS publish failed or not verified",
        };
      }
    } catch (error) {
      const publishDuration = performance.now() - publishStartTime;
      console.log(`⏱️ [IpfsStorage] publishIpns error after ${publishDuration.toFixed(1)}ms`);
      return {
        ipnsName: this.cachedIpnsName,
        success: false,
        verified: false,
        error: error instanceof Error ? error.message : "IPNS publish failed",
      };
    }
  }

  // ==========================================
  // IPNS Publishing
  // ==========================================

  /**
   * Get the last IPNS sequence number from storage
   */
  private getIpnsSequenceNumber(): bigint {
    if (!this.cachedIpnsName) return 0n;
    const key = `${STORAGE_KEY_PREFIXES.IPNS_SEQ}${this.cachedIpnsName}`;
    const stored = localStorage.getItem(key);
    return stored ? BigInt(stored) : 0n;
  }

  /**
   * Save the IPNS sequence number to storage
   */
  private setIpnsSequenceNumber(seq: bigint): void {
    if (!this.cachedIpnsName) return;
    const key = `${STORAGE_KEY_PREFIXES.IPNS_SEQ}${this.cachedIpnsName}`;
    localStorage.setItem(key, seq.toString());
  }

  /**
   * Publish pre-signed IPNS record via Kubo HTTP API
   * Much faster than browser DHT - server has better connectivity
   * @param marshalledRecord The signed, marshalled IPNS record bytes
   * @returns true if at least one backend accepted the record
   */
  private async publishIpnsViaHttp(
    marshalledRecord: Uint8Array
  ): Promise<boolean> {
    const gatewayUrls = getAllBackendGatewayUrls();
    if (gatewayUrls.length === 0) {
      console.warn("📦 No backend gateways configured for HTTP IPNS publish");
      return false;
    }

    // For Kubo API, we pass the IPNS name (peer ID) as the first arg
    const ipnsName = this.cachedIpnsName;
    if (!ipnsName) {
      console.warn("📦 No IPNS name cached - cannot publish via HTTP");
      return false;
    }

    console.log(`📦 Publishing IPNS via HTTP to ${gatewayUrls.length} backend(s)...`);

    // Try all configured gateways in parallel
    const results = await Promise.allSettled(
      gatewayUrls.map(async (gatewayUrl) => {
        try {
          // Kubo /api/v0/routing/put expects:
          // - arg: the routing key path (e.g., "/ipns/12D3KooW...")
          // - body: the marshalled record bytes as multipart form
          const formData = new FormData();
          // Create Blob from Uint8Array (spread to array for type compatibility)
          formData.append(
            "file",
            new Blob([new Uint8Array(marshalledRecord)]),
            "record"
          );

          // NOTE: Do NOT use allow-offline=true - it prevents DHT propagation!
          // The call may take longer but ensures IPNS records reach the DHT
          const response = await fetch(
            `${gatewayUrl}/api/v0/routing/put?arg=/ipns/${ipnsName}`,
            {
              method: "POST",
              body: formData,
              signal: AbortSignal.timeout(30000), // 30s timeout
            }
          );

          if (!response.ok) {
            const errorText = await response.text().catch(() => "");
            const errorLower = errorText.toLowerCase();

            // Detect sequence rejection errors from the sidecar
            // The sidecar rejects records with sequence <= existing sequence
            const isSequenceError =
              response.status === 400 &&
              (errorLower.includes('sequence') ||
               errorLower.includes('rejecting ipns record'));

            // Detect version mismatch errors from the sidecar
            // The sidecar rejects records where _meta.version != current_version + 1
            const isVersionMismatch =
              response.status === 400 &&
              errorLower.includes('version_mismatch');

            const error = new Error(`HTTP ${response.status}: ${errorText.slice(0, 100)}`) as Error & {
              isSequenceRejection?: boolean;
              isVersionMismatch?: boolean;
              httpStatus?: number;
            };
            error.isSequenceRejection = isSequenceError;
            error.isVersionMismatch = isVersionMismatch;
            error.httpStatus = response.status;
            throw error;
          }

          const hostname = new URL(gatewayUrl).hostname;
          console.log(`📦 IPNS record accepted by ${hostname}`);
          return gatewayUrl;
        } catch (error) {
          const hostname = new URL(gatewayUrl).hostname;
          console.warn(`📦 HTTP IPNS publish to ${hostname} failed:`, error);
          throw error;
        }
      })
    );

    const successful = results.filter((r) => r.status === "fulfilled");
    if (successful.length > 0) {
      console.log(
        `📦 IPNS record published via HTTP to ${successful.length}/${gatewayUrls.length} backends`
      );
      return true;
    }

    console.warn("📦 HTTP IPNS publish failed on all backends");
    return false;
  }

  /**
   * Fire-and-forget IPNS publish via browser DHT
   * Runs in background - doesn't block sync completion
   * Provides redundancy alongside HTTP publish
   * @param routingKey The DHT routing key
   * @param marshalledRecord The signed, marshalled IPNS record bytes
   */
  private publishIpnsViaDhtAsync(
    routingKey: Uint8Array,
    marshalledRecord: Uint8Array
  ): void {
    if (!IPFS_CONFIG.enableDht) {
      console.debug("📦 DHT IPNS publish skipped (disabled via config)");
      return;
    }
    if (!this.helia) return;

    const helia = this.helia;
    const DHT_BACKGROUND_TIMEOUT = 60000; // 60s - longer timeout since it's background

    // Don't await - let it run in background
    (async () => {
      try {
        await Promise.race([
          helia.routing.put(routingKey, marshalledRecord),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error("DHT background timeout")),
              DHT_BACKGROUND_TIMEOUT
            )
          ),
        ]);
        console.log("📦 IPNS record also propagated via browser DHT");
      } catch (error) {
        // Non-fatal - HTTP publish is primary
        console.debug("📦 Browser DHT IPNS publish completed with:", error);
      }
    })();
  }

  /**
   * Publish CID to IPNS using dual strategy:
   * 1. Primary: HTTP POST to Kubo backend (fast, reliable)
   * 2. Fallback: Fire-and-forget browser DHT (slow but provides redundancy)
   * @param cid The CID to publish
   * @param skipExtendedVerification If true, reduce verification retries for faster operation
   * @returns The IPNS name on success, null on failure (non-fatal)
   */
  private async publishToIpns(cid: CID, skipExtendedVerification?: boolean): Promise<string | null> {
    if (!this.helia || !this.ipnsKeyPair) {
      console.warn("📦 IPNS key not initialized - skipping IPNS publish");
      return null;
    }

    const IPNS_LIFETIME = 99 * 365 * 24 * 60 * 60 * 1000; // 99 years in ms
    const ipnsKeyPair = this.ipnsKeyPair;

    try {
      console.log(
        `📦 Publishing to IPNS: ${this.cachedIpnsName?.slice(0, 16)}... -> ${cid.toString().slice(0, 16)}...`
      );

      // Use max of local and known remote sequence + 1 to ensure we're always ahead
      // This handles the case where another device published with a higher sequence
      const baseSeq = this.ipnsSequenceNumber > this.lastKnownRemoteSequence
        ? this.ipnsSequenceNumber
        : this.lastKnownRemoteSequence;
      this.ipnsSequenceNumber = baseSeq + 1n;
      console.log(`📦 IPNS sequence: local=${this.ipnsSequenceNumber - 1n}, remote=${this.lastKnownRemoteSequence}, using=${this.ipnsSequenceNumber}`);

      // 1. Create and sign IPNS record (once - used for both paths)
      const record = await createIPNSRecord(
        ipnsKeyPair,
        `/ipfs/${cid.toString()}`,
        this.ipnsSequenceNumber,
        IPNS_LIFETIME
      );

      // Marshal the record for storage/transmission
      const marshalledRecord = marshalIPNSRecord(record);

      // Create the routing key from the public key (needed for DHT path)
      const routingKey = multihashToIPNSRoutingKey(
        ipnsKeyPair.publicKey.toMultihash()
      );

      // 2. Publish via HTTP (primary, fast) - AWAIT this
      // HTTP path uses cachedIpnsName internally, doesn't need routingKey
      let httpSuccess = false;
      let currentMarshalledRecord = marshalledRecord;
      let currentRoutingKey = routingKey;

      try {
        httpSuccess = await this.publishIpnsViaHttp(currentMarshalledRecord);
      } catch (error: unknown) {
        // Check if this is a sequence or version rejection error
        const err = error as Error & { isSequenceRejection?: boolean; isVersionMismatch?: boolean };

        if (err.isVersionMismatch) {
          // Version mismatch: content's _meta.version doesn't match expected (remote + 1)
          // This requires re-uploading content with corrected version - cannot fix in IPNS layer alone
          console.error(`📦 VERSION MISMATCH detected - content has wrong version`);
          console.error(`📦 Recovery requires: fetch remote version -> rebuild content -> re-upload -> re-publish`);

          // Fetch latest to update our version tracking for retry loop
          const httpResolver = getIpfsHttpResolver();
          httpResolver.invalidateIpnsCache();
          const resolution = await this.resolveIpnsProgressively();

          if (resolution.best) {
            // Update sequence tracking
            this.lastKnownRemoteSequence = resolution.best.sequence;
            console.log(`📦 Updated remote sequence tracking to ${resolution.best.sequence}`);

            // Fetch remote content to get actual version
            try {
              const remoteContent = await this.fetchRemoteContent(resolution.best.cid);
              if (remoteContent?._meta?.version) {
                console.log(`📦 Remote content version is ${remoteContent._meta.version}`);
                // Signal to caller that version needs correction
                // The background retry loop will handle this with a full re-sync
              }
            } catch (fetchErr) {
              console.warn(`📦 Could not fetch remote content for version check:`, fetchErr);
            }
          }

          // Fall through - version mismatch requires full re-sync, will be handled by retry loop
          console.warn(`📦 Version mismatch will be resolved by background retry loop`);

        } else if (err.isSequenceRejection) {
          console.warn(`📦 Sequence rejection detected - fetching latest and retrying...`);

          // Fetch latest IPNS record to get correct sequence
          const httpResolver = getIpfsHttpResolver();
          httpResolver.invalidateIpnsCache();
          const resolution = await this.resolveIpnsProgressively();

          if (resolution.best) {
            // Update tracking with actual remote sequence
            const remoteSeq = resolution.best.sequence;
            console.log(`📦 Remote sequence is ${remoteSeq}, our attempt was ${this.ipnsSequenceNumber}`);
            this.lastKnownRemoteSequence = remoteSeq;

            // Recalculate sequence number (remote + 1)
            this.ipnsSequenceNumber = remoteSeq + 1n;
            console.log(`📦 Retrying with corrected sequence: ${this.ipnsSequenceNumber}`);

            // Re-create record with corrected sequence
            const newRecord = await createIPNSRecord(
              ipnsKeyPair,
              `/ipfs/${cid.toString()}`,
              this.ipnsSequenceNumber,
              IPNS_LIFETIME
            );
            currentMarshalledRecord = marshalIPNSRecord(newRecord);
            currentRoutingKey = multihashToIPNSRoutingKey(
              ipnsKeyPair.publicKey.toMultihash()
            );

            // Retry publish with corrected sequence
            try {
              httpSuccess = await this.publishIpnsViaHttp(currentMarshalledRecord);
              console.log(`✅ Retry succeeded with sequence ${this.ipnsSequenceNumber}`);
            } catch (retryError) {
              console.warn(`📦 Retry also failed:`, retryError);
              // Fall through to DHT path
            }
          } else {
            console.warn(`📦 Could not fetch remote state for sequence correction`);
            // Fall through to DHT path
          }
        } else {
          // Not a sequence/version error - log and continue to DHT path
          console.warn(`📦 HTTP IPNS publish failed (non-sequence error):`, error);
        }
      }

      // 3. Publish via browser DHT (fallback, fire-and-forget) - DON'T await
      // This runs in background regardless of HTTP result for redundancy
      this.publishIpnsViaDhtAsync(currentRoutingKey, currentMarshalledRecord);

      if (httpSuccess) {
        // CRITICAL: Verify the IPNS record was actually persisted
        // HTTP 200 only means the node received the record, NOT that it persisted
        const httpResolver = getIpfsHttpResolver();
        const cidString = cid.toString();
        // Use fewer retries in fast mode - record is already accepted, verification confirms propagation
        const verificationRetries = skipExtendedVerification ? 1 : 3;
        const verification = await httpResolver.verifyIpnsRecord(
          this.cachedIpnsName!,
          this.ipnsSequenceNumber,
          cidString,
          verificationRetries,
          skipExtendedVerification // Pass flag to skip delays
        );

        if (verification.verified) {
          // Save sequence number only after verification confirms persistence
          this.setIpnsSequenceNumber(this.ipnsSequenceNumber);
          console.log(
            `✅ IPNS record published AND verified (seq: ${this.ipnsSequenceNumber})`
          );

          // Update cache with verified CID/sequence and mark as known-fresh
          // This enables FAST mode to skip IPNS resolution on subsequent syncs
          const ipfsCache = getIpfsCache();
          ipfsCache.setIpnsRecord(this.cachedIpnsName!, {
            cid: cidString,
            sequence: this.ipnsSequenceNumber,
          });
          ipfsCache.markIpnsCacheFresh(this.cachedIpnsName!);
          console.log(`[IpfsStorageService] Local publish complete - cache updated and marked fresh`);

          return this.cachedIpnsName;
        } else {
          // Verification failed - the record didn't persist!
          console.error(
            `❌ IPNS publish verification FAILED: ${verification.error}`
          );
          console.error(
            `   Expected: seq=${this.ipnsSequenceNumber}, cid=${cidString.slice(0, 16)}...`
          );
          if (verification.actualSeq !== undefined) {
            console.error(
              `   Actual:   seq=${verification.actualSeq}, cid=${verification.actualCid?.slice(0, 16) ?? 'unknown'}...`
            );
          }

          // If node has higher sequence, update our tracking to avoid republish loops
          if (verification.actualSeq !== undefined && verification.actualSeq > this.ipnsSequenceNumber) {
            this.lastKnownRemoteSequence = verification.actualSeq;
            console.log(`📦 Updated lastKnownRemoteSequence to ${verification.actualSeq}`);
          }

          // Rollback our sequence since publish didn't persist
          this.ipnsSequenceNumber--;
          console.log(`📦 Rolled back local sequence to ${this.ipnsSequenceNumber}`);

          // Return null to indicate publish failed
          return null;
        }
      }

      // HTTP failed - DHT is still trying in background
      // We still consider this a partial success since DHT may succeed
      console.warn(
        "📦 HTTP IPNS publish failed, DHT attempting in background"
      );
      // Don't rollback sequence - DHT may succeed with this sequence
      // But don't persist it either - if DHT fails, we'll retry with same seq
      return null;
    } catch (error) {
      // Rollback sequence number on failure
      this.ipnsSequenceNumber--;
      // Non-fatal - content is still stored and announced
      console.warn(`📦 IPNS publish failed:`, error);
      return null;
    }
  }

  /**
   * Start the IPNS sync retry loop.
   * This runs in the background, retrying until IPNS verification succeeds.
   * Each retry: fetches latest IPNS, merges with local, republishes.
   *
   * Uses exponential backoff with jitter to avoid thundering herd.
   */
  private startIpnsSyncRetryLoop(): void {
    if (this.ipnsSyncRetryActive) {
      console.log(`📦 [RetryLoop] Already active, skipping start`);
      return;
    }

    this.ipnsSyncRetryActive = true;
    this.ipnsSyncRetryCount = 0;
    console.log(`📦 [RetryLoop] Starting IPNS sync retry loop...`);

    // Run the loop (fire and forget - it manages itself)
    this.runIpnsSyncRetryIteration();
  }

  /**
   * Single iteration of the IPNS sync retry loop.
   * Schedules the next iteration if needed.
   */
  private async runIpnsSyncRetryIteration(): Promise<void> {
    if (!this.ipnsSyncRetryActive) {
      console.log(`📦 [RetryLoop] Stopped (active=false)`);
      return;
    }

    this.ipnsSyncRetryCount++;
    const attempt = this.ipnsSyncRetryCount;

    // Calculate delay with exponential backoff + jitter
    const baseDelay = Math.min(
      this.BASE_IPNS_RETRY_DELAY_MS * Math.pow(1.5, attempt - 1),
      this.MAX_IPNS_RETRY_DELAY_MS
    );
    // Add jitter: 50-150% of base delay
    const jitter = 0.5 + Math.random();
    const delayMs = Math.round(baseDelay * jitter);

    console.log(`📦 [RetryLoop] Attempt ${attempt}: waiting ${delayMs}ms before retry...`);

    await new Promise(resolve => setTimeout(resolve, delayMs));

    // Check if still active after delay
    if (!this.ipnsSyncRetryActive) {
      console.log(`📦 [RetryLoop] Stopped during delay`);
      return;
    }

    try {
      console.log(`📦 [RetryLoop] Attempt ${attempt}: Fetching latest IPNS and resyncing...`);

      // Step 1: Fetch the latest IPNS record to get current sequence and content
      const httpResolver = getIpfsHttpResolver();
      httpResolver.invalidateIpnsCache(); // Force fresh fetch

      const resolution = await this.resolveIpnsProgressively();

      if (resolution.best) {
        const remoteSeq = resolution.best.sequence;
        const remoteCid = resolution.best.cid;

        console.log(`📦 [RetryLoop] Remote state: seq=${remoteSeq}, cid=${remoteCid.slice(0, 16)}...`);

        // Update our tracking of remote sequence
        this.lastKnownRemoteSequence = remoteSeq;

        // Step 2: Fetch remote content and merge with local
        const remoteData = await this.fetchRemoteContent(remoteCid);
        if (remoteData) {
          console.log(`📦 [RetryLoop] Fetched remote content, importing...`);
          await this.importRemoteData(remoteData);
        }
      }

      // Step 3: Re-sync with merged data (this will publish with new sequence)
      console.log(`📦 [RetryLoop] Re-syncing with merged data...`);
      const result = await this.syncNow({ forceIpnsPublish: true, isRetryAttempt: true });

      if (result.success && result.ipnsPublished) {
        // Success! Stop the retry loop
        console.log(`✅ [RetryLoop] IPNS sync succeeded after ${attempt} attempt(s)`);
        this.ipnsSyncRetryActive = false;
        this.ipnsSyncRetryCount = 0;
        return;
      }

      // Still pending - continue retrying
      if (result.ipnsPublishPending) {
        console.log(`📦 [RetryLoop] Attempt ${attempt} still pending, will retry...`);
      } else {
        console.log(`📦 [RetryLoop] Attempt ${attempt} completed but IPNS not published, will retry...`);
      }

    } catch (error) {
      console.error(`📦 [RetryLoop] Attempt ${attempt} failed with error:`, error);
    }

    // Schedule next iteration
    if (this.ipnsSyncRetryActive) {
      // Use setTimeout to avoid blocking and allow the event loop to process other events
      setTimeout(() => this.runIpnsSyncRetryIteration(), 0);
    }
  }

  /**
   * Stop the IPNS sync retry loop (e.g., when component unmounts or on success)
   */
  stopIpnsSyncRetryLoop(): void {
    if (this.ipnsSyncRetryActive) {
      console.log(`📦 [RetryLoop] Stopping IPNS sync retry loop`);
      this.ipnsSyncRetryActive = false;
      this.ipnsSyncRetryCount = 0;
    }
  }

  // ==========================================
  // Progressive IPNS Resolution (Multi-Gateway)
  // ==========================================

  /**
   * Fetch IPNS record from a single HTTP gateway
   * Returns the CID and sequence number, or null if failed
   */
  private async resolveIpnsFromGateway(gatewayUrl: string): Promise<IpnsGatewayResult | null> {
    if (!this.cachedIpnsName) {
      return null;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        IPNS_RESOLUTION_CONFIG.perGatewayTimeoutMs
      );

      // Use Kubo's routing/get API to fetch the raw IPNS record
      const response = await fetch(
        `${gatewayUrl}/api/v0/routing/get?arg=/ipns/${this.cachedIpnsName}`,
        {
          method: "POST",
          signal: controller.signal,
        }
      );

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.debug(`📦 Gateway ${new URL(gatewayUrl).hostname} returned ${response.status}`);
        return null;
      }

      // Kubo returns JSON with base64-encoded record in "Extra" field:
      // {"ID":"","Type":5,"Responses":null,"Extra":"<base64-encoded-ipns-record>"}
      const json = await response.json() as { Extra?: string; Type?: number };

      if (!json.Extra) {
        console.debug(`📦 Gateway ${new URL(gatewayUrl).hostname} returned no Extra field`);
        return null;
      }

      // Decode base64 Extra field to get raw IPNS record
      const recordData = Uint8Array.from(atob(json.Extra), c => c.charCodeAt(0));
      const record = unmarshalIPNSRecord(recordData);

      // Extract CID from value path
      const cidMatch = record.value.match(/^\/ipfs\/(.+)$/);
      if (!cidMatch) {
        console.debug(`📦 Gateway ${new URL(gatewayUrl).hostname} returned invalid IPNS value: ${record.value}`);
        return null;
      }

      return {
        cid: cidMatch[1],
        sequence: record.sequence,
        gateway: gatewayUrl,
        recordData,
      };
    } catch (error) {
      const hostname = new URL(gatewayUrl).hostname;
      if (error instanceof Error && error.name === "AbortError") {
        console.debug(`📦 Gateway ${hostname} timeout`);
      } else {
        console.debug(`📦 Gateway ${hostname} error:`, error);
      }
      return null;
    }
  }

  /**
   * Resolve IPNS via gateway path (fast, ~30ms with cache)
   * Uses /ipns/{name}?format=dag-json for cached resolution
   * Returns CID and content directly, but no sequence number
   */
  private async resolveIpnsViaGatewayPath(
    gatewayUrl: string
  ): Promise<{ cid: string; content: TxfStorageData; latency: number } | null> {
    if (!this.cachedIpnsName) {
      return null;
    }

    const startTime = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      IPNS_RESOLUTION_CONFIG.gatewayPathTimeoutMs
    );

    try {
      const url = `${gatewayUrl}/ipns/${this.cachedIpnsName}?format=dag-json`;
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: "application/vnd.ipld.dag-json, application/json",
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return null;
      }

      // Extract CID from X-Ipfs-Path header: "/ipfs/bafk..."
      const ipfsPath = response.headers.get("X-Ipfs-Path");
      const cidMatch = ipfsPath?.match(/^\/ipfs\/(.+)$/);
      const cid = cidMatch?.[1] || "";

      const content = await response.json() as TxfStorageData;
      const latency = Date.now() - startTime;

      if (!cid) {
        console.debug(`📦 Gateway ${new URL(gatewayUrl).hostname} returned no X-Ipfs-Path header`);
      }

      return { cid, content, latency };
    } catch (error) {
      clearTimeout(timeoutId);
      const hostname = new URL(gatewayUrl).hostname;
      if (error instanceof Error && error.name === "AbortError") {
        console.debug(`📦 Gateway path ${hostname} timeout`);
      } else {
        console.debug(`📦 Gateway path ${hostname} error:`, error);
      }
      return null;
    }
  }

  /**
   * Resolve IPNS progressively from all gateways using dual-path racing
   *
   * Races both methods in parallel for each gateway:
   * - Gateway path: /ipns/{name}?format=dag-json (fast ~30ms, returns content)
   * - Routing API: /api/v0/routing/get (slow ~5s, returns sequence number)
   *
   * Returns best result after initial timeout, continues collecting late responses.
   * Gateway path results include cached content to avoid re-fetch.
   * Calls onLateHigherSequence if a late response has higher sequence.
   */
  private async resolveIpnsProgressively(
    onLateHigherSequence?: (result: IpnsGatewayResult) => void,
    options?: { useCacheOnly?: boolean }
  ): Promise<IpnsProgressiveResult> {
    const gatewayUrls = getAllBackendGatewayUrls();
    if (gatewayUrls.length === 0 || !this.cachedIpnsName) {
      return { best: null, allResults: [], respondedCount: 0, totalGateways: 0 };
    }

    const startTime = performance.now();
    const metrics = getIpfsMetrics();

    // Fast path: Use HTTP resolver with caching (target: <100ms for cache hit)
    // In FAST mode with useCacheOnly=true, skip network if cache is known-fresh
    const httpResolver = getIpfsHttpResolver();
    const httpResult = await httpResolver.resolveIpnsName(this.cachedIpnsName, options?.useCacheOnly);

    if (httpResult.success && httpResult.cid) {
      const latencyMs = performance.now() - startTime;
      console.log(`📦 IPNS resolved via HTTP in ${latencyMs.toFixed(0)}ms (source: ${httpResult.source})`);

      // Record metrics
      metrics.recordOperation({
        operation: "resolve",
        source: httpResult.source as "cache" | "http-gateway" | "http-routing" | "dht" | "none",
        latencyMs,
        success: true,
        timestamp: Date.now(),
        cacheHit: httpResult.source === "cache",
      });

      // Convert HTTP result to internal format
      const gatewayResult: IpnsGatewayResult = {
        cid: httpResult.cid,
        sequence: httpResult.sequence ?? 0n,
        gateway: "http-resolver",
        recordData: new Uint8Array(),
        _cachedContent: httpResult.content ?? undefined,
      };

      // Update last known remote sequence if available
      if (httpResult.sequence && httpResult.sequence > 0n) {
        this.lastKnownRemoteSequence = httpResult.sequence;
      }

      return {
        best: gatewayResult,
        allResults: [gatewayResult],
        respondedCount: gatewayUrls.length, // HTTP resolver queries all nodes
        totalGateways: gatewayUrls.length,
      };
    }

    // Record HTTP failure, fall back to existing implementation
    if (!httpResult.success) {
      const latencyMs = performance.now() - startTime;
      console.log(`📦 HTTP resolution failed (${httpResult.error}), falling back to direct gateway queries...`);

      metrics.recordOperation({
        operation: "resolve",
        source: "http-gateway",
        latencyMs,
        success: false,
        timestamp: Date.now(),
        error: httpResult.error,
      });
    }

    // Fallback: Use existing progressive resolution (slower but more reliable)
    console.log(`📦 Racing IPNS resolution from ${gatewayUrls.length} gateways (gateway path + routing API)...`);

    const results: IpnsGatewayResult[] = [];
    // Track which gateways have responded via gateway path (for fast results)
    const gatewayPathResults = new Map<string, { cid: string; content: TxfStorageData; latency: number }>();

    // Create promises for each gateway - race both methods
    const gatewayPromises = gatewayUrls.map(async (url) => {
      const hostname = new URL(url).hostname;

      // Start both methods in parallel
      const gatewayPathPromise = this.resolveIpnsViaGatewayPath(url);
      const routingApiPromise = this.resolveIpnsFromGateway(url);

      // Wait for both to settle (we want results from both if available)
      const [gatewayPathResult, routingApiResult] = await Promise.allSettled([
        gatewayPathPromise,
        routingApiPromise,
      ]);

      // Process gateway path result (fast, has content, no sequence)
      let fastCid: string | null = null;
      let fastContent: TxfStorageData | null = null;
      if (gatewayPathResult.status === "fulfilled" && gatewayPathResult.value) {
        const { cid, content, latency } = gatewayPathResult.value;
        if (cid) {
          fastCid = cid;
          fastContent = content;
          gatewayPathResults.set(url, { cid, content, latency });
          console.log(`📦 Gateway path ${hostname}: CID=${cid.slice(0, 16)}... (${latency}ms)`);
        }
      }

      // Process routing API result (slow, has sequence)
      if (routingApiResult.status === "fulfilled" && routingApiResult.value) {
        const result = routingApiResult.value;
        // Merge cached content from gateway path if same CID
        if (fastContent && fastCid === result.cid) {
          result._cachedContent = fastContent;
        }
        results.push(result);
        console.log(`📦 Routing API ${hostname}: seq=${result.sequence}, CID=${result.cid.slice(0, 16)}...`);
        return result;
      }

      // If only gateway path succeeded (no routing result), create result with sequence 0
      // This allows fast content fetch, sequence will be updated by late routing responses
      if (fastCid && fastContent) {
        const partialResult: IpnsGatewayResult = {
          cid: fastCid,
          sequence: 0n, // Unknown sequence - will be updated by late routing response
          gateway: url,
          recordData: new Uint8Array(),
          _cachedContent: fastContent,
        };
        results.push(partialResult);
        console.log(`📦 Gateway path only ${hostname}: CID=${fastCid.slice(0, 16)}... (seq unknown)`);
        return partialResult;
      }

      return null;
    });

    // Wait for initial timeout to collect responses
    await Promise.race([
      Promise.allSettled(gatewayPromises),
      new Promise((resolve) => setTimeout(resolve, IPNS_RESOLUTION_CONFIG.initialTimeoutMs)),
    ]);

    // Find best result (highest sequence, or first with content if no sequences)
    const findBest = (arr: IpnsGatewayResult[]): IpnsGatewayResult | null => {
      if (arr.length === 0) return null;
      // Prefer results with known sequence (> 0)
      const withSequence = arr.filter(r => r.sequence > 0n);
      if (withSequence.length > 0) {
        return withSequence.reduce((best, current) =>
          current.sequence > best.sequence ? current : best
        );
      }
      // Fall back to first result with cached content
      const withContent = arr.find(r => r._cachedContent);
      return withContent || arr[0];
    };

    const initialBest = findBest(results);
    const initialCount = results.length;
    const initialSeq = initialBest?.sequence ?? 0n;
    const hasContent = !!initialBest?._cachedContent;

    console.log(
      `📦 Initial timeout: ${initialCount}/${gatewayUrls.length} responded, ` +
      `best seq=${initialSeq.toString()}, hasContent=${hasContent}`
    );

    // Continue waiting for late responses in background
    if (onLateHigherSequence && initialCount < gatewayUrls.length) {
      // Don't await - let this run in background
      Promise.allSettled(gatewayPromises).then(() => {
        // Find the new best after all responses
        const finalBest = findBest(results);
        // Check if any late response has higher sequence than initial best
        if (finalBest && finalBest.sequence > initialSeq) {
          console.log(
            `📦 Late response with higher sequence: seq=${finalBest.sequence} ` +
            `from ${new URL(finalBest.gateway).hostname} (was seq=${initialSeq})`
          );
          onLateHigherSequence(finalBest);
        }
      });
    }

    return {
      best: initialBest,
      allResults: [...results], // Snapshot at initial timeout
      respondedCount: initialCount,
      totalGateways: gatewayUrls.length,
    };
  }

  /**
   * Handle discovery of a higher IPNS sequence number
   * Fetches the new content and merges with local state
   */
  private async handleHigherSequenceDiscovered(result: IpnsGatewayResult): Promise<void> {
    console.log(`📦 Handling higher sequence discovery: seq=${result.sequence}, cid=${result.cid.slice(0, 16)}...`);

    // Don't process if already syncing
    if (this.isSyncing) {
      console.log(`📦 Sync in progress, deferring higher sequence handling`);
      return;
    }

    // Update last known remote sequence
    this.lastKnownRemoteSequence = result.sequence;

    // Fetch the content from IPFS
    const remoteData = await this.fetchRemoteContent(result.cid);
    if (!remoteData) {
      console.warn(`📦 Failed to fetch content for higher sequence CID: ${result.cid.slice(0, 16)}...`);
      return;
    }

    // Compare versions
    const localVersion = this.getVersionCounter();
    const remoteVersion = remoteData._meta.version;

    if (remoteVersion > localVersion) {
      console.log(`📦 Remote version ${remoteVersion} > local ${localVersion}, importing...`);

      // Import the remote data
      const importedCount = await this.importRemoteData(remoteData);

      // Update local tracking
      this.setVersionCounter(remoteVersion);
      this.setLastCid(result.cid);

      console.log(`📦 Imported ${importedCount} token(s) from late-arriving higher sequence`);

      // Invalidate UNSPENT cache since inventory changed
      if (importedCount > 0) {
        getTokenValidationService().clearUnspentCacheEntries();
      }

      // Emit event to notify UI
      await this.emitEvent({
        type: "storage:completed",
        timestamp: Date.now(),
        data: {
          cid: result.cid,
          tokenCount: importedCount,
        },
      });

      // Trigger wallet refresh
      window.dispatchEvent(new Event("wallet-updated"));

      // CRITICAL: Check if local has unique tokens that weren't in remote
      // This handles case where local tokens were minted but remote was ahead
      // Without this sync, local-only tokens would be lost on next restart
      if (await this.localDiffersFromRemote(remoteData)) {
        console.log(`📦 Local has unique content after higher-sequence import - would need re-sync`);
        console.warn(`⚠️ Skipping auto-sync to prevent dual-publish. Use syncNow() explicitly if needed.`);
        // DEPRECATED: scheduleSync() removed - prevents dual-publish race condition
      }
    } else {
      // Local version is same or higher, BUT remote might have new tokens we don't have
      // (e.g., Browser 2 received token via Nostr while Browser 1 was offline)
      console.log(`📦 Remote version ${remoteVersion} not newer than local ${localVersion}, checking for new tokens...`);

      // Still import remote data - importRemoteData handles deduplication
      const importedCount = await this.importRemoteData(remoteData);

      if (importedCount > 0) {
        console.log(`📦 Imported ${importedCount} new token(s) from remote despite lower version`);

        // Invalidate UNSPENT cache since inventory changed
        getTokenValidationService().clearUnspentCacheEntries();

        // Trigger wallet refresh
        window.dispatchEvent(new Event("wallet-updated"));
      }

      // Only sync if local differs from remote (has unique tokens or better versions)
      // This prevents unnecessary re-publishing when local now matches remote
      if (await this.localDiffersFromRemote(remoteData)) {
        console.log(`📦 Local differs from remote - would need re-sync`);
        console.warn(`⚠️ Skipping auto-sync to prevent dual-publish. Use syncNow() explicitly if needed.`);
        // DEPRECATED: scheduleSync() removed - prevents dual-publish race condition

        // Emit event to notify UI
        await this.emitEvent({
          type: "storage:completed",
          timestamp: Date.now(),
          data: {
            cid: result.cid,
            tokenCount: importedCount,
          },
        });
      } else {
        console.log(`📦 Local now matches remote after import, no sync needed`);

        // Update local tracking to match remote (we're in sync)
        this.setLastCid(result.cid);
        this.setVersionCounter(remoteVersion);
      }
    }
  }

  // ==========================================
  // IPNS Polling (Background Re-fetch)
  // ==========================================

  /**
   * Start periodic IPNS polling to detect cross-device updates
   * Only runs when tab is visible
   */
  private startIpnsPolling(): void {
    if (this.ipnsPollingInterval) {
      return; // Already running
    }

    const poll = async () => {
      if (!this.cachedIpnsName || this.isSyncing) {
        return;
      }

      console.log(`📦 IPNS poll: checking for remote updates...`);

      const result = await this.resolveIpnsProgressively();

      if (result.best) {
        const localSeq = this.ipnsSequenceNumber;

        // Check for higher sequence number
        const hasHigherSequence = result.best.sequence > localSeq &&
                                   result.best.sequence > this.lastKnownRemoteSequence;

        // Also check for CID mismatch at same sequence (race condition between devices)
        // This can happen when two devices publish with the same sequence number
        const localCid = this.getLastCid();
        const hasDifferentCid = localCid && result.best.cid !== localCid &&
                                 result.best.sequence >= localSeq;

        if (hasHigherSequence) {
          console.log(
            `📦 IPNS poll detected higher sequence: remote=${result.best.sequence}, local=${localSeq}`
          );
          await this.handleHigherSequenceDiscovered(result.best);
        } else if (hasDifferentCid) {
          console.log(
            `📦 IPNS poll detected different CID at same sequence: ` +
            `remote=${result.best.cid.slice(0, 16)}... != local=${localCid?.slice(0, 16)}...`
          );
          await this.handleHigherSequenceDiscovered(result.best);
        } else {
          console.log(
            `📦 IPNS poll: no updates (remote seq=${result.best.sequence}, local seq=${localSeq}, ` +
            `cid match=${result.best.cid === localCid})`
          );
        }
      }

      // Run spent token sanity check after checking for remote updates
      await this.runSpentTokenSanityCheck();
    };

    // Calculate random interval with jitter (uses longer interval when tab is inactive)
    const getRandomInterval = () => {
      const config = IPNS_RESOLUTION_CONFIG;
      const minMs = this.isTabVisible ? config.pollingIntervalMinMs : config.inactivePollingIntervalMinMs;
      const maxMs = this.isTabVisible ? config.pollingIntervalMaxMs : config.inactivePollingIntervalMaxMs;
      return minMs + Math.random() * (maxMs - minMs);
    };

    // Schedule next poll with jitter
    const scheduleNextPoll = () => {
      const interval = getRandomInterval();
      this.ipnsPollingInterval = setTimeout(async () => {
        await poll();
        scheduleNextPoll();
      }, interval);
    };

    // Start polling
    scheduleNextPoll();
    const intervalDesc = this.isTabVisible
      ? `${IPNS_RESOLUTION_CONFIG.pollingIntervalMinMs/1000}-${IPNS_RESOLUTION_CONFIG.pollingIntervalMaxMs/1000}s`
      : `${IPNS_RESOLUTION_CONFIG.inactivePollingIntervalMinMs/1000}-${IPNS_RESOLUTION_CONFIG.inactivePollingIntervalMaxMs/1000}s (inactive)`;
    console.log(`📦 IPNS polling started (interval: ${intervalDesc})`);

    // Run first poll after a short delay
    setTimeout(poll, 5000);
  }

  /**
   * Stop IPNS polling (when tab becomes hidden)
   */
  private stopIpnsPolling(): void {
    if (this.ipnsPollingInterval) {
      clearTimeout(this.ipnsPollingInterval);
      this.ipnsPollingInterval = null;
      console.log(`📦 IPNS polling stopped`);
    }
  }

  /**
   * Handle tab visibility changes
   * Adjusts polling interval based on tab visibility (slower when inactive)
   */
  private handleVisibilityChange = (): void => {
    const wasVisible = this.isTabVisible;
    this.isTabVisible = document.visibilityState === "visible";

    if (this.isTabVisible !== wasVisible) {
      // Restart polling with new interval
      this.stopIpnsPolling();
      if (this.isTabVisible) {
        console.log(`📦 Tab visible, switching to active polling interval (45-75s)`);
      } else {
        console.log(`📦 Tab hidden, switching to slower polling interval (4-4.5 min)`);
      }
      this.startIpnsPolling();
    }
  };

  /**
   * Set up visibility change listener for polling control
   *
   * DEPRECATED IN PHASE 2 REFACTORING: This method is no longer called by startAutoSync()
   *
   * RATIONALE FOR DISABLING POLLING:
   * ================================
   * During Phase 2, we identified a race condition between:
   * - Fast HTTP publish to backend (~100-300ms)
   * - Slow DHT publish via browser Helia (2-5 seconds)
   *
   * RACE CONDITION SCENARIO:
   * T+0ms:   Tab A saves token → triggers publish
   * T+100ms: Tab A HTTP publish completes (seq=5)
   * T+150ms: Tab B polling wakes up → resolves IPNS → sees seq=5
   * T+200ms: Tab B detects local diff → calls scheduleSync()
   * T+250ms: Tab B publishes seq=5 via HTTP (DUPLICATE)
   *
   * SOLUTION (Changes 6 + 7):
   * - Remove scheduleSync() from handleHigherSequenceDiscovered() [Change 6]
   * - Disable continuous polling by not calling this method [Change 7]
   * - Only import remote tokens, never auto-sync
   * - User/code must explicitly call syncNow() when ready
   *
   * RE-ENABLEMENT CRITERIA (Phase 3):
   * - Single publish transport (HTTP-only OR DHT-only)
   * - Atomic sequence number increment
   * - Distributed lock across tabs
   */
  // @ts-expect-error - Method kept for documentation and potential re-enablement in Phase 3
  private setupVisibilityListener(): void {
    if (this.boundVisibilityHandler) {
      return; // Already set up
    }

    // Initialize visibility state
    this.isTabVisible = document.visibilityState === "visible";

    this.boundVisibilityHandler = this.handleVisibilityChange;
    document.addEventListener("visibilitychange", this.boundVisibilityHandler);
    console.log(`📦 Visibility listener registered (tab ${this.isTabVisible ? "visible" : "hidden"})`);

    // Always start polling (with appropriate interval based on visibility)
    this.startIpnsPolling();
  }

  /**
   * Remove visibility listener and stop polling
   */
  private cleanupVisibilityListener(): void {
    if (this.boundVisibilityHandler) {
      document.removeEventListener("visibilitychange", this.boundVisibilityHandler);
      this.boundVisibilityHandler = null;
    }
    this.stopIpnsPolling();
  }

  // ==========================================
  // Backend Connection Maintenance
  // ==========================================

  /**
   * Maintain a persistent connection to the backend IPFS node
   * This ensures bitswap can function properly for content transfer
   */
  private startBackendConnectionMaintenance(): void {
    const backendPeerId = getBackendPeerId();
    if (!backendPeerId || !this.helia) {
      return;
    }

    // Import peerIdFromString dynamically
    const maintainConnection = async () => {
      if (!this.helia) return;

      try {
        // Check if we're connected to the backend
        const connections = this.helia.libp2p.getConnections();
        const isConnected = connections.some(
          (conn) => conn.remotePeer.toString() === backendPeerId
        );

        if (!isConnected) {
          console.log(`📦 Backend peer disconnected, reconnecting...`);
          // The bootstrap will reconnect automatically, but we can also dial directly
          const bootstrapPeers = getBootstrapPeers();
          const backendAddr = bootstrapPeers.find((addr) =>
            addr.includes(backendPeerId)
          );
          if (backendAddr) {
            try {
              const { multiaddr } = await import("@multiformats/multiaddr");
              await this.helia.libp2p.dial(multiaddr(backendAddr));
              console.log(`📦 Reconnected to backend peer`);
            } catch (dialError) {
              console.warn(`📦 Failed to reconnect to backend:`, dialError);
            }
          }
        } else {
          // Connection exists, log status
          const backendConn = connections.find(
            (conn) => conn.remotePeer.toString() === backendPeerId
          );
          if (backendConn) {
            console.log(`📦 Backend connection alive: ${backendConn.remoteAddr.toString()}`);
          }
        }
      } catch (error) {
        console.warn(`📦 Connection maintenance error:`, error);
      }
    };

    // Run immediately
    setTimeout(maintainConnection, 2000);

    // Then periodically (every 60 seconds - reduced from 30s to lower CPU overhead)
    this.connectionMaintenanceInterval = setInterval(maintainConnection, 60000);
    console.log(`📦 Backend connection maintenance started`);
  }

  /**
   * Ensure backend is connected before storing content
   * Returns true if connected or successfully reconnected
   */
  private async ensureBackendConnected(): Promise<boolean> {
    const backendPeerId = getBackendPeerId();
    if (!backendPeerId || !this.helia) {
      return false;
    }

    const connections = this.helia.libp2p.getConnections();
    const isConnected = connections.some(
      (conn) => conn.remotePeer.toString() === backendPeerId
    );

    if (isConnected) {
      return true;
    }

    // Try to reconnect
    console.log(`📦 Backend not connected, dialing...`);
    const bootstrapPeers = getBootstrapPeers();
    const backendAddr = bootstrapPeers.find((addr) =>
      addr.includes(backendPeerId)
    );

    if (backendAddr) {
      try {
        const { multiaddr } = await import("@multiformats/multiaddr");
        await this.helia.libp2p.dial(multiaddr(backendAddr));
        console.log(`📦 Connected to backend for content transfer`);
        return true;
      } catch (error) {
        console.warn(`📦 Failed to connect to backend:`, error);
        return false;
      }
    }

    return false;
  }

  // ==========================================
  // Version Counter Management
  // ==========================================

  /**
   * Get current version counter for this wallet
   */
  /**
   * Increment and return new version counter
   */
  private incrementVersionCounter(): number {
    if (!this.cachedIpnsName) return 1;
    const key = `${STORAGE_KEY_PREFIXES.IPFS_VERSION}${this.cachedIpnsName}`;
    const current = this.getVersionCounter();
    const next = current + 1;
    localStorage.setItem(key, String(next));
    return next;
  }

  // ==========================================
  // Pending IPNS Publish Tracking
  // ==========================================

  /**
   * Get pending IPNS publish CID (if previous publish failed)
   */
  private getPendingIpnsPublish(): string | null {
    if (!this.cachedIpnsName) return null;
    const key = `${STORAGE_KEY_PREFIXES.IPFS_PENDING_IPNS}${this.cachedIpnsName}`;
    return localStorage.getItem(key);
  }

  /**
   * Set pending IPNS publish CID for retry
   */
  private setPendingIpnsPublish(cid: string): void {
    if (!this.cachedIpnsName) return;
    const key = `${STORAGE_KEY_PREFIXES.IPFS_PENDING_IPNS}${this.cachedIpnsName}`;
    localStorage.setItem(key, cid);
    console.log(`📦 IPNS publish marked as pending for CID: ${cid.slice(0, 16)}...`);
  }

  /**
   * Clear pending IPNS publish after successful publish
   */
  private clearPendingIpnsPublish(): void {
    if (!this.cachedIpnsName) return;
    const key = `${STORAGE_KEY_PREFIXES.IPFS_PENDING_IPNS}${this.cachedIpnsName}`;
    localStorage.removeItem(key);
  }

  /**
   * Retry any pending IPNS publish from previous failed sync
   */
  private async retryPendingIpnsPublish(): Promise<boolean> {
    const pendingCid = this.getPendingIpnsPublish();
    if (!pendingCid) return true; // No pending publish

    console.log(`📦 Retrying pending IPNS publish for CID: ${pendingCid.slice(0, 16)}...`);

    try {
      const { CID } = await import("multiformats/cid");
      const cid = CID.parse(pendingCid);
      const result = await this.publishToIpns(cid);

      if (result) {
        this.clearPendingIpnsPublish();
        this.setLastCid(pendingCid);
        console.log(`📦 Pending IPNS publish succeeded`);
        return true;
      }
      return false;
    } catch (error) {
      console.warn(`📦 Pending IPNS publish retry failed:`, error);
      return false;
    }
  }

  // ==========================================
  // IPNS Sync Helpers
  // ==========================================

  /**
   * Fetch remote content from IPFS by CID
   * Returns the TXF storage data or null if fetch fails
   */
  private async fetchRemoteContent(cidString: string): Promise<TxfStorageData | null> {
    const startTime = performance.now();
    const metrics = getIpfsMetrics();

    // Fast path: Use HTTP resolver (parallel multi-node racing)
    try {
      console.log(`📦 Fetching content via HTTP: ${cidString.slice(0, 16)}...`);
      const httpResolver = getIpfsHttpResolver();
      const content = await httpResolver.fetchContentByCid(cidString);

      if (content && typeof content === "object" && "_meta" in content) {
        const latencyMs = performance.now() - startTime;
        console.log(`📦 Content fetched via HTTP in ${latencyMs.toFixed(0)}ms`);

        // Record metrics
        metrics.recordOperation({
          operation: "fetch",
          source: "http-gateway",
          latencyMs,
          success: true,
          timestamp: Date.now(),
        });

        return content as TxfStorageData;
      }
    } catch (error) {
      console.debug(`📦 HTTP content fetch failed, trying Helia fallback:`, error);
    }

    // Fallback: Use Helia/Bitswap (slow but reliable)
    if (!this.helia) {
      metrics.recordOperation({
        operation: "fetch",
        source: "none",
        latencyMs: performance.now() - startTime,
        success: false,
        timestamp: Date.now(),
        error: "Helia not initialized",
      });
      return null;
    }

    const FETCH_TIMEOUT = 15000; // 15 seconds

    try {
      console.log(`📦 Falling back to Helia for content: ${cidString.slice(0, 16)}...`);
      const j = json(this.helia);
      const { CID } = await import("multiformats/cid");
      const cid = CID.parse(cidString);

      const data = await Promise.race([
        j.get(cid),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Fetch timeout")), FETCH_TIMEOUT)
        ),
      ]);

      // Validate it's TXF format
      if (data && typeof data === "object" && "_meta" in (data as object)) {
        const latencyMs = performance.now() - startTime;
        console.log(`📦 Content fetched via Helia in ${latencyMs.toFixed(0)}ms`);

        // Record metrics (DHT fallback)
        metrics.recordOperation({
          operation: "fetch",
          source: "dht",
          latencyMs,
          success: true,
          timestamp: Date.now(),
        });

        return data as TxfStorageData;
      }

      console.warn(`📦 Remote content is not valid TXF format`);
      return null;
    } catch (error) {
      const latencyMs = performance.now() - startTime;
      console.warn(`📦 Failed to fetch CID ${cidString.slice(0, 16)}...:`, error);

      // Record failure metrics
      metrics.recordOperation({
        operation: "fetch",
        source: "dht",
        latencyMs,
        success: false,
        timestamp: Date.now(),
        error: error instanceof Error ? error.message : "Unknown error",
      });

      return null;
    }
  }

  // ==========================================
  // Sanity Check Methods (Token Loss Prevention)
  // ==========================================

  /**
   * Sanity check tombstones before applying deletions
   * Verifies each tombstoned token is actually spent on Unicity
   * Returns tokens that should NOT be deleted (false tombstones)
   *
   * @deprecated Use InventorySyncService instead. This method will be removed in a future release.
   * Migration: Call inventorySync() which handles all merge/validation logic (Step 7 + 7.5).
   */
  private async sanityCheckTombstones(
    tombstonesToApply: TombstoneEntry[],
    address: string
  ): Promise<{
    validTombstones: TombstoneEntry[];
    invalidTombstones: TombstoneEntry[];
    tokensToRestore: Array<{ tokenId: string; txf: TxfToken }>;
  }> {
    console.warn('⚠️ [DEPRECATED] sanityCheckTombstones() is deprecated. Use InventorySyncService.inventorySync() instead.');
    const validTombstones: TombstoneEntry[] = [];
    const invalidTombstones: TombstoneEntry[] = [];
    const tokensToRestore: Array<{ tokenId: string; txf: TxfToken }> = [];

    if (tombstonesToApply.length === 0) {
      return { validTombstones, invalidTombstones, tokensToRestore };
    }

    // Get identity for verification
    const identity = await this.identityManager.getCurrentIdentity();
    if (!identity) {
      console.warn("⚠️ No identity available, skipping tombstone verification (accepting all tombstones)");
      return { validTombstones: tombstonesToApply, invalidTombstones: [], tokensToRestore: [] };
    }

    // Build Map of tokenId -> TxfToken from archived versions
    const tokensToCheck = new Map<string, TxfToken>();
    const archivedTokens = getArchivedTokensForAddress(address);
    for (const tombstone of tombstonesToApply) {
      const archivedVersion = archivedTokens.get(tombstone.tokenId);
      if (archivedVersion) {
        tokensToCheck.set(tombstone.tokenId, archivedVersion);
      }
    }

    if (tokensToCheck.size === 0) {
      console.warn("⚠️ No archived tokens available for verification, accepting all tombstones");
      return { validTombstones: tombstonesToApply, invalidTombstones: [], tokensToRestore: [] };
    }

    // Check which tokens are NOT spent (should not be deleted)
    // CRITICAL: Use treatErrorsAsUnspent=false for tombstone recovery!
    // When we can't verify, we should NOT restore tokens (keep tombstone intact)
    // This prevents incorrectly restoring spent tokens when aggregator is down
    const validationService = getTokenValidationService();
    const publicKey = identity.publicKey;
    const unspentTokenIds = await validationService.checkUnspentTokens(
      tokensToCheck,
      publicKey,
      { treatErrorsAsUnspent: false }  // Errors → assume spent → don't restore
    );
    const unspentSet = new Set(unspentTokenIds);

    // Categorize tombstones
    for (const tombstone of tombstonesToApply) {
      if (unspentSet.has(tombstone.tokenId)) {
        // Token is NOT spent - tombstone is invalid
        invalidTombstones.push(tombstone);

        // Find best version to restore
        const bestVersion = archivedTokens.get(tombstone.tokenId);
        if (bestVersion) {
          tokensToRestore.push({ tokenId: tombstone.tokenId, txf: bestVersion });
        }

        console.log(`⚠️ Invalid tombstone for ${tombstone.tokenId.slice(0, 8)}... - token is NOT spent on Unicity`);
      } else {
        // Token is spent - tombstone is valid
        validTombstones.push(tombstone);
      }
    }

    if (tombstonesToApply.length > 0) {
      console.log(`📦 Tombstone sanity check: ${validTombstones.length} valid, ${invalidTombstones.length} invalid`);
    }

    return { validTombstones, invalidTombstones, tokensToRestore };
  }

  /**
   * Check for tokens missing from remote collection (not tombstoned, just absent)
   * This handles case where remote "jumped over" a version
   * Returns tokens that should be preserved (unspent on Unicity)
   *
   * @deprecated Use InventorySyncService instead. This method will be removed in a future release.
   * Migration: Call inventorySync() which handles all merge/validation logic (Step 7 recovery).
   */
  private async sanityCheckMissingTokens(
    localTokens: Token[],
    remoteTokenIds: Set<string>,
    remoteTombstoneIds: Set<string>
  ): Promise<Array<{ tokenId: string; txf: TxfToken }>> {
    console.warn('⚠️ [DEPRECATED] sanityCheckMissingTokens() is deprecated. Use InventorySyncService.inventorySync() instead.');
    const tokensToPreserve: Array<{ tokenId: string; txf: TxfToken }> = [];

    // Find tokens that are in local but missing from remote (and not tombstoned)
    const missingTokens: Token[] = [];
    for (const token of localTokens) {
      const txf = tokenToTxf(token);
      if (!txf) continue;

      const tokenId = txf.genesis.data.tokenId;
      if (!remoteTokenIds.has(tokenId) && !remoteTombstoneIds.has(tokenId)) {
        missingTokens.push(token);
      }
    }

    if (missingTokens.length === 0) return [];

    console.log(`📦 Found ${missingTokens.length} token(s) missing from remote (no tombstone)`);

    // Get identity for verification
    const identity = await this.identityManager.getCurrentIdentity();
    if (!identity) {
      console.warn("⚠️ No identity available, preserving all missing tokens (safe fallback)");
      // Safe fallback: preserve all missing tokens
      for (const token of missingTokens) {
        const txf = tokenToTxf(token);
        if (txf) {
          tokensToPreserve.push({ tokenId: txf.genesis.data.tokenId, txf });
        }
      }
      return tokensToPreserve;
    }

    // Build Map of tokenId -> TxfToken for verification
    const tokensToCheck = new Map<string, TxfToken>();
    for (const token of missingTokens) {
      const txf = tokenToTxf(token);
      if (!txf) continue;

      const tokenId = txf.genesis.data.tokenId;
      tokensToCheck.set(tokenId, txf);
    }

    if (tokensToCheck.size === 0) return tokensToPreserve;

    // Check which are unspent (should be preserved)
    const validationService = getTokenValidationService();
    const publicKey = identity.publicKey;
    const unspentTokenIds = await validationService.checkUnspentTokens(tokensToCheck, publicKey);
    const unspentSet = new Set(unspentTokenIds);

    for (const [tokenId, txf] of tokensToCheck) {
      if (unspentSet.has(tokenId)) {
        // Token is NOT spent - should be preserved
        tokensToPreserve.push({ tokenId, txf });
        console.log(`📦 Preserving missing token ${tokenId.slice(0, 8)}... - NOT spent on Unicity`);
      } else {
        console.log(`📦 Token ${tokenId.slice(0, 8)}... legitimately removed (spent on Unicity)`);
      }
    }

    return tokensToPreserve;
  }

  /**
   * Check if any archived tokens should be restored to active status
   * This is a safety net for IPNS eventual consistency issues where
   * tokens may have been incorrectly removed due to stale IPNS data.
   *
   * Returns the number of tokens restored.
   */
  private async checkArchivedTokensForRecovery(
    walletRepo: WalletRepository
  ): Promise<number> {
    const archivedTokens = walletRepo.getArchivedTokens();
    if (archivedTokens.size === 0) {
      return 0;
    }

    // Get current active token IDs
    const activeTokens = walletRepo.getTokens();
    const activeTokenIds = new Set<string>();
    for (const token of activeTokens) {
      const txf = tokenToTxf(token);
      if (txf) {
        activeTokenIds.add(txf.genesis.data.tokenId);
      }
    }

    // Get tombstone keys (tokenId:stateHash)
    const tombstones = walletRepo.getTombstones();
    const tombstoneKeys = new Set(
      tombstones.map((t: TombstoneEntry) => `${t.tokenId}:${t.stateHash}`)
    );
    const tombstoneTokenIds = new Set(tombstones.map((t: TombstoneEntry) => t.tokenId));

    // Find candidates: ALL archived tokens not in active set
    // IMPORTANT: Include tombstoned tokens - tombstones may be invalid and need verification
    const candidatesForRecovery = new Map<string, TxfToken>();
    const tombstonedCandidates = new Map<string, TxfToken>(); // Track which are tombstoned

    for (const [tokenId, txfToken] of archivedTokens) {
      // Skip if already active
      if (activeTokenIds.has(tokenId)) continue;

      // Get current state hash from archived token
      const stateHash = getCurrentStateHash(txfToken);

      // Check if tombstoned with this exact state
      const isTombstoned = stateHash && tombstoneKeys.has(`${tokenId}:${stateHash}`);

      // Add ALL candidates (tombstoned or not) - we verify against Unicity
      candidatesForRecovery.set(tokenId, txfToken);
      if (isTombstoned) {
        tombstonedCandidates.set(tokenId, txfToken);
      }
    }

    if (candidatesForRecovery.size === 0) {
      return 0;
    }

    // Log what we're checking
    const tombstonedCount = tombstonedCandidates.size;
    const nonTombstonedCount = candidatesForRecovery.size - tombstonedCount;
    console.log(`📦 Checking ${candidatesForRecovery.size} archived token(s) for potential recovery...`);
    console.log(`📦   - ${nonTombstonedCount} non-tombstoned, ${tombstonedCount} tombstoned (verifying against Unicity)`);

    // Get identity for verification
    const identity = await this.identityManager.getCurrentIdentity();
    if (!identity) {
      console.warn("⚠️ No identity available, skipping archive recovery check");
      return 0;
    }

    // Check which are unspent (should be restored)
    // CRITICAL: Use treatErrorsAsUnspent=false for safety
    // If we can't verify, don't restore (prevents incorrectly restoring spent tokens)
    const validationService = getTokenValidationService();
    const publicKey = identity.publicKey;
    const unspentTokenIds = await validationService.checkUnspentTokens(
      candidatesForRecovery,
      publicKey,
      { treatErrorsAsUnspent: false }  // Errors → assume spent → don't restore
    );
    const unspentSet = new Set(unspentTokenIds);

    // Restore unspent tokens
    let restoredCount = 0;
    for (const [tokenId, txfToken] of candidatesForRecovery) {
      const wasTombstoned = tombstonedCandidates.has(tokenId);

      if (unspentSet.has(tokenId)) {
        // Token is NOT spent - should be restored to active!
        const tombstoneNote = wasTombstoned ? ' (was tombstoned - INVALID tombstone!)' : '';
        console.log(`📦 Restoring archived token ${tokenId.slice(0, 8)}... - NOT spent on Unicity${tombstoneNote}`);

        // Remove any tombstones for this token since it's unspent
        if (tombstoneTokenIds.has(tokenId)) {
          walletRepo.removeTombstonesForToken(tokenId);
          console.log(`📦 Removed invalid tombstones for ${tokenId.slice(0, 8)}...`);
        }

        const restored = walletRepo.restoreTokenFromArchive(tokenId, txfToken);
        if (restored) {
          restoredCount++;
        }
      } else {
        // Token is spent - valid to stay archived/tombstoned
        const tombstoneNote = wasTombstoned ? ' (tombstone valid)' : '';
        console.log(`📦 Archived token ${tokenId.slice(0, 8)}... is spent on Unicity - keeping archived${tombstoneNote}`);
      }
    }

    if (restoredCount > 0) {
      console.log(`📦 Archive recovery: restored ${restoredCount} token(s)`);
      // Invalidate UNSPENT cache since inventory changed
      getTokenValidationService().clearUnspentCacheEntries();
    }

    return restoredCount;
  }

  /**
   * Verify integrity invariants after sync operations
   * All spent tokens should have both tombstone and archive entry
   */
  private verifyIntegrityInvariants(address: string): void {
    const tombstones = getTombstonesForAddress(address);
    const archivedTokens = getArchivedTokensForAddress(address);
    const activeTokens = getTokensForAddress(address);

    let issues = 0;

    // Check 1: Every tombstoned token should have archive entry
    for (const tombstone of tombstones) {
      if (!archivedTokens.has(tombstone.tokenId)) {
        console.warn(`⚠️ Integrity: Tombstone ${tombstone.tokenId.slice(0, 8)}... has no archive entry`);
        issues++;
      }
    }

    // Check 2: Active tokens should not be tombstoned
    const tombstoneKeySet = new Set(
      tombstones.map(t => `${t.tokenId}:${t.stateHash}`)
    );

    for (const token of activeTokens) {
      const txf = tokenToTxf(token);
      if (!txf) continue;

      const tokenId = txf.genesis.data.tokenId;
      const stateHash = getCurrentStateHash(txf);
      if (!stateHash) {
        console.warn(`⚠️ Integrity: Token ${tokenId.slice(0, 8)}... has undefined stateHash`);
        issues++;
        continue;
      }
      const key = `${tokenId}:${stateHash}`;

      if (tombstoneKeySet.has(key)) {
        console.warn(`⚠️ Integrity: Active token ${tokenId.slice(0, 8)}... matches a tombstone`);
        issues++;
      }
    }

    if (issues > 0) {
      console.warn(`⚠️ Integrity check found ${issues} issue(s)`);
    } else {
      console.log(`✅ Integrity check passed`);
    }
  }

  // ==========================================
  // Sync Decision Helpers
  // ==========================================

  /**
   * Compare two TXF tokens and determine which is "better"
   * Returns: "local" if local wins, "remote" if remote wins, "equal" if identical
   *
   * CRITICAL: Committed transactions ALWAYS beat pending transactions!
   * This prevents a device with 3 pending (unsubmittable) transactions from
   * overwriting a device with 1 committed transaction.
   *
   * Rules:
   * 1) Committed beats pending (committed transactions always win over pending-only)
   * 2) Longer COMMITTED chain wins (not total chain length!)
   * 3) More proofs wins (including genesis proof)
   * 4) Identical state hashes = equal
   * 5) Deterministic tiebreaker for forks
   *
   * @deprecated Use InventorySyncService instead. This method will be removed in a future release.
   * Migration: InventorySyncService.shouldPreferRemote() implements the same logic.
   */
  private compareTokenVersions(localTxf: TxfToken, remoteTxf: TxfToken): "local" | "remote" | "equal" {
    console.warn('⚠️ [DEPRECATED] compareTokenVersions() is deprecated. Use InventorySyncService.shouldPreferRemote() instead.');
    // Helper to count COMMITTED transactions (those with inclusion proof)
    const countCommitted = (txf: TxfToken): number => {
      return txf.transactions.filter(tx => tx.inclusionProof !== null).length;
    };

    const localCommitted = countCommitted(localTxf);
    const remoteCommitted = countCommitted(remoteTxf);

    // 1. COMMITTED transactions ALWAYS beat pending
    // Token with committed transactions beats token with only pending transactions
    const localHasPending = localTxf.transactions.some(tx => tx.inclusionProof === null);
    const remoteHasPending = remoteTxf.transactions.some(tx => tx.inclusionProof === null);

    if (localCommitted > 0 && remoteCommitted === 0 && remoteHasPending) {
      // Local has committed, remote has only pending - local wins
      console.log(`📦 compareTokenVersions: Local wins (committed=${localCommitted} beats pending-only remote)`);
      return "local";
    }
    if (remoteCommitted > 0 && localCommitted === 0 && localHasPending) {
      // Remote has committed, local has only pending - remote wins
      console.log(`📦 compareTokenVersions: Remote wins (committed=${remoteCommitted} beats pending-only local)`);
      return "remote";
    }

    // 2. Compare COMMITTED chain lengths (not total length!)
    if (localCommitted > remoteCommitted) {
      console.log(`📦 compareTokenVersions: Local wins (${localCommitted} committed > ${remoteCommitted} committed)`);
      return "local";
    }
    if (remoteCommitted > localCommitted) {
      console.log(`📦 compareTokenVersions: Remote wins (${remoteCommitted} committed > ${localCommitted} committed)`);
      return "remote";
    }

    // 3. Same committed count - check total proofs (including genesis)
    const countProofs = (txf: TxfToken): number => {
      let count = txf.genesis?.inclusionProof ? 1 : 0;
      count += txf.transactions.filter(tx => tx.inclusionProof !== null).length;
      return count;
    };

    const localProofs = countProofs(localTxf);
    const remoteProofs = countProofs(remoteTxf);

    if (localProofs > remoteProofs) return "local";
    if (remoteProofs > localProofs) return "remote";

    // 4. Check if last transaction states differ (fork detection)
    const localStateHash = getCurrentStateHash(localTxf);
    const remoteStateHash = getCurrentStateHash(remoteTxf);

    if (localStateHash === remoteStateHash) {
      return "equal"; // Identical tokens
    }

    // 5. Deterministic tiebreaker for forks (use genesis hash)
    const localGenesisHash = localTxf._integrity?.genesisDataJSONHash || "";
    const remoteGenesisHash = remoteTxf._integrity?.genesisDataJSONHash || "";

    if (localGenesisHash > remoteGenesisHash) return "local";
    if (remoteGenesisHash > localGenesisHash) return "remote";

    return "local"; // Ultimate fallback: prefer local
  }

  /**
   * Check if local differs from remote in any way that requires sync
   * Returns true if we need to sync local changes to remote
   *
   * @deprecated Use InventorySyncService instead. This method will be removed in a future release.
   * Migration: InventorySyncService.inventorySync() handles version comparison internally.
   */
  private async localDiffersFromRemote(remoteData: TxfStorageData): Promise<boolean> {
    console.warn('⚠️ [DEPRECATED] localDiffersFromRemote() is deprecated. Use InventorySyncService.inventorySync() instead.');
    const identity = await this.identityManager.getCurrentIdentity();
    if (!identity) return false;

    const localTokens = getTokensForAddress(identity.address);

    // Check if local nametag differs from remote
    const localNametag = getNametagForAddress(identity.address);
    const remoteNametag = remoteData._nametag;

    if (localNametag && !remoteNametag) {
      console.log(`📦 Local has nametag "${localNametag.name}" not in remote`);
      return true;
    }
    if (localNametag && remoteNametag && localNametag.name !== remoteNametag.name) {
      console.log(`📦 Local nametag "${localNametag.name}" differs from remote "${remoteNametag.name}"`);
      return true;
    }

    // Extract remote tokens as TxfToken map
    const remoteTokenMap = new Map<string, TxfToken>();
    for (const key of Object.keys(remoteData)) {
      if (isTokenKey(key)) {
        const tokenId = tokenIdFromKey(key);
        const remoteTxf = remoteData[key] as TxfToken;
        if (remoteTxf?.genesis?.data?.tokenId) {
          remoteTokenMap.set(tokenId, remoteTxf);
        }
      }
    }

    // Check each local token
    for (const token of localTokens) {
      const localTxf = tokenToTxf(token);
      if (!localTxf) continue;

      const tokenId = localTxf.genesis.data.tokenId;
      const remoteTxf = remoteTokenMap.get(tokenId);

      if (!remoteTxf) {
        // Local has token that remote doesn't
        console.log(`📦 Local has token ${tokenId.slice(0, 8)}... not in remote`);
        return true;
      }

      // Compare versions - if local is better, we need to sync
      const comparison = this.compareTokenVersions(localTxf, remoteTxf);
      if (comparison === "local") {
        const localCommitted = localTxf.transactions.filter(tx => tx.inclusionProof !== null).length;
        const remoteCommitted = remoteTxf.transactions.filter(tx => tx.inclusionProof !== null).length;
        console.log(`📦 Local token ${tokenId.slice(0, 8)}... is better than remote (local: ${localCommitted} committed, remote: ${remoteCommitted} committed)`);
        return true;
      }
    }

    return false;
  }

  // ==========================================
  // Data Import Methods
  // ==========================================

  /**
   * Import remote data into local storage
   * - Imports tokens that don't exist locally (unless tombstoned)
   * - Removes local tokens that are tombstoned in remote (with Unicity verification)
   * - Handles missing tokens (tokens in local but not in remote)
   * - Merges tombstones from remote
   * - Imports nametag if local doesn't have one
   *
   * @deprecated Use InventorySyncService instead. This method will be removed in a future release.
   * Migration: Call inventorySync() which handles all merge/validation logic.
   */
  private async importRemoteData(remoteTxf: TxfStorageData): Promise<number> {
    console.warn('⚠️ [DEPRECATED] importRemoteData() is deprecated. Use InventorySyncService.inventorySync() instead.');
    const walletRepo = WalletRepository.getInstance();

    // Debug: Log raw tombstones from remote data
    const rawTombstones = (remoteTxf as Record<string, unknown>)._tombstones;
    console.log(`📦 Raw remote _tombstones field:`, rawTombstones);

    const { tokens: remoteTokens, nametag, tombstones: remoteTombstones, archivedTokens: remoteArchived, forkedTokens: remoteForked, outboxEntries: remoteOutbox, mintOutboxEntries: remoteMintOutbox, invalidatedNametags: remoteInvalidatedNametags } = parseTxfStorageData(remoteTxf);

    // Import outbox entries from remote (CRITICAL for transfer recovery)
    if (remoteOutbox && remoteOutbox.length > 0) {
      const outboxRepo = OutboxRepository.getInstance();
      outboxRepo.importFromRemote(remoteOutbox);
      console.log(`📦 Imported ${remoteOutbox.length} outbox entries from remote`);
    }

    // Import mint outbox entries from remote (CRITICAL for mint recovery)
    if (remoteMintOutbox && remoteMintOutbox.length > 0) {
      const outboxRepo = OutboxRepository.getInstance();
      outboxRepo.importMintEntriesFromRemote(remoteMintOutbox);
      console.log(`📦 Imported ${remoteMintOutbox.length} mint outbox entries from remote`);
    }

    // Merge invalidated nametags from remote (preserves history across devices)
    if (remoteInvalidatedNametags && remoteInvalidatedNametags.length > 0) {
      const mergedCount = walletRepo.mergeInvalidatedNametags(remoteInvalidatedNametags);
      if (mergedCount > 0) {
        console.log(`📦 Merged ${mergedCount} invalidated nametag(s) from remote`);
      }
    }

    // Debug: Log parsed tombstones (now TombstoneEntry[])
    console.log(`📦 Parsed remote tombstones (${remoteTombstones.length}):`,
      remoteTombstones.map(t => `${t.tokenId.slice(0, 8)}:${t.stateHash.slice(0, 8)}`));

    // Get local tokens and tombstones
    const localTokens = walletRepo.getWallet()?.tokens || [];
    const localTokenIds = new Set(localTokens.map(t => t.id));
    const localTombstones = walletRepo.getTombstones();

    // Debug: Log local token IDs for comparison
    console.log(`📦 Local token IDs (${localTokenIds.size}):`, [...localTokenIds].map((id: string) => id.slice(0, 8) + '...'));

    let importedCount = 0;

    // ==========================================
    // SANITY CHECKS - Prevent token loss from race conditions
    // ==========================================

    // 1. Build remote token ID set for missing token detection
    const remoteTokenIds = new Set<string>();
    for (const token of remoteTokens) {
      const txf = tokenToTxf(token);
      if (txf) remoteTokenIds.add(txf.genesis.data.tokenId);
    }

    // 2. Build remote tombstone ID set
    const remoteTombstoneIds = new Set(remoteTombstones.map(t => t.tokenId));

    // 3. Check for missing tokens (local tokens absent from remote without tombstone)
    const tokensToPreserveFromMissing = await this.sanityCheckMissingTokens(
      localTokens,
      remoteTokenIds,
      remoteTombstoneIds
    );

    // 4. Get new tombstones that would be applied
    const localTombstoneKeys = new Set(
      localTombstones.map((t: TombstoneEntry) => `${t.tokenId}:${t.stateHash}`)
    );
    const newTombstones = remoteTombstones.filter(
      (t: TombstoneEntry) => !localTombstoneKeys.has(`${t.tokenId}:${t.stateHash}`)
    );

    // 5. Sanity check new tombstones with Unicity
    let tokensToRestore: Array<{ tokenId: string; txf: TxfToken }> = [];
    let validTombstones = newTombstones;

    if (newTombstones.length > 0) {
      console.log(`📦 Sanity checking ${newTombstones.length} new tombstone(s) with Unicity...`);
      const walletAddress = walletRepo.getWallet()?.address ?? '';
      const result = await this.sanityCheckTombstones(newTombstones, walletAddress);
      validTombstones = result.validTombstones;
      tokensToRestore = result.tokensToRestore;

      if (result.invalidTombstones.length > 0) {
        console.log(`⚠️ Rejected ${result.invalidTombstones.length} invalid tombstone(s)`);
      }
    }

    // 6. Combine tokens to preserve/restore
    const allTokensToRestore = [...tokensToRestore, ...tokensToPreserveFromMissing];

    // 7. Restore any tokens that should not be deleted
    for (const { tokenId, txf } of allTokensToRestore) {
      walletRepo.restoreTokenFromArchive(tokenId, txf);
    }

    // 8. Apply only valid tombstones (not the rejected invalid ones)
    const tombstonesToApply = [...localTombstones];
    for (const t of validTombstones) {
      if (!localTombstoneKeys.has(`${t.tokenId}:${t.stateHash}`)) {
        tombstonesToApply.push(t);
      }
    }

    // Merge valid tombstones - this removes local tokens whose state matches tombstones
    if (tombstonesToApply.length > 0) {
      console.log(`📦 Processing ${tombstonesToApply.length} valid tombstone(s)`);
      const removedCount = walletRepo.mergeTombstones(tombstonesToApply);
      if (removedCount > 0) {
        console.log(`📦 Removed ${removedCount} tombstoned token(s) from local`);
        // Invalidate UNSPENT cache since inventory changed
        getTokenValidationService().clearUnspentCacheEntries();
      }
    }

    // ==========================================
    // IMPORT/UPDATE TOKENS FROM REMOTE
    // ==========================================

    // Build combined tombstone lookup (tokenId:stateHash -> true)
    const allTombstoneKeys = new Set<string>();
    for (const t of walletRepo.getTombstones()) {
      allTombstoneKeys.add(`${t.tokenId}:${t.stateHash}`);
    }

    // Build local token map for comparison (re-get as they may have changed after restore)
    const currentLocalTokens = walletRepo.getWallet()?.tokens || [];
    const localTokenMap = new Map<string, Token>();
    for (const token of currentLocalTokens) {
      const txf = tokenToTxf(token);
      if (txf) {
        localTokenMap.set(txf.genesis.data.tokenId, token);
      }
    }

    for (const remoteToken of remoteTokens) {
      // Extract tokenId and stateHash from remote token
      let remoteTxf = tokenToTxf(remoteToken);
      if (!remoteTxf) continue;

      const tokenId = remoteTxf.genesis.data.tokenId;
      let stateHash = getCurrentStateHash(remoteTxf);

      // Check if this is a genesis-only token (no transactions yet)
      const isGenesisOnly = !remoteTxf.transactions || remoteTxf.transactions.length === 0;

      // Try to repair if state hash is undefined (token may be missing newStateHash from older version)
      if (!stateHash && hasMissingNewStateHash(remoteTxf)) {
        console.log(`📦 Token ${tokenId.slice(0, 8)}... has missing newStateHash, attempting repair...`);
        try {
          const repairedTxf = await repairMissingStateHash(remoteTxf);
          if (repairedTxf) {
            remoteTxf = repairedTxf;
            stateHash = getCurrentStateHash(repairedTxf);
            if (stateHash) {
              console.log(`🔧 Token ${tokenId.slice(0, 8)}... repaired successfully`);
              // Update the remoteToken with repaired data for import
              remoteToken.jsonData = JSON.stringify(repairedTxf);
            }
          }
        } catch (repairErr) {
          console.warn(`📦 Failed to repair token ${tokenId.slice(0, 8)}...:`, repairErr);
        }
      }

      // Skip if state hash is undefined UNLESS it's a genesis-only token
      // Genesis-only tokens (never transferred) don't have a stateHash from transactions
      // and can't match any tombstone (tombstones are created on transfer)
      if (!stateHash && !isGenesisOnly) {
        console.warn(`📦 Token ${tokenId.slice(0, 8)}... has undefined stateHash after repair attempt, skipping import`);
        continue;
      }

      // For genesis-only tokens, compute and store the stateHash
      if (isGenesisOnly) {
        console.log(`📦 Token ${tokenId.slice(0, 8)}... is genesis-only (no transfers yet)`);

        // Compute the stateHash using SDK and patch the token
        try {
          const patchedTxf = await computeAndPatchStateHash(remoteTxf);
          if (patchedTxf !== remoteTxf && patchedTxf._integrity?.currentStateHash) {
            remoteTxf = patchedTxf;
            stateHash = patchedTxf._integrity.currentStateHash;
            remoteToken.jsonData = JSON.stringify(patchedTxf);
          }
        } catch (err) {
          console.warn(`📦 Failed to compute stateHash for genesis token ${tokenId.slice(0, 8)}...:`, err);
        }
      }

      // Skip if this specific state is tombstoned
      // Genesis-only tokens (stateHash undefined) can't be tombstoned since tombstones
      // are created on transfer, and genesis-only tokens have never been transferred
      if (stateHash) {
        const tombstoneKey = `${tokenId}:${stateHash}`;
        if (allTombstoneKeys.has(tombstoneKey)) {
          console.log(`📦 Skipping tombstoned token ${tokenId.slice(0, 8)}... state ${stateHash.slice(0, 8)}... from remote`);
          continue;
        }
      }

      const localToken = localTokenMap.get(tokenId);

      if (!localToken) {
        // NEW token - import it (skip history since it was recorded on original device)
        walletRepo.addToken(remoteToken, true);
        console.log(`📦 Imported new token ${tokenId.slice(0, 8)}... from remote`);
        importedCount++;
      } else {
        // Token EXISTS in both - compare versions
        const localTxf = tokenToTxf(localToken);
        if (!localTxf) continue;

        const comparison = this.compareTokenVersions(localTxf, remoteTxf);

        if (comparison === "remote") {
          // Remote is BETTER - update local with remote version
          const localLen = localTxf.transactions.length;
          const remoteLen = remoteTxf.transactions.length;
          console.log(`📦 Updating token ${tokenId.slice(0, 8)}... from remote (remote: ${remoteLen} txns > local: ${localLen} txns)`);

          // Archive local version before replacing (in case of fork)
          const localStateHash = getCurrentStateHash(localTxf);
          if (localStateHash && localStateHash !== stateHash) {
            // Different state = fork, archive the losing local version
            walletRepo.storeForkedToken(tokenId, localStateHash, localTxf);
            console.log(`📦 Archived forked local version of ${tokenId.slice(0, 8)}... (state ${localStateHash.slice(0, 8)}...)`);
          }

          // Update with remote version
          walletRepo.updateToken(remoteToken);
          importedCount++;
        } else if (comparison === "local") {
          // Local is better - keep local, but archive remote if it's a fork
          const remoteStateHash = getCurrentStateHash(remoteTxf);
          const localStateHash = getCurrentStateHash(localTxf);
          if (remoteStateHash && localStateHash && remoteStateHash !== localStateHash) {
            // Different state = fork, archive the remote version
            walletRepo.storeForkedToken(tokenId, remoteStateHash, remoteTxf);
            console.log(`📦 Archived forked remote version of ${tokenId.slice(0, 8)}... (state ${remoteStateHash.slice(0, 8)}...)`);
          }
        }
        // If "equal", tokens are identical - nothing to do
      }
    }

    // ==========================================
    // IMPORT METADATA & ARCHIVES
    // ==========================================

    // Import nametag if local doesn't have one AND remote nametag is valid
    if (nametag && !walletRepo.getNametag()) {
      // Double-check validation (parseTxfStorageData already validates, but be defensive)
      if (isNametagCorrupted(nametag)) {
        console.warn("📦 Skipping corrupted nametag import from IPFS - will be cleared on next sync");
      } else {
        // Check if this nametag was invalidated (e.g., Nostr pubkey mismatch)
        // If so, don't re-import it - user needs to create a new nametag
        const invalidatedNametags = walletRepo.getInvalidatedNametags();
        const isInvalidated = invalidatedNametags.some((inv: { name: string }) => inv.name === nametag.name);
        if (isInvalidated) {
          console.warn(`📦 Skipping invalidated nametag "${nametag.name}" import from IPFS - user must create new nametag`);
        } else {
          walletRepo.setNametag(nametag);
          console.log(`📦 Imported nametag "${nametag.name}" from remote`);
        }
      }
    }

    // Merge archived and forked tokens from remote
    if (remoteArchived.size > 0) {
      const archivedMergedCount = walletRepo.mergeArchivedTokens(remoteArchived);
      if (archivedMergedCount > 0) {
        console.log(`📦 Merged ${archivedMergedCount} archived token(s) from remote`);
      }
    }
    if (remoteForked.size > 0) {
      const forkedMergedCount = walletRepo.mergeForkedTokens(remoteForked);
      if (forkedMergedCount > 0) {
        console.log(`📦 Merged ${forkedMergedCount} forked token(s) from remote`);
      }
    }

    // Prune old tombstones and archives to prevent unlimited growth
    walletRepo.pruneTombstones();
    walletRepo.pruneArchivedTokens();
    walletRepo.pruneForkedTokens();

    // ==========================================
    // INTEGRITY VERIFICATION
    // ==========================================
    const currentAddress = walletRepo.getWallet()?.address ?? '';
    this.verifyIntegrityInvariants(currentAddress);

    // ==========================================
    // POST-IMPORT SPENT TOKEN VALIDATION
    // ==========================================
    // CRITICAL: Validate all tokens against aggregator to detect spent tokens
    // that bypassed tombstone checks (e.g., tokens with different state hashes)
    const allTokens = walletRepo.getTokens();
    const identity = await this.identityManager.getCurrentIdentity();
    if (allTokens.length > 0 && identity?.publicKey) {
      console.log(`📦 Running post-import spent token validation (${allTokens.length} tokens)...`);
      const validationService = getTokenValidationService();
      const result = await validationService.checkSpentTokens(allTokens, identity.publicKey);

      if (result.spentTokens.length > 0) {
        console.log(`📦 Found ${result.spentTokens.length} spent token(s) during import validation:`);
        for (const spent of result.spentTokens) {
          console.log(`📦   - Removing spent token ${spent.tokenId.slice(0, 8)}...`);
          walletRepo.removeToken(spent.localId, undefined, true); // skipHistory
        }
        // Emit wallet update after removing spent tokens
        window.dispatchEvent(new Event("wallet-updated"));
      } else {
        console.log(`📦 Post-import validation: all ${allTokens.length} token(s) are valid`);
      }
    }

    // ==========================================
    // ARCHIVE RECOVERY CHECK
    // ==========================================
    // Safety net for IPNS eventual consistency: check if any archived tokens
    // should be restored (not active, not tombstoned, and still unspent on Unicity)
    const archivedRecoveryCount = await this.checkArchivedTokensForRecovery(walletRepo);
    if (archivedRecoveryCount > 0) {
      importedCount += archivedRecoveryCount;
      // Emit wallet update after restoring archived tokens
      window.dispatchEvent(new Event("wallet-updated"));
    }

    return importedCount;
  }

  // ==========================================
  // Storage Operations
  // ==========================================

  /**
   * Schedule a debounced sync using the queue with LOW priority (auto-coalesced)
   * The SyncQueue handles coalescing of multiple LOW priority requests
   */
  // @ts-expect-error - Method kept for backward compatibility and potential external callers
  private scheduleSync(): void {
    console.warn("⚠️ [DEPRECATED] IpfsStorageService.scheduleSync() is deprecated. Use InventorySyncService.inventorySync() instead.");
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
    }
    // Use a small delay to batch rapid-fire wallet-updated events
    this.syncTimer = setTimeout(() => {
      this.syncNow({
        priority: SyncPriority.LOW,
        callerContext: 'auto-sync',
        coalesce: true,
      }).catch(console.error);
    }, SYNC_DEBOUNCE_MS);
  }

  /**
   * Sync from IPNS on startup - resolves IPNS and merges with local state
   * Uses progressive multi-gateway resolution for conflict detection
   *
   * Flow:
   * 0. Retry any pending IPNS publishes from previous failed syncs
   * 1. Resolve IPNS progressively from all gateways (highest sequence wins)
   * 2. Compare with local CID - if different, fetch remote content
   * 3. Version comparison: remote > local → import; local > remote → sync to update IPNS
   * 4. Always verify remote is fetchable (handles interrupted syncs)
   * 5. If fetch fails, fall back to normal sync (republish local)
   * 6. Late-arriving higher sequences trigger automatic merge
   */
  async syncFromIpns(): Promise<StorageResult> {
    console.log(`📦 Starting IPNS-based sync...`);
    console.warn("⚠️ [DEPRECATED] IpfsStorageService.syncFromIpns() is deprecated. Use InventorySyncService.inventorySync() instead.");

    // Set initial syncing flag for UI feedback
    this.isInitialSyncing = true;
    this.isInsideSyncFromIpns = true;  // Mark that we're inside this method (to avoid deadlock)
    // Create a Promise that external callers can await to wait for initial sync to complete
    this.initialSyncCompletePromise = new Promise<void>((resolve) => {
      this.initialSyncCompleteResolver = resolve;
    });
    this.emitSyncStateChange();

    // CRITICAL FIX: Detect localStorage corruption before version comparison
    // If wallet is loaded but empty, and version counter is non-zero,
    // we're in a localStorage corruption scenario - reset version to force recovery
    const walletRepo = WalletRepository.getInstance();
    const localTokens = walletRepo.getTokens();
    const currentVersion = this.getVersionCounter();

    if (localTokens.length === 0 && currentVersion > 0) {
      console.warn(`⚠️ RECOVERY: localStorage corruption detected`);
      console.warn(`⚠️ RECOVERY: Wallet has 0 tokens but version counter is v${currentVersion}`);
      console.warn(`⚠️ RECOVERY: Resetting version to 0 to force IPFS import`);

      this.setVersionCounter(0);
      // Continue with normal sync flow - version comparison will now trigger import
    }

    try {
      const initialized = await this.ensureInitialized();
      if (!initialized) {
        console.warn(`📦 Not initialized, skipping IPNS sync`);
        return { success: false, timestamp: Date.now(), error: "Not initialized" };
      }

    // 0. Retry any pending IPNS publishes from previous failed syncs
    await this.retryPendingIpnsPublish();

    // 1. Resolve IPNS progressively from all gateways
    // Late arrivals with higher sequence will trigger handleHigherSequenceDiscovered
    const resolution = await this.resolveIpnsProgressively(
      (lateResult) => this.handleHigherSequenceDiscovered(lateResult)
    );

    const remoteCid = resolution.best?.cid || null;
    const localCid = this.getLastCid();

    // Update last known remote sequence
    if (resolution.best) {
      this.lastKnownRemoteSequence = resolution.best.sequence;
      console.log(
        `📦 IPNS resolved: seq=${resolution.best.sequence}, ` +
        `${resolution.respondedCount}/${resolution.totalGateways} gateways responded`
      );
    }

    console.log(`📦 IPNS sync: remote=${remoteCid?.slice(0, 16) || 'none'}..., local=${localCid?.slice(0, 16) || 'none'}...`);

    // Track if IPNS needs recovery (IPNS resolution returned nothing but we have local data)
    // In this case, we need to force IPNS republish even if CID is unchanged
    const ipnsNeedsRecovery = !remoteCid && !!localCid;
    if (ipnsNeedsRecovery) {
      console.log(`📦 IPNS recovery needed - IPNS empty but local CID exists`);
    }

    // 2. Determine which CID to fetch
    const cidToFetch = remoteCid || localCid;

    if (!cidToFetch) {
      // No IPNS record and no local CID - could be fresh wallet OR failed resolution
      // CRITICAL: Don't upload if IPNS resolution failed and we have no local data
      // This prevents overwriting existing remote tokens on wallet restore

      const ipnsResolutionFailed = resolution.respondedCount === 0;
      const localWallet = WalletRepository.getInstance();
      const localTokenCount = localWallet.getTokens().length;
      const localNametag = localWallet.getNametag();

      if (ipnsResolutionFailed && localTokenCount === 0 && !localNametag) {
        // IPNS resolution failed AND we have no local tokens AND no nametag
        // This is likely a wallet restore - DO NOT overwrite remote!
        console.warn(`📦 IPNS resolution failed (0/${resolution.totalGateways} responded) and no local tokens`);
        console.warn(`📦 Skipping upload to prevent overwriting existing remote tokens`);
        console.warn(`📦 Will retry IPNS resolution on next poll`);
        return {
          success: false,
          timestamp: Date.now(),
          error: "IPNS resolution failed - waiting for successful resolution before sync"
        };
      }

      console.log(`📦 No IPNS record or local CID - fresh wallet, triggering initial sync`);
      return this.syncNow();
    }

    // 3. Check if remote CID differs from local (another device may have updated IPNS)
    if (remoteCid && remoteCid !== localCid) {
      console.log(`📦 IPNS CID differs from local! Remote may have been updated from another device`);
    }

    // 4. Always try to fetch and verify remote content
    // This handles cases where previous sync was interrupted
    // Use cached content from gateway path if available (avoids re-fetch)
    // CRITICAL: Must verify CID integrity - HTTP gateways may cache stale content
    let remoteData: TxfStorageData | null = null;

    if (resolution.best?._cachedContent && resolution.best.cid === cidToFetch) {
      // Verify cached content matches the CID before using it
      // HTTP gateways may serve stale cached content for the IPNS name
      const cachedContent = resolution.best._cachedContent;
      try {
        const computedCid = await computeCidFromContent(cachedContent);
        if (computedCid === cidToFetch) {
          // CID matches - safe to use cached content
          remoteData = cachedContent;
          console.log(`📦 Using cached content from gateway path (CID verified)`);
        } else {
          // CID mismatch - gateway has stale cache
          console.warn(`⚠️ Gateway cached content CID mismatch: expected ${cidToFetch.slice(0, 16)}..., got ${computedCid.slice(0, 16)}...`);
          console.log(`📦 Fetching fresh content by CID (gateway cache was stale)`);
          remoteData = await this.fetchRemoteContent(cidToFetch);
        }
      } catch (error) {
        console.warn(`⚠️ Failed to verify cached content CID:`, error);
        remoteData = await this.fetchRemoteContent(cidToFetch);
      }
    } else {
      // Fetch content via IPFS
      remoteData = await this.fetchRemoteContent(cidToFetch);
    }

    if (!remoteData) {
      // Could not fetch remote content
      // CRITICAL: Do NOT overwrite remote with empty local state!
      // If local wallet is empty and remote has content, we must NOT publish empty state
      const localTokenCount = WalletRepository.getInstance().getTokens().length;

      if (localTokenCount === 0 && remoteCid) {
        // Local is empty but remote has content - DO NOT overwrite!
        // This prevents data loss when we can't fetch remote due to connectivity issues
        console.error(`🚨 BLOCKED: Cannot fetch remote content and local wallet is EMPTY!`);
        console.error(`🚨 Remote CID exists (${remoteCid.slice(0, 16)}...) - refusing to overwrite with empty state`);
        console.error(`🚨 Please retry sync when connectivity improves, or recover from backup`);
        return {
          success: false,
          timestamp: Date.now(),
          error: "Blocked: refusing to overwrite remote with empty local state"
        };
      }

      // Local has content - safe to republish
      // Force IPNS publish if IPNS was empty (recovery scenario)
      console.warn(`📦 Failed to fetch remote content (CID: ${cidToFetch.slice(0, 16)}...), will republish local (${localTokenCount} tokens)`);
      return this.syncNow({ forceIpnsPublish: ipnsNeedsRecovery });
    }

    // 5. Compare versions and decide action
    const localVersion = this.getVersionCounter();
    const remoteVersion = remoteData._meta.version;

    console.log(`📦 Version comparison: local=v${localVersion}, remote=v${remoteVersion}`);

    if (remoteVersion > localVersion) {
      // Remote is newer - import to local
      console.log(`📦 Remote is newer (v${remoteVersion} > v${localVersion}), importing...`);
      const importedCount = await this.importRemoteData(remoteData);

      // Update local version and CID to match remote
      this.setVersionCounter(remoteVersion);
      this.setLastCid(cidToFetch);

      console.log(`📦 Imported ${importedCount} token(s) from remote, now at v${remoteVersion}`);

      // Invalidate UNSPENT cache since inventory changed
      if (importedCount > 0) {
        getTokenValidationService().clearUnspentCacheEntries();
      }

      // If IPNS needs recovery, force publish even though we just imported
      if (ipnsNeedsRecovery) {
        console.log(`📦 Content imported but IPNS needs recovery - publishing to IPNS`);
        return this.syncNow({ forceIpnsPublish: true });
      }

      // CRITICAL: Check if local has unique tokens that weren't in remote
      // This handles the case where new tokens were minted locally but remote was ahead
      // Without this, local-only tokens would never be synced to IPNS and could be lost
      if (await this.localDiffersFromRemote(remoteData)) {
        console.log(`📦 Local has unique content after import - syncing merged state to IPNS`);
        return this.syncNow({ forceIpnsPublish: false });
      }

      // Run immediate sanity check after IPNS sync (don't wait for polling cycle)
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
      // Local is newer - BUT remote might have new tokens we don't have
      // (e.g., Browser 2 received token via Nostr while Browser 1 was offline)
      console.log(`📦 Local is newer (v${localVersion} > v${remoteVersion}), checking for new remote tokens first...`);

      // Import any new tokens from remote before pushing local state
      const importedCount = await this.importRemoteData(remoteData);
      if (importedCount > 0) {
        console.log(`📦 Imported ${importedCount} new token(s) from remote before updating IPNS`);
        // Invalidate UNSPENT cache since inventory changed
        getTokenValidationService().clearUnspentCacheEntries();
        window.dispatchEvent(new Event("wallet-updated"));
      }

      // Only sync if local differs from remote (has unique tokens or better versions)
      if (await this.localDiffersFromRemote(remoteData)) {
        console.log(`📦 Local differs from remote, syncing merged state...`);
        return this.syncNow({ forceIpnsPublish: ipnsNeedsRecovery });
      } else {
        console.log(`📦 Local now matches remote after import, no sync needed`);
        // Update local tracking to match remote
        this.setLastCid(cidToFetch);
        this.setVersionCounter(remoteVersion);

        // If IPNS needs recovery, force publish even though content is synced
        if (ipnsNeedsRecovery) {
          console.log(`📦 Content synced but IPNS needs recovery - publishing to IPNS`);
          return this.syncNow({ forceIpnsPublish: true });
        }

        // Run immediate sanity check after IPNS sync (don't wait for polling cycle)
        await this.runSpentTokenSanityCheck();
        await this.runTombstoneRecoveryCheck();

        return {
          success: true,
          cid: cidToFetch,
          ipnsName: this.cachedIpnsName || undefined,
          timestamp: Date.now(),
          version: remoteVersion,
        };
      }
    } else {
      // Same version - remote is in sync
      // Still update lastCid to match IPNS if resolved
      if (remoteCid && remoteCid !== localCid) {
        this.setLastCid(remoteCid);
        console.log(`📦 Updated local CID to match IPNS`);
      }

      console.log(`📦 Versions match (v${remoteVersion}), remote verified accessible`);

      // CRITICAL FIX: Detect missing tokens (localStorage corruption scenario)
      // If localStorage is cleared but version counter survives, tokens would be lost.
      // Check if local has tokens - if not but remote does, force recovery import.
      const localWallet = WalletRepository.getInstance();
      const localTokenCount = localWallet.getTokens().length;
      let remoteTokenCount = 0;
      for (const key of Object.keys(remoteData)) {
        if (isTokenKey(key)) {
          remoteTokenCount++;
        }
      }

      if (localTokenCount === 0 && remoteTokenCount > 0) {
        console.warn(`⚠️ RECOVERY: Versions match but localStorage is empty!`);
        console.warn(`⚠️ RECOVERY: Detected tokens - local: ${localTokenCount}, remote: ${remoteTokenCount}`);
        console.warn(`⚠️ RECOVERY: Recovering ${remoteTokenCount} token(s) from IPFS`);

        const importedCount = await this.importRemoteData(remoteData);
        if (importedCount > 0) {
          console.log(`✅ RECOVERY: Imported ${importedCount} token(s), wallet restored`);
          // CRITICAL: Invalidate UNSPENT cache since inventory changed
          getTokenValidationService().clearUnspentCacheEntries();
          window.dispatchEvent(new Event("wallet-updated"));
        }
      }

      // If IPNS needs recovery, force publish even though content is synced
      if (ipnsNeedsRecovery) {
        console.log(`📦 Content synced but IPNS needs recovery - publishing to IPNS`);
        return this.syncNow({ forceIpnsPublish: true });
      }

      // Run immediate sanity check after IPNS sync (don't wait for polling cycle)
      await this.runSpentTokenSanityCheck();
      await this.runTombstoneRecoveryCheck();

      return {
        success: true,
        cid: cidToFetch,
        ipnsName: this.cachedIpnsName || undefined,
        timestamp: Date.now(),
        version: remoteVersion,
      };
    }
    } finally {
      this.isInitialSyncing = false;
      this.isInsideSyncFromIpns = false;  // Clear the deadlock-prevention flag
      // Resolve the Promise so any waiting syncs can proceed
      if (this.initialSyncCompleteResolver) {
        this.initialSyncCompleteResolver();
        this.initialSyncCompleteResolver = null;
        this.initialSyncCompletePromise = null;
      }
      this.emitSyncStateChange();
    }
  }

  /**
   * Get or initialize the sync queue (lazy initialization)
   */
  private getSyncQueue(): SyncQueue {
    if (!this.syncQueue) {
      this.syncQueue = new SyncQueue((opts) => this.executeSyncInternal(opts));
    }
    return this.syncQueue;
  }

  /**
   * Perform sync to IPFS using the priority queue
   * Requests are queued and processed in priority order instead of being rejected
   *
   * @param options.forceIpnsPublish Force IPNS publish even if CID unchanged
   * @param options.priority Priority level (default: MEDIUM)
   * @param options.timeout Max time to wait in queue (default: 60s)
   * @param options.callerContext Identifier for debugging
   * @param options.coalesce For LOW priority: batch multiple requests (default: true)
   */
  async syncNow(options?: SyncOptions): Promise<StorageResult> {
    // If IPFS is disabled, return success immediately (no-op)
    if (import.meta.env.VITE_ENABLE_IPFS === 'false') {
      return {
        success: true,
        timestamp: Date.now(),
        // No CID when IPFS is disabled
      };
    }
    return this.getSyncQueue().enqueue(options ?? {});
  }

  /**
   * Internal sync implementation - called by SyncQueue
   * Uses SyncCoordinator for cross-tab coordination to prevent race conditions
   */
  private async executeSyncInternal(options?: { forceIpnsPublish?: boolean; isRetryAttempt?: boolean; skipExtendedVerification?: boolean }): Promise<StorageResult> {
    const { forceIpnsPublish = false, isRetryAttempt = false, skipExtendedVerification = false } = options || {};

    // CRITICAL: Wait for initial IPNS sync to complete before proceeding
    // This prevents race conditions where Nostr delivers tokens and triggers a sync
    // BEFORE the startup sync has fetched remote content, causing token loss
    // Skip the wait if we're inside syncFromIpns (to avoid deadlock on internal syncNow calls)
    if (this.initialSyncCompletePromise && !this.isInsideSyncFromIpns) {
      console.log(`📦 Waiting for initial IPNS sync to complete before proceeding...`);
      await this.initialSyncCompletePromise;
      console.log(`📦 Initial IPNS sync completed, proceeding with sync`);
    }

    // Use SyncCoordinator to acquire distributed lock across browser tabs
    const coordinator = getSyncCoordinator();

    // Try to acquire cross-tab lock
    const lockAcquired = await coordinator.acquireLock();
    if (!lockAcquired) {
      console.log(`📦 Another tab is syncing, skipping this sync`);
      return {
        success: false,
        timestamp: Date.now(),
        error: "Another tab is syncing",
      };
    }

    this.isSyncing = true;
    this.emitSyncStateChange();

    await this.emitEvent({
      type: "storage:started",
      timestamp: Date.now(),
    });

    try {
      const initialized = await this.ensureInitialized();
      if (
        !initialized ||
        !this.helia ||
        !this.ed25519PrivateKey ||
        !this.ed25519PublicKey
      ) {
        throw new Error("IPFS not initialized");
      }

      // 1. Get current tokens
      const wallet = WalletRepository.getInstance().getWallet();
      if (!wallet) {
        // For new wallets, WalletRepository._wallet may not be set yet
        // This is OK - inventorySync() handles the real storage
        // Return success since there's nothing to sync via this legacy path
        console.log(`📦 [SYNC] No WalletRepository wallet loaded (new wallet?) - skipping legacy sync`);
        this.isSyncing = false;
        this.emitSyncStateChange();
        coordinator.releaseLock();
        return {
          success: true,
          timestamp: Date.now(),
          version: 0,
        };
      }

      // Validate wallet belongs to current identity
      const currentIdentity = await this.identityManager.getCurrentIdentity();
      if (currentIdentity && wallet.address !== currentIdentity.address) {
        throw new Error(
          `Cannot sync: wallet address mismatch (wallet=${wallet.address}, identity=${currentIdentity.address})`
        );
      }

      const walletRepo = WalletRepository.getInstance();
      const nametag = walletRepo.getNametag();

      // DIAGNOSTIC: Log all tokens in wallet before validation
      console.log(`📦 [SYNC] Wallet has ${wallet.tokens.length} token(s) before validation:`);
      for (const t of wallet.tokens) {
        let txfInfo = "no jsonData";
        if (t.jsonData) {
          try {
            const parsed = JSON.parse(t.jsonData);
            const hasGenesis = !!parsed.genesis;
            const hasState = !!parsed.state;
            const txCount = Array.isArray(parsed.transactions) ? parsed.transactions.length : 0;
            const tokenIdInTxf = parsed.genesis?.data?.tokenId?.slice(0, 8) || "unknown";
            txfInfo = `genesis=${hasGenesis}, state=${hasState}, tx=${txCount}, tokenId=${tokenIdInTxf}...`;
          } catch {
            txfInfo = "invalid JSON";
          }
        }
        console.log(`📦   - [${t.id.slice(0, 8)}...] ${t.symbol} ${t.amount}: ${txfInfo}`);
      }

      // 2. Validate tokens before sync
      const validationService = getTokenValidationService();
      const { validTokens, issues } = await validationService.validateAllTokens(wallet.tokens);

      if (issues.length > 0) {
        console.warn(`📦 ${issues.length} token(s) failed validation and will be excluded:`);
        for (const issue of issues) {
          console.warn(`📦   - FAILED [${issue.tokenId.slice(0, 8)}...]: ${issue.reason}`);
        }
      }

      // DIAGNOSTIC: Log tokens that passed validation
      console.log(`📦 [SYNC] ${validTokens.length} token(s) passed validation:`);
      for (const t of validTokens) {
        console.log(`📦   - VALID [${t.id.slice(0, 8)}...] ${t.symbol} ${t.amount}`);
      }

      console.log(`📦 Syncing ${validTokens.length} tokens${nametag ? ` + nametag "${nametag.name}"` : ""} to IPFS (TXF format)...`);

      // 3. Check for remote conflicts before syncing
      let tokensToSync = validTokens;
      let conflictsResolved = 0;
      const lastCid = this.getLastCid();

      if (lastCid) {
        try {
          console.log(`📦 Checking for remote conflicts (last CID: ${lastCid.slice(0, 16)}...)...`);
          const j = json(this.helia);
          const { CID } = await import("multiformats/cid");
          const remoteCid = CID.parse(lastCid);

          // Add timeout to prevent hanging indefinitely when IPFS network is slow
          const REMOTE_FETCH_TIMEOUT = 15000; // 15 seconds
          const remoteData = await Promise.race([
            j.get(remoteCid),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("Remote fetch timeout")), REMOTE_FETCH_TIMEOUT)
            ),
          ]) as unknown;

          if (remoteData && typeof remoteData === "object" && "_meta" in (remoteData as object)) {
            const remoteTxf = remoteData as TxfStorageData;
            const remoteVersion = remoteTxf._meta.version;
            const localVersion = this.getVersionCounter();

            if (remoteVersion !== localVersion) {
              console.log(`📦 Version mismatch detected: local v${localVersion} vs remote v${remoteVersion}`);

              // Build local storage data for comparison (include tombstones)
              const localMeta: Omit<TxfMeta, "formatVersion"> = {
                version: localVersion,
                address: wallet.address,
                ipnsName: this.cachedIpnsName || "",
              };
              const localTombstones = walletRepo.getTombstones();
              const localTxf = await buildTxfStorageData(validTokens, localMeta, nametag || undefined, localTombstones);

              // Resolve conflicts
              const conflictService = getConflictResolutionService();
              const mergeResult = conflictService.resolveConflict(localTxf, remoteTxf);

              if (mergeResult.conflicts.length > 0) {
                console.log(`📦 Resolved ${mergeResult.conflicts.length} token conflict(s):`);
                for (const conflict of mergeResult.conflicts) {
                  console.log(`   - ${conflict.tokenId.slice(0, 8)}...: ${conflict.reason} (${conflict.resolution} wins)`);
                }
                conflictsResolved = mergeResult.conflicts.length;
              }

              if (mergeResult.newTokens.length > 0) {
                console.log(`📦 Added ${mergeResult.newTokens.length} token(s) from remote`);

                // Save new tokens from remote to local storage (IPFS → localStorage sync)
                for (const tokenId of mergeResult.newTokens) {
                  const tokenKey = `_${tokenId}`;
                  const txfToken = mergeResult.merged[tokenKey] as TxfToken;
                  if (txfToken) {
                    const token = txfToToken(tokenId, txfToken);
                    walletRepo.addToken(token, true); // skip history - recorded on original device
                    console.log(`📦 Synced token ${tokenId.slice(0, 8)}... from IPFS to local`);
                  }
                }
              }

              // Process tombstones: merge remote tombstones into local
              // This removes local tokens that were deleted on other devices
              const remoteTombstones = remoteTxf._tombstones || [];
              if (remoteTombstones.length > 0) {
                console.log(`📦 Processing ${remoteTombstones.length} remote tombstone(s)`);
                const removedCount = walletRepo.mergeTombstones(remoteTombstones);
                if (removedCount > 0) {
                  console.log(`📦 Removed ${removedCount} tombstoned token(s) from local during conflict resolution`);
                  // Invalidate UNSPENT cache since inventory changed
                  getTokenValidationService().clearUnspentCacheEntries();
                }
              }

              // Merge archived, forked tokens, outbox entries, and invalidated nametags from remote
              const { archivedTokens: remoteArchived, forkedTokens: remoteForked, outboxEntries: remoteOutbox, mintOutboxEntries: remoteMintOutbox, invalidatedNametags: remoteInvalidatedNametags } = parseTxfStorageData(remoteTxf);
              if (remoteArchived.size > 0) {
                const archivedMergedCount = walletRepo.mergeArchivedTokens(remoteArchived);
                if (archivedMergedCount > 0) {
                  console.log(`📦 Merged ${archivedMergedCount} archived token(s) from remote`);
                }
              }
              if (remoteForked.size > 0) {
                const forkedMergedCount = walletRepo.mergeForkedTokens(remoteForked);
                if (forkedMergedCount > 0) {
                  console.log(`📦 Merged ${forkedMergedCount} forked token(s) from remote`);
                }
              }
              // Import outbox entries from remote (CRITICAL for transfer recovery)
              if (remoteOutbox && remoteOutbox.length > 0) {
                const outboxRepo = OutboxRepository.getInstance();
                outboxRepo.importFromRemote(remoteOutbox);
                console.log(`📦 Imported ${remoteOutbox.length} outbox entries from remote during conflict resolution`);
              }
              // Import mint outbox entries from remote (CRITICAL for mint recovery)
              if (remoteMintOutbox && remoteMintOutbox.length > 0) {
                const outboxRepo = OutboxRepository.getInstance();
                outboxRepo.importMintEntriesFromRemote(remoteMintOutbox);
                console.log(`📦 Imported ${remoteMintOutbox.length} mint outbox entries from remote during conflict resolution`);
              }
              // Merge invalidated nametags from remote (preserves history across devices)
              if (remoteInvalidatedNametags && remoteInvalidatedNametags.length > 0) {
                const mergedCount = walletRepo.mergeInvalidatedNametags(remoteInvalidatedNametags);
                if (mergedCount > 0) {
                  console.log(`📦 Merged ${mergedCount} invalidated nametag(s) from remote during conflict resolution`);
                }
              }

              // Also sync nametag from remote if local doesn't have one
              if (!nametag && mergeResult.merged._nametag) {
                // Validate before setting - prevent importing corrupted nametag
                if (isNametagCorrupted(mergeResult.merged._nametag)) {
                  console.warn("📦 Skipping corrupted nametag from conflict resolution - will be cleared on next sync");
                } else {
                  // Check if this nametag was invalidated (e.g., Nostr pubkey mismatch)
                  const invalidatedNametags = walletRepo.getInvalidatedNametags();
                  const isInvalidated = invalidatedNametags.some((inv: { name: string }) => inv.name === mergeResult.merged._nametag!.name);
                  if (isInvalidated) {
                    console.warn(`📦 Skipping invalidated nametag "${mergeResult.merged._nametag.name}" from conflict resolution - user must create new nametag`);
                  } else {
                    walletRepo.setNametag(mergeResult.merged._nametag);
                    console.log(`📦 Synced nametag "${mergeResult.merged._nametag.name}" from IPFS to local`);
                  }
                }
              }

              // Extract tokens from merged data for re-sync
              const { tokens: mergedTokens } = parseTxfStorageData(mergeResult.merged);
              tokensToSync = mergedTokens;

              // Update local version to merged version
              this.setVersionCounter(mergeResult.merged._meta.version);
            } else {
              // Remote is in sync - check if local has any changes worth uploading
              // Extract genesis token IDs from local tokens (same as buildTxfStorageData uses)
              const localTokenIds = validTokens.map(t => {
                try {
                  const txf = JSON.parse(t.jsonData || "{}");
                  return txf.genesis?.data?.tokenId || t.id;
                } catch {
                  return t.id;
                }
              }).sort().join(",");
              // TXF format stores tokens as _tokenId keys (genesis token IDs)
              const remoteTokenIds = Object.keys(remoteTxf)
                .filter(k => k.startsWith("_") && k !== "_meta" && k !== "_nametag" && k !== "_tombstones")
                .map(k => k.slice(1))
                .sort()
                .join(",");

              if (localTokenIds === remoteTokenIds && !forceIpnsPublish) {
                // No changes - remote was verified accessible by startup syncFromIpns()
                // Skip re-upload for this wallet-updated event
                // BUT: don't skip if forceIpnsPublish is set (IPNS recovery needed)
                console.log(`📦 Remote is in sync (v${remoteVersion}) - no changes to upload`);
                this.isSyncing = false;
                this.emitSyncStateChange();
                coordinator.releaseLock(); // Release cross-tab lock on early return
                return {
                  success: true,
                  cid: lastCid || undefined,
                  ipnsName: this.cachedIpnsName || undefined,
                  timestamp: Date.now(),
                  version: remoteVersion,
                  tokenCount: validTokens.length,
                };
              }
              if (localTokenIds === remoteTokenIds && forceIpnsPublish) {
                console.log(`📦 Remote is in sync but IPNS recovery needed - continuing to publish IPNS`);
              }
              console.log(`📦 Remote version matches but local has token changes - uploading...`);
            }
          }
        } catch (err) {
          console.warn(`📦 Could not fetch remote for conflict check:`, err instanceof Error ? err.message : err);
          // Continue with local data
        }
      }

      // 4. Build TXF storage data with incremented version (include tombstones, archives, forks, outbox)
      const newVersion = this.incrementVersionCounter();
      const tombstones = walletRepo.getTombstones();
      const archivedTokens = walletRepo.getArchivedTokens();
      const forkedTokens = walletRepo.getForkedTokens();

      // Get outbox entries for IPFS sync (CRITICAL for transfer recovery)
      const outboxRepo = OutboxRepository.getInstance();
      outboxRepo.setCurrentAddress(wallet.address);
      const outboxEntries = outboxRepo.getAllForSync();
      const mintOutboxEntries = outboxRepo.getAllMintEntriesForSync();

      // Get invalidated nametags (preserves history across devices)
      const invalidatedNametags = walletRepo.getInvalidatedNametags();

      const meta: Omit<TxfMeta, "formatVersion"> = {
        version: newVersion,
        address: wallet.address,
        ipnsName: this.cachedIpnsName || "",
        lastCid: this.getLastCid() || undefined,
      };

      const txfStorageData = await buildTxfStorageData(tokensToSync, meta, nametag || undefined, tombstones, archivedTokens, forkedTokens, outboxEntries, mintOutboxEntries, invalidatedNametags);
      if (tombstones.length > 0 || archivedTokens.size > 0 || forkedTokens.size > 0 || outboxEntries.length > 0 || mintOutboxEntries.length > 0 || invalidatedNametags.length > 0) {
        console.log(`📦 Including ${tombstones.length} tombstone(s), ${archivedTokens.size} archived, ${forkedTokens.size} forked, ${outboxEntries.length} outbox, ${mintOutboxEntries.length} mint outbox, ${invalidatedNametags.length} invalidated nametag(s) in sync`);
      }

      // 4. Ensure backend is connected before storing
      const backendConnected = await this.ensureBackendConnected();
      if (backendConnected) {
        console.log(`📦 Backend connected - content will be available via bitswap`);
      }

      // 4.1. Store to IPFS
      const j = json(this.helia);
      const cid = await j.add(txfStorageData);
      const cidString = cid.toString();

      // 4.2. Wait briefly for bitswap to have a chance to exchange blocks
      // This gives the backend time to request blocks while we're connected
      if (backendConnected) {
        console.log(`📦 Waiting for bitswap block exchange...`);
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }

      // 4.3. Multi-node upload: directly upload content to all configured IPFS nodes
      // This bypasses bitswap limitations since browser can't be directly dialed
      const gatewayUrls = getAllBackendGatewayUrls();
      if (gatewayUrls.length > 0) {
        console.log(`📦 Uploading to ${gatewayUrls.length} IPFS node(s)...`);

        const jsonBlob = new Blob([JSON.stringify(txfStorageData)], {
          type: "application/json",
        });

        // Upload to all nodes in parallel
        const uploadPromises = gatewayUrls.map(async (gatewayUrl) => {
          try {
            const formData = new FormData();
            formData.append("file", jsonBlob, "wallet.json");

            const response = await fetch(
              `${gatewayUrl}/api/v0/add?pin=true&cid-version=1`,
              { method: "POST", body: formData }
            );
            if (response.ok) {
              const result = await response.json();
              const hostname = new URL(gatewayUrl).hostname;
              console.log(`📦 Uploaded to ${hostname}: ${result.Hash}`);
              return { success: true, host: gatewayUrl, cid: result.Hash };
            }
            return { success: false, host: gatewayUrl, error: response.status };
          } catch (error) {
            const hostname = new URL(gatewayUrl).hostname;
            console.warn(`📦 Upload to ${hostname} failed:`, error);
            return { success: false, host: gatewayUrl, error };
          }
        });

        const results = await Promise.allSettled(uploadPromises);
        const successful = results.filter(
          (r) => r.status === "fulfilled" && r.value.success
        ).length;
        console.log(`📦 Content uploaded to ${successful}/${gatewayUrls.length} nodes`);
      }

      // 4.4. Announce content to connected peers (DHT provide)
      // This helps ensure our backend IPFS node can discover and fetch the content
      // Use timeout since DHT operations can be slow in browser
      // ONLY if DHT enabled (HTTP is primary path, DHT provides optional redundancy)
      if (IPFS_CONFIG.enableDht) {
        const PROVIDE_TIMEOUT = 10000; // 10 seconds
        try {
          console.log(`📦 Announcing CID to network: ${cidString.slice(0, 16)}...`);
          await Promise.race([
            this.helia.routing.provide(cid),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("DHT provide timeout")), PROVIDE_TIMEOUT)
            ),
          ]);
          console.log(`📦 CID announced to network`);
        } catch (provideError) {
          // Non-fatal - content is still stored locally
          console.warn(`📦 Could not announce to DHT (non-fatal):`, provideError);
        }
      } else {
        console.debug(`📦 DHT provide skipped (disabled via config)`);
      }

      // 4.5. Publish to IPNS only if CID changed (or forced for IPNS recovery)
      const previousCid = this.getLastCid();
      let ipnsPublished = false;
      let ipnsPublishPending = false;
      const shouldPublishIpns = cidString !== previousCid || forceIpnsPublish;
      if (shouldPublishIpns) {
        if (forceIpnsPublish && cidString === previousCid) {
          console.log(`📦 Forcing IPNS republish (CID unchanged but IPNS may be expired)`);
        }
        const ipnsResult = await this.publishToIpns(cid, skipExtendedVerification);
        if (ipnsResult) {
          ipnsPublished = true;
          this.clearPendingIpnsPublish(); // Clear any previous pending
          // Stop any active retry loop since we succeeded
          this.stopIpnsSyncRetryLoop();
        } else {
          // IPNS publish failed - mark as pending for retry
          this.setPendingIpnsPublish(cidString);
          ipnsPublishPending = true;
          // Start the infinite retry loop (unless this is already a retry attempt)
          if (!isRetryAttempt) {
            console.log(`📦 Starting IPNS sync retry loop due to publish failure...`);
            this.startIpnsSyncRetryLoop();
          }
        }
      } else {
        console.log(`📦 CID unchanged (${cidString.slice(0, 16)}...) - skipping IPNS publish`);
        this.clearPendingIpnsPublish(); // Clear any stale pending
      }

      // 5. Store CID for recovery (even if IPNS failed, content is stored)
      this.setLastCid(cidString);

      console.log(`📦 Tokens stored to IPFS (v${newVersion}): ${cidString}`);
      console.log(`📦 IPNS name: ${this.cachedIpnsName}`);

      const result: StorageResult = {
        success: true,
        cid: cidString,
        ipnsName: this.cachedIpnsName || undefined,
        timestamp: Date.now(),
        version: newVersion,
        tokenCount: tokensToSync.length,
        validationIssues: issues.length > 0 ? issues.map(i => i.reason) : undefined,
        conflictsResolved: conflictsResolved > 0 ? conflictsResolved : undefined,
        ipnsPublished,
        ipnsPublishPending: ipnsPublishPending || undefined,
      };

      this.lastSync = result;

      await this.emitEvent({
        type: "storage:completed",
        timestamp: Date.now(),
        data: {
          cid: cidString,
          ipnsName: this.cachedIpnsName || undefined,
          tokenCount: validTokens.length,
        },
      });

      // Emit IPNS published event for future Nostr integration
      await this.emitEvent({
        type: "ipns:published",
        timestamp: Date.now(),
        data: {
          cid: cidString,
          ipnsName: this.cachedIpnsName || undefined,
        },
      });

      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      console.error("📦 Storage sync failed:", errorMessage);

      const result: StorageResult = {
        success: false,
        timestamp: Date.now(),
        error: errorMessage,
      };

      this.lastSync = result;

      await this.emitEvent({
        type: "storage:failed",
        timestamp: Date.now(),
        data: { error: errorMessage },
      });

      return result;
    } finally {
      this.isSyncing = false;
      this.emitSyncStateChange();
      // Release cross-tab lock
      coordinator.releaseLock();
      // Note: SyncQueue handles queuing of pending sync requests automatically
    }
  }

  // ==========================================
  // Spent Token Sanity Check
  // ==========================================

  /**
   * Run sanity check to detect and remove spent tokens
   * Called during each IPNS poll cycle
   *
   * @deprecated Use InventorySyncService instead. This method will be removed in a future release.
   * Migration: TokenValidationService is called directly by InventorySyncService.
   */
  private async runSpentTokenSanityCheck(): Promise<void> {
    console.warn('⚠️ [DEPRECATED] runSpentTokenSanityCheck() is deprecated. Use InventorySyncService.inventorySync() instead.');
    console.log("📦 Running spent token sanity check...");

    try {
      // Get current identity for public key
      const identity = await this.identityManager.getCurrentIdentity();
      if (!identity) {
        console.warn("📦 Sanity check: No identity, skipping");
        return;
      }

      // Get all tokens from wallet
      const walletRepo = WalletRepository.getInstance();
      const tokens = walletRepo.getTokens();

      if (tokens.length === 0) {
        console.log("📦 Sanity check: No tokens to check");
        return;
      }

      // Run spent token check
      const validationService = getTokenValidationService();
      const result = await validationService.checkSpentTokens(tokens, identity.publicKey, {
        batchSize: 3,
        onProgress: (completed, total) => {
          if (completed % 5 === 0 || completed === total) {
            console.log(`📦 Sanity check progress: ${completed}/${total}`);
          }
        },
      });

      // Remove spent tokens
      if (result.spentTokens.length > 0) {
        console.log(`📦 Sanity check found ${result.spentTokens.length} spent token(s):`);

        for (const spent of result.spentTokens) {
          const tokenIdStr = spent.tokenId || spent.localId || "unknown";
          const stateHashStr = spent.stateHash || "unknown";
          console.log(
            `📦   - Removing spent token ${tokenIdStr.slice(0, 8)}... (state: ${stateHashStr.slice(0, 12)}...)`
          );
          // Use skipHistory=true since this is cleanup, not a user-initiated transfer
          if (spent.localId) {
            walletRepo.removeToken(spent.localId, undefined, true);
          }
        }

        // Emit wallet-updated to refresh UI
        window.dispatchEvent(new Event("wallet-updated"));

        console.log(`📦 Sanity check complete: removed ${result.spentTokens.length} spent token(s)`);
      } else {
        console.log("📦 Sanity check complete: no spent tokens found");
      }

      // Log any errors (non-fatal)
      if (result.errors.length > 0) {
        console.warn(
          `📦 Sanity check had ${result.errors.length} error(s):`,
          result.errors.slice(0, 3)
        );
      }
    } catch (error) {
      // Non-fatal - sanity check failure shouldn't break sync
      console.warn(
        "📦 Sanity check failed (non-fatal):",
        error instanceof Error ? error.message : error
      );
    }
  }

  /**
   * Periodic tombstone recovery check
   * Verifies existing local tombstones are still valid (token actually spent)
   * Removes invalid tombstones and restores tokens from archive
   *
   * This is the inverse of runSpentTokenSanityCheck():
   * - runSpentTokenSanityCheck: finds active tokens that should be tombstoned
   * - runTombstoneRecoveryCheck: finds tombstones that should be removed
   *
   * @deprecated Use InventorySyncService instead. This method will be removed in a future release.
   * Migration: Recovery flow is handled by InventorySyncService.inventorySync().
   */
  private async runTombstoneRecoveryCheck(): Promise<void> {
    console.warn('⚠️ [DEPRECATED] runTombstoneRecoveryCheck() is deprecated. Use InventorySyncService.inventorySync() instead.');
    console.log("📦 Running tombstone recovery check...");

    try {
      const walletRepo = WalletRepository.getInstance();
      const tombstones = walletRepo.getTombstones();

      if (tombstones.length === 0) {
        console.log("📦 Tombstone recovery: no tombstones to check");
        return;
      }

      // Reuse existing sanityCheckTombstones() logic
      const walletAddress = walletRepo.getWallet()?.address ?? '';
      const result = await this.sanityCheckTombstones(tombstones, walletAddress);

      if (result.invalidTombstones.length === 0) {
        console.log(`📦 Tombstone recovery: all ${tombstones.length} tombstone(s) are valid`);
        return;
      }

      console.log(`📦 Found ${result.invalidTombstones.length} invalid tombstone(s) - recovering...`);

      // Remove invalid tombstones
      for (const invalid of result.invalidTombstones) {
        console.log(`📦   - Removing invalid tombstone ${invalid.tokenId.slice(0, 8)}:${invalid.stateHash.slice(0, 8)}...`);
        walletRepo.removeTombstone(invalid.tokenId, invalid.stateHash);
      }

      // Restore tokens from archive
      let restoredCount = 0;
      for (const { tokenId, txf } of result.tokensToRestore) {
        const restored = walletRepo.restoreTokenFromArchive(tokenId, txf);
        if (restored) {
          console.log(`📦   - Restored token ${tokenId.slice(0, 8)}... from archive`);
          restoredCount++;
        }
      }

      if (restoredCount > 0) {
        window.dispatchEvent(new Event("wallet-updated"));
        console.log(`📦 Tombstone recovery complete: ${result.invalidTombstones.length} tombstone(s) removed, ${restoredCount} token(s) restored`);
      }

    } catch (error) {
      // Non-fatal - recovery check failure shouldn't break polling
      console.warn(
        "📦 Tombstone recovery check failed (non-fatal):",
        error instanceof Error ? error.message : error
      );
    }
  }

  // ==========================================
  // Restore Operations
  // ==========================================

  /**
   * Restore tokens from IPFS using CID
   * Supports both legacy format and TXF format
   */
  async restore(cid: string): Promise<RestoreResult> {
    try {
      const initialized = await this.ensureInitialized();
      if (!initialized || !this.helia) {
        throw new Error("IPFS not initialized");
      }

      console.log(`📦 Restoring from CID: ${cid}`);

      const j = json(this.helia);
      const { CID } = await import("multiformats/cid");
      const parsedCid = CID.parse(cid);

      const rawData = await j.get(parsedCid);

      // Detect format: TXF has _meta, legacy has version number
      const isTxfFormat = rawData && typeof rawData === "object" && "_meta" in (rawData as object);

      if (isTxfFormat) {
        // TXF Format
        const txfData = rawData as TxfStorageData;
        const { tokens, meta, nametag, validationErrors } = parseTxfStorageData(txfData);

        if (validationErrors.length > 0) {
          console.warn(`📦 Validation warnings during restore:`, validationErrors);
        }

        // Validate address
        const currentIdentity = await this.identityManager.getCurrentIdentity();
        if (currentIdentity && meta && meta.address !== currentIdentity.address) {
          console.warn(
            `📦 Address mismatch: stored=${meta.address}, current=${currentIdentity.address}`
          );
          throw new Error(
            "Cannot restore tokens: address mismatch. This data belongs to a different identity."
          );
        }

        // Update local version counter to match restored version
        if (meta) {
          this.setVersionCounter(meta.version);
        }

        console.log(`📦 Restored ${tokens.length} tokens (TXF v${meta?.version || "?"})${nametag ? ` + nametag "${nametag.name}"` : ""} from IPFS`);

        return {
          success: true,
          tokens,
          nametag: nametag || undefined,
          version: meta?.version,
          timestamp: Date.now(),
        };
      } else {
        // Legacy format
        const storageData = rawData as StorageData;

        if (!storageData || !storageData.version) {
          throw new Error("Invalid storage data format");
        }

        // Validate address
        const currentIdentity = await this.identityManager.getCurrentIdentity();
        if (currentIdentity && storageData.address !== currentIdentity.address) {
          console.warn(
            `📦 Address mismatch: stored=${storageData.address}, current=${currentIdentity.address}`
          );
          throw new Error(
            "Cannot restore tokens: address mismatch. This data belongs to a different identity."
          );
        }

        console.log(`📦 Restored ${storageData.tokens.length} tokens (legacy format)${storageData.nametag ? ` + nametag "${storageData.nametag.name}"` : ""} from IPFS`);

        // Convert serialized tokens back to Token objects
        const { Token: TokenClass, TokenStatus } = await import("../data/model");
        const tokens = storageData.tokens.map(
          (t) =>
            new TokenClass({
              id: t.id,
              name: t.name,
              symbol: t.symbol,
              amount: t.amount,
              coinId: t.coinId,
              jsonData: t.jsonData,
              status: (t.status as keyof typeof TokenStatus) in TokenStatus
                ? t.status as typeof TokenStatus[keyof typeof TokenStatus]
                : TokenStatus.CONFIRMED,
              timestamp: t.timestamp,
              type: t.type,
              iconUrl: t.iconUrl,
            })
        ) as Token[];

        return {
          success: true,
          tokens,
          nametag: storageData.nametag,
          timestamp: Date.now(),
        };
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      console.error("📦 Restore failed:", errorMessage);

      return {
        success: false,
        timestamp: Date.now(),
        error: errorMessage,
      };
    }
  }

  /**
   * Restore from last known CID (recovery helper)
   */
  async restoreFromLastCid(): Promise<RestoreResult> {
    const lastCid = this.getLastCid();
    if (!lastCid) {
      return {
        success: false,
        timestamp: Date.now(),
        error: "No previous CID found for recovery",
      };
    }
    return this.restore(lastCid);
  }

  // ==========================================
  // Status & Getters
  // ==========================================

  /**
   * Get or compute the deterministic IPNS name for this wallet
   * Returns a proper PeerId-based IPNS name
   * Use getIpnsName() for sync access to cached value
   */
  async getOrComputeIpnsName(): Promise<string | null> {
    if (this.cachedIpnsName) {
      return this.cachedIpnsName;
    }

    // Try to compute it without full initialization
    const identity = await this.identityManager.getCurrentIdentity();
    if (!identity) {
      return null;
    }

    try {
      const walletSecret = this.hexToBytes(identity.privateKey);
      const derivedKey = hkdf(sha256, walletSecret, undefined, HKDF_INFO, 32);

      // Generate libp2p key pair and derive peer ID for proper IPNS name
      const keyPair = await generateKeyPairFromSeed("Ed25519", derivedKey);
      const peerId = peerIdFromPrivateKey(keyPair);
      this.cachedIpnsName = peerId.toString();

      return this.cachedIpnsName;
    } catch (error) {
      console.warn("📦 Failed to compute IPNS name:", error);
      return null;
    }
  }

  /**
   * Get current storage status
   */
  getStatus(): StorageStatus {
    return {
      initialized: this.helia !== null,
      isSyncing: this.isSyncing || this.isInitialSyncing,
      lastSync: this.lastSync,
      ipnsName: this.cachedIpnsName,
      webCryptoAvailable: this.isWebCryptoAvailable(),
      currentVersion: this.getVersionCounter(),
      lastCid: this.getLastCid(),
    };
  }

  /**
   * Get current version counter
   */
  getCurrentVersion(): number {
    return this.getVersionCounter();
  }

  /**
   * Check if currently syncing
   */
  isCurrentlySyncing(): boolean {
    return this.isSyncing || this.isInitialSyncing;
  }

  /**
   * Get IPFS performance metrics for monitoring and debugging
   * Includes latency percentiles, success rates, and target achievement status
   */
  getPerformanceMetrics(): {
    snapshot: IpfsMetricsSnapshot;
    targetStatus: { targetMet: boolean; p95AboveTarget: boolean; message: string };
    resolveMetrics: { count: number; avgLatencyMs: number; successRate: number; preferredSource: IpfsSource };
    fetchMetrics: { count: number; avgLatencyMs: number; successRate: number; preferredSource: IpfsSource };
  } {
    const metrics = getIpfsMetrics();
    return {
      snapshot: metrics.getSnapshot(),
      targetStatus: metrics.getTargetStatus(),
      resolveMetrics: metrics.getOperationMetrics("resolve"),
      fetchMetrics: metrics.getOperationMetrics("fetch"),
    };
  }

  /**
   * Clear IPFS cache and metrics (useful for debugging)
   */
  clearCacheAndMetrics(): void {
    const httpResolver = getIpfsHttpResolver();
    httpResolver.invalidateIpnsCache();
    getIpfsMetrics().reset();
    console.log("📦 IPFS cache and metrics cleared");
  }

  /**
   * Clear corrupted nametag from both local and IPFS storage.
   * This breaks the import loop by publishing clean state to IPFS.
   *
   * Call this when corrupted nametag is detected to ensure the corruption
   * is cleared from BOTH local storage AND the remote IPFS backup.
   */
  async clearCorruptedNametagAndSync(): Promise<void> {
    console.log("🧹 Clearing corrupted nametag from local and IPFS storage...");

    // Get current identity
    const identity = await this.identityManager.getCurrentIdentity();
    if (!identity) {
      console.error("No identity available for clearing nametag");
      return;
    }

    // 1. Clear from local storage
    try {
      clearNametagForAddress(identity.address);
      console.log("✅ Cleared corrupted nametag from local storage");
    } catch (error) {
      console.error("Failed to clear local nametag:", error);
    }

    // 2. Force sync to IPFS to overwrite remote with clean state (no nametag)
    // This prevents the next sync from re-importing the corrupted data
    try {
      await this.syncNow({ forceIpnsPublish: true });
      console.log("✅ Published clean state to IPFS (corrupted nametag removed)");
    } catch (error) {
      console.error("Failed to sync clean state to IPFS:", error);
      // Even if IPFS sync fails, local is cleared - IPFS will be fixed on next successful sync
    }
  }

  // ==========================================
  // TXF Import/Export
  // ==========================================

  /**
   * Export all tokens as TXF file content
   */
  async exportAsTxf(): Promise<{ success: boolean; data?: string; filename?: string; error?: string }> {
    try {
      const identity = await this.identityManager.getCurrentIdentity();
      if (!identity) {
        return { success: false, error: "No identity available" };
      }

      const tokens = getTokensForAddress(identity.address);
      if (tokens.length === 0) {
        return { success: false, error: "No tokens found" };
      }

      // Import serializer
      const { buildTxfExportFile } = await import("./TxfSerializer");
      const txfData = buildTxfExportFile(tokens);

      const filename = `tokens-${identity.address.slice(0, 8)}-${Date.now()}.txf`;
      const jsonString = JSON.stringify(txfData, null, 2);

      console.log(`📦 Exported ${tokens.length} tokens as TXF`);

      return {
        success: true,
        data: jsonString,
        filename,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error("📦 TXF export failed:", errorMessage);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Import tokens from TXF file content
   * Returns imported tokens that can be added to wallet
   */
  async importFromTxf(content: string): Promise<{
    success: boolean;
    tokens?: Token[];
    imported?: number;
    skipped?: number;
    error?: string;
  }> {
    try {
      const txfData = JSON.parse(content);

      // Import serializer and validator
      const { parseTxfFile } = await import("./TxfSerializer");
      const validationService = getTokenValidationService();

      const { tokens: parsedTokens, errors: parseErrors } = parseTxfFile(txfData);

      if (parseErrors.length > 0) {
        console.warn("📦 TXF file parsing warnings:", parseErrors);
      }

      if (parsedTokens.length === 0) {
        return { success: false, error: "No valid tokens found in TXF file" };
      }

      // Validate each token
      const validTokens: Token[] = [];
      let skipped = 0;

      for (const token of parsedTokens) {
        const result = await validationService.validateToken(token);
        if (result.isValid && result.token) {
          validTokens.push(result.token);
        } else {
          skipped++;
          console.warn(`📦 Skipping invalid token ${token.id.slice(0, 8)}...: ${result.reason}`);
        }
      }

      console.log(`📦 Imported ${validTokens.length} tokens from TXF (${skipped} skipped)`);

      return {
        success: true,
        tokens: validTokens,
        imported: validTokens.length,
        skipped,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error("📦 TXF import failed:", errorMessage);
      return { success: false, error: errorMessage };
    }
  }
}

// ==========================================
// IpfsTransport Singleton Getter
// ==========================================

/**
 * Get the IpfsTransport singleton instance
 * This provides access to the pure IPFS/IPNS transport layer
 * for use by InventorySyncService and other high-level services.
 */
let transportInstance: IpfsTransport | null = null;

export function getIpfsTransport(): IpfsTransport {
  if (!transportInstance) {
    transportInstance = IpfsStorageService.getInstance(IdentityManager.getInstance());
  }
  return transportInstance;
}
