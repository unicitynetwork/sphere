/**
 * ChatHistoryIpfsService - IPFS storage for agent chat history
 *
 * Uses the same IPFS infrastructure as token storage (Helia + custom bootstrap peers)
 * but stores chat data under a separate IPNS namespace derived from the wallet identity.
 *
 * Storage structure in IPFS:
 * {
 *   _meta: { version, timestamp, address },
 *   sessions: { [sessionId]: ChatSession },
 *   messages: { [sessionId]: ChatMessage[] },
 *   tombstones: { [sessionId]: { deletedAt, reason } }
 * }
 */

import { createHelia, type Helia } from "helia";
import { json } from "@helia/json";
import { bootstrap } from "@libp2p/bootstrap";
import { generateKeyPairFromSeed } from "@libp2p/crypto/keys";
import { peerIdFromPrivateKey } from "@libp2p/peer-id";
import { createIPNSRecord, marshalIPNSRecord, unmarshalIPNSRecord } from "ipns";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import type { CID } from "multiformats/cid";
import type { PrivateKey } from "@libp2p/interface";
import { IdentityManager } from "../../wallet/L3/services/IdentityManager";
import { getBootstrapPeers, getAllBackendGatewayUrls, IPNS_RESOLUTION_CONFIG, IPFS_CONFIG } from "../../../config/ipfs.config";
import type { ChatSession } from "./ChatHistoryRepository";
import type { ChatMessage } from "../../../hooks/useAgentChat";
import { STORAGE_KEYS, STORAGE_KEY_GENERATORS } from "../../../config/storageKeys";

// ==========================================
// Types
// ==========================================

interface ChatHistoryStorageData {
  _meta: {
    version: number;
    timestamp: number;
    address: string;
    type: "chat-history";
  };
  sessions: Record<string, ChatSession>;
  messages: Record<string, ChatMessage[]>;
  tombstones: Record<string, ChatTombstone>;
}

interface ChatTombstone {
  sessionId: string;
  deletedAt: number;
  reason: "user-deleted" | "clear-all";
}

export interface ChatSyncResult {
  success: boolean;
  cid?: string;
  ipnsName?: string;
  timestamp: number;
  sessionCount?: number;
  error?: string;
}

export type SyncStep =
  | 'idle'
  | 'initializing'
  | 'resolving-ipns'
  | 'fetching-content'
  | 'importing-data'
  | 'building-data'
  | 'uploading'
  | 'publishing-ipns'
  | 'complete'
  | 'error';

export interface ChatSyncStatus {
  initialized: boolean;
  isSyncing: boolean;
  hasPendingSync: boolean; // True when sync is scheduled but not yet started (debounce period)
  lastSync: ChatSyncResult | null;
  ipnsName: string | null;
  currentStep: SyncStep;
  stepProgress?: string; // Optional detail for current step
}

// ==========================================
// Constants
// ==========================================

// Different HKDF info string creates a separate key for chat storage
const HKDF_INFO_CHAT = "ipfs-chat-history-ed25519-v1";
const SYNC_DEBOUNCE_MS = 3000;
const TOMBSTONE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// ==========================================
// ChatHistoryIpfsService
// ==========================================

export class ChatHistoryIpfsService {
  private static instance: ChatHistoryIpfsService | null = null;

  private helia: Helia | null = null;
  private ed25519PrivateKey: Uint8Array | null = null;
  private cachedIpnsName: string | null = null;
  private ipnsKeyPair: PrivateKey | null = null;
  private ipnsSequenceNumber: bigint = 0n;

  private identityManager: IdentityManager;

  private isInitializing = false;
  private isSyncing = false;
  private pendingSync = false;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSync: ChatSyncResult | null = null;
  private autoSyncEnabled = false;
  private boundSyncHandler: (() => void) | null = null;
  private boundBeforeUnloadHandler: (() => void) | null = null;
  private currentIdentityAddress: string | null = null;
  private lastKnownRemoteSequence: bigint = 0n;
  private hasPendingChanges = false;
  private currentStep: SyncStep = 'idle';
  private stepProgress: string = '';
  private statusListeners: Set<() => void> = new Set();

  private constructor(identityManager: IdentityManager) {
    this.identityManager = identityManager;
  }

  static getInstance(): ChatHistoryIpfsService {
    if (!ChatHistoryIpfsService.instance) {
      ChatHistoryIpfsService.instance = new ChatHistoryIpfsService(IdentityManager.getInstance());
    }
    return ChatHistoryIpfsService.instance;
  }

  static async resetInstance(): Promise<void> {
    if (ChatHistoryIpfsService.instance) {
      console.log("💬 Resetting ChatHistoryIpfsService instance...");
      await ChatHistoryIpfsService.instance.shutdown();
      ChatHistoryIpfsService.instance = null;
    }
  }

  // ==========================================
  // Lifecycle
  // ==========================================

  startAutoSync(): void {
    if (this.autoSyncEnabled) {
      return;
    }

    // Clean up old tombstones on startup (once per session)
    this.cleanupOldTombstones();

    this.boundSyncHandler = () => {
      this.hasPendingChanges = true;
      this.scheduleSync();
    };
    window.addEventListener("agent-chat-history-updated", this.boundSyncHandler);

    // Add beforeunload handler to sync pending changes before page close
    this.boundBeforeUnloadHandler = () => {
      if (this.hasPendingChanges && this.syncTimer) {
        console.log("💬 Page closing - triggering immediate sync");
        clearTimeout(this.syncTimer);
        this.syncTimer = null;
        // Use sendBeacon for reliable sync on page close
        this.syncBeforeUnload();
      }
    };
    window.addEventListener("beforeunload", this.boundBeforeUnloadHandler);

    this.autoSyncEnabled = true;
    console.log("💬 Chat history IPFS auto-sync enabled");

    // On startup, sync from IPNS to discover remote state
    this.syncFromIpns().catch(console.error);
  }

