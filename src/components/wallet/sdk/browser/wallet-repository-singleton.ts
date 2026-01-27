/**
 * Browser Wallet Repository Singleton
 *
 * Provides a singleton WalletRepository instance for browser environments.
 * Includes DOM event dispatching for wallet updates.
 *
 * Usage:
 * ```typescript
 * import { getWalletRepository } from '@unicity/wallet-sdk/browser';
 *
 * const repo = getWalletRepository();
 * await repo.loadWalletForAddress(address);
 * ```
 */

import { WalletRepository, type WalletRepositoryConfig } from '../core/wallet-repository';
import { LocalStorageProvider, type LocalStorageProviderConfig } from '../storage/providers/local-storage';
import type { StoredToken, NametagDataBase } from '../core/token-repository';

// ==========================================
// Configuration
// ==========================================

/**
 * Browser-specific configuration
 */
export interface BrowserWalletRepositoryConfig {
  /** Storage prefix (default: 'sphere_wallet_') */
  storagePrefix?: string;
  /** Legacy wallet key for migration */
  legacyWalletKey?: string;
  /** Enable debug logging */
  debug?: boolean;
  /** Custom event name for wallet updates (default: 'wallet-updated') */
  walletUpdatedEvent?: string;
  /** Custom event name for wallet loaded (default: 'wallet-loaded') */
  walletLoadedEvent?: string;
  /** Additional repository config */
  repositoryConfig?: Partial<WalletRepositoryConfig>;
}

// ==========================================
// Default Configuration
// ==========================================

const DEFAULT_CONFIG: BrowserWalletRepositoryConfig = {
  storagePrefix: 'sphere_wallet_',
  walletUpdatedEvent: 'wallet-updated',
  walletLoadedEvent: 'wallet-loaded',
  debug: false,
};

// ==========================================
// Singleton Instance
// ==========================================

let instance: WalletRepository<StoredToken, NametagDataBase> | null = null;
let storage: LocalStorageProvider | null = null;
let initPromise: Promise<void> | null = null;
let currentConfig: BrowserWalletRepositoryConfig = DEFAULT_CONFIG;

/**
 * Dispatch DOM event for wallet updates
 */
function dispatchWalletUpdated(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(currentConfig.walletUpdatedEvent || 'wallet-updated'));
  }
}

/**
 * Dispatch DOM event when wallet is loaded
 */
export function dispatchWalletLoaded(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(currentConfig.walletLoadedEvent || 'wallet-loaded'));
  }
}

/**
 * Get the singleton WalletRepository instance
 *
 * Creates and initializes the repository on first call.
 * Subsequent calls return the same instance.
 *
 * @param config - Optional configuration (only used on first call)
 */
export function getWalletRepository<
  TToken extends StoredToken = StoredToken,
  TNametag extends NametagDataBase = NametagDataBase
>(
  config?: BrowserWalletRepositoryConfig
): WalletRepository<TToken, TNametag> {
  if (!instance) {
    // Merge config with defaults
    currentConfig = { ...DEFAULT_CONFIG, ...config };

    // Create storage provider
    const storageConfig: LocalStorageProviderConfig = {
      prefix: currentConfig.storagePrefix,
      debug: currentConfig.debug,
    };
    storage = new LocalStorageProvider(storageConfig);

    // Create repository with event bridging
    const repoConfig: WalletRepositoryConfig = {
      onWalletUpdated: dispatchWalletUpdated,
      legacyWalletKey: currentConfig.legacyWalletKey,
      debug: currentConfig.debug,
      ...currentConfig.repositoryConfig,
    };

    instance = new WalletRepository<TToken, TNametag>(
      storage as LocalStorageProvider,
      repoConfig
    );

    // Initialize asynchronously (fire-and-forget)
    initPromise = (async () => {
      try {
        await storage!.connect();
        await instance!.init();
        if (currentConfig.debug) {
          console.log('💾 Browser WalletRepository initialized');
        }
      } catch (error) {
        console.error('💾 Failed to initialize WalletRepository:', error);
      }
    })();
  }

  return instance as WalletRepository<TToken, TNametag>;
}

/**
 * Wait for repository initialization to complete
 *
 * Useful when you need to ensure the repository is fully initialized
 * before performing operations.
 */
export async function waitForInit(): Promise<void> {
  if (initPromise) {
    await initPromise;
  }
}

/**
 * Dispose the singleton instance
 *
 * Useful for testing or when switching users.
 */
export function disposeWalletRepository(): void {
  if (storage) {
    storage.disconnect().catch(console.error);
  }
  instance = null;
  storage = null;
  initPromise = null;
  currentConfig = DEFAULT_CONFIG;
}

/**
 * Check if repository is initialized
 */
export function isRepositoryInitialized(): boolean {
  return instance !== null;
}
