// sdk/l1/network.ts

import { addressToScriptHash } from "./addressToScriptHash";
import type { UTXO } from "./types";

const DEFAULT_ENDPOINT = "wss://fulcrum.unicity.network:50004";

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (err: unknown) => void;
}

export interface BlockHeader {
  height: number;
  hex: string;
  [key: string]: unknown;
}

interface BalanceResult {
  confirmed: number;
  unconfirmed: number;
}

let ws: WebSocket | null = null;
let isConnected = false;
let isConnecting = false;
let requestId = 0;
let intentionalClose = false;
let reconnectAttempts = 0;
let isBlockSubscribed = false;
let lastBlockHeader: BlockHeader | null = null;

// Store timeout IDs for pending requests
interface PendingRequestWithTimeout extends PendingRequest {
  timeoutId?: ReturnType<typeof setTimeout>;
}

const pending: Record<number, PendingRequestWithTimeout> = {};
const blockSubscribers: ((header: BlockHeader) => void)[] = [];

// Connection state callbacks with cleanup support
interface ConnectionCallback {
  resolve: () => void;
  reject: (err: Error) => void;
  timeoutId?: ReturnType<typeof setTimeout>;
}
const connectionCallbacks: ConnectionCallback[] = [];

// Reconnect configuration
const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_DELAY = 2000;
const MAX_DELAY = 60000; // 1 minute

// Timeout configuration
const RPC_TIMEOUT = 30000; // 30 seconds
const CONNECTION_TIMEOUT = 30000; // 30 seconds

// ----------------------------------------
// HMR CLEANUP
// ----------------------------------------
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    console.log('[L1] Disposing WebSocket before HMR');
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
    ws = null;
    isConnected = false;
    isConnecting = false;
    intentionalClose = false;
    reconnectAttempts = 0;
    isBlockSubscribed = false;
    lastBlockHeader = null;
    // Clear pending request timeouts
    Object.values(pending).forEach(req => {
      if (req.timeoutId) clearTimeout(req.timeoutId);
    });
    Object.keys(pending).forEach(key => delete pending[Number(key)]);
    // Clear connection callback timeouts
    connectionCallbacks.forEach(cb => {
      if (cb.timeoutId) clearTimeout(cb.timeoutId);
    });
    blockSubscribers.length = 0;
    connectionCallbacks.length = 0;
  });
}

// ----------------------------------------
// CONNECTION STATE
// ----------------------------------------
export function isWebSocketConnected(): boolean {
  return isConnected && ws !== null && ws.readyState === WebSocket.OPEN;
}

export function waitForConnection(): Promise<void> {
  if (isWebSocketConnected()) {
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
      // Remove from callbacks array
      const idx = connectionCallbacks.indexOf(callback);
      if (idx > -1) connectionCallbacks.splice(idx, 1);
      reject(new Error("Connection timeout"));
    }, CONNECTION_TIMEOUT);

    connectionCallbacks.push(callback);
  });
}

