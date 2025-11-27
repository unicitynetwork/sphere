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

const pending: Record<number, PendingRequest> = {};
const blockSubscribers: ((header: BlockHeader) => void)[] = [];

// Connection state callbacks
const connectionCallbacks: (() => void)[] = [];

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

  return new Promise((resolve) => {
    connectionCallbacks.push(resolve);
  });
}

// ----------------------------------------
// SINGLETON CONNECT — prevents double connect
// ----------------------------------------
export function connect(endpoint: string = DEFAULT_ENDPOINT): Promise<void> {
  if (isConnected) return Promise.resolve();

  if (isConnecting) {
    return new Promise((resolve) => {
      const check = setInterval(() => {
        if (isConnected) {
          clearInterval(check);
          resolve();
        }
      }, 50);
    });
  }

  isConnecting = true;

  return new Promise((resolve) => {
    ws = new WebSocket(endpoint);

    ws.onopen = () => {
      console.log("[L1] WebSocket connected:", endpoint);
      isConnected = true;
      isConnecting = false;
      resolve();

      // Notify all waiting callbacks
      connectionCallbacks.forEach((cb) => cb());
      connectionCallbacks.length = 0;
    };

    ws.onclose = () => {
      console.warn("[L1] WebSocket closed. Reconnecting...");
      isConnected = false;
      setTimeout(() => connect(endpoint), 2000);
    };

    ws.onerror = (err) => {
      console.error("[L1] WebSocket error:", err);
    };

    ws.onmessage = (msg) => handleMessage(msg);
  });
}

function handleMessage(event: MessageEvent) {
  const data = JSON.parse(event.data);

  if (data.id && pending[data.id]) {
    if (data.error) {
      pending[data.id].reject(data.error);
    } else {
      pending[data.id].resolve(data.result);
    }
    delete pending[data.id];
  }

  if (data.method === "blockchain.headers.subscribe") {
    const header = data.params[0];
    blockSubscribers.forEach((cb) => cb(header));
  }
}

// ----------------------------------------
// SAFE RPC
// ----------------------------------------
export function rpc(method: string, params: unknown[] = []): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return reject("WebSocket not connected (OPEN)");
    }

    const id = ++requestId;
    pending[id] = { resolve, reject };

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
  // Wait for connection to be established
  await waitForConnection();

  blockSubscribers.push(cb);
  const header = await rpc("blockchain.headers.subscribe", []) as BlockHeader;
  // Call callback immediately with current block
  if (header) {
    cb(header);
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
    ws.close();
    ws = null;
  }
  isConnected = false;
}