  /**
   * Sync data before page unload using synchronous approach
   * Note: This is best-effort - async operations may not complete
   */
  private syncBeforeUnload(): void {
    // Build storage data synchronously
    const storageData = this.buildStorageData();
    const jsonBlob = JSON.stringify(storageData);

    // Try to use sendBeacon for reliable delivery
    const gatewayUrls = getAllBackendGatewayUrls();
    if (gatewayUrls.length > 0 && navigator.sendBeacon) {
      const formData = new FormData();
      formData.append("file", new Blob([jsonBlob], { type: "application/json" }));

      // Send to first available gateway
      const url = `${gatewayUrls[0]}/api/v0/add?pin=true&cid-version=1`;
      const sent = navigator.sendBeacon(url, formData);
      console.log(`💬 sendBeacon sync: ${sent ? 'sent' : 'failed'}`);
    }
  }

  async shutdown(): Promise<void> {
    if (this.boundSyncHandler) {
      window.removeEventListener("agent-chat-history-updated", this.boundSyncHandler);
      this.boundSyncHandler = null;
    }
    if (this.boundBeforeUnloadHandler) {
      window.removeEventListener("beforeunload", this.boundBeforeUnloadHandler);
      this.boundBeforeUnloadHandler = null;
    }
    this.autoSyncEnabled = false;

    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }
    if (this.helia) {
      await this.helia.stop();
      this.helia = null;
    }
    console.log("💬 Chat history IPFS service stopped");
  }

  // ==========================================
  // Initialization
  // ==========================================

  private isWebCryptoAvailable(): boolean {
    try {
      return typeof crypto !== "undefined" &&
             crypto.subtle !== undefined &&
             typeof crypto.subtle.digest === "function";
    } catch {
      return false;
    }
  }

  private async ensureInitialized(): Promise<boolean> {
    const identity = await this.identityManager.getCurrentIdentity();
    if (!identity) {
      console.warn("💬 No wallet identity - skipping chat IPFS init");
      return false;
    }

    // Re-derive keys if identity changed
    if (this.currentIdentityAddress && this.currentIdentityAddress !== identity.address) {
      console.log(`💬 Identity changed, clearing cached keys`);
      this.ed25519PrivateKey = null;
      this.ipnsKeyPair = null;
      this.cachedIpnsName = null;
      this.ipnsSequenceNumber = 0n;
    }

    if (this.helia && this.ed25519PrivateKey) {
      return true;
    }

    if (this.isInitializing) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return this.ensureInitialized();
    }

    this.isInitializing = true;

    try {
      if (!this.isWebCryptoAvailable()) {
        console.warn("💬 WebCrypto not available - chat IPFS sync disabled");
        return false;
      }

      // Derive Ed25519 key from wallet secret with CHAT-SPECIFIC info string
      const walletSecret = this.hexToBytes(identity.privateKey);
      const derivedKey = hkdf(
        sha256,
        walletSecret,
        undefined,
        HKDF_INFO_CHAT, // Different from token storage!
        32
      );
      this.ed25519PrivateKey = derivedKey;

      // Generate libp2p key pair for IPNS
      this.ipnsKeyPair = await generateKeyPairFromSeed("Ed25519", derivedKey);
      const ipnsPeerId = peerIdFromPrivateKey(this.ipnsKeyPair);
      this.cachedIpnsName = ipnsPeerId.toString();
      this.currentIdentityAddress = identity.address;

      // Load stored IPNS sequence number
      this.ipnsSequenceNumber = this.getIpnsSequenceNumber();

      // Initialize Helia
      const bootstrapPeers = getBootstrapPeers();
      console.log("💬 Initializing Helia for chat history...");

      this.helia = await createHelia({
        libp2p: {
          peerDiscovery: [bootstrap({ list: bootstrapPeers })],
          connectionManager: {
            maxConnections: IPFS_CONFIG.maxConnections,
          },
        },
      });

      console.log("💬 Chat history IPFS service initialized");
      console.log("💬 Chat IPNS name:", this.cachedIpnsName);

      return true;
    } catch (error) {
      console.error("💬 Failed to initialize chat IPFS:", error);
      return false;
    } finally {
      this.isInitializing = false;
    }
  }

  // ==========================================
  // Key Utilities
  // ==========================================

  private hexToBytes(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return bytes;
  }

  // ==========================================
  // Version & Sequence Management
  // ==========================================

  private getVersionCounter(): number {
    if (!this.cachedIpnsName) return 0;
    const key = STORAGE_KEY_GENERATORS.ipfsChatVersion(this.cachedIpnsName);
    return parseInt(localStorage.getItem(key) || "0", 10);
  }

  private incrementVersionCounter(): number {
    if (!this.cachedIpnsName) return 1;
    const key = STORAGE_KEY_GENERATORS.ipfsChatVersion(this.cachedIpnsName);
    const next = this.getVersionCounter() + 1;
    localStorage.setItem(key, String(next));
    return next;
  }

  private setVersionCounter(version: number): void {
    if (!this.cachedIpnsName) return;
    const key = STORAGE_KEY_GENERATORS.ipfsChatVersion(this.cachedIpnsName);
    localStorage.setItem(key, String(version));
  }

  private getLastCid(): string | null {
    if (!this.cachedIpnsName) return null;
    const key = STORAGE_KEY_GENERATORS.ipfsChatCid(this.cachedIpnsName);
    return localStorage.getItem(key);
  }

  private setLastCid(cid: string): void {
    if (!this.cachedIpnsName) return;
    const key = STORAGE_KEY_GENERATORS.ipfsChatCid(this.cachedIpnsName);
    localStorage.setItem(key, cid);
  }

  private getIpnsSequenceNumber(): bigint {
    if (!this.cachedIpnsName) return 0n;
    const key = STORAGE_KEY_GENERATORS.ipfsChatSeq(this.cachedIpnsName);
    const stored = localStorage.getItem(key);
    return stored ? BigInt(stored) : 0n;
  }

  private setIpnsSequenceNumber(seq: bigint): void {
    if (!this.cachedIpnsName) return;
    const key = STORAGE_KEY_GENERATORS.ipfsChatSeq(this.cachedIpnsName);
    localStorage.setItem(key, seq.toString());
  }

  // ==========================================
  // IPNS Resolution & Publishing
  // ==========================================

  /**
   * Fast path: resolve IPNS via gateway path (cached, ~30ms)
   * Returns CID and content directly
   */
  private async resolveIpnsViaGatewayPath(gatewayUrl: string): Promise<{
    cid: string;
    content: ChatHistoryStorageData;
  } | null> {
    if (!this.cachedIpnsName) return null;

    const hostname = new URL(gatewayUrl).hostname;
    const GATEWAY_PATH_TIMEOUT = 5000;

    console.log(`💬 Gateway path ${hostname}: trying /ipns/${this.cachedIpnsName?.slice(0, 16)}...`);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), GATEWAY_PATH_TIMEOUT);

      const url = `${gatewayUrl}/ipns/${this.cachedIpnsName}?format=dag-json`;
      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        headers: { Accept: "application/vnd.ipld.dag-json, application/json" },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.log(`💬 Gateway path ${hostname}: HTTP ${response.status}`);
        return null;
      }

      const content = await response.json() as ChatHistoryStorageData;

      // Validate it's our chat format
      if (!content._meta || content._meta.type !== "chat-history") {
        console.log(`💬 Gateway path ${hostname}: not chat-history format, got:`, content._meta);
        return null;
      }

      // Extract CID from response headers or URL
      const cidHeader = response.headers.get("X-Ipfs-Path");
      let cid = "";
      if (cidHeader) {
        const match = cidHeader.match(/\/ipfs\/([^/]+)/);
        if (match) cid = match[1];
      }

      console.log(`💬 Gateway path ${hostname}: SUCCESS - got content (v${content._meta.version}), ${Object.keys(content.sessions).length} sessions`);
      return { cid, content };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.log(`💬 Gateway path ${hostname}: error - ${errorMsg}`);
      return null;
    }
  }

  /**
   * Slow path: resolve IPNS via routing API (returns sequence number)
   */
  private async resolveIpnsViaRoutingApi(gatewayUrl: string): Promise<{
    cid: string;
    sequence: bigint;
  } | null> {
    if (!this.cachedIpnsName) return null;

    const hostname = new URL(gatewayUrl).hostname;
    console.log(`💬 Routing API ${hostname}: trying...`);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        IPNS_RESOLUTION_CONFIG.perGatewayTimeoutMs
      );

      const response = await fetch(
        `${gatewayUrl}/api/v0/routing/get?arg=/ipns/${this.cachedIpnsName}`,
        { method: "POST", signal: controller.signal }
      );

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.log(`💬 Routing API ${hostname}: HTTP ${response.status}`);
        return null;
      }

      const json = await response.json() as { Extra?: string };
      if (!json.Extra) {
        console.log(`💬 Routing API ${hostname}: no Extra field in response`);
        return null;
      }

      const recordData = Uint8Array.from(atob(json.Extra), c => c.charCodeAt(0));
      const record = unmarshalIPNSRecord(recordData);

      const cidMatch = record.value.match(/^\/ipfs\/(.+)$/);
      if (!cidMatch) {
        console.log(`💬 Routing API ${hostname}: no CID in record value`);
        return null;
      }

      console.log(`💬 Routing API ${hostname}: SUCCESS - cid=${cidMatch[1].slice(0, 16)}..., seq=${record.sequence}`);
      return { cid: cidMatch[1], sequence: record.sequence };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.log(`💬 Routing API ${hostname}: error - ${errorMsg}`);
      return null;
    }
  }

  /**
   * Progressive IPNS resolution using both fast (gateway path) and slow (routing API) paths
   *
   * Strategy:
   * 1. Start both gateway path (fast, ~30ms, may be cached) and routing API (slow, ~5s, authoritative)
   * 2. When gateway path returns, wait for routing API to also complete before deciding
   * 3. Compare sequence numbers: routing API is authoritative, gateway path may be stale
   * 4. If routing API has higher sequence, use that CID (need to fetch content separately)
   */
  private async resolveIpnsProgressively(): Promise<{
    cid: string;
    sequence: bigint;
    content?: ChatHistoryStorageData;
  } | null> {
    const gatewayUrls = getAllBackendGatewayUrls();
    console.log(`💬 Resolving IPNS from ${gatewayUrls.length} gateways: ${gatewayUrls.map(u => new URL(u).hostname).join(', ')}`);
    console.log(`💬 IPNS name: ${this.cachedIpnsName}`);
    if (gatewayUrls.length === 0) {
      console.warn(`💬 No gateways configured!`);
      return null;
    }

    const RESOLUTION_TIMEOUT = 15000; // Total timeout for all resolution attempts

    return new Promise((resolve) => {
      let resolved = false;
      let bestFromRoutingApi: { cid: string; sequence: bigint } | null = null;
      let bestFromGatewayPath: { cid: string; sequence: bigint; content: ChatHistoryStorageData } | null = null;
      let gatewayPathCompleted = 0;
      let routingApiCompleted = 0;
      const totalGateways = gatewayUrls.length;

      const resolveWithBest = (reason: string) => {
        if (resolved) return;
        resolved = true;

        // Compare gateway path and routing API results
        const gatewaySeq = bestFromGatewayPath?.sequence || 0n;
        const routingSeq = bestFromRoutingApi?.sequence || 0n;

        console.log(`💬 Resolving (${reason}): gatewayPath seq=${gatewaySeq}, routingApi seq=${routingSeq}`);

        if (routingSeq > gatewaySeq && bestFromRoutingApi) {
          // Routing API has newer version - need to fetch content by CID
          console.log(`💬 Using routing API result (newer): cid=${bestFromRoutingApi.cid.slice(0, 16)}..., seq=${routingSeq}`);
          resolve(bestFromRoutingApi);
        } else if (bestFromGatewayPath) {
          // Gateway path is current or newer
          console.log(`💬 Using gateway path result: v${bestFromGatewayPath.content._meta.version}, ${Object.keys(bestFromGatewayPath.content.sessions).length} sessions`);
          resolve(bestFromGatewayPath);
        } else if (bestFromRoutingApi) {
          // Only have routing API result
          console.log(`💬 Using routing API result (only available): cid=${bestFromRoutingApi.cid.slice(0, 16)}..., seq=${routingSeq}`);
          resolve(bestFromRoutingApi);
        } else {
          console.log(`💬 IPNS resolution: no results found`);
          resolve(null);
        }
      };

      const checkCompletion = () => {
        if (resolved) return;

        const allGatewayPathDone = gatewayPathCompleted >= totalGateways;
        const allRoutingApiDone = routingApiCompleted >= totalGateways;
        const hasGatewayResult = bestFromGatewayPath !== null;
        const hasRoutingResult = bestFromRoutingApi !== null;

        // If we have both results, we can resolve immediately
        if (hasGatewayResult && hasRoutingResult) {
          resolveWithBest("both results available");
          return;
        }

        // If all requests completed, resolve with whatever we have
        if (allGatewayPathDone && allRoutingApiDone) {
          resolveWithBest("all requests completed");
          return;
        }

        // If gateway path is done but routing API is still running, wait for routing API
        // This is the key change - we don't resolve early just because gateway path returned
        if (hasGatewayResult && !allRoutingApiDone) {
          console.log(`💬 Gateway path ready, waiting for routing API (${routingApiCompleted}/${totalGateways} done)`);
          return;
        }

        // If routing API returned first (unusual), wait a bit for gateway path
        if (hasRoutingResult && !allGatewayPathDone) {
          console.log(`💬 Routing API ready, waiting for gateway path (${gatewayPathCompleted}/${totalGateways} done)`);
          return;
        }
      };

      // Start gateway path resolution (fast)
      gatewayUrls.forEach(url => {
        this.resolveIpnsViaGatewayPath(url)
          .then(result => {
            if (result && !bestFromGatewayPath) {
              bestFromGatewayPath = {
                cid: result.cid,
                sequence: BigInt(result.content._meta.version),
                content: result.content,
              };
              console.log(`💬 Gateway path got result: v${result.content._meta.version}, ${Object.keys(result.content.sessions).length} sessions`);
            }
          })
          .catch((err) => {
            console.log(`💬 Gateway path ${new URL(url).hostname}: caught error`, err);
          })
          .finally(() => {
            gatewayPathCompleted++;
            checkCompletion();
          });
      });

      // Start routing API resolution (slow, for authoritative sequence number)
      gatewayUrls.forEach(url => {
        this.resolveIpnsViaRoutingApi(url)
          .then(result => {
            if (result) {
              console.log(`💬 Routing API got result: cid=${result.cid.slice(0, 16)}..., seq=${result.sequence}`);
              if (!bestFromRoutingApi || result.sequence > bestFromRoutingApi.sequence) {
                bestFromRoutingApi = result;
              }
            }
          })
          .catch((err) => {
            console.log(`💬 Routing API ${new URL(url).hostname}: caught error`, err);
          })
          .finally(() => {
            routingApiCompleted++;
            checkCompletion();
          });
      });

      // Timeout fallback - if nothing resolved after timeout, use whatever we have
      setTimeout(() => {
        if (!resolved) {
          resolveWithBest(`timeout after ${RESOLUTION_TIMEOUT}ms`);
        }
      }, RESOLUTION_TIMEOUT);
    });
  }

  private async publishIpnsViaHttp(marshalledRecord: Uint8Array): Promise<boolean> {
    const gatewayUrls = getAllBackendGatewayUrls();
    if (gatewayUrls.length === 0 || !this.cachedIpnsName) return false;

    console.log(`💬 Publishing chat IPNS via HTTP to ${gatewayUrls.length} backend(s)...`);

    const results = await Promise.allSettled(
      gatewayUrls.map(async (gatewayUrl) => {
        const hostname = new URL(gatewayUrl).hostname;
        try {
          const formData = new FormData();
          formData.append("file", new Blob([new Uint8Array(marshalledRecord)]), "record");

          // NOTE: Do NOT use allow-offline=true - it prevents DHT propagation!
          const response = await fetch(
            `${gatewayUrl}/api/v0/routing/put?arg=/ipns/${this.cachedIpnsName}`,
            { method: "POST", body: formData, signal: AbortSignal.timeout(30000) }
          );

          if (!response.ok) {
            console.warn(`💬 IPNS publish to ${hostname}: HTTP ${response.status}`);
            throw new Error(`HTTP ${response.status}`);
          }
          console.log(`💬 IPNS publish to ${hostname}: success`);
          return gatewayUrl;
        } catch (error) {
          // Network errors are expected for some gateways - use debug level
          console.log(`💬 IPNS publish to ${hostname}: failed`, error instanceof Error ? error.message : error);
          throw error;
        }
      })
    );

    const successful = results.filter(r => r.status === "fulfilled");
    console.log(`💬 IPNS publish: ${successful.length}/${gatewayUrls.length} backends succeeded`);
    return successful.length > 0;
  }

  private async publishToIpns(cid: CID): Promise<string | null> {
    if (!this.helia || !this.ipnsKeyPair) return null;

    const IPNS_LIFETIME = 99 * 365 * 24 * 60 * 60 * 1000;

    try {
      console.log(`💬 Publishing chat to IPNS: ${cid.toString().slice(0, 16)}...`);

      const baseSeq = this.ipnsSequenceNumber > this.lastKnownRemoteSequence
        ? this.ipnsSequenceNumber
        : this.lastKnownRemoteSequence;
      this.ipnsSequenceNumber = baseSeq + 1n;

      const record = await createIPNSRecord(
        this.ipnsKeyPair,
        `/ipfs/${cid.toString()}`,
        this.ipnsSequenceNumber,
        IPNS_LIFETIME
      );

      const marshalledRecord = marshalIPNSRecord(record);
      const httpSuccess = await this.publishIpnsViaHttp(marshalledRecord);

      if (httpSuccess) {
        this.setIpnsSequenceNumber(this.ipnsSequenceNumber);
        console.log(`💬 Chat IPNS published (seq: ${this.ipnsSequenceNumber})`);
        return this.cachedIpnsName;
      }

      this.ipnsSequenceNumber--;
      return null;
    } catch (error) {
      this.ipnsSequenceNumber--;
      console.warn(`💬 Chat IPNS publish failed:`, error);
      return null;
    }
  }

  // ==========================================
  // Content Storage & Retrieval
  // ==========================================

  private async fetchRemoteContent(cidString: string): Promise<ChatHistoryStorageData | null> {
    console.log(`💬 Fetching remote chat content: ${cidString.slice(0, 16)}...`);

    // Try HTTP gateways first (faster and more reliable than bitswap)
    const gatewayUrls = getAllBackendGatewayUrls();

    for (const gatewayUrl of gatewayUrls) {
      try {
        const hostname = new URL(gatewayUrl).hostname;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(`${gatewayUrl}/ipfs/${cidString}`, {
          method: "GET",
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          const data = await response.json() as ChatHistoryStorageData;
          if (data && data._meta && data._meta.type === "chat-history") {
            console.log(`💬 Remote chat content fetched via ${hostname}`);
            return data;
          }
        }
      } catch {
        // Try next gateway
        continue;
      }
    }

    // Fallback to Helia bitswap if HTTP failed
    if (this.helia) {
      try {
        console.log(`💬 Trying Helia bitswap for ${cidString.slice(0, 16)}...`);
        const j = json(this.helia);
        const { CID } = await import("multiformats/cid");
        const cid = CID.parse(cidString);

        const data = await Promise.race([
          j.get(cid),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Fetch timeout")), 15000)
          ),
        ]);

        if (data && typeof data === "object" && "_meta" in (data as object)) {
          const meta = (data as ChatHistoryStorageData)._meta;
          if (meta.type === "chat-history") {
            console.log(`💬 Remote chat content fetched via bitswap`);
            return data as ChatHistoryStorageData;
          }
        }
      } catch (error) {
        console.warn(`💬 Bitswap fetch failed:`, error);
      }
    }

    console.warn(`💬 Failed to fetch chat CID from any source`);
    return null;
  }

  private async storeContent(data: ChatHistoryStorageData): Promise<CID | null> {
    if (!this.helia) return null;

    try {
      const j = json(this.helia);
      const cid = await j.add(data);
      console.log(`💬 Chat content stored locally: ${cid.toString().slice(0, 16)}...`);

      // Upload to HTTP gateways for reliable retrieval
      await this.uploadToGateways(cid.toString(), data);

      return cid;
    } catch (error) {
      console.error(`💬 Failed to store chat content:`, error);
      return null;
    }
  }

  private async uploadToGateways(_cidString: string, data: ChatHistoryStorageData): Promise<void> {
    const gatewayUrls = getAllBackendGatewayUrls();
    const jsonBlob = new Blob([JSON.stringify(data)], { type: "application/json" });

    console.log(`💬 Uploading chat content to ${gatewayUrls.length} gateway(s)...`);

    const results = await Promise.allSettled(
      gatewayUrls.map(async (gatewayUrl) => {
        const hostname = new URL(gatewayUrl).hostname;
        try {
          const formData = new FormData();
          formData.append("file", jsonBlob);

          const response = await fetch(
            `${gatewayUrl}/api/v0/add?pin=true&cid-version=1`,
            { method: "POST", body: formData, signal: AbortSignal.timeout(30000) }
          );

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          const result = await response.json() as { Hash?: string };
          console.log(`💬 Uploaded to ${hostname}: ${result.Hash?.slice(0, 16)}...`);
          return gatewayUrl;
        } catch (error) {
          // Network errors are expected for some gateways - use debug level
          console.log(`💬 Upload to ${hostname} failed:`, error instanceof Error ? error.message : error);
          throw error;
        }
      })
    );

    const successful = results.filter(r => r.status === "fulfilled");
    console.log(`💬 Content uploaded to ${successful.length}/${gatewayUrls.length} gateways`);
  }

  // ==========================================
  // Sync Operations
  // ==========================================

  /**
   * Schedule a debounced sync to IPFS
   * Can be called before startAutoSync - will initialize if needed
   */
  scheduleSync(): void {
    console.log(`💬 scheduleSync called, isSyncing=${this.isSyncing}`);

    if (this.isSyncing) {
      this.pendingSync = true;
      console.log(`💬 Sync in progress, marking pending`);
      return;
    }

    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
    }
    console.log(`💬 Scheduling sync in ${SYNC_DEBOUNCE_MS}ms`);
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      this.syncNow().catch(console.error);
    }, SYNC_DEBOUNCE_MS);

    // Notify listeners that a sync is now pending
    this.notifyStatusListeners();
  }

  /**
   * Trigger immediate sync without debounce
   * Use for critical operations like session creation
   */
  async syncImmediately(): Promise<ChatSyncResult> {
    console.log(`💬 syncImmediately called`);

    // Cancel any pending debounced sync
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }

    return this.syncNow();
  }

  async syncFromIpns(): Promise<ChatSyncResult> {
    console.log(`💬 Starting chat IPNS sync...`);
    this.setStep('initializing');

    try {
      const initialized = await this.ensureInitialized();
      if (!initialized) {
        this.setStep('error', 'Not initialized');
        return { success: false, timestamp: Date.now(), error: "Not initialized" };
      }

      this.setStep('resolving-ipns', 'Looking up chat history...');
      const resolution = await this.resolveIpnsProgressively();
      const remoteCid = resolution?.cid || null;
      const localCid = this.getLastCid();
      const hasRemoteContent = resolution?.content !== undefined;

      if (resolution) {
        this.lastKnownRemoteSequence = resolution.sequence;
        console.log(`💬 Chat IPNS resolved: seq=${resolution.sequence}, hasCid=${!!remoteCid}, hasContent=${hasRemoteContent}`);
      }

      // Check if we have any data source: remote content, remote CID, or local CID
      if (!remoteCid && !localCid && !hasRemoteContent) {
        console.log(`💬 No remote or local chat data - fresh state`);
        this.setStep('complete');
        return { success: true, timestamp: Date.now(), sessionCount: 0 };
      }

      // Use cached content from gateway path if available (even without CID)
      let remoteData: ChatHistoryStorageData | null = null;
      if (resolution?.content) {
        remoteData = resolution.content;
        console.log(`💬 Using cached content from gateway path (${Object.keys(remoteData.sessions).length} sessions)`);
      } else {
        const cidToFetch = remoteCid || localCid;
        if (cidToFetch) {
          this.setStep('fetching-content', 'Downloading history...');
          remoteData = await this.fetchRemoteContent(cidToFetch);
        }
      }

      if (!remoteData) {
        console.warn(`💬 Failed to fetch remote chat content`);
        this.setStep('error', 'Failed to fetch content');
        // Don't overwrite remote with potentially empty local data
        // Just return failure and let user retry
        return { success: false, timestamp: Date.now(), error: "Failed to fetch remote content" };
      }

      const localVersion = this.getVersionCounter();
      const remoteVersion = remoteData._meta.version;
      // Use remote CID if available, otherwise local CID (may be empty if we only have content)
      const effectiveCid = remoteCid || localCid || "";

      console.log(`💬 Chat version: local=v${localVersion}, remote=v${remoteVersion}`);

      if (remoteVersion > localVersion) {
        // Import remote data to localStorage
        this.setStep('importing-data', `Importing ${Object.keys(remoteData.sessions).length} session(s)...`);
        console.log(`💬 Importing ${Object.keys(remoteData.sessions).length} session(s) from remote...`);
        await this.importRemoteData(remoteData);
        this.setVersionCounter(remoteVersion);
        if (effectiveCid) {
          this.setLastCid(effectiveCid);
        }

        this.setStep('complete');
        window.dispatchEvent(new CustomEvent("agent-chat-history-updated"));

        return {
          success: true,
          cid: effectiveCid || undefined,
          timestamp: Date.now(),
          sessionCount: Object.keys(remoteData.sessions).length,
        };
      } else if (remoteVersion < localVersion) {
        // Merge and push
        this.setStep('importing-data', 'Merging local and remote...');
        await this.importRemoteData(remoteData);
        return this.syncNow();
      } else {
        // Same version
        if (effectiveCid) {
          this.setLastCid(effectiveCid);
        }
        this.setStep('complete');
        return {
          success: true,
          cid: effectiveCid || undefined,
          timestamp: Date.now(),
          sessionCount: Object.keys(remoteData.sessions).length,
        };
      }
    } catch (error) {
      console.error(`💬 Chat IPNS sync failed:`, error);
      this.setStep('error', String(error));
      return { success: false, timestamp: Date.now(), error: String(error) };
    }
  }

  // Queue for pending sync requests (coalesces multiple requests into one)
  private pendingSyncResolvers: Array<(result: ChatSyncResult) => void> = [];

  async syncNow(): Promise<ChatSyncResult> {
    console.log(`💬 syncNow called`);

    // If already syncing, queue this request and wait for next sync
    if (this.isSyncing) {
      console.log(`💬 syncNow: already syncing, queuing request...`);
      return new Promise<ChatSyncResult>((resolve) => {
        this.pendingSyncResolvers.push(resolve);
      });
    }

    this.isSyncing = true;
    this.setStep('initializing');

    try {
      console.log(`💬 syncNow: ensuring initialized...`);
      const initialized = await this.ensureInitialized();
      if (!initialized || !this.helia) {
        console.warn(`💬 syncNow: IPFS not initialized`);
        throw new Error("IPFS not initialized");
      }

      // Build storage data from localStorage
      this.setStep('building-data', 'Preparing chat data...');
      console.log(`💬 syncNow: building storage data...`);
      const storageData = this.buildStorageData();
      console.log(`💬 syncNow: ${Object.keys(storageData.sessions).length} sessions, ${Object.keys(storageData.messages).length} message sets`);

      // Store content
      this.setStep('uploading', `Uploading ${Object.keys(storageData.sessions).length} session(s)...`);
      const cid = await this.storeContent(storageData);
      if (!cid) {
        throw new Error("Failed to store content");
      }

      // Publish to IPNS
      this.setStep('publishing-ipns', 'Publishing to network...');
      const ipnsName = await this.publishToIpns(cid);

      // Update tracking
      this.setLastCid(cid.toString());
      const version = this.incrementVersionCounter();

      const result: ChatSyncResult = {
        success: true,
        cid: cid.toString(),
        ipnsName: ipnsName || undefined,
        timestamp: Date.now(),
        sessionCount: Object.keys(storageData.sessions).length,
      };

      this.lastSync = result;
      this.hasPendingChanges = false; // Clear pending flag after successful sync
      this.setStep('complete');
      console.log(`💬 Chat sync complete: v${version}, ${result.sessionCount} sessions`);

      return result;
    } catch (error) {
      console.error(`💬 Chat sync failed:`, error);
      this.setStep('error', String(error));
      return { success: false, timestamp: Date.now(), error: String(error) };
    } finally {
      this.isSyncing = false;

      // Handle coalesced sync requests - run ONE more sync to resolve all queued promises
      if (this.pendingSyncResolvers.length > 0) {
        const resolvers = this.pendingSyncResolvers;
        this.pendingSyncResolvers = [];
        console.log(`💬 syncNow: resolving ${resolvers.length} queued request(s) with a final sync`);

        // Run one final sync that captures the latest localStorage state
        // This single sync handles all the changes that were queued
        this.syncNow().then((result) => {
          resolvers.forEach(resolve => resolve(result));
        }).catch((error) => {
          // On error, still resolve with an error result
          const errorResult: ChatSyncResult = {
            success: false,
            timestamp: Date.now(),
            error: String(error),
          };
          resolvers.forEach(resolve => resolve(errorResult));
        });
      } else if (this.pendingSync) {
        // Handle debounced sync requests (from scheduleSync)
        this.pendingSync = false;
        this.scheduleSync();
      } else {
        // Reset to idle after a short delay so user can see 'complete'
        setTimeout(() => {
          if (this.currentStep === 'complete' || this.currentStep === 'error') {
            this.setStep('idle');
          }
        }, 2000);
      }
    }
  }

  // ==========================================
  // Data Building & Import
  // ==========================================

  private buildStorageData(): ChatHistoryStorageData {
    // Load sessions
    const sessionsRaw = localStorage.getItem(STORAGE_KEYS.AGENT_CHAT_SESSIONS);
    const sessions: ChatSession[] = sessionsRaw ? JSON.parse(sessionsRaw) : [];

    console.log(`💬 buildStorageData: found ${sessions.length} sessions in localStorage`);

    // Build sessions map
    const sessionsMap: Record<string, ChatSession> = {};
    const messagesMap: Record<string, ChatMessage[]> = {};

    for (const session of sessions) {
      sessionsMap[session.id] = session;
      console.log(`💬   - Session ${session.id.slice(0, 8)}... agentId=${session.agentId}, title="${session.title.slice(0, 20)}..."`);

      // Load messages for this session
      const messagesRaw = localStorage.getItem(STORAGE_KEY_GENERATORS.agentChatMessages(session.id));
      if (messagesRaw) {
        const messages = JSON.parse(messagesRaw);
        messagesMap[session.id] = messages;
        console.log(`💬     Messages: ${messages.length}`);
      }
    }

    // Load tombstones
    const tombstonesRaw = localStorage.getItem(STORAGE_KEYS.AGENT_CHAT_TOMBSTONES);
    const tombstones: Record<string, ChatTombstone> = tombstonesRaw
      ? JSON.parse(tombstonesRaw)
      : {};

    console.log(`💬 buildStorageData: ${Object.keys(tombstones).length} tombstones`);

    return {
      _meta: {
        version: this.getVersionCounter() + 1,
        timestamp: Date.now(),
        address: this.currentIdentityAddress || "",
        type: "chat-history",
      },
      sessions: sessionsMap,
      messages: messagesMap,
      tombstones,
    };
  }

  private async importRemoteData(data: ChatHistoryStorageData): Promise<number> {
    console.log(`💬 importRemoteData: remote has ${Object.keys(data.sessions).length} sessions, ${Object.keys(data.tombstones).length} tombstones`);

    // Load current local sessions
    const localSessionsRaw = localStorage.getItem(STORAGE_KEYS.AGENT_CHAT_SESSIONS);
    const localSessions: ChatSession[] = localSessionsRaw ? JSON.parse(localSessionsRaw) : [];
    const localSessionsMap = new Map(localSessions.map(s => [s.id, s]));

    console.log(`💬 importRemoteData: local has ${localSessions.length} sessions`);

    // Load local tombstones
    const localTombstonesRaw = localStorage.getItem(STORAGE_KEYS.AGENT_CHAT_TOMBSTONES);
    const localTombstones: Record<string, ChatTombstone> = localTombstonesRaw
      ? JSON.parse(localTombstonesRaw)
      : {};

    console.log(`💬 importRemoteData: local has ${Object.keys(localTombstones).length} tombstones`);

    let importedCount = 0;

    // Merge remote sessions
    for (const [sessionId, remoteSession] of Object.entries(data.sessions)) {
      // Skip if locally tombstoned
      if (localTombstones[sessionId]) {
        console.log(`💬   - Skip ${sessionId.slice(0, 8)}... (locally tombstoned)`);
        continue;
      }

      // Skip if remotely tombstoned
      if (data.tombstones[sessionId]) {
        console.log(`💬   - Skip ${sessionId.slice(0, 8)}... (remotely tombstoned)`);
        continue;
      }

      const localSession = localSessionsMap.get(sessionId);

      // Import if new or remote is newer
      if (!localSession || remoteSession.updatedAt > localSession.updatedAt) {
        console.log(`💬   - Import ${sessionId.slice(0, 8)}... agentId=${remoteSession.agentId}, title="${remoteSession.title.slice(0, 20)}..."`);
        localSessionsMap.set(sessionId, remoteSession);

        // Import messages
        const remoteMessages = data.messages[sessionId];
        if (remoteMessages) {
          localStorage.setItem(
            STORAGE_KEY_GENERATORS.agentChatMessages(sessionId),
            JSON.stringify(remoteMessages)
          );
          console.log(`💬     Messages: ${remoteMessages.length}`);
        }

        importedCount++;
      } else {
        console.log(`💬   - Skip ${sessionId.slice(0, 8)}... (local is newer or same)`);
      }
    }

    // Apply remote tombstones (delete local sessions that remote tombstoned)
    for (const [sessionId, tombstone] of Object.entries(data.tombstones)) {
      if (localSessionsMap.has(sessionId)) {
        const localSession = localSessionsMap.get(sessionId)!;

        // Only apply tombstone if it's newer than local session
        if (tombstone.deletedAt > localSession.updatedAt) {
          localSessionsMap.delete(sessionId);
          localStorage.removeItem(STORAGE_KEY_GENERATORS.agentChatMessages(sessionId));
          localTombstones[sessionId] = tombstone;
        }
      } else {
        // Session doesn't exist locally - just record the tombstone
        localTombstones[sessionId] = tombstone;
      }
    }

    // Save merged sessions
    const mergedSessions = Array.from(localSessionsMap.values());
    localStorage.setItem(STORAGE_KEYS.AGENT_CHAT_SESSIONS, JSON.stringify(mergedSessions));

    // Save merged tombstones
    localStorage.setItem(STORAGE_KEYS.AGENT_CHAT_TOMBSTONES, JSON.stringify(localTombstones));

    console.log(`💬 Imported ${importedCount} chat session(s) from remote`);

    return importedCount;
  }

  // ==========================================
  // Delete Operations (Tombstoning)
  // ==========================================

  /**
   * Record a session deletion as a tombstone for IPFS sync
   */
  recordSessionDeletion(sessionId: string): void {
    const tombstonesRaw = localStorage.getItem(STORAGE_KEYS.AGENT_CHAT_TOMBSTONES);
    const tombstones: Record<string, ChatTombstone> = tombstonesRaw
      ? JSON.parse(tombstonesRaw)
      : {};

    tombstones[sessionId] = {
      sessionId,
      deletedAt: Date.now(),
      reason: "user-deleted",
    };

    localStorage.setItem(STORAGE_KEYS.AGENT_CHAT_TOMBSTONES, JSON.stringify(tombstones));
    // Sync is triggered by ChatHistoryRepository.notifyUpdate() → TanStack hook
  }

  /**
   * Record deletion of all sessions for an agent/user
   */
  recordBulkDeletion(sessionIds: string[]): void {
    const tombstonesRaw = localStorage.getItem(STORAGE_KEYS.AGENT_CHAT_TOMBSTONES);
    const tombstones: Record<string, ChatTombstone> = tombstonesRaw
      ? JSON.parse(tombstonesRaw)
      : {};

    const now = Date.now();
    for (const sessionId of sessionIds) {
      tombstones[sessionId] = {
        sessionId,
        deletedAt: now,
        reason: "clear-all",
      };
    }

    localStorage.setItem(STORAGE_KEYS.AGENT_CHAT_TOMBSTONES, JSON.stringify(tombstones));
    // Sync is triggered by ChatHistoryRepository.notifyUpdate() → TanStack hook
  }

  /**
   * Clean up tombstones older than TOMBSTONE_MAX_AGE_MS (30 days)
   * Old tombstones are unlikely to be needed for sync conflict resolution
   * and just waste storage space.
   */
  cleanupOldTombstones(): number {
    const tombstonesRaw = localStorage.getItem(STORAGE_KEYS.AGENT_CHAT_TOMBSTONES);
    if (!tombstonesRaw) return 0;

    const tombstones: Record<string, ChatTombstone> = JSON.parse(tombstonesRaw);
    const now = Date.now();
    const cutoffTime = now - TOMBSTONE_MAX_AGE_MS;

    let removedCount = 0;
    const remainingTombstones: Record<string, ChatTombstone> = {};

    for (const [sessionId, tombstone] of Object.entries(tombstones)) {
      if (tombstone.deletedAt >= cutoffTime) {
        remainingTombstones[sessionId] = tombstone;
      } else {
        removedCount++;
      }
    }

    if (removedCount > 0) {
      localStorage.setItem(STORAGE_KEYS.AGENT_CHAT_TOMBSTONES, JSON.stringify(remainingTombstones));
      console.log(`💬 Cleaned up ${removedCount} old tombstone(s) (older than 30 days)`);
    }

    return removedCount;
  }

  /**
   * Clear all local IPFS state (version counters, CIDs, sequence numbers)
   * WITHOUT triggering any IPFS sync.
   *
   * Use this when deleting wallet - we want to clear local tracking data
   * but NOT propagate deletion to IPFS network.
   */
  clearLocalStateOnly(): void {
    console.log("💬 Clearing chat IPFS local state (no sync)");

    // Clear version counter
    if (this.cachedIpnsName) {
      localStorage.removeItem(STORAGE_KEY_GENERATORS.ipfsChatVersion(this.cachedIpnsName));
      localStorage.removeItem(STORAGE_KEY_GENERATORS.ipfsChatCid(this.cachedIpnsName));
      localStorage.removeItem(STORAGE_KEY_GENERATORS.ipfsChatSeq(this.cachedIpnsName));
    }

    // Clear tombstones
    localStorage.removeItem(STORAGE_KEYS.AGENT_CHAT_TOMBSTONES);

    // Reset in-memory state
    this.ipnsSequenceNumber = 0n;
    this.lastKnownRemoteSequence = 0n;
    this.lastSync = null;
    this.hasPendingChanges = false;

    // Note: We do NOT shutdown Helia or trigger any sync
    console.log("💬 Chat IPFS local state cleared (no network operations)");
  }

  // ==========================================
  // Status
  // ==========================================

  private setStep(step: SyncStep, progress?: string): void {
    this.currentStep = step;
    this.stepProgress = progress || '';
    this.notifyStatusListeners();
  }

  private notifyStatusListeners(): void {
    this.statusListeners.forEach(listener => listener());
  }

  /**
   * Subscribe to status changes
   * Returns unsubscribe function
   */
  onStatusChange(listener: () => void): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  getStatus(): ChatSyncStatus {
    return {
      initialized: this.helia !== null,
      isSyncing: this.isSyncing,
      hasPendingSync: this.syncTimer !== null || this.hasPendingChanges,
      lastSync: this.lastSync,
      ipnsName: this.cachedIpnsName,
      currentStep: this.currentStep,
      stepProgress: this.stepProgress,
    };
  }
}

// Singleton accessor
let chatHistoryIpfsServiceInstance: ChatHistoryIpfsService | null = null;

export function getChatHistoryIpfsService(): ChatHistoryIpfsService {
  if (!chatHistoryIpfsServiceInstance) {
    chatHistoryIpfsServiceInstance = ChatHistoryIpfsService.getInstance();
  }
  return chatHistoryIpfsServiceInstance;
}
