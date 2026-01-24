/**
 * Browser Network Provider - WebSocket implementation for Fulcrum
 *
 * Browser-specific implementation of L1NetworkProviderFull.
 * Uses WebSocket API and includes HMR cleanup for Vite.
 *
 * For other platforms (Node.js, React Native), create separate implementations
 * of the L1NetworkProviderFull interface.
 */

import { addressToScriptHash } from "../../address/script";
import type {
  L1NetworkProviderFull,
  BlockHeader,
  TransactionHistoryItem,
  TransactionDetail,
} from "../../network/network";
import type { L1UTXO } from "../../types";

const DEFAULT_ENDPOINT = "wss://fulcrum.unicity.network:50004";

// ==========================================
// Browser Network Provider Class
// ==========================================

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (err: unknown) => void;
  timeoutId?: ReturnType<typeof setTimeout>;
}

interface ConnectionCallback {
  resolve: () => void;
  reject: (err: Error) => void;
  timeoutId?: ReturnType<typeof setTimeout>;
}

interface BalanceResult {
  confirmed: number;
  unconfirmed: number;
}

// Reconnect configuration
const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_DELAY = 2000;
const MAX_DELAY = 60000; // 1 minute

// Timeout configuration
const RPC_TIMEOUT = 30000; // 30 seconds
const CONNECTION_TIMEOUT = 30000; // 30 seconds

/**
 * Browser WebSocket implementation of L1NetworkProviderFull
 */
export class BrowserNetworkProvider implements L1NetworkProviderFull {
  private ws: WebSocket | null = null;
  private _isConnected = false;
  private isConnecting = false;
  private requestId = 0;
  private intentionalClose = false;
  private reconnectAttempts = 0;
  private isBlockSubscribed = false;
  private lastBlockHeader: BlockHeader | null = null;

  private pending: Record<number, PendingRequest> = {};
  private blockSubscribers: ((header: BlockHeader) => void)[] = [];
  private connectionCallbacks: ConnectionCallback[] = [];

  // ----------------------------------------
  // Connection Management
  // ----------------------------------------

