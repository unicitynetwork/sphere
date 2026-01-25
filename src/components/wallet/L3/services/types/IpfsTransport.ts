/**
 * IPFS Transport Interface
 *
 * Defines the contract for low-level IPFS/IPNS operations used by InventorySyncService.
 * This interface separates transport concerns from sync orchestration logic.
 */

import type { TxfStorageData } from './TxfTypes';

// ==========================================
// Result Types
// ==========================================

/**
 * Result from resolving an IPNS name to a CID
 */
export interface IpnsResolutionResult {
  /** Resolved CID (null if not found) */
  cid: string | null;
  /** IPNS sequence number (for conflict detection) */
  sequence: bigint;
  /** Fetched content (if available) */
  content?: TxfStorageData;
}

/**
 * Result from uploading content to IPFS
 */
export interface IpfsUploadResult {
  /** CID of uploaded content */
  cid: string;
  /** Whether upload succeeded */
  success: boolean;
  /** Error message (if failed) */
  error?: string;
}

/**
 * Result from publishing to IPNS
 */
export interface IpnsPublishResult {
  /** IPNS name that was published */
  ipnsName: string | null;
  /** Whether publish succeeded */
  success: boolean;
  /** IPNS sequence number (if successful) */
  sequence?: bigint;
  /** Whether publish was verified */
  verified: boolean;
  /** Error message (if failed) */
  error?: string;
}

/**
 * Gateway health metrics
 */
export interface GatewayHealth {
  /** Timestamp of last successful operation */
  lastSuccess: number;
  /** Count of consecutive failures */
  failureCount: number;
}

// ==========================================
// Resolution Options
// ==========================================

/**
 * Options for IPNS resolution
 */
export interface IpnsResolveOptions {
  /**
   * If true, return cached value without network call when cache is known-fresh.
   * Used in FAST mode to skip IPNS resolution when we recently published locally.
   * Default: false
   */
  useCacheOnly?: boolean;
}

// ==========================================
// Transport Interface
// ==========================================

/**
 * Pure IPFS/IPNS transport layer interface
 *
 * This interface defines the contract for low-level IPFS operations
 * that InventorySyncService uses. It separates transport concerns
 * from sync orchestration logic.
 */
export interface IpfsTransport {
  // ==========================================
  // Initialization
  // ==========================================

  /**
   * Ensure IPFS client is initialized and ready
   * Returns true if ready, false if unavailable
   */
  ensureInitialized(): Promise<boolean>;

  /**
   * Check if WebCrypto API is available (required for IPNS)
   * Returns true if available, false otherwise
   */
  isWebCryptoAvailable(): boolean;

  // ==========================================
  // IPNS Name Management
  // ==========================================

  /**
   * Get the IPNS name for the current wallet
   * Returns null if not available or not initialized
   */
  getIpnsName(): string | null;

  // ==========================================
  // IPNS Resolution
  // ==========================================

  /**
   * Resolve IPNS name to CID and fetch content
   * Returns resolution result with CID, sequence, and content
   * @param options Optional resolution options (e.g., useCacheOnly for FAST mode)
   */
  resolveIpns(options?: IpnsResolveOptions): Promise<IpnsResolutionResult>;

  // ==========================================
  // IPFS Content Operations
  // ==========================================

  /**
   * Fetch content from IPFS by CID
   * Returns parsed TxfStorageData or null if not found
   */
  fetchContent(cid: string): Promise<TxfStorageData | null>;

  /**
   * Upload content to IPFS
   * Returns CID and success status
   */
  uploadContent(data: TxfStorageData): Promise<IpfsUploadResult>;

  // ==========================================
  // IPNS Publishing
  // ==========================================

  /**
   * Publish CID to IPNS
   * Returns publish result with verification status
   */
  publishIpns(cid: string): Promise<IpnsPublishResult>;

  // ==========================================
  // Version and CID Tracking
  // ==========================================

  /**
   * Get current version counter (monotonic)
   */
  getVersionCounter(): number;

  /**
   * Set version counter
   */
  setVersionCounter(version: number): void;

  /**
   * Get last published CID
   */
  getLastCid(): string | null;

  /**
   * Set last published CID
   */
  setLastCid(cid: string): void;

  // ==========================================
  // IPNS Sequence Tracking
  // ==========================================

  /**
   * Get current IPNS sequence number (for conflict detection)
   */
  getIpnsSequence(): bigint;

  /**
   * Set IPNS sequence number
   */
  setIpnsSequence(seq: bigint): void;

  // ==========================================
  // Gateway Health Monitoring
  // ==========================================

  /**
   * Get gateway health metrics
   * Used for gateway selection and circuit breaking
   */
  getGatewayHealth(): Map<string, GatewayHealth>;
}
