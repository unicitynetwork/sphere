/**
 * Browser IPFS/IPNS Submodule
 *
 * Browser-specific IPFS storage and IPNS resolution:
 * - IPFS storage provider for token persistence
 * - IPNS client for key derivation, publishing, and resolution
 * - State persistence using localStorage
 * - Nametag fetching via IPNS
 */

// Types
export type {
  IpnsGatewayResult,
  IpnsProgressiveResult,
  IpnsPublishResult,
  IpfsStorageConfig,
  IpfsStorageStatus,
  IpfsContentResult,
  GatewayHealthResult,
} from './ipfs-types';

export { DEFAULT_IPFS_CONFIG } from './ipfs-types';

// IPNS Client
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

// IPFS Storage Provider
export {
  IpfsStorageProvider,
  createIpfsStorageProvider,
} from './ipfs-storage-provider';

// Browser State Persistence
export {
  BrowserIpfsStatePersistence,
  createBrowserIpfsStatePersistence,
} from './ipfs-state-persistence-browser';

// Nametag Fetcher
export {
  fetchNametagFromIpns,
  fetchNametagsForKeys,
  type IpnsNametagResult,
  type IpnsNametagConfig,
} from './ipns-nametag-fetcher';
