/**
 * Trust Base Provider (Platform-Independent)
 *
 * Abstracts loading and caching of the Unicity RootTrustBase.
 * Platform implementations provide the actual loader.
 */

// ==========================================
// Types
// ==========================================

/**
 * Configuration for CachedTrustBaseProvider
 */
export interface TrustBaseProviderConfig {
  /** Cache time-to-live in milliseconds (default: 1 hour) */
  cacheTtlMs?: number;
}

/**
 * Loader function that returns the trust base
 * Platform-specific implementations will load from different sources:
 * - Browser: Load from assets or HTTP
 * - Node.js: Load from file or HTTP
 */
export type TrustBaseLoader = () => Promise<unknown>;

/**
 * Interface for trust base providers
 */
export interface TrustBaseProvider {
  /**
   * Get the root trust base
   * May be cached for performance
   */
  getTrustBase(): Promise<unknown | null>;

  /**
   * Check if trust base is available
   */
  isAvailable(): Promise<boolean>;

  /**
   * Invalidate the cache and force reload on next call
   */
  invalidateCache(): void;

  /**
   * Get cache age in milliseconds (null if not cached)
   */
  getCacheAge(): number | null;
}

// ==========================================
// CachedTrustBaseProvider
// ==========================================

/**
 * Trust base provider with caching
 *
 * Usage:
 * ```typescript
 * // Browser
 * const provider = new CachedTrustBaseProvider(
 *   async () => {
 *     const response = await fetch('/trustbase-testnet.json');
 *     const data = await response.json();
 *     return RootTrustBase.fromJSON(data);
 *   },
 *   { cacheTtlMs: 60 * 60 * 1000 } // 1 hour
 * );
 *
 * // Node.js
 * const provider = new CachedTrustBaseProvider(
 *   async () => {
 *     const data = JSON.parse(fs.readFileSync('trustbase.json', 'utf-8'));
 *     return RootTrustBase.fromJSON(data);
 *   }
 * );
 * ```
 */
export class CachedTrustBaseProvider implements TrustBaseProvider {
  private loader: TrustBaseLoader;
  private cacheTtlMs: number;
  private cache: unknown | null = null;
  private cacheTime: number = 0;
  private loadPromise: Promise<unknown | null> | null = null;

  constructor(loader: TrustBaseLoader, config?: TrustBaseProviderConfig) {
    this.loader = loader;
    this.cacheTtlMs = config?.cacheTtlMs ?? 60 * 60 * 1000; // 1 hour default
  }

  /**
   * Get the trust base, using cache if available and fresh
   */
  async getTrustBase(): Promise<unknown | null> {
    // Check if cache is valid
    if (this.cache !== null && this.isCacheValid()) {
      return this.cache;
    }

    // Prevent concurrent loads
    if (this.loadPromise) {
      return this.loadPromise;
    }

    this.loadPromise = this.loadTrustBase();

    try {
      return await this.loadPromise;
    } finally {
      this.loadPromise = null;
    }
  }

  /**
   * Check if trust base can be loaded
   */
  async isAvailable(): Promise<boolean> {
    try {
      const trustBase = await this.getTrustBase();
      return trustBase !== null;
    } catch {
      return false;
    }
  }

  /**
   * Invalidate the cache
   */
  invalidateCache(): void {
    this.cache = null;
    this.cacheTime = 0;
  }

  /**
   * Get cache age in milliseconds (null if not cached)
   */
  getCacheAge(): number | null {
    if (this.cache === null || this.cacheTime === 0) {
      return null;
    }
    return Date.now() - this.cacheTime;
  }

  /**
   * Check if cache is still valid
   */
  private isCacheValid(): boolean {
    if (this.cache === null) return false;
    const age = Date.now() - this.cacheTime;
    return age < this.cacheTtlMs;
  }

  /**
   * Load trust base using the provided loader
   */
  private async loadTrustBase(): Promise<unknown | null> {
    try {
      const trustBase = await this.loader();
      this.cache = trustBase;
      this.cacheTime = Date.now();
      return trustBase;
    } catch (error) {
      console.warn(
        '📦 Failed to load trust base:',
        error instanceof Error ? error.message : error
      );
      return null;
    }
  }
}

// ==========================================
// InMemoryTrustBaseProvider
// ==========================================

/**
 * Simple trust base provider for testing
 * Holds a pre-loaded trust base
 */
export class InMemoryTrustBaseProvider implements TrustBaseProvider {
  private trustBase: unknown | null;

  constructor(trustBase: unknown | null = null) {
    this.trustBase = trustBase;
  }

  async getTrustBase(): Promise<unknown | null> {
    return this.trustBase;
  }

  async isAvailable(): Promise<boolean> {
    return this.trustBase !== null;
  }

  invalidateCache(): void {
    // No-op for in-memory provider
  }

  getCacheAge(): number | null {
    return null;
  }

  /**
   * Update the trust base (useful for testing)
   */
  setTrustBase(trustBase: unknown | null): void {
    this.trustBase = trustBase;
  }
}

// ==========================================
// Factory Functions
// ==========================================

/**
 * Create a cached trust base provider
 */
export function createCachedTrustBaseProvider(
  loader: TrustBaseLoader,
  config?: TrustBaseProviderConfig
): CachedTrustBaseProvider {
  return new CachedTrustBaseProvider(loader, config);
}

/**
 * Create an in-memory trust base provider (for testing)
 */
export function createInMemoryTrustBaseProvider(
  trustBase?: unknown
): InMemoryTrustBaseProvider {
  return new InMemoryTrustBaseProvider(trustBase);
}
