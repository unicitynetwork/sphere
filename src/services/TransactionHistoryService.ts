/**
 * Transaction History Service
 *
 * Standalone service for tracking transaction history (sent/received tokens).
 * Extracted from WalletRepository as part of the InventorySyncService migration.
 *
 * Per TOKEN_INVENTORY_SPEC.md Section 6.1: Token inventory is managed by InventorySyncService.
 * Transaction history is a separate concern and lives in its own service.
 */

import { v4 as uuidv4 } from 'uuid';
import { STORAGE_KEYS } from '../config/storageKeys';

/**
 * Interface for transaction history entries
 */
export interface TransactionHistoryEntry {
  id: string;
  type: 'SENT' | 'RECEIVED';
  amount: string;
  coinId: string;
  symbol: string;
  iconUrl?: string;
  timestamp: number;
  recipientNametag?: string;
  senderPubkey?: string;
}

/**
 * Transaction History Service - manages transaction history independently of token inventory.
 *
 * This service provides:
 * - Persistent storage of transaction history in localStorage
 * - Methods to add sent/received transactions
 * - Query interface for UI components
 *
 * Design rationale:
 * - Transaction history is a separate concern from token inventory
 * - History persists even if tokens are moved to other devices
 * - Allows InventorySyncService to focus solely on token management
 */
export class TransactionHistoryService {
  private static instance: TransactionHistoryService;
  private _history: TransactionHistoryEntry[] = [];

  private constructor() {
    this.loadFromStorage();
  }

  static getInstance(): TransactionHistoryService {
    if (!TransactionHistoryService.instance) {
      TransactionHistoryService.instance = new TransactionHistoryService();
    }
    return TransactionHistoryService.instance;
  }

  // ==========================================
  // Initialization
  // ==========================================

  /**
   * Load transaction history from localStorage
   */
  private loadFromStorage(): void {
    try {
      const json = localStorage.getItem(STORAGE_KEYS.TRANSACTION_HISTORY);
      if (json) {
        this._history = JSON.parse(json);
        console.log(`📜 [TransactionHistory] Loaded ${this._history.length} entries`);
      }
    } catch (error) {
      console.error('[TransactionHistory] Failed to load from storage:', error);
      this._history = [];
    }
  }

  /**
   * Save transaction history to localStorage
   */
  private saveToStorage(): void {
    try {
      localStorage.setItem(STORAGE_KEYS.TRANSACTION_HISTORY, JSON.stringify(this._history));
    } catch (error) {
      console.error('[TransactionHistory] Failed to save to storage:', error);
    }
  }

  // ==========================================
  // Query API
  // ==========================================

