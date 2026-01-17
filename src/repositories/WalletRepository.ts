/**
 * WalletRepository - App Wrapper over SDK Browser Singleton
 *
 * This is a thin wrapper that:
 * 1. Provides backward-compatible singleton API (getInstance)
 * 2. Converts between app types (WalletToken) and SDK types (StoredToken)
 * 3. Dispatches DOM events for wallet updates
 *
 * All core logic lives in SDK: src/components/wallet/sdk/core/wallet-repository.ts
 * Browser singleton: src/components/wallet/sdk/browser/wallet-repository-singleton.ts
 */

import { WalletToken, TokenCollection, TokenStatus } from "../components/wallet/L3/data/model";
import type { TombstoneEntry, TxfToken } from "../components/wallet/L3/services/types/TxfTypes";
import { STORAGE_KEYS, STORAGE_KEY_PREFIXES } from "../config/storageKeys";

// SDK imports
import {
  getWalletRepository,
  dispatchWalletLoaded,
} from "../components/wallet/sdk/browser";
import {
  WALLET_REPOSITORY_KEYS,
  type StoredToken,
  type StoredWalletData,
  isIncrementalUpdate as sdkIsIncrementalUpdate,
} from "../components/wallet/sdk/core";

// Re-export SDK types
export type { TombstoneEntry, TxfToken };

// ==========================================
// App-Specific Types
// ==========================================

export interface NametagData {
  name: string;
  token: object;
  timestamp: number;
  format: string;
  version: string;
}

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

// ==========================================
// Type Converters
// ==========================================

function toStoredToken(token: WalletToken): StoredToken {
  return {
    id: token.id,
    jsonData: token.jsonData,
    coinId: token.coinId,
    amount: token.amount,
    symbol: token.symbol,
    timestamp: token.timestamp,
  };
}

function fromStoredToken(stored: StoredToken): WalletToken {
  let name = "Token";
  let type = "UCT";

  if (stored.jsonData) {
    try {
      const txf = JSON.parse(stored.jsonData);
      const tokenType = txf.genesis?.data?.tokenType || "";
      const isNft = tokenType === "455ad8720656b08e8dbd5bac1f3c73eeea5431565f6c1c3af742b1aa12d41d89";
      name = isNft ? "NFT" : "Token";
      type = isNft ? "NFT" : "UCT";
    } catch {
      // Use defaults
    }
  }

  return new WalletToken({
    id: stored.id,
    name,
    type,
    timestamp: stored.timestamp || Date.now(),
    jsonData: stored.jsonData,
    status: TokenStatus.CONFIRMED,
    amount: stored.amount,
    coinId: stored.coinId,
    symbol: stored.symbol || "UNK",
    sizeBytes: stored.jsonData?.length,
  });
}

// ==========================================
// WalletRepository Class (Backward-Compatible API)
// ==========================================

export class WalletRepository {
  private static instance: WalletRepository;

  private constructor() {
    // Initialize SDK singleton with app config
    getWalletRepository<StoredToken, NametagData>({
      storagePrefix: STORAGE_KEY_PREFIXES.WALLET_ADDRESS,
      legacyWalletKey: STORAGE_KEYS.WALLET_DATA_LEGACY,
    });
  }

  private get sdk() {
    return getWalletRepository<StoredToken, NametagData>();
  }

  static getInstance(): WalletRepository {
    if (!WalletRepository.instance) {
      WalletRepository.instance = new WalletRepository();
    }
    return WalletRepository.instance;
  }

  // ==========================================
  // Static Methods (Direct localStorage access)
  // ==========================================

  static checkNametagForAddress(address: string): NametagData | null {
    if (!address) return null;
    const key = STORAGE_KEY_PREFIXES.WALLET_ADDRESS + WALLET_REPOSITORY_KEYS.walletByAddress(address);
    try {
      const json = localStorage.getItem(key);
      if (json) return JSON.parse(json).nametag || null;
    } catch { /* ignore */ }
    return null;
  }

  static checkTokensForAddress(address: string): boolean {
    if (!address) return false;
    const key = STORAGE_KEY_PREFIXES.WALLET_ADDRESS + WALLET_REPOSITORY_KEYS.walletByAddress(address);
    try {
      const json = localStorage.getItem(key);
      if (json) {
        const parsed = JSON.parse(json);
        return Array.isArray(parsed.tokens) && parsed.tokens.length > 0;
      }
    } catch { /* ignore */ }
    return false;
  }

