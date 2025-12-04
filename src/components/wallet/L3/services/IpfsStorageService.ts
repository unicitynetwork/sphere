import { createHelia, type Helia } from "helia";
import { json } from "@helia/json";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import * as ed from "@noble/ed25519";
import { WalletRepository } from "../../../../repositories/WalletRepository";
import type { IdentityManager } from "./IdentityManager";
import type { Token } from "../data/model";

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
  error?: string;
}

export interface RestoreResult {
  success: boolean;
  tokens?: Token[];
  timestamp: number;
  error?: string;
}

export interface StorageStatus {
  initialized: boolean;
  isSyncing: boolean;
  lastSync: StorageResult | null;
  ipnsName: string | null;
}

interface StorageData {
  version: number;
  timestamp: number;
  address: string;
  tokens: SerializedToken[];
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
const STORAGE_VERSION = 1;

// ==========================================
// IpfsStorageService
// ==========================================

export class IpfsStorageService {
  private static instance: IpfsStorageService | null = null;

  private helia: Helia | null = null;
  private ed25519PrivateKey: Uint8Array | null = null;
  private ed25519PublicKey: Uint8Array | null = null;
  private cachedIpnsName: string | null = null;

  private identityManager: IdentityManager;
  private eventCallbacks: StorageEventCallback[] = [];

  private isInitializing = false;
  private isSyncing = false;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSync: StorageResult | null = null;

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
   */
  startAutoSync(): void {
    window.addEventListener("wallet-updated", () => this.scheduleSync());
    console.log("📦 IPFS auto-sync enabled");
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = null;
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
      this.ed25519PublicKey = await ed.getPublicKeyAsync(derivedKey);

      // 3. Compute IPNS name from public key
      this.cachedIpnsName = this.computeIpnsName(this.ed25519PublicKey);

      // 4. Initialize Helia (browser IPFS)
      console.log("📦 Initializing Helia...");
      this.helia = await createHelia();

      console.log("📦 IPFS storage service initialized");
      console.log("📦 IPNS name:", this.cachedIpnsName);
      return true;
    } catch (error) {
      console.error("📦 Failed to initialize IPFS storage:", error);
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
   * Compute IPNS name from Ed25519 public key
   * Format: Base36-encoded CIDv1 of the public key
   */
  private computeIpnsName(publicKey: Uint8Array): string {
    // For now, use hex-encoded public key as identifier
    // In production, this would be a proper CIDv1/PeerId
    return `ipns-${this.bytesToHex(publicKey).slice(0, 32)}`;
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
   * Perform immediate sync to IPFS
   */
  async syncNow(): Promise<StorageResult> {
    if (this.isSyncing) {
      return {
        success: false,
        timestamp: Date.now(),
        error: "Sync already in progress",
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

      const tokens = wallet.tokens;
      console.log(`📦 Syncing ${tokens.length} tokens to IPFS...`);

      // 2. Serialize to storage format
      const storageData: StorageData = {
        version: STORAGE_VERSION,
        timestamp: Date.now(),
        address: wallet.address,
        tokens: tokens.map((t) => ({
          id: t.id,
          name: t.name,
          symbol: t.symbol,
          amount: t.amount,
          coinId: t.coinId,
          jsonData: t.jsonData,
          status: t.status,
          timestamp: t.timestamp,
          type: t.type,
          iconUrl: t.iconUrl,
        })),
      };

      // 3. Store to IPFS
      const j = json(this.helia);
      const cid = await j.add(storageData);
      const cidString = cid.toString();
      console.log(`📦 Tokens stored to IPFS: ${cidString}`);

      // 4. Publish to IPNS
      // Note: Full IPNS publishing requires libp2p key management
      // For MVP, we log the CID and emit events for external systems
      console.log(`📦 CID for IPNS publication: ${cidString}`);
      console.log(`📦 IPNS name: ${this.cachedIpnsName}`);

      const result: StorageResult = {
        success: true,
        cid: cidString,
        ipnsName: this.cachedIpnsName || undefined,
        timestamp: Date.now(),
      };

      this.lastSync = result;

      await this.emitEvent({
        type: "storage:completed",
        timestamp: Date.now(),
        data: {
          cid: cidString,
          ipnsName: this.cachedIpnsName || undefined,
          tokenCount: tokens.length,
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
    }
  }

  // ==========================================
  // Restore Operations
  // ==========================================

  /**
   * Restore tokens from IPFS using CID
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

      const storageData = (await j.get(parsedCid)) as StorageData;

      if (!storageData || storageData.version !== STORAGE_VERSION) {
        throw new Error("Invalid or incompatible storage data");
      }

      console.log(`📦 Restored ${storageData.tokens.length} tokens from IPFS`);

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
        timestamp: Date.now(),
      };
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

  // ==========================================
  // Status & Getters
  // ==========================================

  /**
   * Get the deterministic IPNS name for this wallet
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

    const walletSecret = this.hexToBytes(identity.privateKey);
    const derivedKey = hkdf(sha256, walletSecret, undefined, HKDF_INFO, 32);
    const publicKey = await ed.getPublicKeyAsync(derivedKey);

    this.cachedIpnsName = this.computeIpnsName(publicKey);
    return this.cachedIpnsName;
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
    };
  }

  /**
   * Check if currently syncing
   */
  isCurrentlySyncing(): boolean {
    return this.isSyncing;
  }
}
