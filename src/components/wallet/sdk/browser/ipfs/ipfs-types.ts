/**
 * IPFS Storage Types (Browser-specific)
 *
 * Types for IPFS/IPNS storage operations.
 */

import type { TxfStorageDataBase } from '../../types/txf';
import type { IpfsStatePersistence } from '../../storage/ipfs-state-persistence';

// ==========================================
// IPNS Types
// ==========================================

/**
 * Result of IPNS resolution from a single gateway
 */
export interface IpnsGatewayResult {
  /** CID string that the IPNS name points to */
  cid: string;
  /** IPNS record sequence number */
  sequence: bigint;
  /** Gateway URL that resolved this */
  gateway: string;
  /** Raw IPNS record data */
  recordData: Uint8Array;
  /** Cached content (avoids re-fetch) */
  cachedContent?: TxfStorageDataBase;
}

/**
 * Result of progressive IPNS resolution across multiple gateways
 */
export interface IpnsProgressiveResult {
  /** Best result (highest sequence number) */
  best: IpnsGatewayResult | null;
  /** All successful results */
  allResults: IpnsGatewayResult[];
  /** Number of gateways that responded */
  respondedCount: number;
  /** Total number of gateways queried */
  totalGateways: number;
}

/**
 * IPNS publish result
 */
export interface IpnsPublishResult {
  success: boolean;
  /** IPNS name (PeerId string) */
  ipnsName?: string;
  /** CID that was published */
  cid?: string;
  /** New sequence number */
  sequence?: bigint;
  /** Gateways that accepted the publish */
  successfulGateways?: string[];
  /** Error message if failed */
  error?: string;
}

// ==========================================
// IPFS Storage Options
// ==========================================

/**
 * Configuration for IPFS storage provider
 */
export interface IpfsStorageConfig {
  /** Private key for IPNS (hex string) */
  privateKey: string;
  /** Gateway URLs for IPNS resolution and publishing */
  gatewayUrls: string[];
  /** Bootstrap peers for Helia */
  bootstrapPeers?: string[];
  /** Backend peer ID for direct connections */
  backendPeerId?: string;
  /** Enable debug logging */
  debug?: boolean;
  /** IPNS record TTL in seconds */
  ipnsTtlSeconds?: number;
  /** Timeout for gateway requests in ms */
  gatewayTimeoutMs?: number;
  /** State persistence provider (optional - uses in-memory if not provided) */
  statePersistence?: IpfsStatePersistence;
}

/**
 * Default IPFS storage configuration
 */
export const DEFAULT_IPFS_CONFIG: Partial<IpfsStorageConfig> = {
  ipnsTtlSeconds: 60,
  gatewayTimeoutMs: 10000,
  debug: false,
};

// ==========================================
// IPFS Storage Status
// ==========================================

/**
 * Status of IPFS storage
 */
export interface IpfsStorageStatus {
  /** Whether Helia is initialized */
  heliaInitialized: boolean;
  /** Whether keys are derived */
  keysReady: boolean;
  /** IPNS name (PeerId) */
  ipnsName: string | null;
  /** Last known CID */
  lastCid: string | null;
  /** Current IPNS sequence number */
  sequenceNumber: bigint;
  /** Whether WebCrypto is available */
  webCryptoAvailable: boolean;
  /** Number of connected peers */
  connectedPeers?: number;
}

// ==========================================
// Content Fetching
// ==========================================

/**
 * Result of fetching content from IPFS
 */
export interface IpfsContentResult<T = TxfStorageDataBase> {
  success: boolean;
  /** Fetched content */
  data?: T;
  /** CID of the content */
  cid?: string;
  /** Source (gateway URL or 'helia') */
  source?: string;
  /** Error message if failed */
  error?: string;
}

// ==========================================
// Gateway Health
// ==========================================

/**
 * Gateway health check result
 */
export interface GatewayHealthResult {
  url: string;
  healthy: boolean;
  latencyMs?: number;
  error?: string;
}
