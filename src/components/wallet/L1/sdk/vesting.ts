import { getTransaction } from "./network";
import type { UTXO, ClassifiedUTXO, ClassificationResult } from "./types";

export const VESTING_THRESHOLD = 280000;

interface VestingCacheEntry {
  blockHeight: number;
  isCoinbase: boolean;
  inputTxId: string | null;
  timestamp: number;
}

class VestingClassifier {
  private memoryCache = new Map<string, VestingCacheEntry>();
  private dbName = "SphereVestingCache";
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
   * Classify a single UTXO as vested or unvested
   */
  async classifyUtxo(utxo: UTXO): Promise<ClassificationResult> {
    const txHash = utxo.tx_hash || utxo.txid;
    if (!txHash) {
      return {
        isVested: false,
        coinbaseHeight: null,
        error: "No transaction hash",
      };
    }

    try {
      const result = await this.traceToOrigin(txHash);

      if (result.coinbaseHeight === null) {
        return {
          isVested: false,
          coinbaseHeight: null,
          error: "Could not trace to origin",
        };
      }

      return {
        isVested: result.coinbaseHeight <= VESTING_THRESHOLD,
        coinbaseHeight: result.coinbaseHeight,
      };
    } catch (error) {
      return {
        isVested: false,
        coinbaseHeight: null,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Trace a transaction back to its coinbase origin
   * Alpha blockchain has single-input transactions, making this a linear trace
   */
  async traceToOrigin(
    txHash: string
  ): Promise<{ coinbaseHeight: number | null }> {
    const MAX_ITERATIONS = 10000;
    let currentTxHash = txHash;
    let iterations = 0;

    while (iterations < MAX_ITERATIONS) {
      iterations++;

      // Check memory cache
      const cached = this.memoryCache.get(currentTxHash);
      if (cached) {
        if (cached.isCoinbase) {
          return { coinbaseHeight: cached.blockHeight };
        }
        if (cached.inputTxId) {
          currentTxHash = cached.inputTxId;
          continue;
        }
      }

      // Check IndexedDB cache
      const dbCached = await this.loadFromDB(currentTxHash);
      if (dbCached) {
        this.memoryCache.set(currentTxHash, dbCached);
        if (dbCached.isCoinbase) {
          return { coinbaseHeight: dbCached.blockHeight };
        }
        if (dbCached.inputTxId) {
          currentTxHash = dbCached.inputTxId;
          continue;
        }
      }

      // Fetch from network
      const txData = (await getTransaction(currentTxHash)) as TransactionData;
      if (!txData) {
        return { coinbaseHeight: null };
      }

      const isCoinbase = this.isCoinbaseTransaction(txData);
      const entry: VestingCacheEntry = {
        blockHeight: txData.height || 0,
        isCoinbase,
        inputTxId: isCoinbase ? null : txData.vin?.[0]?.txid || null,
        timestamp: Date.now(),
      };

      // Cache the result
      this.memoryCache.set(currentTxHash, entry);
      await this.saveToDB(currentTxHash, entry);

      if (isCoinbase) {
        return { coinbaseHeight: entry.blockHeight };
      }

      if (entry.inputTxId) {
        currentTxHash = entry.inputTxId;
      } else {
        return { coinbaseHeight: null };
      }
    }

    console.warn(`Max iterations reached tracing ${txHash}`);
    return { coinbaseHeight: null };
  }

  /**
   * Check if a transaction is a coinbase transaction
   */
  private isCoinbaseTransaction(txData: TransactionData): boolean {
    if (!txData.vin || txData.vin.length !== 1) return false;

    const vin = txData.vin[0];
    return (
      vin.coinbase !== undefined ||
      vin.txid === undefined ||
      vin.txid ===
        "0000000000000000000000000000000000000000000000000000000000000000"
    );
  }

  /**
   * Batch classify multiple UTXOs with progress callback
   */
  async classifyUtxos(
    utxos: UTXO[],
    onProgress?: (current: number, total: number) => void
  ): Promise<{
    vested: ClassifiedUTXO[];
    unvested: ClassifiedUTXO[];
    errors: Array<{ utxo: UTXO; error: string }>;
  }> {
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

      // Report progress and yield to UI
      if (onProgress && i % 5 === 0) {
        onProgress(i + 1, utxos.length);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    if (onProgress) {
      onProgress(utxos.length, utxos.length);
    }

    return { vested, unvested, errors };
  }

  /**
   * Load cached entry from IndexedDB
   */
  private async loadFromDB(txHash: string): Promise<VestingCacheEntry | null> {
    if (!this.db) return null;

    return new Promise((resolve) => {
      const tx = this.db!.transaction(this.storeName, "readonly");
      const store = tx.objectStore(this.storeName);
      const request = store.get(txHash);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    });
  }

  /**
   * Save cache entry to IndexedDB
   */
  private async saveToDB(
    txHash: string,
    entry: VestingCacheEntry
  ): Promise<void> {
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

// Transaction data structure from network
interface TransactionData {
  txid: string;
  height?: number;
  vin?: Array<{
    txid?: string;
    coinbase?: string;
    vout?: number;
  }>;
  vout?: Array<{
    value: number;
    n: number;
  }>;
}

export const vestingClassifier = new VestingClassifier();
