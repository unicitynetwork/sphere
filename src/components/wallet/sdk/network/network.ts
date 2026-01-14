/**
 * Network Provider - SDK Interface and Utilities
 *
 * Defines the L1NetworkProvider interface for Alpha blockchain operations.
 * Platform-specific implementations (Browser, Node.js, React Native) implement this interface.
 *
 * This file contains:
 * - Extended L1NetworkProvider interface with all required methods
 * - Type definitions for network responses
 * - Pure utility functions that work with any provider
 */

import type { L1UTXO } from '../types';

// ==========================================
// Network Response Types
// ==========================================

/**
 * Block header from subscription
 */
export interface BlockHeader {
  height: number;
  hex: string;
  [key: string]: unknown;
}

/**
 * Transaction history item
 */
export interface TransactionHistoryItem {
  tx_hash: string;
  height: number;
  fee?: number;
}

/**
 * Transaction details from network
 */
export interface TransactionDetail {
  txid: string;
  version: number;
  locktime: number;
  vin: Array<{
    txid?: string; // undefined for coinbase transactions
    vout?: number;
    coinbase?: string; // present for coinbase transactions
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

// ==========================================
// Extended Network Provider Interface
// ==========================================

/**
 * Extended L1 Network provider interface for Alpha blockchain operations.
 *
 * This interface extends the base L1NetworkProvider with additional methods
 * needed for full wallet functionality (block subscriptions, connection management).
 *
 * Implementations provide platform-specific network access:
 * - Browser: WebSocket to Fulcrum
 * - Node.js: ws package to Fulcrum
 * - React Native: platform WebSocket
 */
export interface L1NetworkProviderFull {
  // ----------------------------------------
  // Connection Management
  // ----------------------------------------

  /** Connect to the network */
  connect(endpoint?: string): Promise<void>;

  /** Disconnect from the network */
  disconnect(): void;

  /** Check if connected */
  isConnected(): boolean;

  /** Wait for connection to be established */
  waitForConnection(): Promise<void>;

  // ----------------------------------------
  // Core Methods (from base L1NetworkProvider)
  // ----------------------------------------

  /** Get balance for address in ALPHA (not satoshis) */
  getBalance(address: string): Promise<number>;

  /** Get UTXOs for address */
  getUtxos(address: string): Promise<L1UTXO[]>;

  /** Broadcast raw transaction hex, returns txid */
  broadcast(rawTxHex: string): Promise<string>;

  // ----------------------------------------
  // Transaction Methods
  // ----------------------------------------

  /** Get transaction details by txid */
  getTransaction(txid: string): Promise<TransactionDetail>;

  /** Get transaction history for address */
  getTransactionHistory(address: string): Promise<TransactionHistoryItem[]>;

  // ----------------------------------------
  // Block Methods
  // ----------------------------------------

  /** Get current block height */
  getCurrentBlockHeight(): Promise<number>;

  /** Get block header by height */
  getBlockHeader(height: number): Promise<unknown>;

  /**
   * Subscribe to new block headers
   * @returns Unsubscribe function
   */
  subscribeBlocks(callback: (header: BlockHeader) => void): Promise<() => void>;
}

// ==========================================
// Utility Functions (work with any provider)
// ==========================================

/**
 * Get total balance for multiple addresses
 */
export async function getTotalBalance(
  provider: L1NetworkProviderFull,
  addresses: string[]
): Promise<number> {
  const balances = await Promise.all(
    addresses.map(addr => provider.getBalance(addr))
  );
  return balances.reduce((sum, bal) => sum + bal, 0);
}

/**
 * Get all UTXOs for multiple addresses
 */
export async function getAllUtxos(
  provider: L1NetworkProviderFull,
  addresses: string[]
): Promise<L1UTXO[]> {
  const utxoArrays = await Promise.all(
    addresses.map(addr => provider.getUtxos(addr))
  );
  return utxoArrays.flat();
}

/**
 * Wait for transaction confirmation
 * @param provider Network provider
 * @param txid Transaction ID to wait for
 * @param confirmations Number of confirmations to wait for (default: 1)
 * @param timeout Timeout in milliseconds (default: 5 minutes)
 */
export async function waitForConfirmation(
  provider: L1NetworkProviderFull,
  txid: string,
  confirmations: number = 1,
  timeout: number = 300000
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    try {
      const tx = await provider.getTransaction(txid);
      if (tx.confirmations && tx.confirmations >= confirmations) {
        return true;
      }
    } catch {
      // Transaction not found yet, keep waiting
    }

    // Wait 10 seconds before next check
    await new Promise(resolve => setTimeout(resolve, 10000));
  }

  return false;
}
