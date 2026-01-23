/**
 * Vesting Classification - Pure SDK Implementation
 *
 * Traces UTXOs to their coinbase origin to determine vesting status.
 * VESTED: Coins from coinbase transactions in blocks <= VESTING_THRESHOLD
 * UNVESTED: Coins from coinbase transactions in blocks > VESTING_THRESHOLD
 *
 * This is a pure implementation that accepts NetworkProvider and CacheProvider
 * as dependencies, making it portable across platforms.
 */

import type {
  L1UTXO,
  VestingCacheProvider,
  VestingCacheEntry,
} from '../types';
import type { L1NetworkProviderFull, TransactionDetail } from '../network/network';

// ==========================================
// Constants
// ==========================================

/** Block height threshold for vesting classification */
export const VESTING_THRESHOLD = 280000;

// ==========================================
// Types
// ==========================================

/**
 * Result of classifying a single UTXO
 */
export interface ClassificationResult {
  isVested: boolean;
  coinbaseHeight: number | null;
  error?: string;
}

/**
 * UTXO with vesting classification
 */
export interface ClassifiedUTXO extends L1UTXO {
  vestingStatus: 'vested' | 'unvested' | 'error';
  coinbaseHeight: number | null;
}

/**
 * Result of classifying multiple UTXOs
 */
export interface ClassifyUtxosResult {
  vested: ClassifiedUTXO[];
  unvested: ClassifiedUTXO[];
  errors: Array<{ utxo: L1UTXO; error: string }>;
}

/**
 * Progress callback for batch classification
 */
export type ClassificationProgressCallback = (current: number, total: number) => void;

// ==========================================
// In-Memory Cache (fallback when no provider)
// ==========================================

/**
 * Simple in-memory cache provider
 * Used when no persistent cache is provided
 */
export class InMemoryCacheProvider implements VestingCacheProvider {
  private cache = new Map<string, VestingCacheEntry>();

  async init(): Promise<void> {
    // Nothing to initialize
  }

  async get(txHash: string): Promise<VestingCacheEntry | null> {
    return this.cache.get(txHash) ?? null;
  }

  async set(txHash: string, entry: VestingCacheEntry): Promise<void> {
    this.cache.set(txHash, entry);
  }

  async clear(): Promise<void> {
    this.cache.clear();
  }
}

// ==========================================
// VestingClassifier Class
// ==========================================

/**
 * Classifies UTXOs by tracing them to their coinbase origin.
 *
 * Pure implementation - requires NetworkProvider and optionally CacheProvider.
 * Platform-specific code should create instances with appropriate providers.
 */
export class VestingClassifier {
  private networkProvider: L1NetworkProviderFull;
  private cacheProvider: VestingCacheProvider;
  private memoryCache = new Map<string, VestingCacheEntry>();
  private currentBlockHeight: number | null = null;

  constructor(
    networkProvider: L1NetworkProviderFull,
    cacheProvider?: VestingCacheProvider
  ) {
    this.networkProvider = networkProvider;
    this.cacheProvider = cacheProvider ?? new InMemoryCacheProvider();
  }

  /**
   * Initialize the classifier (must be called before use)
   */
  async init(): Promise<void> {
    await this.cacheProvider.init();
  }

  /**
   * Check if transaction is coinbase
   */
  private isCoinbaseTransaction(txData: TransactionDetail): boolean {
    if (txData.vin && txData.vin.length === 1) {
      const vin = txData.vin[0];
      // Check for missing txid or zero txid (coinbase indicators)
      if (!vin.txid) {
        return true;
      }
      // Some formats use all-zeros txid for coinbase
      if (vin.txid === '0000000000000000000000000000000000000000000000000000000000000000') {
        return true;
      }
    }
    return false;
  }

