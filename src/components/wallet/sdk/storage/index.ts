/**
 * Token Storage - platform-independent
 *
 * NOTE: FileStorageProvider is NOT exported from here because it uses
 * Node.js-only modules (fs, path) that break browser bundlers like Vite.
 * For Node.js/CLI usage, import directly from './file-storage'.
 */

// Types
export type {
  // Event types
  StorageEventType,
  StorageEvent,
  StorageEventCallback,
  // Result types
  SaveResult,
  LoadResult,
  SyncResult,
  StorageStatus,
  // Provider interface
  TokenStorageProvider,
  // Options types
  StorageProviderOptions,
  FileStorageOptions,
  IpfsStorageOptions,
  InMemoryStorageOptions,
  // Factory type
  StorageProviderFactory,
} from './types';

// Conflict Resolution
export {
  ConflictResolutionService,
  createConflictResolutionService,
} from './conflict-resolution';

// In-Memory Storage (browser & Node.js)
export {
  InMemoryStorageProvider,
  createInMemoryStorageProvider,
} from './in-memory-storage';

// IPFS State Persistence Interface
export type {
  IpfsPersistedState,
  IpfsStatePersistence,
} from './ipfs-state-persistence';

export {
  InMemoryIpfsStatePersistence,
  createInMemoryIpfsStatePersistence,
} from './ipfs-state-persistence';

// NOTE: FileStorageProvider is available for Node.js only:
// import { FileStorageProvider, createFileStorageProvider } from './sdk/storage/file-storage';
