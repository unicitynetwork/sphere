/**
 * IndexedDB Cache Provider for Vesting Classification
 *
 * Browser-specific implementation of VestingCacheProvider using IndexedDB
 * for persistent caching of vesting classification data.
 */

import type { VestingCacheProvider, VestingCacheEntry } from '../../sdk/types';

const DB_NAME = 'SphereVestingCacheV5';
const STORE_NAME = 'vestingCache';

/**
 * IndexedDB implementation of VestingCacheProvider
 */
export class IndexedDBVestingCache implements VestingCacheProvider {
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'txHash' });
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
      const tx = this.db!.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
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
      const tx = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put({ txHash, ...entry });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }

  async clear(): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve) => {
      const tx = this.db!.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }
}
