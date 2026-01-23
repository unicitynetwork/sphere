/**
 * IPFS/IPNS Module (Platform-Independent)
 *
 * Unified module for IPFS content storage and IPNS name resolution.
 * All operations work via HTTP API to IPFS gateways.
 *
 * Structure:
 * - crypto.ts: Key derivation, CID computation (pure, no I/O)
 * - cache.ts: Intelligent caching with TTL
 * - metrics.ts: Performance tracking
 * - http-resolver.ts: IPNS resolution, content fetching
 * - publisher.ts: Content upload, IPNS publishing
 * - sync-queue.ts: Priority queue with coalescing
 */

// ==========================================
// Crypto (pure functions, no I/O)
// ==========================================

export {
  // Constants
  IPNS_HKDF_INFO,
  // IPNS key derivation
  deriveEd25519KeyMaterial,
  deriveIpnsNameFromPrivateKey,
  deriveEd25519KeyPair,
  derivePeerIdFromPrivateKey,
  // CID computation
  computeCidFromContent,
  verifyCid,
} from './crypto';

// ==========================================
// Cache
// ==========================================

export {
  IpfsCache,
  getIpfsCache,
  type IpnsGatewayResult,
} from './cache';

// ==========================================
// Metrics
// ==========================================

export {
  IpfsMetricsCollector,
  getIpfsMetrics,
  resetIpfsMetrics,
  type IpfsOperation,
  type IpfsSource,
  type IpfsOperationMetric,
  type IpfsMetricsSnapshot,
} from './metrics';

// ==========================================
// HTTP Resolver
// ==========================================

export {
  IpfsHttpResolver,
  createIpfsHttpResolver,
  type IpnsResolutionResult,
  type IpfsHttpResolverConfig,
} from './http-resolver';

// ==========================================
// Publisher
// ==========================================

export {
  IpfsPublisher,
  createIpfsPublisher,
  type PublishResult,
  type IpfsPublisherConfig,
} from './publisher';

// ==========================================
// Sync Queue
// ==========================================

export {
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
} from './sync-queue';
