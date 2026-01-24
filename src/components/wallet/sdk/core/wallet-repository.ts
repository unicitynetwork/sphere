/**
 * Wallet Repository - Platform-Independent Implementation
 *
 * Provides token storage, tombstones, archives, and transaction history.
 * Uses async StorageProvider interface for platform independence.
 *
 * Can be used with:
 * - LocalStorageProvider (browser)
 * - InMemoryProvider (testing)
 * - FileStorageProvider (Node.js) - TODO
 * - SQLiteProvider (mobile) - TODO
 */

import type { TxfToken, TombstoneEntry, NametagDataBase } from '../types';
import type {
  StoredToken,
  StoredWalletData,
  TransactionHistoryEntry,
} from './token-repository';
import {
  isIncrementalUpdate,
  getTokenCurrentStateHash,
  extractTokenIdFromJsonData,
  extractStateHashFromJsonData,
  isSameStoredToken,
  createTombstoneFromStoredToken,
  validateL3Address,
  validateStoredWalletData,
  parseTombstones,
  parseArchivedTokens,
  parseForkedTokens,
  pruneTombstonesByAge,
  pruneMapByCount,
  findBestTokenVersion,
} from './token-repository';
import type { StorageProvider } from '../storage/storage-provider';

// ==========================================
// Storage Key Constants
// ==========================================

/**
 * Default storage key suffixes (without prefix)
 */
export const WALLET_REPOSITORY_KEYS = {
  /** Per-address wallet data: `wallet_${address}` */
  walletByAddress: (address: string) => `wallet_${address}`,
  /** Transaction history */
  TRANSACTION_HISTORY: 'transaction_history',
} as const;

// ==========================================
// Configuration
// ==========================================

/**
 * Async wallet repository configuration
 */
export interface WalletRepositoryConfig {
  /** Called when wallet data changes */
  onWalletUpdated?: () => void;
  /** ID generator for transactions (default: crypto.randomUUID or fallback) */
  generateId?: () => string;
  /** Legacy storage key for migration (optional) */
  legacyWalletKey?: string;
  /** Enable debug logging */
  debug?: boolean;
}

// ==========================================
// Async Token Repository Interface
// ==========================================

/**
 * Async version of TokenRepository interface
 * All methods that access storage are now async
 */
export interface TokenRepository<
  TToken extends StoredToken = StoredToken,
  TNametag extends NametagDataBase = NametagDataBase
> {
  // Wallet lifecycle
  loadWalletForAddress(address: string): Promise<StoredWalletData<TToken, TNametag> | null>;
  createWallet(address: string, name?: string): Promise<StoredWalletData<TToken, TNametag>>;
  saveWallet(wallet: StoredWalletData<TToken, TNametag>): Promise<void>;
  getCurrentAddress(): string | null;
  switchToAddress(address: string): Promise<StoredWalletData<TToken, TNametag> | null>;
  clearWallet(): Promise<void>;
  getWallet(): StoredWalletData<TToken, TNametag> | null;

  // Token operations
  getTokens(): TToken[];
  addToken(token: TToken, skipHistory?: boolean): Promise<boolean>;
  updateToken(token: TToken): Promise<void>;
  removeToken(tokenId: string, recipientNametag?: string, skipHistory?: boolean): Promise<void>;

  // Tombstone operations
  getTombstones(): TombstoneEntry[];
  isStateTombstoned(tokenId: string, stateHash: string): boolean;
  mergeTombstones(remoteTombstones: TombstoneEntry[]): Promise<number>;
  pruneTombstones(maxAge?: number): Promise<void>;

  // Archive operations
  archiveToken(token: TToken): Promise<void>;
  getArchivedTokens(): Map<string, TxfToken>;
  getBestArchivedVersion(tokenId: string): TxfToken | null;
  importArchivedToken(tokenId: string, txfToken: TxfToken): void;
  mergeArchivedTokens(remoteArchived: Map<string, TxfToken>): Promise<number>;

  // Forked token operations
  storeForkedToken(tokenId: string, stateHash: string, txfToken: TxfToken): Promise<void>;
  getForkedTokens(): Map<string, TxfToken>;
  importForkedToken(key: string, txfToken: TxfToken): void;
  mergeForkedTokens(remoteForked: Map<string, TxfToken>): Promise<number>;
  pruneArchivedTokens(maxCount?: number): Promise<void>;
  pruneForkedTokens(maxCount?: number): Promise<void>;

  // Nametag operations
  setNametag(nametag: TNametag): Promise<void>;
  getNametag(): TNametag | null;
  hasNametag(): boolean;
  clearNametag(): Promise<void>;

  // Transaction history
  getTransactionHistory(): TransactionHistoryEntry[];
  addTransactionToHistory(entry: Omit<TransactionHistoryEntry, 'id'>): Promise<void>;
}

