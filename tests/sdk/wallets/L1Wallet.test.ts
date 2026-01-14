import { describe, it, expect, vi, beforeEach } from 'vitest';
import { L1Wallet } from '@/components/wallet/sdk/wallets/L1Wallet';
import type { WebSocketAdapter } from '@/components/wallet/sdk/network/websocket';
import { publicKeyToAddress } from '@/components/wallet/sdk/address/address';

describe('L1Wallet', () => {
  let mockWsAdapter: WebSocketAdapter;
  let messageHandler: ((data: string) => void) | null = null;
  let closeHandler: (() => void) | null = null;
  let errorHandler: ((err: Error) => void) | null = null;

  // Generate a valid test address
  const testPublicKey = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
  const testAddress = publicKeyToAddress(testPublicKey);

  beforeEach(() => {
    messageHandler = null;
    closeHandler = null;
    errorHandler = null;

    // Create mock WebSocket adapter
    mockWsAdapter = {
      connect: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
      send: vi.fn(),
      isConnected: vi.fn().mockReturnValue(false),
      getState: vi.fn().mockReturnValue('closed'),
      onMessage: vi.fn((handler) => {
        messageHandler = handler;
      }),
      onClose: vi.fn((handler) => {
        closeHandler = handler;
      }),
      onError: vi.fn((handler) => {
        errorHandler = handler;
      }),
    };
  });

  describe('constructor', () => {
    it('should create instance with adapter', () => {
      const wallet = new L1Wallet(mockWsAdapter);
      expect(wallet).toBeDefined();
    });

    it('should set up message handlers', () => {
      new L1Wallet(mockWsAdapter);

      expect(mockWsAdapter.onMessage).toHaveBeenCalled();
      expect(mockWsAdapter.onClose).toHaveBeenCalled();
      expect(mockWsAdapter.onError).toHaveBeenCalled();
    });

    it('should accept custom config', () => {
      const wallet = new L1Wallet(mockWsAdapter, undefined, {
        endpoint: 'wss://custom.endpoint:1234',
        autoConnect: false,
        autoReconnect: false,
      });

      expect(wallet).toBeDefined();
    });
  });

  describe('connection', () => {
    it('should connect to endpoint', async () => {
      const wallet = new L1Wallet(mockWsAdapter, undefined, { autoConnect: false });

      // isConnected returns false initially, so connect() will call adapter.connect
      vi.mocked(mockWsAdapter.isConnected).mockReturnValue(false);
      await wallet.connect();

      expect(mockWsAdapter.connect).toHaveBeenCalled();
    });

    it('should not reconnect if already connected', async () => {
      vi.mocked(mockWsAdapter.isConnected).mockReturnValue(true);

      const wallet = new L1Wallet(mockWsAdapter);
      await wallet.connect();

      expect(mockWsAdapter.connect).not.toHaveBeenCalled();
    });

    it('should disconnect', () => {
      const wallet = new L1Wallet(mockWsAdapter);
      wallet.disconnect();

      expect(mockWsAdapter.close).toHaveBeenCalled();
    });

    it('should check connection status', () => {
      vi.mocked(mockWsAdapter.isConnected).mockReturnValue(true);

      const wallet = new L1Wallet(mockWsAdapter);
      expect(wallet.isConnected()).toBe(true);

      vi.mocked(mockWsAdapter.isConnected).mockReturnValue(false);
      expect(wallet.isConnected()).toBe(false);
    });
  });

  describe('RPC calls', () => {
    it('should send RPC request and receive response', async () => {
      vi.mocked(mockWsAdapter.isConnected).mockReturnValue(true);

      const wallet = new L1Wallet(mockWsAdapter, undefined, { autoConnect: false });

      // Start balance request
      const balancePromise = wallet.getBalance(testAddress);

      // Wait for send to be called
      await new Promise(resolve => setTimeout(resolve, 0));

      // Verify message was sent
      expect(mockWsAdapter.send).toHaveBeenCalled();

      // Parse sent message
      const sentMessage = JSON.parse(vi.mocked(mockWsAdapter.send).mock.calls[0][0] as string);
      expect(sentMessage.method).toBe('blockchain.scripthash.get_balance');
      expect(sentMessage.jsonrpc).toBe('2.0');

      // Simulate response
      if (messageHandler) {
        messageHandler(JSON.stringify({
          jsonrpc: '2.0',
          id: sentMessage.id,
          result: { confirmed: 100000000, unconfirmed: 0 },
        }));
      }

      const balance = await balancePromise;
      expect(balance).toBe(1); // 100000000 sats = 1 ALPHA
    });

    it('should handle RPC errors', async () => {
      vi.mocked(mockWsAdapter.isConnected).mockReturnValue(true);

      const wallet = new L1Wallet(mockWsAdapter, undefined, { autoConnect: false });

      const balancePromise = wallet.getBalance(testAddress);

      // Wait for send to be called
      await new Promise(resolve => setTimeout(resolve, 0));

      // Get sent message ID
      const sentMessage = JSON.parse(vi.mocked(mockWsAdapter.send).mock.calls[0][0] as string);

      // Simulate error response
      if (messageHandler) {
        messageHandler(JSON.stringify({
          jsonrpc: '2.0',
          id: sentMessage.id,
          error: { message: 'Address not found' },
        }));
      }

      await expect(balancePromise).rejects.toThrow('Address not found');
    });
  });

  describe('getBalance', () => {
    it('should return balance in ALPHA', async () => {
      vi.mocked(mockWsAdapter.isConnected).mockReturnValue(true);

      const wallet = new L1Wallet(mockWsAdapter, undefined, { autoConnect: false });

      // Start the request
      const balancePromise = wallet.getBalance(testAddress);

      // Wait for send to be called
      await new Promise(resolve => setTimeout(resolve, 0));

      // Get sent message and respond
      const sentMessage = JSON.parse(vi.mocked(mockWsAdapter.send).mock.calls[0][0] as string);
      if (messageHandler) {
        messageHandler(JSON.stringify({
          jsonrpc: '2.0',
          id: sentMessage.id,
          result: { confirmed: 250000000, unconfirmed: 50000000 },
        }));
      }

      const balance = await balancePromise;
      expect(balance).toBe(3); // (250000000 + 50000000) / 100000000 = 3 ALPHA
    });
  });

  describe('getUtxos', () => {
    it('should return UTXOs for address', async () => {
      vi.mocked(mockWsAdapter.isConnected).mockReturnValue(true);

      const wallet = new L1Wallet(mockWsAdapter, undefined, { autoConnect: false });

      const utxosPromise = wallet.getUtxos(testAddress);

      // Wait for send to be called
      await new Promise(resolve => setTimeout(resolve, 0));

      const sentMessage = JSON.parse(vi.mocked(mockWsAdapter.send).mock.calls[0][0] as string);
      if (messageHandler) {
        messageHandler(JSON.stringify({
          jsonrpc: '2.0',
          id: sentMessage.id,
          result: [
            { tx_hash: 'a'.repeat(64), tx_pos: 0, value: 100000, height: 1000 },
            { tx_hash: 'b'.repeat(64), tx_pos: 1, value: 200000, height: 2000 },
          ],
        }));
      }

      const utxos = await utxosPromise;

      expect(utxos).toHaveLength(2);
      expect(utxos[0].tx_hash).toBe('a'.repeat(64));
      expect(utxos[0].value).toBe(100000);
      expect(utxos[1].address).toBe(testAddress);
    });

    it('should return empty array for no UTXOs', async () => {
      vi.mocked(mockWsAdapter.isConnected).mockReturnValue(true);

      const wallet = new L1Wallet(mockWsAdapter, undefined, { autoConnect: false });

      const utxosPromise = wallet.getUtxos(testAddress);

      // Wait for send to be called
      await new Promise(resolve => setTimeout(resolve, 0));

      const sentMessage = JSON.parse(vi.mocked(mockWsAdapter.send).mock.calls[0][0] as string);
      if (messageHandler) {
        messageHandler(JSON.stringify({
          jsonrpc: '2.0',
          id: sentMessage.id,
          result: [],
        }));
      }

      const utxos = await utxosPromise;
      expect(utxos).toHaveLength(0);
    });
  });

  describe('broadcast', () => {
    it('should broadcast transaction and return txid', async () => {
      vi.mocked(mockWsAdapter.isConnected).mockReturnValue(true);

      const wallet = new L1Wallet(mockWsAdapter, undefined, { autoConnect: false });
      const rawTx = '020000000001...';
      const expectedTxid = 'c'.repeat(64);

      const broadcastPromise = wallet.broadcast(rawTx);

      // Wait for send to be called
      await new Promise(resolve => setTimeout(resolve, 0));

      const sentMessage = JSON.parse(vi.mocked(mockWsAdapter.send).mock.calls[0][0] as string);
      if (messageHandler) {
        messageHandler(JSON.stringify({
          jsonrpc: '2.0',
          id: sentMessage.id,
          result: expectedTxid,
        }));
      }

      const txid = await broadcastPromise;
      expect(txid).toBe(expectedTxid);
    });
  });

  describe('getVestingThreshold', () => {
    it('should return vesting threshold constant', () => {
      const wallet = new L1Wallet(mockWsAdapter);
      expect(wallet.getVestingThreshold()).toBe(280000);
    });
  });

  describe('error handling', () => {
    it('should throw when not connected and autoConnect disabled', async () => {
      vi.mocked(mockWsAdapter.isConnected).mockReturnValue(false);

      const wallet = new L1Wallet(mockWsAdapter, undefined, { autoConnect: false });

      await expect(wallet.getBalance(testAddress)).rejects.toThrow('Not connected');
    });

    it('should handle close event', () => {
      new L1Wallet(mockWsAdapter, undefined, { autoReconnect: false });

      // Trigger close handler
      if (closeHandler) {
        closeHandler();
      }

      // Should not throw
    });

    it('should handle error event', () => {
      new L1Wallet(mockWsAdapter);

      // Trigger error handler
      if (errorHandler) {
        errorHandler(new Error('Connection failed'));
      }

      // Should not throw
    });
  });
});