  /**
   * Trace a transaction to its coinbase origin
   * Alpha blockchain has single-input transactions, making this a linear trace
   */
  async traceToOrigin(txHash: string): Promise<{ coinbaseHeight: number | null; error?: string }> {
    let currentTxHash = txHash;
    let iterations = 0;
    const MAX_ITERATIONS = 10000;

    while (iterations < MAX_ITERATIONS) {
      iterations++;

      // Check memory cache first
      const memCached = this.memoryCache.get(currentTxHash);
      if (memCached) {
        if (memCached.isCoinbase) {
          if (memCached.blockHeight !== null && memCached.blockHeight !== undefined) {
            return { coinbaseHeight: memCached.blockHeight };
          }
          // Fall through to re-fetch if blockHeight is null
        } else if (memCached.inputTxId) {
          currentTxHash = memCached.inputTxId;
          continue;
        }
      }

      // Check persistent cache
      const cached = await this.cacheProvider.get(currentTxHash);
      if (cached) {
        // Store in memory cache
        this.memoryCache.set(currentTxHash, cached);

        if (cached.isCoinbase) {
          if (cached.blockHeight !== null && cached.blockHeight !== undefined) {
            return { coinbaseHeight: cached.blockHeight };
          }
          // Fall through to re-fetch
        } else if (cached.inputTxId) {
          currentTxHash = cached.inputTxId;
          continue;
        }
      }

      // Fetch from network
      let txData: TransactionDetail;
      try {
        txData = await this.networkProvider.getTransaction(currentTxHash);
      } catch (err) {
        return {
          coinbaseHeight: null,
          error: `Failed to fetch tx ${currentTxHash}: ${err instanceof Error ? err.message : String(err)}`,
        };
      }

      if (!txData || !txData.txid) {
        return { coinbaseHeight: null, error: `Invalid tx data for ${currentTxHash}` };
      }

      // Determine if this is a coinbase transaction
      const isCoinbase = this.isCoinbaseTransaction(txData);

      // Calculate block height from confirmations
      let blockHeight: number | null = null;
      if (txData.confirmations && this.currentBlockHeight !== null) {
        blockHeight = this.currentBlockHeight - txData.confirmations + 1;
      }

      // Get input transaction ID (if not coinbase)
      let inputTxId: string | null = null;
      if (!isCoinbase && txData.vin && txData.vin.length > 0 && txData.vin[0].txid) {
        inputTxId = txData.vin[0].txid;
      }

      // Cache the result
      const cacheEntry: VestingCacheEntry = {
        blockHeight,
        isCoinbase,
        inputTxId,
      };
      this.memoryCache.set(currentTxHash, cacheEntry);
      await this.cacheProvider.set(currentTxHash, cacheEntry);

      if (isCoinbase) {
        return { coinbaseHeight: blockHeight };
      }

      if (!inputTxId) {
        return { coinbaseHeight: null, error: 'Could not find input transaction' };
      }

      currentTxHash = inputTxId;
    }

    return { coinbaseHeight: null, error: 'Max iterations exceeded' };
  }

  /**
   * Classify a single UTXO
   */
  async classifyUtxo(utxo: L1UTXO): Promise<ClassificationResult> {
    const txHash = utxo.tx_hash || utxo.txid;
    if (!txHash) {
      return { isVested: false, coinbaseHeight: null, error: 'No transaction hash' };
    }

    try {
      const result = await this.traceToOrigin(txHash);
      if (result.error || result.coinbaseHeight === null) {
        return {
          isVested: false,
          coinbaseHeight: null,
          error: result.error || 'Could not trace to origin',
        };
      }
      return {
        isVested: result.coinbaseHeight <= VESTING_THRESHOLD,
        coinbaseHeight: result.coinbaseHeight,
      };
    } catch (err) {
      return {
        isVested: false,
        coinbaseHeight: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Classify multiple UTXOs with progress callback
   */
  async classifyUtxos(
    utxos: L1UTXO[],
    onProgress?: ClassificationProgressCallback
  ): Promise<ClassifyUtxosResult> {
    // Get current block height before classification
    this.currentBlockHeight = await this.networkProvider.getCurrentBlockHeight();

    // Clear memory cache to force re-fetch with current block height
    this.memoryCache.clear();

    const vested: ClassifiedUTXO[] = [];
    const unvested: ClassifiedUTXO[] = [];
    const errors: Array<{ utxo: L1UTXO; error: string }> = [];

    for (let i = 0; i < utxos.length; i++) {
      const utxo = utxos[i];
      const result = await this.classifyUtxo(utxo);

      if (result.error) {
        errors.push({ utxo, error: result.error });
        // Default to unvested on error for safety
        unvested.push({
          ...utxo,
          vestingStatus: 'error',
          coinbaseHeight: null,
        });
      } else if (result.isVested) {
        vested.push({
          ...utxo,
          vestingStatus: 'vested',
          coinbaseHeight: result.coinbaseHeight,
        });
      } else {
        unvested.push({
          ...utxo,
          vestingStatus: 'unvested',
          coinbaseHeight: result.coinbaseHeight,
        });
      }

      // Report progress
      onProgress?.(i + 1, utxos.length);
    }

    return { vested, unvested, errors };
  }

  /**
   * Clear all caches
   */
  async clearCaches(): Promise<void> {
    this.memoryCache.clear();
    await this.cacheProvider.clear();
  }

  /**
   * Set current block height (useful for testing or when already known)
   */
  setBlockHeight(height: number): void {
    this.currentBlockHeight = height;
  }
}
