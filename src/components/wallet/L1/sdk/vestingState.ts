import { vestingClassifier } from "./vesting";
import type {
  UTXO,
  ClassifiedUTXO,
  VestingMode,
  VestingBalances,
} from "./types";

interface AddressVestingCache {
  classifiedUtxos: {
    vested: ClassifiedUTXO[];
    unvested: ClassifiedUTXO[];
    all: ClassifiedUTXO[];
  };
  vestingBalances: VestingBalances;
}

class VestingStateManager {
  private currentMode: VestingMode = "all";
  private addressCache = new Map<string, AddressVestingCache>();
  private classificationInProgress = false;

  /**
   * Set the current vesting mode
   */
  setMode(mode: VestingMode): void {
    if (!["all", "vested", "unvested"].includes(mode)) {
      throw new Error(`Invalid vesting mode: ${mode}`);
    }
    this.currentMode = mode;
  }

  getMode(): VestingMode {
    return this.currentMode;
  }

  /**
   * Classify all UTXOs for an address
   */
  async classifyAddressUtxos(
    address: string,
    utxos: UTXO[],
    onProgress?: (current: number, total: number) => void
  ): Promise<void> {
    if (this.classificationInProgress) return;

    this.classificationInProgress = true;

    try {
      await vestingClassifier.initDB();

      const result = await vestingClassifier.classifyUtxos(utxos, onProgress);

      // Calculate balances
      const vestedBalance = result.vested.reduce(
        (sum, utxo) => sum + BigInt(utxo.value),
        0n
      );
      const unvestedBalance = result.unvested.reduce(
        (sum, utxo) => sum + BigInt(utxo.value),
        0n
      );

      // Store in cache
      this.addressCache.set(address, {
        classifiedUtxos: {
          vested: result.vested,
          unvested: result.unvested,
          all: [...result.vested, ...result.unvested],
        },
        vestingBalances: {
          vested: vestedBalance,
          unvested: unvestedBalance,
          all: vestedBalance + unvestedBalance,
        },
      });

      // Log any errors
      if (result.errors.length > 0) {
        console.warn(`Vesting classification errors: ${result.errors.length}`);
        result.errors.slice(0, 5).forEach((err) => {
          const txHash = err.utxo.tx_hash || err.utxo.txid;
          console.warn(`  ${txHash}: ${err.error}`);
        });
      }
    } finally {
      this.classificationInProgress = false;
    }
  }

  /**
   * Get filtered UTXOs based on current vesting mode
   */
  getFilteredUtxos(address: string): ClassifiedUTXO[] {
    const cache = this.addressCache.get(address);
    if (!cache) return [];

    switch (this.currentMode) {
      case "vested":
        return cache.classifiedUtxos.vested;
      case "unvested":
        return cache.classifiedUtxos.unvested;
      default:
        return cache.classifiedUtxos.all;
    }
  }

  /**
   * Get balance for current vesting mode (in satoshis)
   */
  getBalance(address: string): bigint {
    const cache = this.addressCache.get(address);
    if (!cache) return 0n;

    return cache.vestingBalances[this.currentMode];
  }

  /**
   * Get all balances for display
   */
  getAllBalances(address: string): VestingBalances {
    const cache = this.addressCache.get(address);
    if (!cache) {
      return { vested: 0n, unvested: 0n, all: 0n };
    }
    return cache.vestingBalances;
  }

  /**
   * Check if address has been classified
   */
  hasClassifiedData(address: string): boolean {
    return this.addressCache.has(address);
  }

  /**
   * Check if classification is in progress
   */
  isClassifying(): boolean {
    return this.classificationInProgress;
  }

  /**
   * Clear cache for an address
   */
  clearAddressCache(address: string): void {
    this.addressCache.delete(address);
  }

  /**
   * Clear all caches
   */
  clearAllCaches(): void {
    this.addressCache.clear();
    vestingClassifier.clearCaches();
  }
}

export const vestingState = new VestingStateManager();
