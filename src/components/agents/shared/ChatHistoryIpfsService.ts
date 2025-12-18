/**
 * ChatHistoryIpfsService - IPFS-based persistent storage for agent chat history
 *
 * Stores chat history in IPFS with IPNS for naming, allowing sync across devices.
 * Uses a separate IPNS key from wallet storage to avoid conflicts.
 *
 * Architecture:
 * - Each user (identified by nametag/address) has their own IPNS name for chat history
 * - IPNS key is derived deterministically from user's identity seed + "chat-history" context
 * - Chat sessions are stored as JSON in IPFS
 * - IPNS record points to latest chat history CID
 */

import { generateKeyPairFromSeed } from "@libp2p/crypto/keys";
import { peerIdFromPrivateKey } from "@libp2p/peer-id";
import { createIPNSRecord, marshalIPNSRecord, unmarshalIPNSRecord } from "ipns";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import type { PrivateKey } from "@libp2p/interface";
import { getAllBackendGatewayUrls } from "../../../config/ipfs.config";
import type { ChatMessage } from "../../../hooks/useAgentChat";

// Configure @noble/ed25519 to use sync sha512
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(ed.hashes as any).sha512 = (message: Uint8Array) => sha512(message);

// ==========================================
// Types
// ==========================================

export interface ChatSession {
  id: string;
  agentId: string;
  userId: string;
  title: string;
  preview: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

export interface ChatSessionData extends ChatSession {
  messages: ChatMessage[];
}

export interface ChatHistoryStorageData {
  version: number;
  timestamp: number;
  userId: string;
  sessions: ChatSessionData[];
}

export interface SyncResult {
  success: boolean;
  cid?: string;
  ipnsName?: string;
  timestamp: number;
  sessionCount?: number;
  error?: string;
}

export interface RestoreResult {
  success: boolean;
  sessions?: ChatSessionData[];
  timestamp: number;
  error?: string;
}

// ==========================================
// Constants
// ==========================================

const HKDF_INFO_CHAT = "ipfs-chat-history-ed25519-v1";
const VERSION_STORAGE_PREFIX = "chat_ipfs_version_";
const CID_STORAGE_PREFIX = "chat_ipfs_cid_";
const IPNS_SEQ_PREFIX = "chat_ipns_seq_";

// ==========================================
// ChatHistoryIpfsService
// ==========================================

export class ChatHistoryIpfsService {
  private static instance: ChatHistoryIpfsService | null = null;

  // Ed25519 keys for signing/encryption
  private ed25519PrivateKey: Uint8Array | null = null;
  private ed25519PublicKey: Uint8Array | null = null;
  private cachedIpnsName: string | null = null;
  private ipnsKeyPair: PrivateKey | null = null;
  private ipnsSequenceNumber: bigint = 0n;

  private currentUserId: string | null = null;
  private isSyncing = false;
  private lastSyncResult: SyncResult | null = null;

  private constructor() {}

  static getInstance(): ChatHistoryIpfsService {
    if (!ChatHistoryIpfsService.instance) {
      ChatHistoryIpfsService.instance = new ChatHistoryIpfsService();
    }
    return ChatHistoryIpfsService.instance;
  }

  /**
   * Reset instance when user switches identity
   */
  static resetInstance(): void {
    if (ChatHistoryIpfsService.instance) {
      ChatHistoryIpfsService.instance.shutdown();
      ChatHistoryIpfsService.instance = null;
    }
  }

  // ==========================================
  // Initialization
  // ==========================================

