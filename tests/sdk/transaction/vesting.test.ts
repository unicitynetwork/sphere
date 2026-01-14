import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  VestingClassifier,
  InMemoryCacheProvider,
  VESTING_THRESHOLD,
} from '@/components/wallet/sdk/transaction/vesting';
import type { L1NetworkProviderFull, TransactionDetail } from '@/components/wallet/sdk/network/network';
import type { L1UTXO } from '@/components/wallet/sdk/types';

describe('vesting', () => {
  describe('constants', () => {
    it('should export VESTING_THRESHOLD', () => {
      expect(VESTING_THRESHOLD).toBe(280000);
    });
  });

  describe('InMemoryCacheProvider', () => {
    it('should initialize without error', async () => {
      const cache = new InMemoryCacheProvider();
      await expect(cache.init()).resolves.toBeUndefined();
    });

    it('should store and retrieve entries', async () => {
      const cache = new InMemoryCacheProvider();
      await cache.init();

      const entry = { blockHeight: 100, isCoinbase: false, inputTxId: 'abc' };
      await cache.set('txhash1', entry);

      const result = await cache.get('txhash1');
      expect(result).toEqual(entry);
    });

    it('should return null for missing entries', async () => {
      const cache = new InMemoryCacheProvider();
      await cache.init();

      const result = await cache.get('nonexistent');
      expect(result).toBeNull();
    });

    it('should clear all entries', async () => {
      const cache = new InMemoryCacheProvider();
      await cache.init();

      await cache.set('tx1', { blockHeight: 1, isCoinbase: true, inputTxId: null });
      await cache.set('tx2', { blockHeight: 2, isCoinbase: false, inputTxId: 'tx1' });

      await cache.clear();

      expect(await cache.get('tx1')).toBeNull();
      expect(await cache.get('tx2')).toBeNull();
    });
  });

  describe('VestingClassifier', () => {
    let mockNetworkProvider: L1NetworkProviderFull;

    beforeEach(() => {
      // Create mock network provider
      mockNetworkProvider = {
        getTransaction: vi.fn(),
        getCurrentBlockHeight: vi.fn().mockResolvedValue(300000),
      } as unknown as L1NetworkProviderFull;
    });

    it('should classify vested UTXO (coinbase below threshold)', async () => {
      // Mock coinbase transaction at block 100000 (below threshold)
      const coinbaseTx: TransactionDetail = {
        txid: 'coinbase_tx',
        version: 1,
        locktime: 0,
        vin: [{ coinbase: '...', sequence: 0xffffffff }], // Coinbase indicator
        vout: [],
        confirmations: 200000, // 300000 - 200000 + 1 = 100001
      };

      vi.mocked(mockNetworkProvider.getTransaction).mockResolvedValue(coinbaseTx);

      const classifier = new VestingClassifier(mockNetworkProvider);
      await classifier.init();
      classifier.setBlockHeight(300000);

      const utxo: L1UTXO = {
        tx_hash: 'coinbase_tx',
        tx_pos: 0,
        value: 5000000000,
        address: 'alpha1test',
      };

      const result = await classifier.classifyUtxo(utxo);

      expect(result.isVested).toBe(true);
      expect(result.coinbaseHeight).toBeDefined();
      expect(result.coinbaseHeight!).toBeLessThanOrEqual(VESTING_THRESHOLD);
    });

    it('should classify unvested UTXO (coinbase above threshold)', async () => {
      // Mock coinbase transaction at block 290000 (above threshold)
      const coinbaseTx: TransactionDetail = {
        txid: 'coinbase_tx_new',
        version: 1,
        locktime: 0,
        vin: [{ coinbase: '...', sequence: 0xffffffff }], // Coinbase indicator
        vout: [],
        confirmations: 10001, // 300000 - 10001 + 1 = 290000
      };

      vi.mocked(mockNetworkProvider.getTransaction).mockResolvedValue(coinbaseTx);

      const classifier = new VestingClassifier(mockNetworkProvider);
      await classifier.init();
      classifier.setBlockHeight(300000);

      const utxo: L1UTXO = {
        tx_hash: 'coinbase_tx_new',
        tx_pos: 0,
        value: 5000000000,
        address: 'alpha1test',
      };

      const result = await classifier.classifyUtxo(utxo);

      expect(result.isVested).toBe(false);
      expect(result.coinbaseHeight).toBeDefined();
      expect(result.coinbaseHeight!).toBeGreaterThan(VESTING_THRESHOLD);
    });

    it('should trace through multiple transactions to coinbase', async () => {
      // Chain: tx3 -> tx2 -> tx1 -> coinbase
      const coinbaseTx: TransactionDetail = {
        txid: 'coinbase',
        version: 1,
        locktime: 0,
        vin: [{ coinbase: '...', sequence: 0xffffffff }],
        vout: [],
        confirmations: 220000, // Block 80001
      };

      const tx1: TransactionDetail = {
        txid: 'tx1',
        version: 1,
        locktime: 0,
        vin: [{ txid: 'coinbase', vout: 0, sequence: 0xffffffff }],
        vout: [],
        confirmations: 210000,
      };

      const tx2: TransactionDetail = {
        txid: 'tx2',
        version: 1,
        locktime: 0,
        vin: [{ txid: 'tx1', vout: 0, sequence: 0xffffffff }],
        vout: [],
        confirmations: 200000,
      };

      const tx3: TransactionDetail = {
        txid: 'tx3',
        version: 1,
        locktime: 0,
        vin: [{ txid: 'tx2', vout: 0, sequence: 0xffffffff }],
        vout: [],
        confirmations: 190000,
      };

      vi.mocked(mockNetworkProvider.getTransaction)
        .mockImplementation(async (txid: string) => {
          if (txid === 'coinbase') return coinbaseTx;
          if (txid === 'tx1') return tx1;
          if (txid === 'tx2') return tx2;
          if (txid === 'tx3') return tx3;
          throw new Error('Unknown tx');
        });

      const classifier = new VestingClassifier(mockNetworkProvider);
      await classifier.init();
      classifier.setBlockHeight(300000);

      const utxo: L1UTXO = {
        tx_hash: 'tx3',
        tx_pos: 0,
        value: 1000000,
        address: 'alpha1test',
      };

      const result = await classifier.classifyUtxo(utxo);

      expect(result.isVested).toBe(true);
      expect(result.coinbaseHeight).toBe(80001);
    });

    it('should classify multiple UTXOs with progress', async () => {
      // Two UTXOs: one vested, one unvested
      const vestedCoinbase: TransactionDetail = {
        txid: 'vested_coinbase',
        version: 1,
        locktime: 0,
        vin: [{ coinbase: '...', sequence: 0xffffffff }],
        vout: [],
        confirmations: 250000, // Block 50001
      };

      const unvestedCoinbase: TransactionDetail = {
        txid: 'unvested_coinbase',
        version: 1,
        locktime: 0,
        vin: [{ coinbase: '...', sequence: 0xffffffff }],
        vout: [],
        confirmations: 5000, // Block 295001
      };

      vi.mocked(mockNetworkProvider.getTransaction)
        .mockImplementation(async (txid: string) => {
          if (txid === 'vested_coinbase') return vestedCoinbase;
          if (txid === 'unvested_coinbase') return unvestedCoinbase;
          throw new Error('Unknown tx');
        });

      const classifier = new VestingClassifier(mockNetworkProvider);
      await classifier.init();

      const utxos: L1UTXO[] = [
        { tx_hash: 'vested_coinbase', tx_pos: 0, value: 1000000, address: 'alpha1a' },
        { tx_hash: 'unvested_coinbase', tx_pos: 0, value: 2000000, address: 'alpha1b' },
      ];

      const progressCalls: Array<[number, number]> = [];
      const onProgress = (current: number, total: number) => {
        progressCalls.push([current, total]);
      };

      const result = await classifier.classifyUtxos(utxos, onProgress);

      expect(result.vested).toHaveLength(1);
      expect(result.unvested).toHaveLength(1);
      expect(result.errors).toHaveLength(0);

      expect(progressCalls).toEqual([[1, 2], [2, 2]]);
    });

    it('should handle network errors gracefully', async () => {
      vi.mocked(mockNetworkProvider.getTransaction).mockRejectedValue(new Error('Network error'));

      const classifier = new VestingClassifier(mockNetworkProvider);
      await classifier.init();
      classifier.setBlockHeight(300000);

      const utxo: L1UTXO = {
        tx_hash: 'error_tx',
        tx_pos: 0,
        value: 1000000,
        address: 'alpha1test',
      };

      const result = await classifier.classifyUtxo(utxo);

      expect(result.isVested).toBe(false);
      expect(result.coinbaseHeight).toBeNull();
      expect(result.error).toContain('Network error');
    });

    it('should cache results for subsequent lookups', async () => {
      const coinbaseTx: TransactionDetail = {
        txid: 'cached_coinbase',
        version: 1,
        locktime: 0,
        vin: [{ coinbase: '...', sequence: 0xffffffff }],
        vout: [],
        confirmations: 220000,
      };

      vi.mocked(mockNetworkProvider.getTransaction).mockResolvedValue(coinbaseTx);

      const classifier = new VestingClassifier(mockNetworkProvider);
      await classifier.init();
      classifier.setBlockHeight(300000);

      const utxo: L1UTXO = {
        tx_hash: 'cached_coinbase',
        tx_pos: 0,
        value: 1000000,
        address: 'alpha1test',
      };

      // First call
      await classifier.classifyUtxo(utxo);
      // Second call - should use cache
      await classifier.classifyUtxo(utxo);

      // Should only fetch from network once
      expect(mockNetworkProvider.getTransaction).toHaveBeenCalledTimes(1);
    });

    it('should clear caches', async () => {
      const coinbaseTx: TransactionDetail = {
        txid: 'to_clear',
        version: 1,
        locktime: 0,
        vin: [{ coinbase: '...', sequence: 0xffffffff }],
        vout: [],
        confirmations: 220000,
      };

      vi.mocked(mockNetworkProvider.getTransaction).mockResolvedValue(coinbaseTx);

      const classifier = new VestingClassifier(mockNetworkProvider);
      await classifier.init();
      classifier.setBlockHeight(300000);

      const utxo: L1UTXO = {
        tx_hash: 'to_clear',
        tx_pos: 0,
        value: 1000000,
        address: 'alpha1test',
      };

      await classifier.classifyUtxo(utxo);
      await classifier.clearCaches();
      classifier.setBlockHeight(300000);
      await classifier.classifyUtxo(utxo);

      // Should fetch twice (before and after clear)
      expect(mockNetworkProvider.getTransaction).toHaveBeenCalledTimes(2);
    });
  });
});
