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
import { WalletRepository, type NametagData } from "../../../../repositories/WalletRepository";
import { IdentityManager } from "./IdentityManager";
import type { Token } from "../data/model";
import type { TxfStorageData, TxfMeta, TxfToken, TombstoneEntry } from "./types/TxfTypes";
import { isTokenKey, tokenIdFromKey } from "./types/TxfTypes";
import { buildTxfStorageData, parseTxfStorageData, txfToToken, tokenToTxf, getCurrentStateHash } from "./TxfSerializer";
import { getTokenValidationService } from "./TokenValidationService";
import { getConflictResolutionService } from "./ConflictResolutionService";
import { getSyncCoordinator } from "./SyncCoordinator";
import { getTokenBackupService } from "./TokenBackupService";
// Note: retryWithBackoff was used for DHT publish, now handled by HTTP primary path
import { getBootstrapPeers, getConfiguredCustomPeers, getBackendPeerId, getAllBackendGatewayUrls, IPNS_RESOLUTION_CONFIG, IPFS_CONFIG } from "../../../../config/ipfs.config";

// Configure @noble/ed25519 to use sync sha512 (required for getPublicKey without WebCrypto)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(ed.hashes as any).sha512 = (message: Uint8Array) => sha512(message);

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
const VERSION_STORAGE_PREFIX = "ipfs_version_";
const CID_STORAGE_PREFIX = "ipfs_last_cid_";
const PENDING_IPNS_PREFIX = "ipfs_pending_ipns_";

// ==========================================
// IpfsStorageService
// ==========================================