  /**
   * Initialize service for a specific user
   * @param seedPhrase - User's seed phrase (same as wallet seed)
   * @param userId - User identifier (nametag)
   */
  async initialize(seedPhrase: string, userId: string): Promise<boolean> {
    if (this.currentUserId === userId && this.cachedIpnsName) {
      return true; // Already initialized for this user
    }

    try {
      console.log(`[ChatHistoryIpfs] Initializing for user: ${userId}`);

      // Derive Ed25519 key for chat history IPNS (different from wallet IPNS)
      const seedBytes = new TextEncoder().encode(seedPhrase);
      const seedHash = sha256(seedBytes);

      // Use different context for chat history to get different IPNS key
      const keyMaterial = hkdf(sha256, seedHash, undefined, HKDF_INFO_CHAT, 32);

      this.ed25519PrivateKey = keyMaterial;
      this.ed25519PublicKey = ed.getPublicKey(keyMaterial);

      // Generate libp2p key pair for IPNS
      const libp2pKey = await generateKeyPairFromSeed("Ed25519", keyMaterial);
      this.ipnsKeyPair = libp2pKey;

      // Get IPNS name (peer ID)
      const peerId = peerIdFromPrivateKey(libp2pKey);
      this.cachedIpnsName = peerId.toString();

      this.currentUserId = userId;

      // Load saved sequence number
      this.ipnsSequenceNumber = this.getStoredSequenceNumber();

      console.log(`[ChatHistoryIpfs] Initialized with IPNS name: ${this.cachedIpnsName?.slice(0, 16)}...`);
      return true;
    } catch (error) {
      console.error("[ChatHistoryIpfs] Initialization failed:", error);
      return false;
    }
  }

  /**
   * Check if service is initialized
   */
  isInitialized(): boolean {
    return !!this.cachedIpnsName && !!this.currentUserId;
  }

  /**
   * Get current IPNS name
   */
  getIpnsName(): string | null {
    return this.cachedIpnsName;
  }

  /**
   * Get current user ID
   */
  getCurrentUserId(): string | null {
    return this.currentUserId;
  }

  /**
   * Get public key (for potential future use - signing/encryption)
   */
  getPublicKey(): Uint8Array | null {
    return this.ed25519PublicKey;
  }

  /**
   * Check if keys are initialized (uses private key internally)
   */
  hasKeys(): boolean {
    return this.ed25519PrivateKey !== null && this.ed25519PublicKey !== null;
  }

  /**
   * Shutdown service
   */
  shutdown(): void {
    this.ed25519PrivateKey = null;
    this.ed25519PublicKey = null;
    this.cachedIpnsName = null;
    this.ipnsKeyPair = null;
    this.currentUserId = null;
    console.log("[ChatHistoryIpfs] Service shutdown");
  }

  // ==========================================
  // Storage Operations
  // ==========================================

