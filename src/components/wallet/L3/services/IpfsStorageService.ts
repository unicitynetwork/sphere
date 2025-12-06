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
import type { PrivateKey } from "@libp2p/interface";
import { WalletRepository, type NametagData } from "../../../../repositories/WalletRepository";
import type { IdentityManager } from "./IdentityManager";
import type { Token } from "../data/model";
import type { TxfStorageData, TxfMeta, TxfToken } from "./types/TxfTypes";
import { buildTxfStorageData, parseTxfStorageData, txfToToken } from "./TxfSerializer";
import { getTokenValidationService } from "./TokenValidationService";
import { getConflictResolutionService } from "./ConflictResolutionService";
import { getSyncCoordinator } from "./SyncCoordinator";
// Note: retryWithBackoff was used for DHT publish, now handled by HTTP primary path
import { getBootstrapPeers, getConfiguredCustomPeers, getBackendPeerId, getAllBackendGatewayUrls } from "../../../../config/ipfs.config";

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
  | "ipns:published";

export interface StorageEvent {
  type: StorageEventType;
  timestamp: number;
  data?: {
    cid?: string;
    ipnsName?: string;
    tokenCount?: number;
    error?: string;
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
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSync: StorageResult | null = null;
  private autoSyncEnabled = false;
  private boundSyncHandler: (() => void) | null = null;
  private connectionMaintenanceInterval: ReturnType<typeof setInterval> | null = null;

  private constructor(identityManager: IdentityManager) {
    this.identityManager = identityManager;
  }

  static getInstance(identityManager: IdentityManager): IpfsStorageService {
    if (!IpfsStorageService.instance) {
      IpfsStorageService.instance = new IpfsStorageService(identityManager);
    }
    return IpfsStorageService.instance;
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

    // Call registered callbacks (for future Nostr integration)
    for (const callback of this.eventCallbacks) {
      try {
        await callback(event);
      } catch (error) {
        console.error("📦 Storage event callback error:", error);
      }
    }
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
   */
  private async ensureInitialized(): Promise<boolean> {
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

      // 1. Get wallet identity
      const identity = await this.identityManager.getCurrentIdentity();
      if (!identity) {
        console.warn("📦 No wallet identity - skipping IPFS init");
        return false;
      }

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
      this.migrateStorageKeys(oldIpnsName, newIpnsName);

      // Load last IPNS sequence number from storage
      this.ipnsSequenceNumber = this.getIpnsSequenceNumber();

      // 4. Initialize Helia (browser IPFS) with custom bootstrap peers
      const bootstrapPeers = getBootstrapPeers();
      const customPeerCount = getConfiguredCustomPeers().length;

      console.log("📦 Initializing Helia with custom peers...");
      console.log(`📦 Bootstrap peers: ${bootstrapPeers.length} total (${customPeerCount} custom, ${bootstrapPeers.length - customPeerCount} default)`);

      this.helia = await createHelia({
        libp2p: {
          peerDiscovery: [
            bootstrap({ list: bootstrapPeers }),
          ],
          connectionManager: {
            maxConnections: 50,
          },
        },
      });

      // Log browser's peer ID for debugging
      const browserPeerId = this.helia.libp2p.peerId.toString();
      console.log("📦 IPFS storage service initialized");
      console.log("📦 Browser Peer ID:", browserPeerId);
      console.log("📦 IPNS name:", this.cachedIpnsName);

      // Set up peer connection event handlers for debugging
      this.helia.libp2p.addEventListener("peer:connect", (event) => {
        const remotePeerId = event.detail.toString();
        console.log(`📦 Connected to peer: ${remotePeerId.slice(0, 16)}...`);
      });

      this.helia.libp2p.addEventListener("peer:disconnect", (event) => {
        const remotePeerId = event.detail.toString();
        console.log(`📦 Disconnected from peer: ${remotePeerId.slice(0, 16)}...`);
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

    const IPNS_LIFETIME = 24 * 60 * 60 * 1000; // 24 hours in ms
    const ipnsKeyPair = this.ipnsKeyPair;

    try {
      console.log(
        `📦 Publishing to IPNS: ${this.cachedIpnsName?.slice(0, 16)}... -> ${cid.toString().slice(0, 16)}...`
      );

      // Increment sequence number for new record
      this.ipnsSequenceNumber++;

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

  /**
   * Resolve IPNS name to CID using DHT
   * Uses low-level ipns package to fetch and parse records via DHT routing
   * Returns the CID that our IPNS name points to, or null if resolution fails
   */
  private async resolveIpns(): Promise<string | null> {
    if (!this.helia || !this.ipnsKeyPair) {
      return null;
    }

    const IPNS_RESOLVE_TIMEOUT = 30000; // 30 seconds - DHT can be slow

    try {
      console.log(`📦 Resolving IPNS: ${this.cachedIpnsName?.slice(0, 16)}...`);

      // Create the routing key from our public key
      const routingKey = multihashToIPNSRoutingKey(this.ipnsKeyPair.publicKey.toMultihash());

      // Fetch the record from DHT with timeout
      const recordData = await Promise.race([
        this.helia.routing.get(routingKey),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("IPNS resolve timeout")), IPNS_RESOLVE_TIMEOUT)
        ),
      ]);

      // Unmarshal the IPNS record
      const record = unmarshalIPNSRecord(recordData);

      // Extract the value (path) from the record
      // The value is typically "/ipfs/CID" and is already a string
      const valueStr = record.value;
      console.log(`📦 IPNS record value: ${valueStr}`);

      // Extract CID from path (remove "/ipfs/" prefix)
      const cidMatch = valueStr.match(/^\/ipfs\/(.+)$/);
      if (!cidMatch) {
        console.warn(`📦 IPNS value is not an IPFS path: ${valueStr}`);
        return null;
      }

      const cidString = cidMatch[1];
      console.log(`📦 IPNS resolved to: ${cidString.slice(0, 16)}...`);
      return cidString;
    } catch (error) {
      // Non-fatal - can fall back to local lastCid
      console.warn(`📦 IPNS resolution failed (non-fatal):`, error);
      return null;
    }
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

  /**
   * Import remote data into local storage
   * - Imports tokens that don't exist locally (unless tombstoned)
   * - Removes local tokens that are tombstoned in remote
   * - Merges tombstones from remote
   * - Imports nametag if local doesn't have one
   */
  private async importRemoteData(remoteTxf: TxfStorageData): Promise<number> {
    const walletRepo = WalletRepository.getInstance();
    const { tokens, nametag, tombstones: remoteTombstones } = parseTxfStorageData(remoteTxf);

    // Get local tokens and tombstones
    const localTokens = walletRepo.getWallet()?.tokens || [];
    const localTokenIds = new Set(localTokens.map(t => t.id));
    const localTombstones = new Set(walletRepo.getTombstones());

    let importedCount = 0;

    // 1. Merge tombstones - this removes local tokens that are in remote tombstones
    if (remoteTombstones.length > 0) {
      const removedCount = walletRepo.mergeTombstones(remoteTombstones);
      if (removedCount > 0) {
        console.log(`📦 Removed ${removedCount} tombstoned token(s) from local`);
      }
    }

    // 2. Import tokens not in local storage (and not in any tombstone list)
    const allTombstones = new Set([...localTombstones, ...remoteTombstones]);
    for (const token of tokens) {
      // Skip if already in local
      if (localTokenIds.has(token.id)) {
        continue;
      }

      // Skip if tombstoned (deleted on any device)
      if (allTombstones.has(token.id)) {
        console.log(`📦 Skipping tombstoned token ${token.id.slice(0, 8)}... from remote`);
        continue;
      }

      walletRepo.addToken(token);
      console.log(`📦 Imported token ${token.id.slice(0, 8)}... from remote`);
      importedCount++;
    }

    // 3. Import nametag if local doesn't have one
    if (nametag && !walletRepo.getNametag()) {
      walletRepo.setNametag(nametag);
      console.log(`📦 Imported nametag "${nametag.name}" from remote`);
    }

    // 4. Prune old tombstones to prevent unlimited growth
    walletRepo.pruneTombstones();

    return importedCount;
  }

  // ==========================================
  // Storage Operations
  // ==========================================

  /**
   * Schedule a debounced sync
   */
  private scheduleSync(): void {
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
    }
    this.syncTimer = setTimeout(() => {
      this.syncNow().catch(console.error);
    }, SYNC_DEBOUNCE_MS);
  }

  /**
   * Sync from IPNS on startup - resolves IPNS and merges with local state
   * This ensures we have the latest state from DHT before making changes
   *
   * Flow:
   * 0. Retry any pending IPNS publishes from previous failed syncs
   * 1. Resolve IPNS to get remote CID
   * 2. Compare with local CID - if different, fetch remote content
   * 3. Version comparison: remote > local → import; local > remote → sync to update IPNS
   * 4. Always verify remote is fetchable (handles interrupted syncs)
   * 5. If fetch fails, fall back to normal sync (republish local)
   */
  async syncFromIpns(): Promise<StorageResult> {
    console.log(`📦 Starting IPNS-based sync...`);

    const initialized = await this.ensureInitialized();
    if (!initialized) {
      console.warn(`📦 Not initialized, skipping IPNS sync`);
      return { success: false, timestamp: Date.now(), error: "Not initialized" };
    }

    // 0. Retry any pending IPNS publishes from previous failed syncs
    await this.retryPendingIpnsPublish();

    // 1. Resolve IPNS to get remote CID from DHT
    const remoteCid = await this.resolveIpns();
    const localCid = this.getLastCid();

    console.log(`📦 IPNS sync: remote=${remoteCid?.slice(0, 16) || 'none'}..., local=${localCid?.slice(0, 16) || 'none'}...`);

    // 2. Determine which CID to fetch
    const cidToFetch = remoteCid || localCid;

    if (!cidToFetch) {
      // Fresh wallet - no IPNS record and no local CID
      console.log(`📦 No IPNS record or local CID - fresh wallet, triggering initial sync`);
      return this.syncNow();
    }

    // 3. Check if remote CID differs from local (another device may have updated IPNS)
    if (remoteCid && remoteCid !== localCid) {
      console.log(`📦 IPNS CID differs from local! Remote may have been updated from another device`);
    }

    // 4. Always try to fetch and verify remote content
    // This handles cases where previous sync was interrupted
    const remoteData = await this.fetchRemoteContent(cidToFetch);

    if (!remoteData) {
      // Could not fetch remote content - republish local
      console.warn(`📦 Failed to fetch remote content (CID: ${cidToFetch.slice(0, 16)}...), will republish local`);
      return this.syncNow();
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

      return {
        success: true,
        cid: cidToFetch,
        ipnsName: this.cachedIpnsName || undefined,
        timestamp: Date.now(),
        version: remoteVersion,
      };
    } else if (remoteVersion < localVersion) {
      // Local is newer - need to update IPNS
      console.log(`📦 Local is newer (v${localVersion} > v${remoteVersion}), updating IPNS...`);
      return this.syncNow();
    } else {
      // Same version - remote is in sync
      // Still update lastCid to match IPNS if resolved
      if (remoteCid && remoteCid !== localCid) {
        this.setLastCid(remoteCid);
        console.log(`📦 Updated local CID to match IPNS`);
      }

      console.log(`📦 Versions match (v${remoteVersion}), remote verified accessible`);
      return {
        success: true,
        cid: cidToFetch,
        ipnsName: this.cachedIpnsName || undefined,
        timestamp: Date.now(),
        version: remoteVersion,
      };
    }
  }

  /**
   * Perform immediate sync to IPFS with TXF format and validation
   * Uses SyncCoordinator for cross-tab coordination to prevent race conditions
   */
  async syncNow(): Promise<StorageResult> {
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
                timestamp: Date.now(),
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
              const localTokenIds = validTokens.map(t => t.id).sort().join(",");
              // TXF format stores tokens as _tokenId keys
              const remoteTokenIds = Object.keys(remoteTxf)
                .filter(k => k.startsWith("_") && k !== "_meta" && k !== "_nametag")
                .map(k => k.slice(1))
                .sort()
                .join(",");

              if (localTokenIds === remoteTokenIds) {
                // No changes - remote was verified accessible by startup syncFromIpns()
                // Skip re-upload for this wallet-updated event
                console.log(`📦 Remote is in sync (v${remoteVersion}) - no changes to upload`);
                this.isSyncing = false;
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
              console.log(`📦 Remote version matches but local has token changes - uploading...`);
            }
          }
        } catch (err) {
          console.warn(`📦 Could not fetch remote for conflict check:`, err instanceof Error ? err.message : err);
          // Continue with local data
        }
      }

      // 4. Build TXF storage data with incremented version (include tombstones)
      const newVersion = this.incrementVersionCounter();
      const tombstones = walletRepo.getTombstones();
      const meta: Omit<TxfMeta, "formatVersion"> = {
        version: newVersion,
        timestamp: Date.now(),
        address: wallet.address,
        ipnsName: this.cachedIpnsName || "",
        lastCid: this.getLastCid() || undefined,
      };

      const txfStorageData = buildTxfStorageData(tokensToSync, meta, nametag || undefined, tombstones);
      if (tombstones.length > 0) {
        console.log(`📦 Including ${tombstones.length} tombstone(s) in sync`);
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

      // 4.5. Publish to IPNS only if CID changed
      const previousCid = this.getLastCid();
      let ipnsPublished = false;
      let ipnsPublishPending = false;
      if (cidString !== previousCid) {
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
      // Release cross-tab lock
      coordinator.releaseLock();
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
      isSyncing: this.isSyncing,
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
    return this.isSyncing;
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