  static saveNametagForAddress(address: string, nametag: NametagData): void {
    if (!address || !nametag) return;
    const key = STORAGE_KEY_PREFIXES.WALLET_ADDRESS + WALLET_REPOSITORY_KEYS.walletByAddress(address);
    try {
      const existing = localStorage.getItem(key);
      const data: StoredWalletData<StoredToken, NametagData> = existing
        ? { ...JSON.parse(existing), nametag }
        : { id: crypto.randomUUID?.() || `wallet-${Date.now()}`, name: "Wallet", address, tokens: [], nametag };
      localStorage.setItem(key, JSON.stringify(data));
    } catch (e) { console.error("Error saving nametag:", e); }
  }

  static clearAllWalletStorage(): void {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(STORAGE_KEY_PREFIXES.WALLET_ADDRESS)) keysToRemove.push(key);
    }
    keysToRemove.push(STORAGE_KEYS.WALLET_DATA_LEGACY, STORAGE_KEYS.TRANSACTION_HISTORY);
    keysToRemove.forEach(k => localStorage.removeItem(k));
  }

  // ==========================================
  // Wallet Lifecycle
  // ==========================================

  /**
   * Load wallet for address (fire-and-forget sync version)
   * @deprecated Use loadWalletForAddressAsync for guaranteed data loading
   */
  loadWalletForAddress(address: string): TokenCollection | null {
    this.sdk.loadWalletForAddress(address).catch(console.error);
    return this.getWallet();
  }

  /**
   * Load wallet for address (async version - waits for storage)
   * Use this when you need to read data immediately after loading
   */
  async loadWalletForAddressAsync(address: string): Promise<TokenCollection | null> {
    await this.sdk.loadWalletForAddress(address);
    return this.getWallet();
  }

  /**
   * Switch to address (fire-and-forget sync version)
   * @deprecated Use switchToAddressAsync for guaranteed data loading
   */
  switchToAddress(address: string): TokenCollection | null {
    this.sdk.switchToAddress(address).catch(console.error);
    return this.getWallet();
  }

  /**
   * Switch to address (async version - waits for storage)
   */
  async switchToAddressAsync(address: string): Promise<TokenCollection | null> {
    await this.sdk.switchToAddress(address);
    return this.getWallet();
  }

  /**
   * Create wallet (fire-and-forget sync version)
   * @deprecated Use createWalletAsync for guaranteed wallet creation
   */
  createWallet(address: string, name = "My Wallet", silent = false): TokenCollection {
    this.sdk.createWallet(address, name).catch(console.error);
    if (!silent) dispatchWalletLoaded();
    return this.getWallet() || new TokenCollection(crypto.randomUUID?.() || "", name, address, []);
  }

  /**
   * Create wallet (async version - waits for storage)
   */
  async createWalletAsync(address: string, name = "My Wallet", silent = false): Promise<TokenCollection> {
    await this.sdk.createWallet(address, name);
    if (!silent) dispatchWalletLoaded();
    return this.getWallet() || new TokenCollection(crypto.randomUUID?.() || "", name, address, []);
  }

  getWallet(): TokenCollection | null {
    const wallet = this.sdk.getWallet();
    if (!wallet) return null;
    return new TokenCollection(wallet.id, wallet.name, wallet.address, wallet.tokens.map(fromStoredToken));
  }

  getTokens(): WalletToken[] {
    return this.sdk.getTokens().map(fromStoredToken);
  }

  getCurrentAddress(): string | null {
    return this.sdk.getCurrentAddress();
  }

  clearWallet(): void {
    this.sdk.clearWallet().catch(console.error);
  }

  resetInMemoryState(silent = false): void {
    this.sdk.resetInMemoryState(silent);
  }

  // ==========================================
  // Token Operations
  // ==========================================

  addToken(token: WalletToken, skipHistory = false): void {
    this.sdk.addToken(toStoredToken(token), skipHistory).catch(console.error);
  }

  updateToken(token: WalletToken): void {
    this.sdk.updateToken(toStoredToken(token)).catch(console.error);
  }

  removeToken(tokenId: string, recipientNametag?: string, skipHistory = false): void {
    this.sdk.removeToken(tokenId, recipientNametag, skipHistory).catch(console.error);
  }

  archiveToken(token: WalletToken): void {
    this.sdk.archiveToken(toStoredToken(token)).catch(console.error);
  }

  // ==========================================
  // Nametag
  // ==========================================

  /**
   * Set nametag (fire-and-forget sync version)
   * @deprecated Use setNametagAsync for guaranteed save
   */
  setNametag(nametag: NametagData): void {
    this.sdk.setNametag(nametag).catch(console.error);
  }

  /**
   * Set nametag (async version - waits for storage)
   */
  async setNametagAsync(nametag: NametagData): Promise<void> {
    await this.sdk.setNametag(nametag);
  }

  getNametag(): NametagData | null {
    return this.sdk.getNametag();
  }

  clearNametag(): void {
    this.sdk.clearNametag().catch(console.error);
  }

  hasNametag(): boolean {
    return this.sdk.hasNametag();
  }

  // ==========================================
  // Tombstones
  // ==========================================

  getTombstones(): TombstoneEntry[] {
    return this.sdk.getTombstones() as TombstoneEntry[];
  }

  isStateTombstoned(tokenId: string, stateHash: string): boolean {
    return this.sdk.isStateTombstoned(tokenId, stateHash);
  }

  mergeTombstones(remoteTombstones: TombstoneEntry[]): number {
    this.sdk.mergeTombstones(remoteTombstones).catch(console.error);
    return 0; // Async, returns immediately
  }

  pruneTombstones(maxAge = 30 * 24 * 60 * 60 * 1000): void {
    this.sdk.pruneTombstones(maxAge).catch(console.error);
  }

  // ==========================================
  // Archives & Forks
  // ==========================================

  getArchivedTokens(): Map<string, TxfToken> {
    return this.sdk.getArchivedTokens() as Map<string, TxfToken>;
  }

  getBestArchivedVersion(tokenId: string): TxfToken | null {
    return this.sdk.getBestArchivedVersion(tokenId) as TxfToken | null;
  }

  getForkedTokens(): Map<string, TxfToken> {
    return this.sdk.getForkedTokens() as Map<string, TxfToken>;
  }

  storeForkedToken(tokenId: string, stateHash: string, txfToken: TxfToken): void {
    this.sdk.storeForkedToken(tokenId, stateHash, txfToken).catch(console.error);
  }

  importArchivedToken(tokenId: string, txfToken: TxfToken): void {
    this.sdk.importArchivedToken(tokenId, txfToken);
  }

  importForkedToken(key: string, txfToken: TxfToken): void {
    this.sdk.importForkedToken(key, txfToken);
  }

  mergeArchivedTokens(remoteArchived: Map<string, TxfToken>): number {
    this.sdk.mergeArchivedTokens(remoteArchived).catch(console.error);
    return 0;
  }

  mergeForkedTokens(remoteForked: Map<string, TxfToken>): number {
    this.sdk.mergeForkedTokens(remoteForked).catch(console.error);
    return 0;
  }

  pruneArchivedTokens(maxCount = 100): void {
    this.sdk.pruneArchivedTokens(maxCount).catch(console.error);
  }

  pruneForkedTokens(maxCount = 50): void {
    this.sdk.pruneForkedTokens(maxCount).catch(console.error);
  }

  isIncrementalUpdate(existing: TxfToken, incoming: TxfToken): boolean {
    return sdkIsIncrementalUpdate(existing, incoming);
  }

  restoreTokenFromArchive(tokenId: string, txfToken: TxfToken): boolean {
    try {
      const coinData = txfToken.genesis?.data?.coinData || [];
      const totalAmount = coinData.reduce((sum: bigint, [, amt]: [string, string]) => sum + BigInt(amt || "0"), BigInt(0));
      const coinId = coinData.find(([, a]: [string, string]) => BigInt(a || "0") > 0)?.[0] || coinData[0]?.[0] || "";
      const tokenType = txfToken.genesis?.data?.tokenType || "";
      const isNft = tokenType === "455ad8720656b08e8dbd5bac1f3c73eeea5431565f6c1c3af742b1aa12d41d89";

      const token = new WalletToken({
        id: tokenId, name: isNft ? "NFT" : "Token", type: isNft ? "NFT" : "UCT",
        timestamp: Date.now(), jsonData: JSON.stringify(txfToken), status: TokenStatus.CONFIRMED,
        amount: totalAmount.toString(), coinId, symbol: isNft ? "NFT" : "UCT",
        sizeBytes: JSON.stringify(txfToken).length,
      });
      this.addToken(token, true);
      return true;
    } catch { return false; }
  }

  // ==========================================
  // Transaction History
  // ==========================================

  getTransactionHistory(): TransactionHistoryEntry[] {
    return this.sdk.getTransactionHistory() as TransactionHistoryEntry[];
  }

  addTransactionToHistory(entry: Omit<TransactionHistoryEntry, 'id'>): void {
    this.sdk.addTransactionToHistory(entry).catch(console.error);
  }

  addSentTransaction(amount: string, coinId: string, symbol: string, iconUrl: string | undefined, recipientNametag: string): void {
    this.addTransactionToHistory({ type: 'SENT', amount, coinId, symbol, iconUrl, timestamp: Date.now(), recipientNametag });
  }

  // ==========================================
  // Events
  // ==========================================

  refreshWallet(): void {
    window.dispatchEvent(new Event("wallet-updated"));
  }
}