export class IpfsStorageService {
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
  private isSyncing = false;
  private isInitialSyncing = false;  // Tracks initial IPNS-based sync on startup
  private pendingSync = false; // Track if sync was requested while another sync was running
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
      return; // Already enabled
    }

    // Create bound handler to allow proper cleanup
    this.boundSyncHandler = () => this.scheduleSync();
    window.addEventListener("wallet-updated", this.boundSyncHandler);
    this.autoSyncEnabled = true;
    console.log("📦 IPFS auto-sync enabled");

    // Set up IPNS polling with visibility-based control
    this.setupVisibilityListener();

    // On startup, run IPNS-based sync to discover remote state
    // This resolves IPNS, verifies remote content, and merges if needed
    this.syncFromIpns().catch(console.error);
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    // Remove event listener
    if (this.boundSyncHandler) {
      window.removeEventListener("wallet-updated", this.boundSyncHandler);
      this.boundSyncHandler = null;
    }
    this.autoSyncEnabled = false;

    // Clean up IPNS polling and visibility listener
    this.cleanupVisibilityListener();

    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }
    if (this.connectionMaintenanceInterval) {
      clearInterval(this.connectionMaintenanceInterval);
      this.connectionMaintenanceInterval = null;
    }
    if (this.helia) {
      await this.helia.stop();
      this.helia = null;
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
  private isWebCryptoAvailable(): boolean {
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
   */
  private async ensureInitialized(): Promise<boolean> {
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
      // Wait for ongoing initialization
      await new Promise((resolve) => setTimeout(resolve, 100));
      return this.ensureInitialized();
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

      // 4. Compute proper IPNS name from peer ID and migrate old storage keys
      const oldIpnsName = `ipns-${this.bytesToHex(this.ed25519PublicKey).slice(0, 32)}`;
      const newIpnsName = ipnsPeerId.toString();
      this.cachedIpnsName = newIpnsName;
      this.currentIdentityAddress = identity.address; // Track which identity we initialized for
      this.migrateStorageKeys(oldIpnsName, newIpnsName);

      // Load last IPNS sequence number from storage
      this.ipnsSequenceNumber = this.getIpnsSequenceNumber();

      // 4. Initialize Helia (browser IPFS) with custom bootstrap peers
      const bootstrapPeers = getBootstrapPeers();
      const customPeerCount = getConfiguredCustomPeers().length;

      console.log("📦 Initializing Helia with restricted peer connections...");
      console.log(`📦 Bootstrap peers: ${bootstrapPeers.length} total (${customPeerCount} custom, ${bootstrapPeers.length - customPeerCount} fallback)`);

      // Create connection gater to restrict connections to bootstrap peers only
      const connectionGater = this.createConnectionGater(bootstrapPeers);

      this.helia = await createHelia({
        libp2p: {
          connectionGater,
          peerDiscovery: [
            bootstrap({ list: bootstrapPeers }),
            // No mDNS - don't discover local network peers
          ],
          connectionManager: {
            maxConnections: IPFS_CONFIG.maxConnections,
          },
        },
      });

      // Log browser's peer ID for debugging
      const browserPeerId = this.helia.libp2p.peerId.toString();
      console.log("📦 IPFS storage service initialized");
      console.log("📦 Browser Peer ID:", browserPeerId);
      console.log("📦 IPNS name:", this.cachedIpnsName);
      console.log("📦 Identity address:", identity.address.slice(0, 30) + "...");

      // Extract bootstrap peer IDs for filtering connection logs
      const bootstrapPeerIds = new Set(
        bootstrapPeers.map((addr) => {
          const match = addr.match(/\/p2p\/([^/]+)$/);
          return match ? match[1] : null;
        }).filter(Boolean) as string[]
      );

      // Set up peer connection event handlers - only log bootstrap peers
      this.helia.libp2p.addEventListener("peer:connect", (event) => {
        const remotePeerId = event.detail.toString();
        if (bootstrapPeerIds.has(remotePeerId)) {
          console.log(`📦 Connected to bootstrap peer: ${remotePeerId.slice(0, 16)}...`);
        }
      });

      this.helia.libp2p.addEventListener("peer:disconnect", (event) => {
        const remotePeerId = event.detail.toString();
        if (bootstrapPeerIds.has(remotePeerId)) {
          console.log(`📦 Disconnected from bootstrap peer: ${remotePeerId.slice(0, 16)}...`);
        }
      });

      // Log initial connections after a short delay
      setTimeout(() => {
        const connections = this.helia?.libp2p.getConnections() || [];
        console.log(`📦 Active connections: ${connections.length}`);
        connections.slice(0, 5).forEach((conn) => {
          console.log(`📦   - ${conn.remotePeer.toString().slice(0, 16)}... via ${conn.remoteAddr.toString()}`);
        });
      }, 5000);

      // Start connection maintenance for backend peer
      this.startBackendConnectionMaintenance();

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
    const oldVersionKey = `${VERSION_STORAGE_PREFIX}${oldIpnsName}`;
    const newVersionKey = `${VERSION_STORAGE_PREFIX}${newIpnsName}`;
    const version = localStorage.getItem(oldVersionKey);
    if (version && !localStorage.getItem(newVersionKey)) {
      localStorage.setItem(newVersionKey, version);
      localStorage.removeItem(oldVersionKey);
      console.log(`📦 Migrated version key: ${oldIpnsName} -> ${newIpnsName}`);
    }

    // Migrate last CID
    const oldCidKey = `${CID_STORAGE_PREFIX}${oldIpnsName}`;
    const newCidKey = `${CID_STORAGE_PREFIX}${newIpnsName}`;
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

  /**
   * Create a connection gater that only allows connections to bootstrap peers.
   * This restricts libp2p from connecting to random DHT-discovered peers,
   * reducing browser traffic significantly.
   *
   * @param bootstrapPeers - List of bootstrap multiaddrs containing allowed peer IDs
   */
  private createConnectionGater(bootstrapPeers: string[]): ConnectionGater {
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

  // ==========================================
  // IPNS Publishing
  // ==========================================

  private readonly IPNS_SEQ_STORAGE_PREFIX = "ipns_seq_";

  /**
   * Get the last IPNS sequence number from storage
   */
  private getIpnsSequenceNumber(): bigint {
    if (!this.cachedIpnsName) return 0n;
    const key = `${this.IPNS_SEQ_STORAGE_PREFIX}${this.cachedIpnsName}`;
    const stored = localStorage.getItem(key);
    return stored ? BigInt(stored) : 0n;
  }

  /**
   * Save the IPNS sequence number to storage
   */
  private setIpnsSequenceNumber(seq: bigint): void {
    if (!this.cachedIpnsName) return;
    const key = `${this.IPNS_SEQ_STORAGE_PREFIX}${this.cachedIpnsName}`;
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

          // allow-offline=true: Store record locally first, then propagate async
          // This makes the HTTP call return quickly instead of waiting for DHT
          const response = await fetch(
            `${gatewayUrl}/api/v0/routing/put?arg=/ipns/${ipnsName}&allow-offline=true`,
            {
              method: "POST",
              body: formData,
              signal: AbortSignal.timeout(30000), // 30s timeout
            }
          );

          if (!response.ok) {
            const errorText = await response.text().catch(() => "");
            throw new Error(`HTTP ${response.status}: ${errorText.slice(0, 100)}`);
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
   * @returns The IPNS name on success, null on failure (non-fatal)
   */
  private async publishToIpns(cid: CID): Promise<string | null> {
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
      const httpSuccess = await this.publishIpnsViaHttp(marshalledRecord);

      // 3. Publish via browser DHT (fallback, fire-and-forget) - DON'T await
      // This runs in background regardless of HTTP result for redundancy
      this.publishIpnsViaDhtAsync(routingKey, marshalledRecord);

      if (httpSuccess) {
        // Save sequence number on HTTP success
        this.setIpnsSequenceNumber(this.ipnsSequenceNumber);
        console.log(
          `📦 IPNS record published successfully (seq: ${this.ipnsSequenceNumber})`
        );
        return this.cachedIpnsName;
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
    onLateHigherSequence?: (result: IpnsGatewayResult) => void
  ): Promise<IpnsProgressiveResult> {
    const gatewayUrls = getAllBackendGatewayUrls();
    if (gatewayUrls.length === 0 || !this.cachedIpnsName) {
      return { best: null, allResults: [], respondedCount: 0, totalGateways: 0 };
    }

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
    } else {
      // Local version is same or higher, BUT remote might have new tokens we don't have
      // (e.g., Browser 2 received token via Nostr while Browser 1 was offline)
      console.log(`📦 Remote version ${remoteVersion} not newer than local ${localVersion}, checking for new tokens...`);

      // Still import remote data - importRemoteData handles deduplication
      const importedCount = await this.importRemoteData(remoteData);

      if (importedCount > 0) {
        console.log(`📦 Imported ${importedCount} new token(s) from remote despite lower version`);

        // Trigger wallet refresh
        window.dispatchEvent(new Event("wallet-updated"));
      }

      // Only sync if local differs from remote (has unique tokens or better versions)
      // This prevents unnecessary re-publishing when local now matches remote
      if (this.localDiffersFromRemote(remoteData)) {
        console.log(`📦 Local differs from remote, scheduling sync to publish merged state`);
        this.scheduleSync();

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
   */
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

    // Then periodically (every 30 seconds)
    this.connectionMaintenanceInterval = setInterval(maintainConnection, 30000);
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
  private getVersionCounter(): number {
    if (!this.cachedIpnsName) return 0;
    const key = `${VERSION_STORAGE_PREFIX}${this.cachedIpnsName}`;
    return parseInt(localStorage.getItem(key) || "0", 10);
  }

  /**
   * Increment and return new version counter
   */
  private incrementVersionCounter(): number {
    if (!this.cachedIpnsName) return 1;
    const key = `${VERSION_STORAGE_PREFIX}${this.cachedIpnsName}`;
    const current = this.getVersionCounter();
    const next = current + 1;
    localStorage.setItem(key, String(next));
    return next;
  }

  /**
   * Set version counter to specific value (used after merge)
   */
  private setVersionCounter(version: number): void {
    if (!this.cachedIpnsName) return;
    const key = `${VERSION_STORAGE_PREFIX}${this.cachedIpnsName}`;
    localStorage.setItem(key, String(version));
  }

  /**
   * Get last stored CID for this wallet
   */
  private getLastCid(): string | null {
    if (!this.cachedIpnsName) return null;
    const key = `${CID_STORAGE_PREFIX}${this.cachedIpnsName}`;
    return localStorage.getItem(key);
  }

  /**
   * Store last CID for recovery
   */
  private setLastCid(cid: string): void {
    if (!this.cachedIpnsName) return;
    const key = `${CID_STORAGE_PREFIX}${this.cachedIpnsName}`;
    localStorage.setItem(key, cid);
  }

  // ==========================================
  // Pending IPNS Publish Tracking
  // ==========================================

  /**
   * Get pending IPNS publish CID (if previous publish failed)
   */
  private getPendingIpnsPublish(): string | null {
    if (!this.cachedIpnsName) return null;
    const key = `${PENDING_IPNS_PREFIX}${this.cachedIpnsName}`;
    return localStorage.getItem(key);
  }

  /**
   * Set pending IPNS publish CID for retry
   */
  private setPendingIpnsPublish(cid: string): void {
    if (!this.cachedIpnsName) return;
    const key = `${PENDING_IPNS_PREFIX}${this.cachedIpnsName}`;
    localStorage.setItem(key, cid);
    console.log(`📦 IPNS publish marked as pending for CID: ${cid.slice(0, 16)}...`);
  }

  /**
   * Clear pending IPNS publish after successful publish
   */
  private clearPendingIpnsPublish(): void {
    if (!this.cachedIpnsName) return;
    const key = `${PENDING_IPNS_PREFIX}${this.cachedIpnsName}`;
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
    if (!this.helia) return null;

    const FETCH_TIMEOUT = 15000; // 15 seconds

    try {
      console.log(`📦 Fetching remote content: ${cidString.slice(0, 16)}...`);
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
        console.log(`📦 Remote content fetched successfully`);
        return data as TxfStorageData;
      }

      console.warn(`📦 Remote content is not valid TXF format`);
      return null;
    } catch (error) {
      console.warn(`📦 Failed to fetch CID ${cidString.slice(0, 16)}...:`, error);
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
   */
  private async sanityCheckTombstones(
    tombstonesToApply: TombstoneEntry[],
    walletRepo: WalletRepository
  ): Promise<{
    validTombstones: TombstoneEntry[];
    invalidTombstones: TombstoneEntry[];
    tokensToRestore: Array<{ tokenId: string; txf: TxfToken }>;
  }> {
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
    for (const tombstone of tombstonesToApply) {
      const archivedVersion = walletRepo.getBestArchivedVersion(tombstone.tokenId);
      if (archivedVersion) {
        tokensToCheck.set(tombstone.tokenId, archivedVersion);
      }
    }

    if (tokensToCheck.size === 0) {
      console.warn("⚠️ No archived tokens available for verification, accepting all tombstones");
      return { validTombstones: tombstonesToApply, invalidTombstones: [], tokensToRestore: [] };
    }

    // Check which tokens are NOT spent (should not be deleted)
    const validationService = getTokenValidationService();
    const publicKey = identity.publicKey;
    const unspentTokenIds = await validationService.checkUnspentTokens(tokensToCheck, publicKey);
    const unspentSet = new Set(unspentTokenIds);

    // Categorize tombstones
    for (const tombstone of tombstonesToApply) {
      if (unspentSet.has(tombstone.tokenId)) {
        // Token is NOT spent - tombstone is invalid
        invalidTombstones.push(tombstone);

        // Find best version to restore
        const bestVersion = walletRepo.getBestArchivedVersion(tombstone.tokenId);
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
   */
  private async sanityCheckMissingTokens(
    localTokens: Token[],
    remoteTokenIds: Set<string>,
    remoteTombstoneIds: Set<string>
  ): Promise<Array<{ tokenId: string; txf: TxfToken }>> {
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
   * Verify integrity invariants after sync operations
   * All spent tokens should have both tombstone and archive entry
   */
  private verifyIntegrityInvariants(walletRepo: WalletRepository): void {
    const tombstones = walletRepo.getTombstones();
    const archivedTokens = walletRepo.getArchivedTokens();
    const activeTokens = walletRepo.getTokens();

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
   */
  private compareTokenVersions(localTxf: TxfToken, remoteTxf: TxfToken): "local" | "remote" | "equal" {
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
   */
  private localDiffersFromRemote(remoteData: TxfStorageData): boolean {
    const walletRepo = WalletRepository.getInstance();
    const localTokens = walletRepo.getTokens();

    // Check if local nametag differs from remote
    const localNametag = walletRepo.getNametag();
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
   */
  private async importRemoteData(remoteTxf: TxfStorageData): Promise<number> {
    const walletRepo = WalletRepository.getInstance();

    // Debug: Log raw tombstones from remote data
    const rawTombstones = (remoteTxf as Record<string, unknown>)._tombstones;
    console.log(`📦 Raw remote _tombstones field:`, rawTombstones);

    const { tokens: remoteTokens, nametag, tombstones: remoteTombstones, archivedTokens: remoteArchived, forkedTokens: remoteForked } = parseTxfStorageData(remoteTxf);

    // Debug: Log parsed tombstones (now TombstoneEntry[])
    console.log(`📦 Parsed remote tombstones (${remoteTombstones.length}):`,
      remoteTombstones.map(t => `${t.tokenId.slice(0, 8)}:${t.stateHash.slice(0, 8)}`));

    // Get local tokens and tombstones
    const localTokens = walletRepo.getWallet()?.tokens || [];
    const localTokenIds = new Set(localTokens.map(t => t.id));
    const localTombstones = walletRepo.getTombstones();

    // Debug: Log local token IDs for comparison
    console.log(`📦 Local token IDs (${localTokenIds.size}):`, [...localTokenIds].map(id => id.slice(0, 8) + '...'));

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
      localTombstones.map(t => `${t.tokenId}:${t.stateHash}`)
    );
    const newTombstones = remoteTombstones.filter(
      t => !localTombstoneKeys.has(`${t.tokenId}:${t.stateHash}`)
    );

    // 5. Sanity check new tombstones with Unicity
    let tokensToRestore: Array<{ tokenId: string; txf: TxfToken }> = [];
    let validTombstones = newTombstones;

    if (newTombstones.length > 0) {
      console.log(`📦 Sanity checking ${newTombstones.length} new tombstone(s) with Unicity...`);
      const result = await this.sanityCheckTombstones(newTombstones, walletRepo);
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
      const remoteTxf = tokenToTxf(remoteToken);
      if (!remoteTxf) continue;

      const tokenId = remoteTxf.genesis.data.tokenId;
      const stateHash = getCurrentStateHash(remoteTxf);

      // Skip if this specific state is tombstoned
      const tombstoneKey = `${tokenId}:${stateHash}`;
      if (allTombstoneKeys.has(tombstoneKey)) {
        console.log(`📦 Skipping tombstoned token ${tokenId.slice(0, 8)}... state ${stateHash.slice(0, 8)}... from remote`);
        continue;
      }

      const localToken = localTokenMap.get(tokenId);

      if (!localToken) {
        // NEW token - import it
        walletRepo.addToken(remoteToken);
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
          if (localStateHash !== stateHash) {
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
          if (remoteStateHash !== localStateHash) {
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

    // Import nametag if local doesn't have one
    if (nametag && !walletRepo.getNametag()) {
      walletRepo.setNametag(nametag);
      console.log(`📦 Imported nametag "${nametag.name}" from remote`);
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
    this.verifyIntegrityInvariants(walletRepo);

    return importedCount;
  }

  // ==========================================
  // Storage Operations
  // ==========================================

  /**
   * Schedule a debounced sync
   * If sync is currently running, marks pendingSync flag for execution after current sync completes
   */
  private scheduleSync(): void {
    // If a sync is already running, mark pending so it will run after completion
    if (this.isSyncing) {
      console.log(`📦 Sync in progress - marking pending sync for after completion`);
      this.pendingSync = true;
      return;
    }

    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
    }
    this.syncTimer = setTimeout(() => {
      this.syncNow().catch(console.error);
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

    // Set initial syncing flag for UI feedback
    this.isInitialSyncing = true;
    this.emitSyncStateChange();

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
    let remoteData: TxfStorageData | null = null;

    if (resolution.best?._cachedContent && resolution.best.cid === cidToFetch) {
      // Use cached content from gateway path resolution (fast path)
      remoteData = resolution.best._cachedContent;
      console.log(`📦 Using cached content from gateway path (avoided re-fetch)`);
    } else {
      // Fetch content via IPFS
      remoteData = await this.fetchRemoteContent(cidToFetch);
    }

    if (!remoteData) {
      // Could not fetch remote content - republish local
      // Force IPNS publish if IPNS was empty (recovery scenario)
      console.warn(`📦 Failed to fetch remote content (CID: ${cidToFetch.slice(0, 16)}...), will republish local`);
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

      // If IPNS needs recovery, force publish even though we just imported
      if (ipnsNeedsRecovery) {
        console.log(`📦 Content imported but IPNS needs recovery - publishing to IPNS`);
        return this.syncNow({ forceIpnsPublish: true });
      }

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
        window.dispatchEvent(new Event("wallet-updated"));
      }

      // Only sync if local differs from remote (has unique tokens or better versions)
      if (this.localDiffersFromRemote(remoteData)) {
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

      // If IPNS needs recovery, force publish even though content is synced
      if (ipnsNeedsRecovery) {
        console.log(`📦 Content synced but IPNS needs recovery - publishing to IPNS`);
        return this.syncNow({ forceIpnsPublish: true });
      }

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
      this.emitSyncStateChange();
    }
  }

  /**
   * Perform immediate sync to IPFS with TXF format and validation
   * Uses SyncCoordinator for cross-tab coordination to prevent race conditions
   * @param options.forceIpnsPublish Force IPNS publish even if CID unchanged (for recovery when IPNS expired)
   */
  async syncNow(options?: { forceIpnsPublish?: boolean }): Promise<StorageResult> {
    const { forceIpnsPublish = false } = options || {};
    // Use SyncCoordinator to acquire distributed lock across browser tabs
    const coordinator = getSyncCoordinator();

    if (this.isSyncing) {
      return {
        success: false,
        timestamp: Date.now(),
        error: "Sync already in progress",
      };
    }

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
        throw new Error("No wallet found");
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

      // 2. Validate tokens before sync
      const validationService = getTokenValidationService();
      const { validTokens, issues } = await validationService.validateAllTokens(wallet.tokens);

      if (issues.length > 0) {
        console.warn(`📦 ${issues.length} token(s) failed validation and will be excluded:`,
          issues.map(i => `${i.tokenId.slice(0, 8)}...: ${i.reason}`).join(", "));
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
              const localTxf = buildTxfStorageData(validTokens, localMeta, nametag || undefined, localTombstones);

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
                    walletRepo.addToken(token);
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
                }
              }

              // Merge archived and forked tokens from remote
              const { archivedTokens: remoteArchived, forkedTokens: remoteForked } = parseTxfStorageData(remoteTxf);
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

              // Also sync nametag from remote if local doesn't have one
              if (!nametag && mergeResult.merged._nametag) {
                walletRepo.setNametag(mergeResult.merged._nametag);
                console.log(`📦 Synced nametag "${mergeResult.merged._nametag.name}" from IPFS to local`);
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

      // 4. Build TXF storage data with incremented version (include tombstones, archives, forks)
      const newVersion = this.incrementVersionCounter();
      const tombstones = walletRepo.getTombstones();
      const archivedTokens = walletRepo.getArchivedTokens();
      const forkedTokens = walletRepo.getForkedTokens();
      const meta: Omit<TxfMeta, "formatVersion"> = {
        version: newVersion,
        address: wallet.address,
        ipnsName: this.cachedIpnsName || "",
        lastCid: this.getLastCid() || undefined,
      };

      const txfStorageData = buildTxfStorageData(tokensToSync, meta, nametag || undefined, tombstones, archivedTokens, forkedTokens);
      if (tombstones.length > 0 || archivedTokens.size > 0 || forkedTokens.size > 0) {
        console.log(`📦 Including ${tombstones.length} tombstone(s), ${archivedTokens.size} archived, ${forkedTokens.size} forked in sync`);
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

      // 4.5. Publish to IPNS only if CID changed (or forced for IPNS recovery)
      const previousCid = this.getLastCid();
      let ipnsPublished = false;
      let ipnsPublishPending = false;
      const shouldPublishIpns = cidString !== previousCid || forceIpnsPublish;
      if (shouldPublishIpns) {
        if (forceIpnsPublish && cidString === previousCid) {
          console.log(`📦 Forcing IPNS republish (CID unchanged but IPNS may be expired)`);
        }
        const ipnsResult = await this.publishToIpns(cid);
        if (ipnsResult) {
          ipnsPublished = true;
          this.clearPendingIpnsPublish(); // Clear any previous pending
        } else {
          // IPNS publish failed - mark as pending for retry
          this.setPendingIpnsPublish(cidString);
          ipnsPublishPending = true;
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

      // Check if a sync was requested while we were busy
      if (this.pendingSync) {
        console.log(`📦 Processing pending sync request that arrived during sync`);
        this.pendingSync = false;
        // Use setTimeout to avoid deep recursion and allow event loop to process
        setTimeout(() => {
          this.scheduleSync();
        }, 100);
      }
    }
  }

  // ==========================================
  // Spent Token Sanity Check
  // ==========================================

  /**
   * Run sanity check to detect and remove spent tokens
   * Called during each IPNS poll cycle
   */
  private async runSpentTokenSanityCheck(): Promise<void> {
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
   * Get the deterministic IPNS name for this wallet
   * Returns a proper PeerId-based IPNS name
   */
  async getIpnsName(): Promise<string | null> {
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

  // ==========================================
  // TXF Import/Export
  // ==========================================

  /**
   * Export all tokens as TXF file content
   */
  async exportAsTxf(): Promise<{ success: boolean; data?: string; filename?: string; error?: string }> {
    try {
      const wallet = WalletRepository.getInstance().getWallet();
      if (!wallet) {
        return { success: false, error: "No wallet found" };
      }

      // Import serializer
      const { buildTxfExportFile } = await import("./TxfSerializer");
      const txfData = buildTxfExportFile(wallet.tokens);

      const filename = `tokens-${wallet.address.slice(0, 8)}-${Date.now()}.txf`;
      const jsonString = JSON.stringify(txfData, null, 2);

      console.log(`📦 Exported ${wallet.tokens.length} tokens as TXF`);

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
