/**
 * Browser Vesting Classifier
 *
 * Browser-specific wrapper around SDK VestingClassifier.
 * Uses BrowserNetworkProvider for network and IndexedDBVestingCache for caching.
 */

import { getBrowserProvider } from '../network';
import { IndexedDBVestingCache } from '../storage';
import {
  VestingClassifier,
  VESTING_THRESHOLD,
  type ClassificationResult,
  type ClassifiedUTXO,
  type ClassifyUtxosResult,
} from '../../transaction/vesting';
import type { L1UTXO } from '../../types';

// Re-export SDK constants and types for backwards compatibility
export { VESTING_THRESHOLD };
export type { ClassificationResult, ClassifiedUTXO, ClassifyUtxosResult };

/**
 * Browser-specific vesting classifier.
 * Uses BrowserNetworkProvider and IndexedDB cache.
 */
export class BrowserVestingClassifier {
  private classifier: VestingClassifier | null = null;
  private cache: IndexedDBVestingCache | null = null;
  private initPromise: Promise<void> | null = null;

  /**
   * Ensure classifier is initialized
   */
  private async ensureInitialized(): Promise<VestingClassifier> {
    if (this.classifier) {
      return this.classifier;
    }

    if (!this.initPromise) {
      this.initPromise = this.initialize();
    }

    await this.initPromise;
    return this.classifier!;
  }

  private async initialize(): Promise<void> {
    this.cache = new IndexedDBVestingCache();
    await this.cache.init();
    this.classifier = new VestingClassifier(getBrowserProvider(), this.cache);
    await this.classifier.init();
  }

  /**
   * Classify a single UTXO
   */
  async classifyUtxo(utxo: L1UTXO): Promise<ClassificationResult> {
    const classifier = await this.ensureInitialized();
    return classifier.classifyUtxo(utxo);
  }

  /**
   * Classify multiple UTXOs with progress callback
   */
  async classifyUtxos(
    utxos: L1UTXO[],
    onProgress?: (current: number, total: number) => void
  ): Promise<ClassifyUtxosResult> {
    const classifier = await this.ensureInitialized();

    console.log(
      `VestingClassifier: threshold=${VESTING_THRESHOLD}, utxos=${utxos.length}`
    );

    const result = await classifier.classifyUtxos(utxos, onProgress);

    console.log(
      `VestingClassifier: ${result.vested.length} vested, ${result.unvested.length} unvested, ${result.errors.length} errors`
    );

    return result;
  }

  /**
   * Clear all caches
   */
  async clearCaches(): Promise<void> {
    if (this.classifier) {
      await this.classifier.clearCaches();
    }
  }
}

// ==========================================
// Singleton Instance
// ==========================================

let vestingClassifierInstance: BrowserVestingClassifier | null = null;

/**
 * Get the singleton BrowserVestingClassifier instance
 */
export function getVestingClassifier(): BrowserVestingClassifier {
  if (!vestingClassifierInstance) {
    vestingClassifierInstance = new BrowserVestingClassifier();
  }
  return vestingClassifierInstance;
}