  /**
   * Store chat history to IPFS and publish IPNS record
   */
  async store(sessions: ChatSessionData[]): Promise<SyncResult> {
    if (!this.isInitialized() || !this.currentUserId) {
      return {
        success: false,
        timestamp: Date.now(),
        error: "Service not initialized",
      };
    }

    if (this.isSyncing) {
      return {
        success: false,
        timestamp: Date.now(),
        error: "Sync already in progress",
      };
    }

    this.isSyncing = true;

    try {
      const storageData: ChatHistoryStorageData = {
        version: this.getStoredVersion() + 1,
        timestamp: Date.now(),
        userId: this.currentUserId,
        sessions,
      };

      // Upload to IPFS
      const cid = await this.uploadToIpfs(storageData);
      if (!cid) {
        throw new Error("Failed to upload to IPFS");
      }

      // Publish IPNS record
      const ipnsPublished = await this.publishToIpns(cid);

      // Save local state
      this.setStoredVersion(storageData.version);
      this.setStoredCid(cid);

      const result: SyncResult = {
        success: true,
        cid,
        ipnsName: this.cachedIpnsName ?? undefined,
        timestamp: Date.now(),
        sessionCount: sessions.length,
      };

      if (!ipnsPublished) {
        console.warn("[ChatHistoryIpfs] Content stored but IPNS publish failed");
      }

      this.lastSyncResult = result;
      this.emitSyncEvent(result);

      console.log(`[ChatHistoryIpfs] Stored ${sessions.length} sessions, CID: ${cid.slice(0, 16)}...`);
      return result;
    } catch (error) {
      const result: SyncResult = {
        success: false,
        timestamp: Date.now(),
        error: error instanceof Error ? error.message : "Unknown error",
      };
      this.lastSyncResult = result;
      return result;
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Restore chat history from IPFS via IPNS resolution
   */
  async restore(): Promise<RestoreResult> {
    if (!this.isInitialized()) {
      return {
        success: false,
        timestamp: Date.now(),
        error: "Service not initialized",
      };
    }

    console.log("[ChatHistoryIpfs] Attempting to restore from IPFS...");

    try {
      // Resolve IPNS to get latest CID
      const resolution = await this.resolveIpns();
      if (!resolution) {
        // Try local CID as fallback
        const localCid = this.getStoredCid();
        if (localCid) {
          console.log(`[ChatHistoryIpfs] IPNS resolution failed, trying local CID: ${localCid.slice(0, 16)}...`);
          return this.restoreFromCid(localCid);
        }
        console.log("[ChatHistoryIpfs] No IPNS record found and no local CID");
        return {
          success: false,
          timestamp: Date.now(),
          error: "No IPNS record found and no local CID",
        };
      }

      console.log(`[ChatHistoryIpfs] IPNS resolved to CID: ${resolution.cid.slice(0, 16)}...`);
      return this.restoreFromCid(resolution.cid);
    } catch (error) {
      console.error("[ChatHistoryIpfs] Restore error:", error);
      return {
        success: false,
        timestamp: Date.now(),
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Restore from specific CID
   */
  async restoreFromCid(cid: string): Promise<RestoreResult> {
    try {
      const data = await this.fetchFromIpfs(cid);
      if (!data) {
        return {
          success: false,
          timestamp: Date.now(),
          error: "Failed to fetch data from IPFS",
        };
      }

      // Validate user ID matches
      if (data.userId !== this.currentUserId) {
        console.warn(`[ChatHistoryIpfs] User ID mismatch: ${data.userId} vs ${this.currentUserId}`);
      }

      // Update local state
      this.setStoredCid(cid);
      this.setStoredVersion(data.version);

      console.log(`[ChatHistoryIpfs] Restored ${data.sessions.length} sessions from CID: ${cid.slice(0, 16)}...`);

      return {
        success: true,
        sessions: data.sessions,
        timestamp: Date.now(),
      };
    } catch (error) {
      return {
        success: false,
        timestamp: Date.now(),
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Sync: merge remote and local data
   */
  async sync(localSessions: ChatSessionData[]): Promise<{ sessions: ChatSessionData[]; synced: boolean }> {
    if (!this.isInitialized()) {
      console.log("[ChatHistoryIpfs] Sync skipped - not initialized");
      return { sessions: localSessions, synced: false };
    }

    console.log(`[ChatHistoryIpfs] Starting sync with ${localSessions.length} local sessions`);

    try {
      // Get remote data
      const restoreResult = await this.restore();

      if (!restoreResult.success || !restoreResult.sessions) {
        console.log(`[ChatHistoryIpfs] No remote data found (error: ${restoreResult.error || 'none'})`);
        // No remote data, upload local
        if (localSessions.length > 0) {
          console.log(`[ChatHistoryIpfs] Uploading ${localSessions.length} local sessions to IPFS`);
          await this.store(localSessions);
        } else {
          console.log("[ChatHistoryIpfs] No local sessions to upload");
        }
        return { sessions: localSessions, synced: true };
      }

      console.log(`[ChatHistoryIpfs] Found ${restoreResult.sessions.length} remote sessions`);

      // Merge sessions
      const merged = this.mergeSessions(localSessions, restoreResult.sessions);
      console.log(`[ChatHistoryIpfs] Merged to ${merged.length} sessions`);

      // Store merged result
      if (merged.length > 0) {
        await this.store(merged);
      }

      return { sessions: merged, synced: true };
    } catch (error) {
      console.error("[ChatHistoryIpfs] Sync failed:", error);
      return { sessions: localSessions, synced: false };
    }
  }

  // ==========================================
  // IPFS Operations
  // ==========================================

  private async uploadToIpfs(data: ChatHistoryStorageData): Promise<string | null> {
    const gatewayUrls = getAllBackendGatewayUrls();
    if (gatewayUrls.length === 0) {
      console.warn("[ChatHistoryIpfs] No IPFS gateways configured");
      return null;
    }

    const jsonBlob = new Blob([JSON.stringify(data)], { type: "application/json" });

    // Try all gateways, return first successful CID
    for (const gatewayUrl of gatewayUrls) {
      try {
        const formData = new FormData();
        formData.append("file", jsonBlob, "chat-history.json");

        const response = await fetch(
          `${gatewayUrl}/api/v0/add?pin=true&cid-version=1`,
          { method: "POST", body: formData }
        );

        if (response.ok) {
          const result = await response.json();
          const hostname = new URL(gatewayUrl).hostname;
          console.log(`[ChatHistoryIpfs] Uploaded to ${hostname}: ${result.Hash}`);

          // Upload to remaining gateways in background (for redundancy)
          this.uploadToRemainingGateways(gatewayUrls, gatewayUrl, jsonBlob);

          return result.Hash;
        }
      } catch (error) {
        const hostname = new URL(gatewayUrl).hostname;
        console.warn(`[ChatHistoryIpfs] Upload to ${hostname} failed:`, error);
      }
    }

    return null;
  }

  private async uploadToRemainingGateways(
    allGateways: string[],
    excludeGateway: string,
    blob: Blob
  ): Promise<void> {
    const remaining = allGateways.filter(g => g !== excludeGateway);
    if (remaining.length === 0) return;

    // Fire and forget
    Promise.allSettled(
      remaining.map(async (gatewayUrl) => {
        try {
          const formData = new FormData();
          formData.append("file", blob, "chat-history.json");
          await fetch(`${gatewayUrl}/api/v0/add?pin=true&cid-version=1`, {
            method: "POST",
            body: formData,
          });
        } catch {
          // Ignore errors for redundancy uploads
        }
      })
    );
  }

  private async fetchFromIpfs(cid: string): Promise<ChatHistoryStorageData | null> {
    const gatewayUrls = getAllBackendGatewayUrls();
    if (gatewayUrls.length === 0) return null;

    for (const gatewayUrl of gatewayUrls) {
      try {
        const response = await fetch(`${gatewayUrl}/ipfs/${cid}`, {
          signal: AbortSignal.timeout(10000),
        });

        if (response.ok) {
          const data = await response.json();
          return data as ChatHistoryStorageData;
        }
      } catch (error) {
        const hostname = new URL(gatewayUrl).hostname;
        console.debug(`[ChatHistoryIpfs] Fetch from ${hostname} failed:`, error);
      }
    }

    return null;
  }

  // ==========================================
  // IPNS Operations
  // ==========================================

  private async publishToIpns(cid: string): Promise<boolean> {
    if (!this.ipnsKeyPair || !this.cachedIpnsName) {
      return false;
    }

    const gatewayUrls = getAllBackendGatewayUrls();
    if (gatewayUrls.length === 0) return false;

    try {
      // Increment sequence number
      this.ipnsSequenceNumber++;

      // Create IPNS record
      const record = await createIPNSRecord(
        this.ipnsKeyPair,
        `/ipfs/${cid}`,
        this.ipnsSequenceNumber,
        99 * 365 * 24 * 60 * 60 * 1000 // 99 years lifetime
      );

      const marshalledRecord = marshalIPNSRecord(record);

      // Publish to all gateways
      const results = await Promise.allSettled(
        gatewayUrls.map(async (gatewayUrl) => {
          const formData = new FormData();
          formData.append("file", new Blob([new Uint8Array(marshalledRecord)]), "record");

          const response = await fetch(
            `${gatewayUrl}/api/v0/routing/put?arg=/ipns/${this.cachedIpnsName}&allow-offline=true`,
            {
              method: "POST",
              body: formData,
              signal: AbortSignal.timeout(30000),
            }
          );

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          return true;
        })
      );

      const successful = results.filter(r => r.status === "fulfilled").length;
      console.log(`[ChatHistoryIpfs] IPNS published to ${successful}/${gatewayUrls.length} gateways`);

      if (successful > 0) {
        this.setStoredSequenceNumber(this.ipnsSequenceNumber);
        return true;
      }

      // Rollback on failure
      this.ipnsSequenceNumber--;
      return false;
    } catch (error) {
      console.error("[ChatHistoryIpfs] IPNS publish failed:", error);
      this.ipnsSequenceNumber--;
      return false;
    }
  }

  private async resolveIpns(): Promise<{ cid: string; sequence: bigint } | null> {
    if (!this.cachedIpnsName) return null;

    const gatewayUrls = getAllBackendGatewayUrls();
    if (gatewayUrls.length === 0) {
      console.warn("[ChatHistoryIpfs] No gateways configured for IPNS resolution");
      return null;
    }

    console.log(`[ChatHistoryIpfs] Resolving IPNS ${this.cachedIpnsName.slice(0, 16)}... via ${gatewayUrls.length} gateways`);

    // Use shorter timeout for chat history - it's less critical than wallet
    const CHAT_GATEWAY_TIMEOUT = 5000; // 5 seconds for gateway path
    const CHAT_ROUTING_TIMEOUT = 10000; // 10 seconds for routing API (faster than wallet's 25s)

    // Try fast gateway path first (all in parallel for speed)
    const gatewayPromises = gatewayUrls.map(async (gatewayUrl) => {
      try {
        const hostname = new URL(gatewayUrl).hostname;
        const response = await fetch(
          `${gatewayUrl}/ipns/${this.cachedIpnsName}?format=dag-json`,
          {
            signal: AbortSignal.timeout(CHAT_GATEWAY_TIMEOUT),
            headers: { Accept: "application/vnd.ipld.dag-json, application/json" },
          }
        );

        if (response.ok) {
          const ipfsPath = response.headers.get("X-Ipfs-Path");
          const cidMatch = ipfsPath?.match(/^\/ipfs\/(.+)$/);
          if (cidMatch) {
            console.log(`[ChatHistoryIpfs] IPNS resolved via gateway path (${hostname}): ${cidMatch[1].slice(0, 16)}...`);
            return { cid: cidMatch[1], sequence: 0n };
          }
        }
        return null;
      } catch {
        return null;
      }
    });

    // Race all gateway path requests
    const gatewayResults = await Promise.all(gatewayPromises);
    const gatewayResult = gatewayResults.find(r => r !== null);
    if (gatewayResult) {
      return gatewayResult;
    }

    console.log("[ChatHistoryIpfs] Gateway path failed, trying routing API...");

    // Fallback to routing API (also in parallel)
    const routingPromises = gatewayUrls.map(async (gatewayUrl) => {
      try {
        const hostname = new URL(gatewayUrl).hostname;
        const response = await fetch(
          `${gatewayUrl}/api/v0/routing/get?arg=/ipns/${this.cachedIpnsName}`,
          {
            method: "POST",
            signal: AbortSignal.timeout(CHAT_ROUTING_TIMEOUT),
          }
        );

        if (response.ok) {
          const json = await response.json() as { Extra?: string };
          if (json.Extra) {
            const recordData = Uint8Array.from(atob(json.Extra), c => c.charCodeAt(0));
            const record = unmarshalIPNSRecord(recordData);
            const cidMatch = record.value.match(/^\/ipfs\/(.+)$/);
            if (cidMatch) {
              console.log(`[ChatHistoryIpfs] IPNS resolved via routing API (${hostname}): ${cidMatch[1].slice(0, 16)}..., seq=${record.sequence}`);
              return { cid: cidMatch[1], sequence: record.sequence };
            }
          }
        } else if (response.status === 500) {
          // 500 error typically means IPNS record doesn't exist yet - this is normal for first sync
          console.debug(`[ChatHistoryIpfs] Routing API ${hostname}: IPNS record not found (500)`);
        }
        return null;
      } catch {
        return null;
      }
    });

    // Race all routing API requests
    const routingResults = await Promise.all(routingPromises);
    const routingResult = routingResults.find(r => r !== null);
    if (routingResult) {
      return routingResult;
    }

    console.log("[ChatHistoryIpfs] IPNS resolution failed on all gateways (record may not exist yet)");
    return null;
  }

  // ==========================================
  // Session Merging
  // ==========================================

  private mergeSessions(local: ChatSessionData[], remote: ChatSessionData[]): ChatSessionData[] {
    const merged = new Map<string, ChatSessionData>();

    // Add all remote sessions
    for (const session of remote) {
      merged.set(session.id, session);
    }

    // Merge local sessions (newer wins)
    for (const session of local) {
      const existing = merged.get(session.id);
      if (!existing || session.updatedAt > existing.updatedAt) {
        merged.set(session.id, session);
      } else if (existing && session.messages.length > existing.messages.length) {
        // Local has more messages, merge
        merged.set(session.id, {
          ...session,
          messages: this.mergeMessages(existing.messages, session.messages),
        });
      }
    }

    // Sort by updatedAt descending
    return Array.from(merged.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  private mergeMessages(remote: ChatMessage[], local: ChatMessage[]): ChatMessage[] {
    const merged = new Map<string, ChatMessage>();

    for (const msg of remote) {
      merged.set(msg.id, msg);
    }

    for (const msg of local) {
      const existing = merged.get(msg.id);
      if (!existing || msg.timestamp > existing.timestamp) {
        merged.set(msg.id, msg);
      }
    }

    return Array.from(merged.values()).sort((a, b) => a.timestamp - b.timestamp);
  }

  // ==========================================
  // Local Storage Helpers
  // ==========================================

  private getStorageKey(prefix: string): string {
    return `${prefix}${this.currentUserId || "unknown"}`;
  }

  private getStoredVersion(): number {
    try {
      const val = localStorage.getItem(this.getStorageKey(VERSION_STORAGE_PREFIX));
      return val ? parseInt(val, 10) : 0;
    } catch {
      return 0;
    }
  }

  private setStoredVersion(version: number): void {
    try {
      localStorage.setItem(this.getStorageKey(VERSION_STORAGE_PREFIX), version.toString());
    } catch {
      // Ignore storage errors
    }
  }

  private getStoredCid(): string | null {
    try {
      return localStorage.getItem(this.getStorageKey(CID_STORAGE_PREFIX));
    } catch {
      return null;
    }
  }

  private setStoredCid(cid: string): void {
    try {
      localStorage.setItem(this.getStorageKey(CID_STORAGE_PREFIX), cid);
    } catch {
      // Ignore storage errors
    }
  }

  private getStoredSequenceNumber(): bigint {
    try {
      const val = localStorage.getItem(this.getStorageKey(IPNS_SEQ_PREFIX));
      return val ? BigInt(val) : 0n;
    } catch {
      return 0n;
    }
  }

  private setStoredSequenceNumber(seq: bigint): void {
    try {
      localStorage.setItem(this.getStorageKey(IPNS_SEQ_PREFIX), seq.toString());
    } catch {
      // Ignore storage errors
    }
  }

  // ==========================================
  // Events
  // ==========================================

  private emitSyncEvent(result: SyncResult): void {
    window.dispatchEvent(
      new CustomEvent("chat-history-ipfs-sync", { detail: result })
    );
  }

  // ==========================================
  // Status
  // ==========================================

  getStatus(): {
    initialized: boolean;
    isSyncing: boolean;
    lastSync: SyncResult | null;
    ipnsName: string | null;
    userId: string | null;
    currentVersion: number;
    lastCid: string | null;
  } {
    return {
      initialized: this.isInitialized(),
      isSyncing: this.isSyncing,
      lastSync: this.lastSyncResult,
      ipnsName: this.cachedIpnsName,
      userId: this.currentUserId,
      currentVersion: this.getStoredVersion(),
      lastCid: this.getStoredCid(),
    };
  }
}

export const chatHistoryIpfsService = ChatHistoryIpfsService.getInstance();
