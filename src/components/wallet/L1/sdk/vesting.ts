/**
 * Vesting Classification - Browser Implementation
 *
 * Browser-specific wrapper around SDK VestingClassifier.
 * Uses browserProvider for network and IndexedDB for caching.
 *
 * Re-exports SDK types for backwards compatibility.
 */

import { browserProvider } from './network';
import { IndexedDBVestingCache } from './vestingCache';
import {
  VestingClassifier,
  VESTING_THRESHOLD,
  type ClassificationResult,
  type ClassifiedUTXO,
  type ClassifyUtxosResult,
} from '../../sdk/vesting';
import type { UTXO } from './types';

// Re-export SDK constants and types for backwards compatibility
export { VESTING_THRESHOLD };
export type { ClassificationResult, ClassifiedUTXO, ClassifyUtxosResult };

// ==========================================
// Browser Vesting Classifier Singleton
// ==========================================

/**
 * Browser-specific vesting classifier instance.
 * Uses browserProvider and IndexedDB cache.
 */
class BrowserVestingClassifier {
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
    this.classifier = new VestingClassifier(browserProvider, this.cache);
    await this.classifier.init();
  }

  /**
   * Classify a single UTXO
   */
  async classifyUtxo(utxo: UTXO): Promise<ClassificationResult> {
    const classifier = await this.ensureInitialized();
    return classifier.classifyUtxo(utxo);
  }

  /**
   * Classify multiple UTXOs with progress callback
   */
  async classifyUtxos(
    utxos: UTXO[],
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

// Export singleton instance
export const vestingClassifier = new BrowserVestingClassifier();
