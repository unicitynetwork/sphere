/**
 * IndexedDB Cache Provider for Vesting Classification
 *
 * Browser-specific implementation of VestingCacheProvider using IndexedDB
 * for persistent caching of vesting classification data.
 */

import type { VestingCacheProvider, VestingCacheEntry } from '../../types';

const DB_NAME = 'UnicityVestingCacheV1';
const STORE_NAME = 'vestingCache';

/**
 * IndexedDB implementation of VestingCacheProvider
 *
 * Usage:
 * ```typescript
 * import { L1Wallet } from '@unicity/wallet-sdk';
 * import { BrowserWSAdapter, IndexedDBVestingCache } from '@unicity/wallet-sdk/browser';
 *
 * const wallet = new L1Wallet(
 *   new BrowserWSAdapter(),
 *   new IndexedDBVestingCache()
 * );
 * ```
 */
export class IndexedDBVestingCache implements VestingCacheProvider {
  private db: IDBDatabase | null = null;
  private dbName: string;
  private storeName: string;

  constructor(dbName: string = DB_NAME, storeName: string = STORE_NAME) {
    this.dbName = dbName;
    this.storeName = storeName;
  }

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'txHash' });
        }
      };

      request.onsuccess = (event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
        resolve();
      };

      request.onerror = () => reject(request.error);
    });
  }

  async get(txHash: string): Promise<VestingCacheEntry | null> {
    if (!this.db) return null;

    return new Promise((resolve) => {
      const tx = this.db!.transaction(this.storeName, 'readonly');
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

  async set(txHash: string, entry: VestingCacheEntry): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve) => {
      const tx = this.db!.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      store.put({ txHash, ...entry });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }

  async clear(): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve) => {
      const tx = this.db!.transaction(this.storeName, 'readwrite');
      tx.objectStore(this.storeName).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }
}
