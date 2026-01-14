import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnityWallet } from '@/components/wallet/sdk/wallets/UnityWallet';
import type { WebSocketAdapter } from '@/components/wallet/sdk/network/websocket';

describe('UnityWallet', () => {
  let mockWsAdapter: WebSocketAdapter;

  beforeEach(() => {
    // Create mock WebSocket adapter
    mockWsAdapter = {
      connect: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
      send: vi.fn(),
      isConnected: vi.fn().mockReturnValue(false),
      getState: vi.fn().mockReturnValue('closed'),
      onMessage: vi.fn(),
      onClose: vi.fn(),
      onError: vi.fn(),
    };
  });

  describe('create', () => {
    it('should create new wallet with mnemonic', async () => {
      const wallet = await UnityWallet.create(mockWsAdapter);

      expect(wallet).toBeDefined();
      expect(wallet.hasMnemonic()).toBe(true);
      expect(wallet.getMnemonic()).toBeDefined();
      expect(wallet.getMnemonic()!.split(' ')).toHaveLength(12);
    });

    it('should create wallet with 24-word mnemonic', async () => {
      const wallet = await UnityWallet.create(mockWsAdapter, undefined, undefined, 24);

      expect(wallet.getMnemonic()!.split(' ')).toHaveLength(24);
    });

    it('should have L1 and L3 wallet instances', async () => {
      const wallet = await UnityWallet.create(mockWsAdapter);

      expect(wallet.l1).toBeDefined();
      expect(wallet.l3).toBeDefined();
    });
  });

  describe('fromMnemonic', () => {
    const testMnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

    it('should restore wallet from mnemonic', async () => {
      const wallet = await UnityWallet.fromMnemonic(testMnemonic, mockWsAdapter);

      expect(wallet).toBeDefined();
      expect(wallet.hasMnemonic()).toBe(true);
      expect(wallet.getMnemonic()).toBe(testMnemonic);
    });

    it('should be deterministic', async () => {
      const wallet1 = await UnityWallet.fromMnemonic(testMnemonic, mockWsAdapter);
      const wallet2 = await UnityWallet.fromMnemonic(testMnemonic, mockWsAdapter);

      expect(wallet1.getMasterKey()).toBe(wallet2.getMasterKey());
      expect(wallet1.getChainCode()).toBe(wallet2.getChainCode());
    });
  });

  describe('fromMasterKey', () => {
    it('should restore wallet from master key', async () => {
      const masterKey = 'e8f32e723decf4051aefac8e2c93c9c5b214313817cdb01a1494b917c8436b35';
      const chainCode = '873dff81c02f525623fd1fe5167eac3a55a049de3d314bb42ee227ffed37d508';

      const wallet = await UnityWallet.fromMasterKey(masterKey, chainCode, mockWsAdapter);

      expect(wallet).toBeDefined();
      expect(wallet.getMasterKey()).toBe(masterKey);
      expect(wallet.getChainCode()).toBe(chainCode);
      expect(wallet.hasMnemonic()).toBe(false);
    });
  });

  describe('validateMnemonic', () => {
    it('should validate correct mnemonic', () => {
      const valid = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
      expect(UnityWallet.validateMnemonic(valid)).toBe(true);
    });

    it('should reject invalid mnemonic', () => {
      expect(UnityWallet.validateMnemonic('invalid mnemonic words')).toBe(false);
      expect(UnityWallet.validateMnemonic('')).toBe(false);
    });
  });

  describe('key management', () => {
    it('should provide master key and chain code', async () => {
      const wallet = await UnityWallet.create(mockWsAdapter);

      expect(wallet.getMasterKey()).toBeDefined();
      expect(wallet.getMasterKey()).toHaveLength(64);
      expect(wallet.getChainCode()).toBeDefined();
      expect(wallet.getChainCode()).toHaveLength(64);
    });
  });

  describe('address derivation', () => {
    const testMnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

    it('should derive unified address at path', async () => {
      const wallet = await UnityWallet.fromMnemonic(testMnemonic, mockWsAdapter);
      const address = await wallet.deriveAddress("m/84'/1'/0'/0/0");

      expect(address).toBeDefined();
      expect(address.l1Address).toBeDefined();
      expect(address.l3Address).toBeDefined();
      expect(address.privateKey).toBeDefined();
      expect(address.publicKey).toBeDefined();
      expect(address.path).toBe("m/84'/1'/0'/0/0");
      expect(address.index).toBe(0);
    });

    it('should derive default address', async () => {
      const wallet = await UnityWallet.fromMnemonic(testMnemonic, mockWsAdapter);
      const address = await wallet.deriveDefaultAddress();

      expect(address).toBeDefined();
      expect(address.index).toBe(0);
      expect(address.l1Address.startsWith('alpha1')).toBe(true);
    });

    it('should derive deterministic addresses', async () => {
      const wallet1 = await UnityWallet.fromMnemonic(testMnemonic, mockWsAdapter);
      const wallet2 = await UnityWallet.fromMnemonic(testMnemonic, mockWsAdapter);

      const addr1 = await wallet1.deriveAddress("m/84'/1'/0'/0/5");
      const addr2 = await wallet2.deriveAddress("m/84'/1'/0'/0/5");

      expect(addr1.l1Address).toBe(addr2.l1Address);
      expect(addr1.l3Address).toBe(addr2.l3Address);
    });
  });

  describe('getL1Wallet', () => {
    it('should return BaseWallet structure', async () => {
      const wallet = await UnityWallet.create(mockWsAdapter);
      const l1Wallet = wallet.getL1Wallet();

      expect(l1Wallet.masterPrivateKey).toBe(wallet.getMasterKey());
      expect(l1Wallet.chainCode).toBe(wallet.getChainCode());
      expect(l1Wallet.isBIP32).toBe(true);
      expect(l1Wallet.addresses).toEqual([]);
    });

    it('should include provided addresses', async () => {
      const wallet = await UnityWallet.create(mockWsAdapter);
      const addresses = [
        { address: 'alpha1test', privateKey: 'abc', publicKey: 'def', index: 0, path: 'm/0' },
      ];

      const l1Wallet = wallet.getL1Wallet(addresses);
      expect(l1Wallet.addresses).toEqual(addresses);
    });
  });

  describe('connection management', () => {
    it('should connect L1', async () => {
      const wallet = await UnityWallet.create(mockWsAdapter);
      // isConnected should be false so connect gets called
      vi.mocked(mockWsAdapter.isConnected).mockReturnValue(false);

      await wallet.connectL1();

      expect(mockWsAdapter.connect).toHaveBeenCalled();
    });

    it('should disconnect L1', async () => {
      const wallet = await UnityWallet.create(mockWsAdapter);
      wallet.disconnectL1();

      expect(mockWsAdapter.close).toHaveBeenCalled();
    });

    it('should check L1 connection status', async () => {
      const wallet = await UnityWallet.create(mockWsAdapter);

      vi.mocked(mockWsAdapter.isConnected).mockReturnValue(false);
      expect(wallet.isL1Connected()).toBe(false);

      vi.mocked(mockWsAdapter.isConnected).mockReturnValue(true);
      expect(wallet.isL1Connected()).toBe(true);
    });
  });
});
