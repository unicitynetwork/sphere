/**
 * L1Wallet - Unified Alpha Blockchain Wallet SDK
 *
 * Single class providing all L1 wallet functionality:
 * - Network communication (via WebSocketAdapter)
 * - Balance and UTXO queries
 * - Transaction building and broadcasting
 * - Vesting classification (via VestingCacheProvider)
 *
 * Platform-specific implementations only need to provide:
 * - WebSocketAdapter (for network)
 * - VestingCacheProvider (for caching, optional)
 */

import type { WebSocketAdapter } from '../network/websocket';
import type {
  L1UTXO,
  VestingCacheProvider,
  BaseWallet,
} from '../types';
import type { BlockHeader, TransactionDetail, TransactionHistoryItem } from '../network/network';
import { addressToScriptHash } from '../address/script';
import { signTransaction, selectUtxos, SATS_PER_COIN } from '../transaction/transaction';
import { decodeBech32 } from '../address/bech32';
import { WalletAddressHelper } from '../address/addressHelpers';
import {
  VestingClassifier,
  InMemoryCacheProvider,
  VESTING_THRESHOLD,
  type ClassifyUtxosResult,
} from '../transaction/vesting';

// ==========================================
// Configuration
// ==========================================

const DEFAULT_ENDPOINT = 'wss://fulcrum.unicity.network:50004';
const RPC_TIMEOUT = 30000;
const CONNECTION_TIMEOUT = 30000;
const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_RECONNECT_DELAY = 2000;
const MAX_RECONNECT_DELAY = 60000;

// ==========================================
// Types
// ==========================================

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

interface BalanceResult {
  confirmed: number;
  unconfirmed: number;
}

export interface L1WalletConfig {
  /** WebSocket endpoint URL */
  endpoint?: string;
  /** Auto-connect on first method call */
  autoConnect?: boolean;
  /** Enable auto-reconnect on disconnect */
  autoReconnect?: boolean;
}

export interface SendResult {
  txids: string[];
  success: boolean;
  error?: string;
}

// ==========================================
// L1Wallet Class
// ==========================================

/**
 * Unified L1 Wallet SDK
 *
 * Usage:
 * ```typescript
 * const wallet = new L1Wallet(webSocketAdapter, vestingCache);
 * await wallet.connect();
 *
 * const balance = await wallet.getBalance(address);
 * const tx = await wallet.getTransaction(txid);
 * const result = await wallet.send(walletData, toAddress, amount);
 * ```
 */
export class L1Wallet {
  private wsAdapter: WebSocketAdapter;
  private cacheProvider: VestingCacheProvider;
  private vestingClassifier: VestingClassifier | null = null;

  private endpoint: string;
  private autoConnect: boolean;
  private autoReconnect: boolean;

  private requestId = 0;
  private pending = new Map<number, PendingRequest>();
  private blockSubscribers: ((header: BlockHeader) => void)[] = [];
  private isBlockSubscribed = false;
  private lastBlockHeader: BlockHeader | null = null;

  private reconnectAttempts = 0;
  private intentionalClose = false;

  constructor(
    wsAdapter: WebSocketAdapter,
    cacheProvider?: VestingCacheProvider,
    config: L1WalletConfig = {}
  ) {
    this.wsAdapter = wsAdapter;
    this.cacheProvider = cacheProvider ?? new InMemoryCacheProvider();
    this.endpoint = config.endpoint ?? DEFAULT_ENDPOINT;
    this.autoConnect = config.autoConnect ?? true;
    this.autoReconnect = config.autoReconnect ?? true;

    // Setup message handler
    this.wsAdapter.onMessage((data) => this.handleMessage(data));
    this.wsAdapter.onClose(() => this.handleClose());
    this.wsAdapter.onError((err) => this.handleError(err));
  }

  // ==========================================
  // Connection Management
  // ==========================================

  /**
   * Connect to the Fulcrum server
   */
  async connect(endpoint?: string): Promise<void> {
    if (endpoint) {
      this.endpoint = endpoint;
    }

    if (this.wsAdapter.isConnected()) {
      return;
    }

    this.intentionalClose = false;

    await Promise.race([
      this.wsAdapter.connect(this.endpoint),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Connection timeout')), CONNECTION_TIMEOUT)
      ),
    ]);