// ----------------------------------------
// SINGLETON CONNECT — prevents double connect
// ----------------------------------------
export function connect(endpoint: string = DEFAULT_ENDPOINT): Promise<void> {
  console.log("[L1] connect() called, endpoint:", endpoint);
  console.log("[L1] connect() state - isConnected:", isConnected, "isConnecting:", isConnecting);

  if (isConnected) {
    console.log("[L1] Already connected, returning immediately");
    return Promise.resolve();
  }

  if (isConnecting) {
    console.log("[L1] Already connecting, waiting for connection...");
    return waitForConnection();
  }

  isConnecting = true;
  console.log("[L1] Starting new connection to:", endpoint);

  return new Promise((resolve, reject) => {
    let hasResolved = false;

    console.log("[L1] Creating WebSocket object...");
    try {
      ws = new WebSocket(endpoint);
      console.log("[L1] WebSocket object created, readyState:", ws.readyState);
    } catch (err) {
      console.error("[L1] WebSocket constructor threw exception:", err);
      isConnecting = false;
      reject(err);
      return;
    }

    ws.onopen = () => {
      console.log("[L1] WebSocket connected:", endpoint);
      isConnected = true;
      isConnecting = false;
      reconnectAttempts = 0; // Reset reconnect counter on successful connection
      hasResolved = true;
      resolve();

      // Notify all waiting callbacks (clear their timeouts first)
      connectionCallbacks.forEach((cb) => {
        if (cb.timeoutId) clearTimeout(cb.timeoutId);
        cb.resolve();
      });
      connectionCallbacks.length = 0;
    };

    ws.onclose = () => {
      isConnected = false;
      isBlockSubscribed = false; // Reset block subscription on disconnect

      // Reject all pending requests and clear their timeouts
      Object.values(pending).forEach(req => {
        if (req.timeoutId) clearTimeout(req.timeoutId);
        req.reject(new Error('WebSocket connection closed'));
      });
      Object.keys(pending).forEach(key => delete pending[Number(key)]);

      // Don't reconnect if this was an intentional close
      if (intentionalClose) {
        console.log("[L1] WebSocket closed intentionally");
        intentionalClose = false;
        isConnecting = false;
        reconnectAttempts = 0;

        // Reject if we haven't resolved yet
        if (!hasResolved) {
          hasResolved = true;
          reject(new Error("WebSocket connection closed intentionally"));
        }
        return;
      }

      // Check if we've exceeded max reconnect attempts
      if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        console.error('[L1] Max reconnect attempts reached. Giving up.');
        isConnecting = false;

        // Reject all waiting callbacks
        const error = new Error("Max reconnect attempts reached");
        connectionCallbacks.forEach(cb => {
          if (cb.timeoutId) clearTimeout(cb.timeoutId);
          cb.reject(error);
        });
        connectionCallbacks.length = 0;

        // Reject if we haven't resolved yet
        if (!hasResolved) {
          hasResolved = true;
          reject(error);
        }
        return;
      }

      // Calculate exponential backoff delay
      const delay = Math.min(
        BASE_DELAY * Math.pow(2, reconnectAttempts),
        MAX_DELAY
      );

      reconnectAttempts++;
      console.warn(`[L1] WebSocket closed unexpectedly. Reconnecting in ${delay}ms (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);

      // Keep isConnecting true so callers know reconnection is in progress
      // The resolve/reject will happen when reconnection succeeds or fails
      setTimeout(() => {
        connect(endpoint)
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

    ws.onerror = (err: Event) => {
      console.error("[L1] WebSocket error:", err);
      console.error("[L1] WebSocket error - readyState:", ws?.readyState);
      console.error("[L1] WebSocket error - url:", endpoint);
      // Note: Browser WebSocket errors don't provide detailed error info for security reasons
      // The actual connection error details are only visible in browser DevTools Network tab
      // Error alone doesn't mean connection failed - onclose will be called
    };

    ws.onmessage = (msg) => handleMessage(msg);
  });
}

function handleMessage(event: MessageEvent) {
  const data = JSON.parse(event.data);

  if (data.id && pending[data.id]) {
    const request = pending[data.id];
    delete pending[data.id];
    if (data.error) {
      request.reject(data.error);
    } else {
      request.resolve(data.result);
    }
  }

  if (data.method === "blockchain.headers.subscribe") {
    const header = data.params[0] as BlockHeader;
    lastBlockHeader = header; // Cache for late subscribers
    blockSubscribers.forEach((cb) => cb(header));
  }
}

// ----------------------------------------
// SAFE RPC - Auto-connects and waits if needed
// ----------------------------------------
export async function rpc(method: string, params: unknown[] = []): Promise<unknown> {
  // Auto-connect if not connected
  if (!isConnected && !isConnecting) {
    console.log("[L1] RPC: Auto-connecting to WebSocket...");
    await connect();
  }

  // Wait for connection if connecting
  if (!isWebSocketConnected()) {
    console.log("[L1] RPC: Waiting for WebSocket connection...");
    await waitForConnection();
  }

  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return reject(new Error("WebSocket not connected (OPEN)"));
    }

    const id = ++requestId;

    // Set up timeout for this request
    const timeoutId = setTimeout(() => {
      if (pending[id]) {
        delete pending[id];
        reject(new Error(`RPC timeout: ${method}`));
      }
    }, RPC_TIMEOUT);

    pending[id] = {
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

    ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
  });
}

// ----------------------------------------
// API METHODS
// ----------------------------------------

export async function getUtxo(address: string) {
  const scripthash = addressToScriptHash(address);

  const result = await rpc("blockchain.scripthash.listunspent", [scripthash]);

  if (!Array.isArray(result)) {
    console.warn("listunspent returned non-array:", result);
    return [];
  }

  return result.map((u: UTXO) => ({
    tx_hash: u.tx_hash,
    tx_pos: u.tx_pos,
    value: u.value,
    height: u.height,
    address,
  }));
}

export async function getBalance(address: string) {
  const scriptHash = addressToScriptHash(address);
  const result = await rpc("blockchain.scripthash.get_balance", [scriptHash]) as BalanceResult;

  const confirmed = result.confirmed || 0;
  const unconfirmed = result.unconfirmed || 0;

  const totalSats = confirmed + unconfirmed;

  // Convert sats → ALPHA
  const alpha = totalSats / 100_000_000;

  return alpha;
}

export async function broadcast(rawHex: string) {
  return await rpc("blockchain.transaction.broadcast", [rawHex]);
}

export async function subscribeBlocks(cb: (header: BlockHeader) => void): Promise<() => void> {
  // Auto-connect if not connected (same as rpc())
  if (!isConnected && !isConnecting) {
    await connect();
  }

  // Wait for connection to be established
  if (!isWebSocketConnected()) {
    await waitForConnection();
  }

  blockSubscribers.push(cb);

  // Only send RPC subscription if not already subscribed
  // This prevents duplicate server-side subscriptions
  if (!isBlockSubscribed) {
    isBlockSubscribed = true;
    const header = await rpc("blockchain.headers.subscribe", []) as BlockHeader;
    if (header) {
      lastBlockHeader = header;
      // Notify ALL current subscribers with the initial header
      blockSubscribers.forEach(subscriber => subscriber(header));
    }
  } else if (lastBlockHeader) {
    // For late subscribers, immediately notify with cached header
    cb(lastBlockHeader);
  }

  // Return unsubscribe function
  return () => {
    const index = blockSubscribers.indexOf(cb);
    if (index > -1) {
      blockSubscribers.splice(index, 1);
    }
  };
}

export interface TransactionHistoryItem {
  tx_hash: string;
  height: number;
  fee?: number;
}

export interface TransactionDetail {
  txid: string;
  version: number;
  locktime: number;
  vin: Array<{
    txid: string;
    vout: number;
    scriptSig?: {
      hex: string;
    };
    sequence: number;
  }>;
  vout: Array<{
    value: number;
    n: number;
    scriptPubKey: {
      hex: string;
      type: string;
      addresses?: string[];
      address?: string;
    };
  }>;
  blockhash?: string;
  confirmations?: number;
  time?: number;
  blocktime?: number;
}

export async function getTransactionHistory(address: string): Promise<TransactionHistoryItem[]> {
  const scriptHash = addressToScriptHash(address);
  const result = await rpc("blockchain.scripthash.get_history", [scriptHash]);

  if (!Array.isArray(result)) {
    console.warn("get_history returned non-array:", result);
    return [];
  }

  return result as TransactionHistoryItem[];
}

export async function getTransaction(txid: string) {
  return await rpc("blockchain.transaction.get", [txid, true]);
}

export async function getBlockHeader(height: number) {
  return await rpc("blockchain.block.header", [height, height]);
}

export async function getCurrentBlockHeight(): Promise<number> {
  try {
    const header = await rpc("blockchain.headers.subscribe", []) as BlockHeader;
    return header?.height || 0;
  } catch (err) {
    console.error("Error getting current block height:", err);
    return 0;
  }
}

export function disconnect() {
  if (ws) {
    intentionalClose = true;
    ws.close();
    ws = null;
  }
  isConnected = false;
  isConnecting = false;
  reconnectAttempts = 0;
  isBlockSubscribed = false;

  // Clear all pending request timeouts
  Object.values(pending).forEach(req => {
    if (req.timeoutId) clearTimeout(req.timeoutId);
  });
  Object.keys(pending).forEach(key => delete pending[Number(key)]);

  // Clear connection callback timeouts
  connectionCallbacks.forEach(cb => {
    if (cb.timeoutId) clearTimeout(cb.timeoutId);
  });
  connectionCallbacks.length = 0;
}
