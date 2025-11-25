// sdk/l1/network.ts

import { addressToScriptHash } from "./addressToScriptHash";

const DEFAULT_ENDPOINT = "wss://fulcrum.unicity.network:50004";

let ws: WebSocket | null = null;
let isConnected = false;
let isConnecting = false;
let requestId = 0;

const pending: Record<number, { resolve: (result: any) => void; reject: (err: any) => void }> = {};
const blockSubscribers: ((header: any) => void)[] = [];

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
export function rpc(method: string, params: any[] = []): Promise<any> {
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

  return result.map((u) => ({
    tx_hash: u.tx_hash,
    tx_pos: u.tx_pos,
    value: u.value,
    height: u.height,
    address,
  }));
}

export async function getBalance(address: string) {
  const scriptHash = addressToScriptHash(address);
  const result = await rpc("blockchain.scripthash.get_balance", [scriptHash]);

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

export async function subscribeBlocks(cb: (header: any) => void) {
  blockSubscribers.push(cb);
  await rpc("blockchain.headers.subscribe", []);
}

export function disconnect() {
  if (ws) {
    ws.close();
    ws = null;
  }
  isConnected = false;
}
