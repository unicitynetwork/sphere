/**
 * Browser IPFS/IPNS Submodule
 *
 * Re-exports platform-independent modules from sdk/ipfs/
 * plus browser-specific implementations:
 * - localStorage state persistence
 * - IPNS client with Helia
 * - IPFS storage provider
 * - Nametag fetcher
 */

// ==========================================
// Re-export from sdk/ipfs/ (platform-independent)
// ==========================================

export {
  // Crypto
  IPNS_HKDF_INFO,
  deriveEd25519KeyMaterial,
  deriveIpnsNameFromPrivateKey,
  deriveEd25519KeyPair,
  derivePeerIdFromPrivateKey,
  computeCidFromContent,
  verifyCid,
  // Cache
  IpfsCache,
  getIpfsCache,
  type IpnsGatewayResult,
  // Metrics
  IpfsMetricsCollector,
  getIpfsMetrics,
  resetIpfsMetrics,
  type IpfsOperation,
  type IpfsSource,
  type IpfsOperationMetric,
  type IpfsMetricsSnapshot,
  // HTTP Resolver
  IpfsHttpResolver,
  createIpfsHttpResolver,
  type IpnsResolutionResult,
  type IpfsHttpResolverConfig,
  // Publisher
  IpfsPublisher,
  createIpfsPublisher,
  type PublishResult,
  type IpfsPublisherConfig,
  // Sync Queue
  SyncQueue,
  createSyncQueue,
  SyncPriority,
  type SyncPriority as SyncPriorityType,
  type SyncOptions,
  type SyncResultBase,
  type QueueStatus,
  type SyncQueueConfig,
  type SyncExecutor,
  type ErrorResultFactory,
} from '../../ipfs';

// ==========================================
// Browser-specific: Types
// ==========================================

export type {
  IpnsGatewayResult as IpnsGatewayResultLegacy,
  IpnsProgressiveResult,
  IpnsPublishResult,
  IpfsStorageConfig,
  IpfsStorageStatus,
  IpfsContentResult,
  GatewayHealthResult,
} from './ipfs-types';

export { DEFAULT_IPFS_CONFIG } from './ipfs-types';

// ==========================================
// Browser-specific: IPNS Client (Helia-based)
// ==========================================

export {
  deriveIpnsKeyPair,
  createSignedIpnsRecord,
  publishIpnsToGateway,
  publishIpnsToGateways,
  resolveIpnsFromGateway,
  resolveIpnsViaPath,
  resolveIpnsProgressively,
  fetchIpfsContent,
  uploadIpfsContent,
  uint8ArrayToBase64,
} from './ipns-client';

// ==========================================
// Browser-specific: Storage Provider
// ==========================================

export {
  IpfsStorageProvider,
  createIpfsStorageProvider,
} from './ipfs-storage-provider';

// ==========================================
// Browser-specific: State Persistence (localStorage)
// ==========================================

export {
  BrowserIpfsStatePersistence,
  createBrowserIpfsStatePersistence,
} from './ipfs-state-persistence-browser';

// ==========================================
// Browser-specific: Nametag Fetcher
// ==========================================

export {
  fetchNametagFromIpns,
  fetchNametagsForKeys,
  type IpnsNametagResult,
  type IpnsNametagConfig,
} from './ipns-nametag-fetcher';

// Legacy alias for backwards compatibility
export type { IpnsGatewayResult as IpnsCacheResult } from '../../ipfs';
