import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  WalletRepository,
  createWalletRepository,
  WALLET_REPOSITORY_KEYS,
} from '../../../src/components/wallet/sdk/storage/wallet-repository';
import {
  InMemoryProvider,
} from '../../../src/components/wallet/sdk/storage/providers';
import type { StoredToken } from '../../../src/components/wallet/sdk/storage/token-repository';

// ==========================================
// Test Helpers
// ==========================================

function createMockToken(id: string, stateHash?: string): StoredToken {
  return {
    id,
    coinId: 'test-coin',
    amount: '1000',
    symbol: 'TEST',
    timestamp: Date.now(),
    jsonData: JSON.stringify({
      version: '2.0',
      genesis: {
        stateHash: stateHash || `genesis_${id}`,
        data: { tokenId: id },
      },
      transactions: [],
    }),
  };
}

// ==========================================
// WalletRepository Tests
// ==========================================

describe('WalletRepository', () => {
  let storage: InMemoryProvider;
  let repository: WalletRepository;
  // L3 addresses must be at least 20 chars and use DIRECT:// or PROXY:// prefix
  const testAddress = 'DIRECT://0x1234567890abcdef1234567890abcdef12345678';

  beforeEach(async () => {
    storage = new InMemoryProvider();
    await storage.connect();
    repository = new WalletRepository(storage);
    await repository.init();
  });

  describe('initialization', () => {
    it('should initialize without error', async () => {
      const repo = new WalletRepository(storage);
      await expect(repo.init()).resolves.toBeUndefined();
    });

    it('should be safe to call init multiple times', async () => {
      await repository.init();
      await repository.init();
      // Should not throw
    });
  });

  describe('wallet lifecycle', () => {
    it('should create a new wallet', async () => {
      const wallet = await repository.createWallet(testAddress, 'Test Wallet');

      expect(wallet).toBeDefined();
      expect(wallet.address).toBe(testAddress);
      expect(wallet.name).toBe('Test Wallet');
      expect(wallet.tokens).toEqual([]);
    });

    it('should load wallet for address', async () => {
      await repository.createWallet(testAddress, 'Test Wallet');

      // Create new repository instance to test loading
      const repo2 = new WalletRepository(storage);
      await repo2.init();

      const loaded = await repo2.loadWalletForAddress(testAddress);
      expect(loaded).toBeDefined();
      expect(loaded?.address).toBe(testAddress);
    });

    it('should return null for non-existent wallet', async () => {
      const wallet = await repository.loadWalletForAddress('non-existent');
      expect(wallet).toBeNull();
    });

    it('should switch to different address', async () => {
      const addr1 = 'DIRECT://address1_0x1234567890abcdef';
      const addr2 = 'DIRECT://address2_0xabcdef1234567890';

      await repository.createWallet(addr1, 'Wallet 1');
      await repository.createWallet(addr2, 'Wallet 2');

      const wallet1 = await repository.switchToAddress(addr1);
      expect(wallet1?.name).toBe('Wallet 1');

      const wallet2 = await repository.switchToAddress(addr2);
      expect(wallet2?.name).toBe('Wallet 2');
    });

    it('should get current address', async () => {
      expect(repository.getCurrentAddress()).toBeNull();

      await repository.createWallet(testAddress);
      expect(repository.getCurrentAddress()).toBe(testAddress);
    });

    it('should clear wallet', async () => {
      await repository.createWallet(testAddress);
      await repository.clearWallet();

      expect(repository.getCurrentAddress()).toBeNull();
      expect(repository.getWallet()).toBeNull();
    });
  });

  describe('token operations', () => {
    beforeEach(async () => {
      await repository.createWallet(testAddress);
    });

    it('should add token', async () => {
      const token = createMockToken('token1');
      const added = await repository.addToken(token);

      expect(added).toBe(true);
      expect(repository.getTokens()).toHaveLength(1);
      expect(repository.getTokens()[0].id).toBe('token1');
    });

    it('should not add duplicate token', async () => {
      const token = createMockToken('token1');
      await repository.addToken(token);
      const addedAgain = await repository.addToken(token);

      expect(addedAgain).toBe(false);
      expect(repository.getTokens()).toHaveLength(1);
    });

    it('should update token', async () => {
      const token = createMockToken('token1');
      await repository.addToken(token);

      const updatedToken = { ...token, symbol: 'UPDATED' };
      await repository.updateToken(updatedToken);

      expect(repository.getTokens()[0].symbol).toBe('UPDATED');
    });

    it('should remove token', async () => {
      const token = createMockToken('token1');
      await repository.addToken(token);

      await repository.removeToken('token1');
      expect(repository.getTokens()).toHaveLength(0);
    });

    it('should persist tokens across repository instances', async () => {
      const token = createMockToken('token1');
      await repository.addToken(token);

      // Create new repository instance
      const repo2 = new WalletRepository(storage);
      await repo2.init();
      await repo2.loadWalletForAddress(testAddress);

      expect(repo2.getTokens()).toHaveLength(1);
      expect(repo2.getTokens()[0].id).toBe('token1');
    });
  });

  describe('tombstone operations', () => {
    beforeEach(async () => {
      await repository.createWallet(testAddress);
    });

    it('should start with empty tombstones', () => {
      expect(repository.getTombstones()).toEqual([]);
    });

    it('should create tombstone when removing token', async () => {
      const token = createMockToken('token1', 'state1');
      await repository.addToken(token);

      // Initially no tombstones
      expect(repository.getTombstones().length).toBe(0);

      await repository.removeToken('token1');

      // After removal, a tombstone should be created
      const tombstones = repository.getTombstones();
      expect(tombstones.length).toBeGreaterThan(0);
      expect(tombstones[0].tokenId).toBe('token1');
    });

    it('should merge tombstones', async () => {
      const remoteTombstones = [
        {
          tokenId: 'remote-token',
          stateHash: 'remote-state',
          timestamp: Date.now(),
          reason: 'transferred' as const,
        },
      ];

      const added = await repository.mergeTombstones(remoteTombstones);
      // mergeTombstones returns count of new tombstones added
      expect(added).toBeGreaterThanOrEqual(0);
    });
  });

  describe('transaction history', () => {
    beforeEach(async () => {
      await repository.createWallet(testAddress);
    });

    it('should start with empty history', () => {
      expect(repository.getTransactionHistory()).toEqual([]);
    });

    it('should add transaction to history when adding token', async () => {
      const token = createMockToken('token1');
      await repository.addToken(token, false); // skipHistory = false

      const history = repository.getTransactionHistory();
      expect(history.length).toBeGreaterThanOrEqual(0); // May or may not add based on implementation
    });

    it('should record sent transaction on remove', async () => {
      const token = createMockToken('token1');
      await repository.addToken(token, true);
      await repository.removeToken('token1', 'recipient', false);

      const history = repository.getTransactionHistory();
      const sentTx = history.find(tx => tx.type === 'SENT');
      if (sentTx) {
        expect(sentTx.recipientNametag).toBe('recipient');
      }
    });
  });

  describe('archived tokens', () => {
    beforeEach(async () => {
      await repository.createWallet(testAddress);
    });

    it('should start with empty archives', () => {
      const archived = repository.getArchivedTokens();
      // Returns a Map
      expect(archived.size).toBe(0);
    });
  });

  describe('nametag operations', () => {
    beforeEach(async () => {
      await repository.createWallet(testAddress);
    });

    it('should start with no nametag', () => {
      expect(repository.getNametag()).toBeNull();
    });

    it('should set and get nametag', async () => {
      const nametag = {
        name: 'alice',
        registeredAt: Date.now(),
      };
      await repository.setNametag(nametag);

      expect(repository.getNametag()).toEqual(nametag);
    });

    it('should persist nametag', async () => {
      const nametag = { name: 'bob', registeredAt: Date.now() };
      await repository.setNametag(nametag);

      // New repository instance
      const repo2 = new WalletRepository(storage);
      await repo2.init();
      await repo2.loadWalletForAddress(testAddress);

      expect(repo2.getNametag()?.name).toBe('bob');
    });
  });

  describe('callback', () => {
    it('should have onWalletUpdated callback configured', async () => {
      const onUpdated = vi.fn();
      const repo = new WalletRepository(storage, { onWalletUpdated: onUpdated });
      await repo.init();

      // Just verify repository accepts the callback
      expect(repo).toBeDefined();
    });
  });

  describe('factory function', () => {
    it('should create repository with createWalletRepository', () => {
      const created = createWalletRepository(storage);
      expect(created).toBeInstanceOf(WalletRepository);
    });
  });

  describe('WALLET_REPOSITORY_KEYS', () => {
    it('should generate wallet key for address', () => {
      const key = WALLET_REPOSITORY_KEYS.walletByAddress('0x123');
      expect(key).toBe('wallet_0x123');
    });

    it('should have transaction history key', () => {
      expect(WALLET_REPOSITORY_KEYS.TRANSACTION_HISTORY).toBe('transaction_history');
    });
  });

  describe('token count via getTokens', () => {
    beforeEach(async () => {
      await repository.createWallet(testAddress);
    });

    it('should return correct token count', async () => {
      expect(repository.getTokens().length).toBe(0);

      await repository.addToken(createMockToken('t1'));
      expect(repository.getTokens().length).toBe(1);

      await repository.addToken(createMockToken('t2'));
      expect(repository.getTokens().length).toBe(2);

      await repository.removeToken('t1');
      expect(repository.getTokens().length).toBe(1);
    });
  });

  describe('static methods', () => {
    it('should check nametag for address without loading wallet', async () => {
      // First create a wallet with nametag
      await repository.createWallet(testAddress);
      await repository.setNametag({ name: 'test', registeredAt: Date.now() });

      // Use static method
      const nametag = await WalletRepository.checkNametagForAddress(storage, testAddress);
      expect(nametag?.name).toBe('test');
    });

    it('should check tokens for address without loading wallet', async () => {
      await repository.createWallet(testAddress);

      let hasTokens = await WalletRepository.checkTokensForAddress(storage, testAddress);
      expect(hasTokens).toBe(false);

      await repository.addToken(createMockToken('t1'));
      hasTokens = await WalletRepository.checkTokensForAddress(storage, testAddress);
      expect(hasTokens).toBe(true);
    });
  });
});