    this.reconnectAttempts = 0;
  }

  /**
   * Disconnect from the server
   */
  disconnect(): void {
    this.intentionalClose = true;
    this.wsAdapter.close();
    this.clearPendingRequests(new Error('Disconnected'));
    this.isBlockSubscribed = false;
    this.reconnectAttempts = 0;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.wsAdapter.isConnected();
  }

  /**
   * Ensure connected (auto-connect if enabled)
   */
  private async ensureConnected(): Promise<void> {
    if (this.wsAdapter.isConnected()) {
      return;
    }

    if (this.autoConnect) {
      await this.connect();
    } else {
      throw new Error('Not connected. Call connect() first.');
    }
  }

  // ==========================================
  // Balance & UTXOs
  // ==========================================

  /**
   * Get balance for address in ALPHA
   */
  async getBalance(address: string): Promise<number> {
    await this.ensureConnected();

    const scriptHash = addressToScriptHash(address);
    const result = (await this.rpc('blockchain.scripthash.get_balance', [scriptHash])) as BalanceResult;

    const confirmed = result.confirmed || 0;
    const unconfirmed = result.unconfirmed || 0;
    const totalSats = confirmed + unconfirmed;

    return totalSats / SATS_PER_COIN;
  }

  /**
   * Get UTXOs for address
   */
  async getUtxos(address: string): Promise<L1UTXO[]> {
    await this.ensureConnected();

    const scriptHash = addressToScriptHash(address);
    const result = await this.rpc('blockchain.scripthash.listunspent', [scriptHash]);

    if (!Array.isArray(result)) {
      return [];
    }

    return result.map((u: { tx_hash: string; tx_pos: number; value: number; height?: number }) => ({
      tx_hash: u.tx_hash,
      tx_pos: u.tx_pos,
      value: u.value,
      height: u.height,
      address,
    }));
  }

  /**
   * Get total balance for multiple addresses
   */
  async getTotalBalance(addresses: string[]): Promise<number> {
    const balances = await Promise.all(addresses.map((addr) => this.getBalance(addr)));
    return balances.reduce((sum, bal) => sum + bal, 0);
  }

  /**
   * Get all UTXOs for multiple addresses
   */
  async getAllUtxos(addresses: string[]): Promise<L1UTXO[]> {
    const utxoArrays = await Promise.all(addresses.map((addr) => this.getUtxos(addr)));
    return utxoArrays.flat();
  }

  // ==========================================
  // Transactions
  // ==========================================

  /**
   * Get transaction details
   */
  async getTransaction(txid: string): Promise<TransactionDetail> {
    await this.ensureConnected();
    return (await this.rpc('blockchain.transaction.get', [txid, true])) as TransactionDetail;
  }

  /**
   * Get transaction history for address
   */
  async getTransactionHistory(address: string): Promise<TransactionHistoryItem[]> {
    await this.ensureConnected();

    const scriptHash = addressToScriptHash(address);
    const result = await this.rpc('blockchain.scripthash.get_history', [scriptHash]);

    if (!Array.isArray(result)) {
      return [];
    }

    return result as TransactionHistoryItem[];
  }

  /**
   * Broadcast raw transaction
   * @returns Transaction ID
   */
  async broadcast(rawTxHex: string): Promise<string> {
    await this.ensureConnected();
    return (await this.rpc('blockchain.transaction.broadcast', [rawTxHex])) as string;
  }

  /**
   * Send ALPHA to address
   *
   * @param wallet Wallet with keys and addresses
   * @param toAddress Recipient address
   * @param amountAlpha Amount in ALPHA
   * @param fromAddress Optional: specific address to send from
   * @returns Transaction IDs
   */
  async send(
    wallet: BaseWallet,
    toAddress: string,
    amountAlpha: number,
    fromAddress?: string
  ): Promise<SendResult> {
    if (!decodeBech32(toAddress)) {
      throw new Error('Invalid recipient address');
    }

    // Get sender address
    const defaultAddr = WalletAddressHelper.getDefault(wallet);
    const senderAddress = fromAddress || defaultAddr.address;
    const amountSats = Math.floor(amountAlpha * SATS_PER_COIN);

    // Get UTXOs
    const utxos = await this.getUtxos(senderAddress);

    if (utxos.length === 0) {
      throw new Error(`No UTXOs available for address: ${senderAddress}`);
    }

    // Create transaction plan
    const plan = selectUtxos(utxos, amountSats, toAddress, senderAddress);

    if (!plan.success) {
      throw new Error(plan.error || 'Transaction planning failed');
    }

    // Sign and broadcast transactions
    const txids: string[] = [];

    for (const tx of plan.transactions) {
      // Find private key for the input address
      const inputAddress = tx.input.address;
      const addressEntry = wallet.addresses.find((a) => a.address === inputAddress);
      const privateKey = addressEntry?.privateKey || wallet.childPrivateKey || wallet.masterPrivateKey;

      if (!privateKey) {
        throw new Error(`No private key for address: ${inputAddress}`);
      }

      // Sign
      const signed = signTransaction(
        {
          input: {
            tx_hash: tx.input.txid,
            tx_pos: tx.input.vout,
            value: tx.input.value,
          },
          outputs: tx.outputs,
        },
        privateKey
      );

      // Broadcast
      const txid = await this.broadcast(signed.hex);
      txids.push(txid);
    }

    return { txids, success: true };
  }

  // ==========================================
  // Block Methods
  // ==========================================

  /**
   * Get current block height
   */
  async getCurrentBlockHeight(): Promise<number> {
    await this.ensureConnected();

    try {
      const header = (await this.rpc('blockchain.headers.subscribe', [])) as BlockHeader;
      return header?.height || 0;
    } catch {
      return 0;
    }
  }

  /**
   * Get block header by height
   */
  async getBlockHeader(height: number): Promise<unknown> {
    await this.ensureConnected();
    return this.rpc('blockchain.block.header', [height, height]);
  }

  /**
   * Subscribe to new block headers
   * @returns Unsubscribe function
   */
  async subscribeBlocks(callback: (header: BlockHeader) => void): Promise<() => void> {
    await this.ensureConnected();

    this.blockSubscribers.push(callback);

    if (!this.isBlockSubscribed) {
      this.isBlockSubscribed = true;
      const header = (await this.rpc('blockchain.headers.subscribe', [])) as BlockHeader;
      if (header) {
        this.lastBlockHeader = header;
        this.blockSubscribers.forEach((cb) => cb(header));
      }
    } else if (this.lastBlockHeader) {
      callback(this.lastBlockHeader);
    }

    return () => {
      const idx = this.blockSubscribers.indexOf(callback);
      if (idx > -1) {
        this.blockSubscribers.splice(idx, 1);
      }
    };
  }

  // ==========================================
  // Vesting Classification
  // ==========================================

  /**
   * Classify UTXOs by vesting status
   */
  async classifyUtxos(
    utxos: L1UTXO[],
    onProgress?: (current: number, total: number) => void
  ): Promise<ClassifyUtxosResult> {
    // Lazy init vesting classifier
    if (!this.vestingClassifier) {
      await this.cacheProvider.init();
      // Create a provider wrapper that uses this wallet instance
      const networkProvider = this.createNetworkProviderWrapper();
      this.vestingClassifier = new VestingClassifier(networkProvider, this.cacheProvider);
      await this.vestingClassifier.init();
    }

    return this.vestingClassifier.classifyUtxos(utxos, onProgress);
  }

  /**
   * Get vesting threshold constant
   */
  getVestingThreshold(): number {
    return VESTING_THRESHOLD;
  }

  // ==========================================
  // Internal: RPC
  // ==========================================

  private async rpc(method: string, params: unknown[] = []): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.wsAdapter.isConnected()) {
        return reject(new Error('WebSocket not connected'));
      }

      const id = ++this.requestId;

      const timeoutId = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`RPC timeout: ${method}`));
        }
      }, RPC_TIMEOUT);

      this.pending.set(id, { resolve, reject, timeoutId });

      this.wsAdapter.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  }

  private handleMessage(data: string): void {
    const msg = JSON.parse(data);

    // Handle RPC response
    if (msg.id && this.pending.has(msg.id)) {
      const request = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      clearTimeout(request.timeoutId);

      if (msg.error) {
        request.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      } else {
        request.resolve(msg.result);
      }
    }

    // Handle block subscription
    if (msg.method === 'blockchain.headers.subscribe') {
      const header = msg.params[0] as BlockHeader;
      this.lastBlockHeader = header;
      this.blockSubscribers.forEach((cb) => cb(header));
    }
  }

  private handleClose(): void {
    this.isBlockSubscribed = false;
    this.clearPendingRequests(new Error('WebSocket closed'));

    if (this.intentionalClose || !this.autoReconnect) {
      return;
    }

    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.error('[L1Wallet] Max reconnect attempts reached');
      return;
    }

    const delay = Math.min(
      BASE_RECONNECT_DELAY * Math.pow(2, this.reconnectAttempts),
      MAX_RECONNECT_DELAY
    );

    this.reconnectAttempts++;
    console.warn(`[L1Wallet] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      this.connect().catch((err) => {
        console.error('[L1Wallet] Reconnect failed:', err);
      });
    }, delay);
  }

  private handleError(error: Error): void {
    console.error('[L1Wallet] WebSocket error:', error);
  }

  private clearPendingRequests(error: Error): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timeoutId);
      request.reject(error);
    }
    this.pending.clear();
  }

  /**
   * Create a network provider wrapper for VestingClassifier
   * This allows VestingClassifier to use this wallet's connection
   */
  private createNetworkProviderWrapper() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const wallet = this;
    return {
      async connect() {
        await wallet.connect();
      },
      disconnect() {
        // Don't disconnect - managed by wallet
      },
      isConnected() {
        return wallet.isConnected();
      },
      async waitForConnection() {
        await wallet.ensureConnected();
      },
      async getBalance(address: string) {
        return wallet.getBalance(address);
      },
      async getUtxos(address: string) {
        return wallet.getUtxos(address);
      },
      async broadcast(rawTxHex: string) {
        return wallet.broadcast(rawTxHex);
      },
      async getTransaction(txid: string) {
        return wallet.getTransaction(txid);
      },
      async getTransactionHistory(address: string) {
        return wallet.getTransactionHistory(address);
      },
      async getCurrentBlockHeight() {
        return wallet.getCurrentBlockHeight();
      },
      async getBlockHeader(height: number) {
        return wallet.getBlockHeader(height);
      },
      async subscribeBlocks(callback: (header: BlockHeader) => void) {
        return wallet.subscribeBlocks(callback);
      },
    };
  }
}
