/**
 * VestingClassifier - Traces UTXOs to their coinbase origin to determine vesting status
 * VESTED: Coins from coinbase transactions in blocks <= VESTING_THRESHOLD (280000)
 * UNVESTED: Coins from coinbase transactions in blocks > VESTING_THRESHOLD
 *
 * Direct port from index.html VestingClassifier
 */
import { getTransaction, getCurrentBlockHeight } from "./network";
import type { UTXO, ClassifiedUTXO, ClassificationResult } from "./types";

export const VESTING_THRESHOLD = 280000;

// Current block height - updated during classification
let currentBlockHeight: number | null = null;

interface CacheEntry {
  blockHeight: number | null;  // null means "not computed yet"
  isCoinbase: boolean;
  inputTxId: string | null;
}

interface TransactionData {
  txid: string;
  confirmations?: number;
  height?: number;
  vin?: Array<{
    txid?: string;
    coinbase?: string;
  }>;
}

class VestingClassifier {
  private memoryCache = new Map<string, CacheEntry>();
  private dbName = "SphereVestingCacheV5"; // V5 - new cache with proper null handling
  private storeName = "vestingCache";
  private db: IDBDatabase | null = null;

  /**
   * Initialize IndexedDB for persistent caching
   */
  async initDB(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: "txHash" });
        }
      };

      request.onsuccess = (event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
        resolve();
      };

      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Check if transaction is coinbase
   */
  private isCoinbaseTransaction(txData: TransactionData): boolean {
    if (txData.vin && txData.vin.length === 1) {
      const vin = txData.vin[0];
      // Check for coinbase field or missing txid
      if (vin.coinbase || (!vin.txid && vin.coinbase !== undefined)) {
        return true;
      }
      // Some formats use empty txid for coinbase
      if (vin.txid === "0000000000000000000000000000000000000000000000000000000000000000") {
        return true;
      }
    }
    return false;
  }

  /**
   * Load from IndexedDB cache
   */
  private async loadFromDB(txHash: string): Promise<CacheEntry | null> {
    if (!this.db) return null;

    return new Promise((resolve) => {
      const tx = this.db!.transaction(this.storeName, "readonly");
      const store = tx.objectStore(this.storeName);
      const request = store.get(txHash);

      request.onsuccess = () => {
        if (request.result) {
          resolve({
            blockHeight: request.result.blockHeight,
            isCoinbase: request.result.isCoinbase,
            inputTxId: request.result.inputTxId,
          });
        } else {
          resolve(null);
        }
      };
      request.onerror = () => resolve(null);
    });
  }

  /**
   * Save to IndexedDB cache
   */
  private async saveToDB(txHash: string, entry: CacheEntry): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve) => {
      const tx = this.db!.transaction(this.storeName, "readwrite");
      const store = tx.objectStore(this.storeName);
      store.put({ txHash, ...entry });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
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
      const cached = this.memoryCache.get(currentTxHash);
      if (cached) {
        if (cached.isCoinbase) {
          // Skip cache if blockHeight is null - needs re-fetch
          if (cached.blockHeight !== null && cached.blockHeight !== undefined) {
            return { coinbaseHeight: cached.blockHeight };
          }
          // Fall through to re-fetch
        } else if (cached.inputTxId) {
          // Follow the input chain
          currentTxHash = cached.inputTxId;
          continue;
        }
      }

      // Check IndexedDB cache
      const dbCached = await this.loadFromDB(currentTxHash);
      if (dbCached) {
        // Also store in memory cache
        this.memoryCache.set(currentTxHash, dbCached);
        if (dbCached.isCoinbase) {
          // Skip cache if blockHeight is null - needs re-fetch
          if (dbCached.blockHeight !== null && dbCached.blockHeight !== undefined) {
            return { coinbaseHeight: dbCached.blockHeight };
          }
          // Fall through to re-fetch
        } else if (dbCached.inputTxId) {
          currentTxHash = dbCached.inputTxId;
          continue;
        }
      }

      // Fetch from network
      const txData = await getTransaction(currentTxHash) as TransactionData;
      if (!txData || !txData.txid) {
        return { coinbaseHeight: null, error: `Failed to fetch tx ${currentTxHash}` };
      }

      // Determine if this is a coinbase transaction
      const isCoinbase = this.isCoinbaseTransaction(txData);

      // Calculate block height from confirmations (like index.html does)
      let blockHeight: number | null = null;
      if (txData.confirmations && currentBlockHeight !== null && currentBlockHeight !== undefined) {
        blockHeight = currentBlockHeight - txData.confirmations + 1;
      }

      // Get input transaction ID (if not coinbase)
      let inputTxId: string | null = null;
      if (!isCoinbase && txData.vin && txData.vin.length > 0 && txData.vin[0].txid) {
        inputTxId = txData.vin[0].txid;
      }

      // Cache the result
      const cacheEntry: CacheEntry = {
        blockHeight,  // Can be null if confirmations not available
        isCoinbase,
        inputTxId,
      };
      this.memoryCache.set(currentTxHash, cacheEntry);
      await this.saveToDB(currentTxHash, cacheEntry);

      if (isCoinbase) {
        console.log(`Traced to coinbase at block ${blockHeight}, isVested: ${blockHeight !== null && blockHeight <= VESTING_THRESHOLD}`);
        return { coinbaseHeight: blockHeight };
      }

      if (!inputTxId) {
        return { coinbaseHeight: null, error: "Could not find input transaction" };
      }

      currentTxHash = inputTxId;
    }

    return { coinbaseHeight: null, error: "Max iterations exceeded" };
  }

  /**
   * Classify a single UTXO
   */
  async classifyUtxo(utxo: UTXO): Promise<ClassificationResult> {
    const txHash = utxo.tx_hash || utxo.txid;
    if (!txHash) {
      return { isVested: false, coinbaseHeight: null, error: "No transaction hash" };
    }

    try {
      const result = await this.traceToOrigin(txHash);
      if (result.error || result.coinbaseHeight === null) {
        return { isVested: false, coinbaseHeight: null, error: result.error || "Could not trace to origin" };
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
    utxos: UTXO[],
    onProgress?: (current: number, total: number) => void
  ): Promise<{
    vested: ClassifiedUTXO[];
    unvested: ClassifiedUTXO[];
    errors: Array<{ utxo: UTXO; error: string }>;
  }> {
    // Get current block height before classification
    currentBlockHeight = await getCurrentBlockHeight();
    console.log(`VestingClassifier: blockHeight=${currentBlockHeight}, threshold=${VESTING_THRESHOLD}, utxos=${utxos.length}`);

    // Clear memory cache to force re-fetch with current block height
    this.memoryCache.clear();

    const vested: ClassifiedUTXO[] = [];
    const unvested: ClassifiedUTXO[] = [];
    const errors: Array<{ utxo: UTXO; error: string }> = [];

    for (let i = 0; i < utxos.length; i++) {
      const utxo = utxos[i];
      const result = await this.classifyUtxo(utxo);

      if (result.error) {
        errors.push({ utxo, error: result.error });
        // Default to unvested on error for safety
        unvested.push({
          ...utxo,
          vestingStatus: "error",
          coinbaseHeight: null,
        });
      } else if (result.isVested) {
        vested.push({
          ...utxo,
          vestingStatus: "vested",
          coinbaseHeight: result.coinbaseHeight,
        });
      } else {
        unvested.push({
          ...utxo,
          vestingStatus: "unvested",
          coinbaseHeight: result.coinbaseHeight,
        });
      }

      // Report progress
      if (onProgress) {
        onProgress(i + 1, utxos.length);
      }

      // Yield every 5 UTXOs
      if (i % 5 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    console.log(`VestingClassifier: ${vested.length} vested, ${unvested.length} unvested, ${errors.length} errors`);

    return { vested, unvested, errors };
  }

  /**
   * Clear all caches
   */
  clearCaches(): void {
    this.memoryCache.clear();
    if (this.db) {
      const tx = this.db.transaction(this.storeName, "readwrite");
      tx.objectStore(this.storeName).clear();
    }
  }
}

export const vestingClassifier = new VestingClassifier();