  /**
   * Get all transaction history entries, sorted by timestamp (newest first)
   */
  getHistory(): TransactionHistoryEntry[] {
    return [...this._history].sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Get transaction history for a specific time range
   */
  getHistoryInRange(startTime: number, endTime: number): TransactionHistoryEntry[] {
    return this._history
      .filter(entry => entry.timestamp >= startTime && entry.timestamp <= endTime)
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Get recent transactions (last N entries)
   */
  getRecentTransactions(count: number = 10): TransactionHistoryEntry[] {
    return this.getHistory().slice(0, count);
  }

  /**
   * Get transaction count
   */
  getCount(): number {
    return this._history.length;
  }

  // ==========================================
  // Write API
  // ==========================================

  /**
   * Add a transaction to history
   */
  addTransaction(entry: Omit<TransactionHistoryEntry, 'id'>): TransactionHistoryEntry {
    const historyEntry: TransactionHistoryEntry = {
      id: uuidv4(),
      ...entry,
    };

    this._history.push(historyEntry);
    this.saveToStorage();

    console.log(`📜 [TransactionHistory] Added ${entry.type} transaction: ${entry.amount} ${entry.symbol}`);

    // Dispatch event for UI updates
    window.dispatchEvent(new Event('transaction-history-updated'));

    return historyEntry;
  }

  /**
   * Add a SENT transaction
   */
  addSent(
    amount: string,
    coinId: string,
    symbol: string,
    iconUrl?: string,
    recipientNametag?: string
  ): TransactionHistoryEntry {
    return this.addTransaction({
      type: 'SENT',
      amount,
      coinId,
      symbol,
      iconUrl,
      timestamp: Date.now(),
      recipientNametag,
    });
  }

  /**
   * Add a RECEIVED transaction
   */
  addReceived(
    amount: string,
    coinId: string,
    symbol: string,
    iconUrl?: string,
    senderPubkey?: string,
    timestamp?: number
  ): TransactionHistoryEntry {
    return this.addTransaction({
      type: 'RECEIVED',
      amount,
      coinId,
      symbol,
      iconUrl,
      timestamp: timestamp || Date.now(),
      senderPubkey,
    });
  }

  // ==========================================
  // Management API
  // ==========================================

  /**
   * Clear all transaction history
   */
  clear(): void {
    this._history = [];
    this.saveToStorage();
    window.dispatchEvent(new Event('transaction-history-updated'));
    console.log('📜 [TransactionHistory] Cleared all history');
  }

  /**
   * Prune old transactions (keep last N entries)
   */
  prune(keepCount: number = 1000): number {
    if (this._history.length <= keepCount) {
      return 0;
    }

    // Sort by timestamp and keep newest
    this._history.sort((a, b) => b.timestamp - a.timestamp);
    const removed = this._history.length - keepCount;
    this._history = this._history.slice(0, keepCount);
    this.saveToStorage();

    console.log(`📜 [TransactionHistory] Pruned ${removed} old entries`);
    return removed;
  }

  /**
   * Remove a specific transaction by ID
   */
  removeById(id: string): boolean {
    const index = this._history.findIndex(entry => entry.id === id);
    if (index === -1) {
      return false;
    }

    this._history.splice(index, 1);
    this.saveToStorage();
    window.dispatchEvent(new Event('transaction-history-updated'));
    return true;
  }

  // ==========================================
  // Import/Export (for backup compatibility)
  // ==========================================

  /**
   * Import transaction history from external source (e.g., backup restore)
   * Merges with existing history, avoiding duplicates by ID
   */
  importHistory(entries: TransactionHistoryEntry[]): number {
    let imported = 0;
    const existingIds = new Set(this._history.map(e => e.id));

    for (const entry of entries) {
      if (!existingIds.has(entry.id)) {
        this._history.push(entry);
        imported++;
      }
    }

    if (imported > 0) {
      this.saveToStorage();
      window.dispatchEvent(new Event('transaction-history-updated'));
      console.log(`📜 [TransactionHistory] Imported ${imported} entries`);
    }

    return imported;
  }

  /**
   * Export transaction history for backup
   */
  exportHistory(): TransactionHistoryEntry[] {
    return [...this._history];
  }
}

// ==========================================
// Convenience functions (for simpler imports)
// ==========================================

/**
 * Get the TransactionHistoryService singleton
 */
export function getTransactionHistoryService(): TransactionHistoryService {
  return TransactionHistoryService.getInstance();
}

/**
 * Get transaction history (sorted by timestamp, newest first)
 */
export function getTransactionHistory(): TransactionHistoryEntry[] {
  return TransactionHistoryService.getInstance().getHistory();
}

/**
 * Add a sent transaction to history
 */
export function addSentTransaction(
  amount: string,
  coinId: string,
  symbol: string,
  iconUrl?: string,
  recipientNametag?: string
): TransactionHistoryEntry {
  return TransactionHistoryService.getInstance().addSent(
    amount,
    coinId,
    symbol,
    iconUrl,
    recipientNametag
  );
}

/**
 * Add a received transaction to history
 */
export function addReceivedTransaction(
  amount: string,
  coinId: string,
  symbol: string,
  iconUrl?: string,
  senderPubkey?: string,
  timestamp?: number
): TransactionHistoryEntry {
  return TransactionHistoryService.getInstance().addReceived(
    amount,
    coinId,
    symbol,
    iconUrl,
    senderPubkey,
    timestamp
  );
}