  isConnected(): boolean {
    return this._isConnected && this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  waitForConnection(): Promise<void> {
    if (this.isConnected()) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const callback: ConnectionCallback = {
        resolve: () => {
          if (callback.timeoutId) clearTimeout(callback.timeoutId);
          resolve();
        },
        reject: (err: Error) => {
          if (callback.timeoutId) clearTimeout(callback.timeoutId);
          reject(err);
        },
      };

      callback.timeoutId = setTimeout(() => {
        const idx = this.connectionCallbacks.indexOf(callback);
        if (idx > -1) this.connectionCallbacks.splice(idx, 1);
        reject(new Error("Connection timeout"));
      }, CONNECTION_TIMEOUT);

      this.connectionCallbacks.push(callback);
    });
  }

  connect(endpoint: string = DEFAULT_ENDPOINT): Promise<void> {
    console.log("[L1] connect() called, endpoint:", endpoint);
    console.log("[L1] connect() state - isConnected:", this._isConnected, "isConnecting:", this.isConnecting);

    if (this._isConnected) {
      console.log("[L1] Already connected, returning immediately");
      return Promise.resolve();
    }

    if (this.isConnecting) {
      console.log("[L1] Already connecting, waiting for connection...");
      return this.waitForConnection();
    }

    this.isConnecting = true;
    console.log("[L1] Starting new connection to:", endpoint);

    return new Promise((resolve, reject) => {
      let hasResolved = false;

      console.log("[L1] Creating WebSocket object...");
      try {
        this.ws = new WebSocket(endpoint);
        console.log("[L1] WebSocket object created, readyState:", this.ws.readyState);
      } catch (err) {
        console.error("[L1] WebSocket constructor threw exception:", err);
        this.isConnecting = false;
        reject(err);
        return;
      }

      this.ws.onopen = () => {
        console.log("[L1] WebSocket connected:", endpoint);
        this._isConnected = true;
        this.isConnecting = false;
        this.reconnectAttempts = 0;
        hasResolved = true;
        resolve();

        // Notify all waiting callbacks
        this.connectionCallbacks.forEach((cb) => {
          if (cb.timeoutId) clearTimeout(cb.timeoutId);
          cb.resolve();
        });
        this.connectionCallbacks.length = 0;
      };

      this.ws.onclose = () => {
        this._isConnected = false;
        this.isBlockSubscribed = false;

        // Reject all pending requests
        Object.values(this.pending).forEach(req => {
          if (req.timeoutId) clearTimeout(req.timeoutId);
          req.reject(new Error('WebSocket connection closed'));
        });
        this.pending = {};

        // Don't reconnect if intentional close
        if (this.intentionalClose) {
          console.log("[L1] WebSocket closed intentionally");
          this.intentionalClose = false;
          this.isConnecting = false;
          this.reconnectAttempts = 0;

          if (!hasResolved) {
            hasResolved = true;
            reject(new Error("WebSocket connection closed intentionally"));
          }
          return;
        }

        // Check max reconnect attempts
        if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
          console.error('[L1] Max reconnect attempts reached. Giving up.');
          this.isConnecting = false;

          const error = new Error("Max reconnect attempts reached");
          this.connectionCallbacks.forEach(cb => {
            if (cb.timeoutId) clearTimeout(cb.timeoutId);
            cb.reject(error);
          });
          this.connectionCallbacks.length = 0;

          if (!hasResolved) {
            hasResolved = true;
            reject(error);
          }
          return;
        }

        // Exponential backoff
        const delay = Math.min(
          BASE_DELAY * Math.pow(2, this.reconnectAttempts),
          MAX_DELAY
        );

        this.reconnectAttempts++;
        console.warn(`[L1] WebSocket closed unexpectedly. Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);

        setTimeout(() => {
          this.connect(endpoint)
            .then(() => {
              if (!hasResolved) {
                hasResolved = true;
                resolve();
              }
            })
            .catch((err) => {
              if (!hasResolved) {
                hasResolved = true;
                reject(err);
              }
            });
        }, delay);
      };

      this.ws.onerror = (err: Event) => {
        console.error("[L1] WebSocket error:", err);
        console.error("[L1] WebSocket error - readyState:", this.ws?.readyState);
        console.error("[L1] WebSocket error - url:", endpoint);
        // Note: Browser WebSocket errors don't provide detailed error info for security reasons
        // The actual connection error details are only visible in browser DevTools Network tab
        // Error alone doesn't mean connection failed - onclose will be called
      };

      this.ws.onmessage = (msg) => this.handleMessage(msg);
    });
  }

  disconnect(): void {
    if (this.ws) {
      this.intentionalClose = true;
      this.ws.close();
      this.ws = null;
    }
    this._isConnected = false;
    this.isConnecting = false;
    this.reconnectAttempts = 0;
    this.isBlockSubscribed = false;

    // Clear all pending request timeouts
    Object.values(this.pending).forEach(req => {
      if (req.timeoutId) clearTimeout(req.timeoutId);
    });
    this.pending = {};

    // Clear connection callback timeouts
    this.connectionCallbacks.forEach(cb => {
      if (cb.timeoutId) clearTimeout(cb.timeoutId);
    });
    this.connectionCallbacks.length = 0;
  }

  /**
   * Cleanup resources (for HMR)
   */
  dispose(): void {
    console.log('[L1] Disposing WebSocket');
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close();
    }
    this.ws = null;
    this._isConnected = false;
    this.isConnecting = false;
    this.intentionalClose = false;
    this.reconnectAttempts = 0;
    this.isBlockSubscribed = false;
    this.lastBlockHeader = null;

    Object.values(this.pending).forEach(req => {
      if (req.timeoutId) clearTimeout(req.timeoutId);
    });
    this.pending = {};

    this.connectionCallbacks.forEach(cb => {
      if (cb.timeoutId) clearTimeout(cb.timeoutId);
    });
    this.blockSubscribers.length = 0;
    this.connectionCallbacks.length = 0;
  }

  // ----------------------------------------
  // RPC
  // ----------------------------------------

  private handleMessage(event: MessageEvent): void {
    const data = JSON.parse(event.data);

    if (data.id && this.pending[data.id]) {
      const request = this.pending[data.id];
      delete this.pending[data.id];
      if (request.timeoutId) clearTimeout(request.timeoutId);

      if (data.error) {
        request.reject(data.error);
      } else {
        request.resolve(data.result);
      }
    }

    if (data.method === "blockchain.headers.subscribe") {
      const header = data.params[0] as BlockHeader;
      this.lastBlockHeader = header;
      this.blockSubscribers.forEach((cb) => cb(header));
    }
  }

  private async rpc(method: string, params: unknown[] = []): Promise<unknown> {
    // Auto-connect if not connected
    if (!this._isConnected && !this.isConnecting) {
      console.log("[L1] RPC: Auto-connecting to WebSocket...");
      await this.connect();
    }

    // Wait for connection
    if (!this.isConnected()) {
      console.log("[L1] RPC: Waiting for WebSocket connection...");
      await this.waitForConnection();
    }

    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return reject(new Error("WebSocket not connected (OPEN)"));
      }

      const id = ++this.requestId;

      const timeoutId = setTimeout(() => {
        if (this.pending[id]) {
          delete this.pending[id];
          reject(new Error(`RPC timeout: ${method}`));
        }
      }, RPC_TIMEOUT);

      this.pending[id] = {
        resolve: (result) => {
          clearTimeout(timeoutId);
          resolve(result);
        },
        reject: (err) => {
          clearTimeout(timeoutId);
          reject(err);
        },
        timeoutId,
      };

      this.ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });
  }

  // ----------------------------------------
  // Core Methods
  // ----------------------------------------

  async getBalance(address: string): Promise<number> {
    const scriptHash = addressToScriptHash(address);
    const result = await this.rpc("blockchain.scripthash.get_balance", [scriptHash]) as BalanceResult;

    const confirmed = result.confirmed || 0;
    const unconfirmed = result.unconfirmed || 0;
    const totalSats = confirmed + unconfirmed;

    // Convert sats → ALPHA
    return totalSats / 100_000_000;
  }

  async getUtxos(address: string): Promise<L1UTXO[]> {
    const scripthash = addressToScriptHash(address);
    const result = await this.rpc("blockchain.scripthash.listunspent", [scripthash]);

    if (!Array.isArray(result)) {
      console.warn("listunspent returned non-array:", result);
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

  async broadcast(rawHex: string): Promise<string> {
    return await this.rpc("blockchain.transaction.broadcast", [rawHex]) as string;
  }

  // ----------------------------------------
  // Transaction Methods
  // ----------------------------------------

  async getTransaction(txid: string): Promise<TransactionDetail> {
    return await this.rpc("blockchain.transaction.get", [txid, true]) as TransactionDetail;
  }

  async getTransactionHistory(address: string): Promise<TransactionHistoryItem[]> {
    const scriptHash = addressToScriptHash(address);
    const result = await this.rpc("blockchain.scripthash.get_history", [scriptHash]);

    if (!Array.isArray(result)) {
      console.warn("get_history returned non-array:", result);
      return [];
    }

    return result as TransactionHistoryItem[];
  }

  // ----------------------------------------
  // Block Methods
  // ----------------------------------------

  async getCurrentBlockHeight(): Promise<number> {
    try {
      const header = await this.rpc("blockchain.headers.subscribe", []) as BlockHeader;
      return header?.height || 0;
    } catch (err) {
      console.error("Error getting current block height:", err);
      return 0;
    }
  }

  async getBlockHeader(height: number): Promise<unknown> {
    return await this.rpc("blockchain.block.header", [height, height]);
  }

  async subscribeBlocks(cb: (header: BlockHeader) => void): Promise<() => void> {
    // Auto-connect if not connected
    if (!this._isConnected && !this.isConnecting) {
      await this.connect();
    }

    // Wait for connection
    if (!this.isConnected()) {
      await this.waitForConnection();
    }

    this.blockSubscribers.push(cb);

    // Only send RPC subscription if not already subscribed
    if (!this.isBlockSubscribed) {
      this.isBlockSubscribed = true;
      const header = await this.rpc("blockchain.headers.subscribe", []) as BlockHeader;
      if (header) {
        this.lastBlockHeader = header;
        // Notify ALL current subscribers with the initial header
        this.blockSubscribers.forEach(subscriber => subscriber(header));
      }
    } else if (this.lastBlockHeader) {
      // For late subscribers, immediately notify with cached header
      cb(this.lastBlockHeader);
    }

    // Return unsubscribe function
    return () => {
      const index = this.blockSubscribers.indexOf(cb);
      if (index > -1) {
        this.blockSubscribers.splice(index, 1);
      }
    };
  }
}

// ==========================================
// Singleton Instance
// ==========================================

let browserProviderInstance: BrowserNetworkProvider | null = null;

/**
 * Get the singleton BrowserNetworkProvider instance
 */
export function getBrowserProvider(): BrowserNetworkProvider {
  if (!browserProviderInstance) {
    browserProviderInstance = new BrowserNetworkProvider();
  }
  return browserProviderInstance;
}

/**
 * Dispose the singleton instance (for HMR cleanup)
 */
export function disposeBrowserProvider(): void {
  if (browserProviderInstance) {
    browserProviderInstance.dispose();
    browserProviderInstance = null;
  }
}