// ==========================================
// Async Wallet Repository
// ==========================================

/**
 * Platform-independent async wallet repository
 *
 * Implements TokenRepository interface with support for:
 * - Token CRUD operations
 * - Tombstones for sync
 * - Archived tokens (spent history)
 * - Forked tokens (alternative histories)
 * - Nametag per identity
 * - Transaction history
 */
export class WalletRepository<
  TToken extends StoredToken = StoredToken,
  TNametag extends NametagDataBase = NametagDataBase
> implements TokenRepository<TToken, TNametag> {
  private readonly storage: StorageProvider;
  private readonly config: Required<WalletRepositoryConfig>;

  // In-memory state
  private _wallet: StoredWalletData<TToken, TNametag> | null = null;
  private _currentAddress: string | null = null;
  private _nametag: TNametag | null = null;
  private _tombstones: TombstoneEntry[] = [];
  private _archivedTokens: Map<string, TxfToken> = new Map();
  private _forkedTokens: Map<string, TxfToken> = new Map();
  private _transactionHistory: TransactionHistoryEntry[] = [];

  // Debounce timer for wallet refresh events
  private _refreshDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  // Migration flag
  private _migrationComplete: boolean = false;

  // Initialization flag
  private _initialized: boolean = false;

  constructor(storage: StorageProvider, config: WalletRepositoryConfig = {}) {
    this.storage = storage;
    this.config = {
      onWalletUpdated: config.onWalletUpdated ?? (() => {}),
      generateId: config.generateId ?? (() =>
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`
      ),
      legacyWalletKey: config.legacyWalletKey ?? '',
      debug: config.debug ?? false,
    };
  }

  /**
   * Initialize the repository
   * Must be called before using any storage operations
   */
  async init(): Promise<void> {
    if (this._initialized) return;

    // Connect storage if not connected
    if (!this.storage.isConnected()) {
      await this.storage.connect();
    }

    // Load transaction history
    await this.loadTransactionHistory();

    this._initialized = true;
    this.log('Repository initialized');
  }

  /**
   * Check if repository is initialized
   */
  isInitialized(): boolean {
    return this._initialized;
  }

  private log(message: string): void {
    if (this.config.debug) {
      console.log(`[WalletRepository] ${message}`);
    }
  }

  // ==========================================
  // Storage Key Helpers
  // ==========================================

  private getStorageKey(address: string): string {
    return WALLET_REPOSITORY_KEYS.walletByAddress(address);
  }

  // ==========================================
  // Legacy Migration
  // ==========================================

  /**
   * Migrate legacy wallet data to address-based storage
   * Only runs once per session
   */
  async migrateLegacyWallet(): Promise<void> {
    if (this._migrationComplete || !this.config.legacyWalletKey) {
      return;
    }

    try {
      const legacyJson = await this.storage.get(this.config.legacyWalletKey);
      if (!legacyJson) {
        this._migrationComplete = true;
        return;
      }

      console.log("Migrating legacy wallet data to address-based storage...");
      const parsed = JSON.parse(legacyJson);

      if (!parsed.address) {
        console.warn("Legacy wallet has no address, cannot migrate");
        this._migrationComplete = true;
        return;
      }

      const newKey = this.getStorageKey(parsed.address);

      // Check if already migrated
      if (await this.storage.has(newKey)) {
        console.log("Wallet already migrated, removing legacy key");
        await this.storage.remove(this.config.legacyWalletKey);
        this._migrationComplete = true;
        return;
      }

      await this.storage.set(newKey, legacyJson);
      await this.storage.remove(this.config.legacyWalletKey);
      console.log(`Successfully migrated wallet for ${parsed.address}`);
      this._migrationComplete = true;
    } catch (error) {
      console.error("Failed to migrate legacy wallet", error);
      this._migrationComplete = true; // Don't retry on error
    }
  }

  // ==========================================
  // Wallet Lifecycle
  // ==========================================

  async loadWalletForAddress(address: string): Promise<StoredWalletData<TToken, TNametag> | null> {
    // First check if migration is needed
    await this.migrateLegacyWallet();

    if (!validateL3Address(address)) {
      console.error(`Invalid address format: ${address}`);
      return null;
    }

    try {
      const storageKey = this.getStorageKey(address);
      const json = await this.storage.get(storageKey);

      if (!json) return null;

      const parsed = JSON.parse(json);

      if (!validateStoredWalletData<TToken, TNametag>(parsed)) {
        console.error(`Invalid wallet structure in storage for ${address}`);
        await this.storage.remove(storageKey);
        return null;
      }

      // Verify address match - critical security check
      if (parsed.address !== address) {
        console.error(
          `Address mismatch: requested ${address}, stored ${parsed.address}. Removing corrupted data.`
        );
        await this.storage.remove(storageKey);
        return null;
      }

      // Cast to proper type after validation
      const walletData = parsed as StoredWalletData<TToken, TNametag>;

      // Update in-memory state
      this._wallet = walletData;
      this._currentAddress = address;
      this._nametag = (walletData.nametag || null) as TNametag | null;
      this._tombstones = parseTombstones(parsed.tombstones);
      this._archivedTokens = parseArchivedTokens(
        parsed.archivedTokens as Record<string, unknown> | undefined
      );
      this._forkedTokens = parseForkedTokens(
        parsed.forkedTokens as Record<string, unknown> | undefined
      );

      const archiveInfo = this._archivedTokens.size > 0 ? `, ${this._archivedTokens.size} archived` : "";
      const forkedInfo = this._forkedTokens.size > 0 ? `, ${this._forkedTokens.size} forked` : "";
      this.log(
        `Loaded wallet for address ${address} with ${walletData.tokens.length} tokens` +
        `${this._nametag ? `, nametag: ${this._nametag.name}` : ""}` +
        `${this._tombstones.length > 0 ? `, ${this._tombstones.length} tombstones` : ""}` +
        `${archiveInfo}${forkedInfo}`
      );

      return walletData;
    } catch (error) {
      console.error(`Failed to load wallet for address ${address}`, error);
      return null;
    }
  }

  async createWallet(address: string, name: string = "My Wallet"): Promise<StoredWalletData<TToken, TNametag>> {
    if (!validateL3Address(address)) {
      throw new Error(`Cannot create wallet with invalid address: ${address}`);
    }

    // Check if wallet already exists
    const existing = await this.loadWalletForAddress(address);
    if (existing) {
      this.log(`Wallet already exists for address ${address}, using existing wallet`);
      return existing;
    }

    // Clear in-memory state for new wallet
    this._nametag = null;
    this._tombstones = [];
    this._archivedTokens = new Map();
    this._forkedTokens = new Map();

    const newWallet: StoredWalletData<TToken, TNametag> = {
      id: this.config.generateId(),
      name,
      address,
      tokens: [],
    };

    this._wallet = newWallet;
    this._currentAddress = address;
    await this.saveWallet(newWallet);

    this.log(`Created new wallet for address ${address}`);
    return newWallet;
  }

  async saveWallet(wallet: StoredWalletData<TToken, TNametag>): Promise<void> {
    this._wallet = wallet;
    this._currentAddress = wallet.address;
    const storageKey = this.getStorageKey(wallet.address);

    // Include nametag, tombstones, and archived/forked tokens
    const storedData = {
      ...wallet,
      nametag: this._nametag || undefined,
      tombstones: this._tombstones.length > 0 ? this._tombstones : undefined,
      archivedTokens: this._archivedTokens.size > 0
        ? Object.fromEntries(this._archivedTokens)
        : undefined,
      forkedTokens: this._forkedTokens.size > 0
        ? Object.fromEntries(this._forkedTokens)
        : undefined,
    };

    await this.storage.set(storageKey, JSON.stringify(storedData));
  }

  getCurrentAddress(): string | null {
    return this._currentAddress;
  }

  async switchToAddress(address: string): Promise<StoredWalletData<TToken, TNametag> | null> {
    if (!validateL3Address(address)) {
      console.error(`Cannot switch to invalid address: ${address}`);
      return null;
    }

    // Optimization: skip if already on the correct address
    if (this._currentAddress === address && this._wallet?.address === address) {
      return this._wallet;
    }

    this.log(`Switching from ${this._currentAddress || "none"} to ${address}`);
    return this.loadWalletForAddress(address);
  }

  async clearWallet(): Promise<void> {
    if (this._currentAddress) {
      const storageKey = this.getStorageKey(this._currentAddress);
      await this.storage.remove(storageKey);
    }

    // Also remove legacy key if configured
    if (this.config.legacyWalletKey) {
      await this.storage.remove(this.config.legacyWalletKey);
    }

    this._wallet = null;
    this._currentAddress = null;
    this._nametag = null;
    this._tombstones = [];
    this._archivedTokens = new Map();
    this._forkedTokens = new Map();
    this.triggerUpdate();
  }

  /**
   * Reset in-memory state without touching storage
   */
  resetInMemoryState(silent: boolean = false): void {
    this._wallet = null;
    this._currentAddress = null;
    this._nametag = null;
    this._tombstones = [];
    this._archivedTokens = new Map();
    this._forkedTokens = new Map();
    if (!silent) {
      this.triggerUpdate();
    }
  }

  /**
   * Get current wallet data
   */
  getWallet(): StoredWalletData<TToken, TNametag> | null {
    return this._wallet;
  }

  // ==========================================
  // Token Operations
  // ==========================================

  getTokens(): TToken[] {
    return this._wallet?.tokens || [];
  }

  async addToken(token: TToken, skipHistory: boolean = false): Promise<boolean> {
    if (!this._wallet) {
      console.error("Wallet not initialized!");
      return false;
    }

    const currentTokens = this._wallet.tokens;

    // Check for duplicates
    const isDuplicate = currentTokens.some((existing) =>
      isSameStoredToken(existing, token)
    );

    if (isDuplicate) {
      console.warn(`Duplicate token detected (ID: ${token.id}). Skipping add.`);
      return false;
    }

    const updatedTokens = [token, ...currentTokens];
    this._wallet = { ...this._wallet, tokens: updatedTokens };
    await this.saveWallet(this._wallet);

    // Archive the token
    await this.archiveToken(token);

    // Add to transaction history (RECEIVED)
    if (!skipHistory && token.coinId && token.amount) {
      await this.addTransactionToHistory({
        type: 'RECEIVED',
        amount: token.amount,
        coinId: token.coinId,
        symbol: token.symbol || 'UNK',
        timestamp: token.timestamp || Date.now(),
      });
    }

    this.log(`Saved token! Total tokens: ${updatedTokens.length}`);
    this.triggerUpdate();
    return true;
  }

  async updateToken(token: TToken): Promise<void> {
    if (!this._wallet) {
      console.error("Wallet not initialized!");
      return;
    }

    // Find existing token by genesis tokenId
    let existingIndex = -1;
    const incomingTokenId = extractTokenIdFromJsonData(token.jsonData);

    for (let i = 0; i < this._wallet.tokens.length; i++) {
      const existing = this._wallet.tokens[i];
      const existingTokenId = extractTokenIdFromJsonData(existing.jsonData);

      if (existingTokenId && incomingTokenId && existingTokenId === incomingTokenId) {
        existingIndex = i;
        break;
      }
      if (existing.id === token.id) {
        existingIndex = i;
        break;
      }
    }

    if (existingIndex === -1) {
      console.warn(`Token ${token.id} not found for update, adding instead`);
      await this.addToken(token, true);
      return;
    }

    const updatedTokens = [...this._wallet.tokens];
    updatedTokens[existingIndex] = token;
    this._wallet = { ...this._wallet, tokens: updatedTokens };
    await this.saveWallet(this._wallet);

    // Archive the updated token
    await this.archiveToken(token);

    this.log(`Updated token ${token.id.slice(0, 8)}...`);
    this.triggerUpdate();
  }

  async removeToken(tokenId: string, recipientNametag?: string, skipHistory: boolean = false): Promise<void> {
    if (!this._wallet) return;

    const tokenToRemove = this._wallet.tokens.find((t) => t.id === tokenId);

    // Archive before removing
    if (tokenToRemove) {
      await this.archiveToken(tokenToRemove);
    }

    const updatedTokens = this._wallet.tokens.filter((t) => t.id !== tokenId);
    this._wallet = { ...this._wallet, tokens: updatedTokens };

    // Add to tombstones
    if (tokenToRemove) {
      const tombstone = createTombstoneFromStoredToken(tokenToRemove);
      if (tombstone) {
        const alreadyTombstoned = this._tombstones.some(
          t => t.tokenId === tombstone.tokenId && t.stateHash === tombstone.stateHash
        );
        if (!alreadyTombstoned) {
          this._tombstones.push(tombstone);
          this.log(`Token ${tombstone.tokenId.slice(0, 8)}... state ${tombstone.stateHash.slice(0, 12)}... added to tombstones`);
        }
      }
    }

    await this.saveWallet(this._wallet);

    // Add to transaction history (SENT)
    if (!skipHistory && tokenToRemove && tokenToRemove.coinId && tokenToRemove.amount) {
      await this.addTransactionToHistory({
        type: 'SENT',
        amount: tokenToRemove.amount,
        coinId: tokenToRemove.coinId,
        symbol: tokenToRemove.symbol || 'UNK',
        timestamp: Date.now(),
        recipientNametag,
      });
    }

    this.triggerUpdate();
  }

  // ==========================================
  // Tombstone Operations
  // ==========================================

  getTombstones(): TombstoneEntry[] {
    return [...this._tombstones];
  }

  isStateTombstoned(tokenId: string, stateHash: string): boolean {
    return this._tombstones.some(
      t => t.tokenId === tokenId && t.stateHash === stateHash
    );
  }

  async mergeTombstones(remoteTombstones: TombstoneEntry[]): Promise<number> {
    if (!this._wallet) return 0;

    let removedCount = 0;

    // Build set for quick lookup
    const tombstoneKeys = new Set(
      remoteTombstones.map(t => `${t.tokenId}:${t.stateHash}`)
    );

    // Find tokens to remove
    const tokensToRemove: TToken[] = [];
    for (const token of this._wallet.tokens) {
      const sdkTokenId = extractTokenIdFromJsonData(token.jsonData);
      const currentStateHash = extractStateHashFromJsonData(token.jsonData);

      const key = `${sdkTokenId}:${currentStateHash}`;
      if (tombstoneKeys.has(key)) {
        tokensToRemove.push(token);
      }
    }

    for (const token of tokensToRemove) {
      const filteredTokens: TToken[] = this._wallet!.tokens.filter(t => t.id !== token.id);
      this._wallet = { ...this._wallet!, tokens: filteredTokens };
      this.log(`Removed tombstoned token ${token.id.slice(0, 8)}... from local`);
      removedCount++;
    }

    // Merge tombstones (union)
    for (const remoteTombstone of remoteTombstones) {
      const alreadyExists = this._tombstones.some(
        t => t.tokenId === remoteTombstone.tokenId && t.stateHash === remoteTombstone.stateHash
      );
      if (!alreadyExists) {
        this._tombstones.push(remoteTombstone);
      }
    }

    if (removedCount > 0) {
      await this.saveWallet(this._wallet!);
      this.triggerUpdate();
    }

    return removedCount;
  }

  async pruneTombstones(maxAge: number = 30 * 24 * 60 * 60 * 1000): Promise<void> {
    const originalCount = this._tombstones.length;
    this._tombstones = pruneTombstonesByAge(this._tombstones, maxAge, 100);

    if (this._tombstones.length < originalCount && this._wallet) {
      await this.saveWallet(this._wallet);
      this.log(`Pruned tombstones from ${originalCount} to ${this._tombstones.length}`);
    }
  }

  // ==========================================
  // Archive Operations
  // ==========================================

  async archiveToken(token: TToken): Promise<void> {
    if (!token.jsonData) return;

    let txfToken: TxfToken;
    try {
      txfToken = JSON.parse(token.jsonData);
    } catch {
      console.warn(`Cannot archive token ${token.id.slice(0, 8)}...: invalid JSON`);
      return;
    }

    const tokenId = txfToken.genesis?.data?.tokenId;
    if (!tokenId) {
      console.warn(`Cannot archive token ${token.id.slice(0, 8)}...: missing genesis tokenId`);
      return;
    }

    const existingArchive = this._archivedTokens.get(tokenId);

    if (existingArchive) {
      if (isIncrementalUpdate(existingArchive, txfToken)) {
        this._archivedTokens.set(tokenId, txfToken);
        this.log(`Updated archived token ${tokenId.slice(0, 8)}... (incremental update)`);
      } else {
        // Forking update - store as forked
        const stateHash = getTokenCurrentStateHash(txfToken);
        await this.storeForkedToken(tokenId, stateHash, txfToken);
        this.log(`Archived token ${tokenId.slice(0, 8)}... is a fork`);
      }
    } else {
      this._archivedTokens.set(tokenId, txfToken);
      this.log(`Archived token ${tokenId.slice(0, 8)}... (${txfToken.transactions?.length || 0} txns)`);
    }

    if (this._wallet) {
      await this.saveWallet(this._wallet);
    }
  }

  getArchivedTokens(): Map<string, TxfToken> {
    return new Map(this._archivedTokens);
  }

  getBestArchivedVersion(tokenId: string): TxfToken | null {
    return findBestTokenVersion(tokenId, this._archivedTokens, this._forkedTokens);
  }

  importArchivedToken(tokenId: string, txfToken: TxfToken): void {
    const existingArchive = this._archivedTokens.get(tokenId);

    if (existingArchive) {
      if (isIncrementalUpdate(existingArchive, txfToken)) {
        this._archivedTokens.set(tokenId, txfToken);
        this.log(`Imported remote archived token ${tokenId.slice(0, 8)}... (incremental)`);
      } else if (isIncrementalUpdate(txfToken, existingArchive)) {
        this.log(`Kept local archived token ${tokenId.slice(0, 8)}... (local is more advanced)`);
      } else {
        const stateHash = getTokenCurrentStateHash(txfToken);
        this.importForkedToken(`${tokenId}_${stateHash}`, txfToken);
        this.log(`Remote archived token ${tokenId.slice(0, 8)}... is a fork`);
      }
    } else {
      this._archivedTokens.set(tokenId, txfToken);
      this.log(`Imported remote archived token ${tokenId.slice(0, 8)}...`);
    }
  }

  async mergeArchivedTokens(remoteArchived: Map<string, TxfToken>): Promise<number> {
    let mergedCount = 0;

    for (const [tokenId, remoteTxf] of remoteArchived) {
      const existingArchive = this._archivedTokens.get(tokenId);

      if (!existingArchive) {
        this._archivedTokens.set(tokenId, remoteTxf);
        mergedCount++;
      } else if (isIncrementalUpdate(existingArchive, remoteTxf)) {
        this._archivedTokens.set(tokenId, remoteTxf);
        mergedCount++;
      } else if (!isIncrementalUpdate(remoteTxf, existingArchive)) {
        const stateHash = getTokenCurrentStateHash(remoteTxf);
        await this.storeForkedToken(tokenId, stateHash, remoteTxf);
      }
    }

    if (mergedCount > 0 && this._wallet) {
      await this.saveWallet(this._wallet);
    }

    return mergedCount;
  }

  // ==========================================
  // Forked Token Operations
  // ==========================================

  async storeForkedToken(tokenId: string, stateHash: string, txfToken: TxfToken): Promise<void> {
    const key = `${tokenId}_${stateHash}`;

    if (this._forkedTokens.has(key)) return;

    this._forkedTokens.set(key, txfToken);
    this.log(`Stored forked token ${tokenId.slice(0, 8)}... state ${stateHash.slice(0, 12)}...`);

    if (this._wallet) {
      await this.saveWallet(this._wallet);
    }
  }

  getForkedTokens(): Map<string, TxfToken> {
    return new Map(this._forkedTokens);
  }

  importForkedToken(key: string, txfToken: TxfToken): void {
    if (!this._forkedTokens.has(key)) {
      this._forkedTokens.set(key, txfToken);
      this.log(`Imported remote forked token ${key.slice(0, 20)}...`);
    }
  }

  async mergeForkedTokens(remoteForked: Map<string, TxfToken>): Promise<number> {
    let addedCount = 0;

    for (const [key, remoteTxf] of remoteForked) {
      if (!this._forkedTokens.has(key)) {
        this._forkedTokens.set(key, remoteTxf);
        addedCount++;
      }
    }

    if (addedCount > 0 && this._wallet) {
      await this.saveWallet(this._wallet);
    }

    return addedCount;
  }

  /**
   * Prune archived tokens to prevent unlimited growth
   */
  async pruneArchivedTokens(maxCount: number = 100): Promise<void> {
    if (this._archivedTokens.size <= maxCount) return;

    const originalCount = this._archivedTokens.size;
    this._archivedTokens = pruneMapByCount(this._archivedTokens, maxCount);

    if (this._wallet) {
      await this.saveWallet(this._wallet);
    }
    this.log(`Pruned archived tokens from ${originalCount} to ${this._archivedTokens.size}`);
  }

  /**
   * Prune forked tokens to prevent unlimited growth
   */
  async pruneForkedTokens(maxCount: number = 50): Promise<void> {
    if (this._forkedTokens.size <= maxCount) return;

    const originalCount = this._forkedTokens.size;
    this._forkedTokens = pruneMapByCount(this._forkedTokens, maxCount);

    if (this._wallet) {
      await this.saveWallet(this._wallet);
    }
    this.log(`Pruned forked tokens from ${originalCount} to ${this._forkedTokens.size}`);
  }

  // ==========================================
  // Nametag Operations
  // ==========================================

  async setNametag(nametag: TNametag): Promise<void> {
    if (!this._wallet) {
      console.error("Cannot set nametag: wallet not initialized");
      return;
    }

    this._nametag = nametag;
    await this.saveWallet(this._wallet);
    this.log(`Nametag set for ${this._wallet.address}: ${nametag.name}`);
    this.triggerUpdate();
  }

  getNametag(): TNametag | null {
    return this._nametag;
  }

  hasNametag(): boolean {
    return this._nametag !== null;
  }

  async clearNametag(): Promise<void> {
    if (!this._wallet) return;

    this._nametag = null;
    await this.saveWallet(this._wallet);
    this.log(`Nametag cleared for ${this._wallet.address}`);
    this.triggerUpdate();
  }

  // ==========================================
  // Transaction History
  // ==========================================

  private async loadTransactionHistory(): Promise<void> {
    try {
      const json = await this.storage.get(WALLET_REPOSITORY_KEYS.TRANSACTION_HISTORY);
      if (json) {
        this._transactionHistory = JSON.parse(json);
      }
    } catch (error) {
      console.error("Failed to load transaction history", error);
      this._transactionHistory = [];
    }
  }

  private async saveTransactionHistory(): Promise<void> {
    try {
      await this.storage.set(
        WALLET_REPOSITORY_KEYS.TRANSACTION_HISTORY,
        JSON.stringify(this._transactionHistory)
      );
    } catch (error) {
      console.error("Failed to save transaction history", error);
    }
  }

  getTransactionHistory(): TransactionHistoryEntry[] {
    return [...this._transactionHistory].sort((a, b) => b.timestamp - a.timestamp);
  }

  async addTransactionToHistory(entry: Omit<TransactionHistoryEntry, 'id'>): Promise<void> {
    const historyEntry: TransactionHistoryEntry = {
      id: this.config.generateId(),
      ...entry,
    };
    this._transactionHistory.push(historyEntry);
    await this.saveTransactionHistory();
    this.triggerUpdate();
  }

  // ==========================================
  // Update Trigger (Debounced)
  // ==========================================

  private triggerUpdate(): void {
    if (this._refreshDebounceTimer) {
      clearTimeout(this._refreshDebounceTimer);
    }

    this._refreshDebounceTimer = setTimeout(() => {
      this._refreshDebounceTimer = null;
      this.config.onWalletUpdated();
    }, 100);
  }

  /**
   * Force immediate update (no debounce)
   */
  forceUpdate(): void {
    if (this._refreshDebounceTimer) {
      clearTimeout(this._refreshDebounceTimer);
      this._refreshDebounceTimer = null;
    }
    this.config.onWalletUpdated();
  }

  // ==========================================
  // Static Helpers (for quick lookups)
  // ==========================================

  /**
   * Check if an address has a nametag without loading full wallet
   */
  static async checkNametagForAddress<T extends NametagDataBase = NametagDataBase>(
    storage: StorageProvider,
    address: string
  ): Promise<T | null> {
    if (!address) return null;

    const storageKey = WALLET_REPOSITORY_KEYS.walletByAddress(address);

    try {
      const json = await storage.get(storageKey);
      if (json) {
        const parsed = JSON.parse(json) as StoredWalletData<StoredToken, T>;
        return parsed.nametag || null;
      }
    } catch (error) {
      console.error("Error checking nametag for address:", error);
    }
    return null;
  }

  /**
   * Check if an address has tokens without loading full wallet
   */
  static async checkTokensForAddress(
    storage: StorageProvider,
    address: string
  ): Promise<boolean> {
    if (!address) return false;

    const storageKey = WALLET_REPOSITORY_KEYS.walletByAddress(address);

    try {
      const json = await storage.get(storageKey);
      if (json) {
        const parsed = JSON.parse(json) as StoredWalletData;
        return Array.isArray(parsed.tokens) && parsed.tokens.length > 0;
      }
    } catch (error) {
      console.error("Error checking tokens for address:", error);
    }
    return false;
  }

  /**
   * Save nametag for an address without loading full wallet
   */
  static async saveNametagForAddress<T extends NametagDataBase>(
    storage: StorageProvider,
    address: string,
    nametag: T,
    generateId?: () => string
  ): Promise<void> {
    if (!address || !nametag) return;

    const storageKey = WALLET_REPOSITORY_KEYS.walletByAddress(address);
    const idGenerator = generateId ?? (() =>
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `wallet-${Date.now()}`
    );

    try {
      let walletData: StoredWalletData<StoredToken, T>;
      const existingJson = await storage.get(storageKey);

      if (existingJson) {
        walletData = JSON.parse(existingJson) as StoredWalletData<StoredToken, T>;
        walletData.nametag = nametag;
      } else {
        walletData = {
          id: idGenerator(),
          name: "Wallet",
          address: address,
          tokens: [],
          nametag: nametag,
        };
      }

      await storage.set(storageKey, JSON.stringify(walletData));
      console.log(`Saved nametag "${nametag.name}" for address ${address.slice(0, 20)}...`);
    } catch (error) {
      console.error("Error saving nametag for address:", error);
    }
  }

  /**
   * Clear ALL wallet data from storage
   */
  static async clearAllWalletStorage(storage: StorageProvider): Promise<void> {
    console.log("Clearing all wallet storage...");

    const keysToRemove = await storage.keys('wallet_');
    keysToRemove.push(WALLET_REPOSITORY_KEYS.TRANSACTION_HISTORY);

    for (const key of keysToRemove) {
      await storage.remove(key);
      console.log(`  Removed: ${key}`);
    }

    console.log(`Cleared ${keysToRemove.length} wallet storage keys`);
  }
}

// ==========================================
// Factory Function
// ==========================================

/**
 * Create an async wallet repository with the given storage provider
 */
export function createWalletRepository<
  TToken extends StoredToken = StoredToken,
  TNametag extends NametagDataBase = NametagDataBase
>(
  storage: StorageProvider,
  config?: WalletRepositoryConfig
): WalletRepository<TToken, TNametag> {
  return new WalletRepository<TToken, TNametag>(storage, config);
}
