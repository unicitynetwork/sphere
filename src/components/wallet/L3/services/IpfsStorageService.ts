import { createHelia, type Helia } from "helia";
import { json } from "@helia/json";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { sha512 } from "@noble/hashes/sha512";
import * as ed from "@noble/ed25519";
import { WalletRepository, type NametagData } from "../../../../repositories/WalletRepository";
import type { IdentityManager } from "./IdentityManager";
import type { Token } from "../data/model";
import type { TxfStorageData, TxfMeta } from "./types/TxfTypes";
import { buildTxfStorageData, parseTxfStorageData } from "./TxfSerializer";
import { getTokenValidationService } from "./TokenValidationService";
// ConflictResolutionService will be used for remote conflict detection
// import { getConflictResolutionService } from "./ConflictResolutionService";

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
   * Compute IPNS name from Ed25519 public key
   * Format: Base36-encoded CIDv1 of the public key
   */
  private computeIpnsName(publicKey: Uint8Array): string {
    // For now, use hex-encoded public key as identifier
    // In production, this would be a proper CIDv1/PeerId
    return `ipns-${this.bytesToHex(publicKey).slice(0, 32)}`;
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
   * Perform immediate sync to IPFS with TXF format and validation
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

      // 3. Build TXF storage data with incremented version
      const newVersion = this.incrementVersionCounter();
      const meta: Omit<TxfMeta, "formatVersion"> = {
        version: newVersion,
        timestamp: Date.now(),
        address: wallet.address,
        ipnsName: this.cachedIpnsName || "",
        lastCid: this.getLastCid() || undefined,
      };

      const txfStorageData = buildTxfStorageData(validTokens, meta, nametag || undefined);

      // 4. Store to IPFS
      const j = json(this.helia);
      const cid = await j.add(txfStorageData);
      const cidString = cid.toString();

      // 5. Store CID for recovery
      this.setLastCid(cidString);

      console.log(`📦 Tokens stored to IPFS (v${newVersion}): ${cidString}`);
      console.log(`📦 IPNS name: ${this.cachedIpnsName}`);

      const result: StorageResult = {
        success: true,
        cid: cidString,
        ipnsName: this.cachedIpnsName || undefined,
        timestamp: Date.now(),
        version: newVersion,
        tokenCount: validTokens.length,
        validationIssues: issues.length > 0 ? issues.map(i => i.reason) : undefined,
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
        const { tokens, meta, nametag } = parseTxfStorageData(txfData);

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
      const publicKey = ed.getPublicKey(derivedKey);

      this.cachedIpnsName = this.computeIpnsName(publicKey);
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

      const parsedTokens = parseTxfFile(txfData);

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
