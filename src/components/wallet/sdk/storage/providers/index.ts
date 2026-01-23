/**
 * Storage Providers
 *
 * Platform-specific storage implementations.
 */

// Local Storage (Browser)
export {
  LocalStorageProvider,
  createLocalStorageProvider,
  type LocalStorageProviderConfig,
} from './local-storage';

// In-Memory (Testing)
export {
  InMemoryProvider,
  createInMemoryProvider,
  type InMemoryProviderConfig,
} from './in-memory';

// IPFS Sync Provider
export {
  IpfsSyncProvider,
  createIpfsSyncProvider,
  type IpfsSyncProviderConfig,
  type IpnsKeyPair,
} from './ipfs-sync';

// Re-export base types and constants
export {
  PROVIDER_IDS,
} from '../storage-provider';

export type {
  StorageProvider,
  StorageProviderConfig,
  ProviderStatus,
  ProviderType,
  ProviderMetadata,
} from '../storage-provider';
