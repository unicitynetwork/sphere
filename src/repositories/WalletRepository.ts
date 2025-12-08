import { Token, Wallet, TokenStatus } from "../components/wallet/L3/data/model";
import type { TombstoneEntry, TxfToken, TxfTransaction } from "../components/wallet/L3/services/types/TxfTypes";
import { v4 as uuidv4 } from "uuid";

const LEGACY_STORAGE_KEY = "unicity_wallet_data";
const STORAGE_KEY_PREFIX = "unicity_wallet_";
const STORAGE_KEY_HISTORY = "unicity_transaction_history";

/**
 * Interface for nametag data (one per identity)
 */
export interface NametagData {
  name: string;           // e.g., "cryptohog"
  token: object;          // SDK Token JSON
  timestamp: number;
  format: string;
  version: string;
}

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
 * Interface for stored wallet data (for type safety when parsing JSON)
 */
interface StoredWallet {
  id: string;
  name: string;
  address: string;
  tokens: Partial<Token>[];
  nametag?: NametagData;  // One nametag per wallet/identity
  tombstones?: TombstoneEntry[] | string[];  // TombstoneEntry[] (new) or string[] (legacy, discarded on load)
  archivedTokens?: Record<string, TxfToken>;  // Archived spent tokens (keyed by tokenId)
  forkedTokens?: Record<string, TxfToken>;    // Forked tokens (keyed by tokenId_stateHash)
}

export class WalletRepository {
  private static instance: WalletRepository;

  private _wallet: Wallet | null = null;
  private _currentAddress: string | null = null;
  private _migrationComplete: boolean = false;
  private _nametag: NametagData | null = null;
  private _tombstones: TombstoneEntry[] = [];  // State-hash-aware tombstones for IPFS sync
  private _transactionHistory: TransactionHistoryEntry[] = [];
  private _archivedTokens: Map<string, TxfToken> = new Map();  // Archived spent tokens (keyed by tokenId)
  private _forkedTokens: Map<string, TxfToken> = new Map();    // Forked tokens (keyed by tokenId_stateHash)

  // Debounce timer for wallet refresh events
  private _refreshDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  private constructor() {
    // Don't auto-load wallet in constructor - wait for address
    this.loadTransactionHistory();
  }

  static getInstance(): WalletRepository {
    if (!WalletRepository.instance) {
      WalletRepository.instance = new WalletRepository();
    }
    return WalletRepository.instance;
  }

  /**
   * Check if an address has a nametag without loading the full wallet
   * Static method for use during onboarding address selection
   */
  static checkNametagForAddress(address: string): NametagData | null {
    if (!address) return null;

    const storageKey = `${STORAGE_KEY_PREFIX}${address}`;
    try {
      const json = localStorage.getItem(storageKey);
      if (json) {
        const parsed = JSON.parse(json) as StoredWallet;
        return parsed.nametag || null;
      }
    } catch (error) {
      console.error("Error checking nametag for address:", error);
    }
    return null;
  }

  /**
   * Save nametag for an address without loading the full wallet
   * Used during onboarding when we fetch nametag from IPNS
   * Creates minimal wallet structure if needed
   */
  static saveNametagForAddress(address: string, nametag: NametagData): void {
    if (!address || !nametag) return;

    const storageKey = `${STORAGE_KEY_PREFIX}${address}`;
    try {
      // Load existing wallet data or create minimal structure
      let walletData: StoredWallet;
      const existingJson = localStorage.getItem(storageKey);

      if (existingJson) {
        walletData = JSON.parse(existingJson) as StoredWallet;
        walletData.nametag = nametag;
      } else {
        // Create minimal wallet structure with just the nametag
        walletData = {
          id: crypto.randomUUID ? crypto.randomUUID() : `wallet-${Date.now()}`,
          name: "Wallet",
          address: address,
          tokens: [],
          nametag: nametag,
        };
      }

      localStorage.setItem(storageKey, JSON.stringify(walletData));
      console.log(`💾 Saved IPNS-fetched nametag "${nametag.name}" for address ${address.slice(0, 20)}...`);
    } catch (error) {
      console.error("Error saving nametag for address:", error);
    }
  }

  /**
   * Validate address format
   * Returns true if the address is valid, false otherwise
   */
  private validateAddress(address: string | null | undefined): address is string {
    if (!address || typeof address !== "string") {
      return false;
    }

    const trimmed = address.trim();

    // Check minimum length (L3 addresses are typically long)
    if (trimmed.length < 20) {
      return false;
    }

    // L3 addresses can be in format: DIRECT://... or PROXY://...
    // Allow alphanumeric, colon, slash (for scheme), and underscore
    // Block dangerous characters: <, >, ", ', \, and path traversal (..)
    if (/[<>"'\\]|\.\./.test(trimmed)) {
      return false;
    }

    return true;
  }

  /**
   * Generate storage key for a specific address
   */
  private getStorageKey(address: string): string {
    return `${STORAGE_KEY_PREFIX}${address}`;
  }

  /**
   * Migrate legacy wallet data to address-based storage
   * Only runs once per session
   */
  private migrateLegacyWallet(): void {
    if (this._migrationComplete) {
      return;
    }

    try {
      const legacyJson = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (!legacyJson) {
        this._migrationComplete = true;
        return;
      }

      console.log("Migrating legacy wallet data to address-based storage...");
      const parsed = JSON.parse(legacyJson) as StoredWallet;

      if (!parsed.address) {
        console.warn("Legacy wallet has no address, cannot migrate");
        this._migrationComplete = true;
        return;
      }

      if (!this.validateAddress(parsed.address)) {
        console.error(`Legacy wallet has invalid address: ${parsed.address}`);
        this._migrationComplete = true;
        return;
      }

      const newKey = this.getStorageKey(parsed.address);

      // Check if already migrated
      if (localStorage.getItem(newKey)) {
        console.log("Wallet already migrated, removing legacy key");
        localStorage.removeItem(LEGACY_STORAGE_KEY);
        this._migrationComplete = true;
        return;
      }

      localStorage.setItem(newKey, legacyJson);
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      console.log(`Successfully migrated wallet for ${parsed.address}`);
      this._migrationComplete = true;
    } catch (error) {
      console.error("Failed to migrate legacy wallet", error);
      this._migrationComplete = true; // Don't retry on error
    }
  }

  /**
   * Load wallet for a specific address
   */
  loadWalletForAddress(address: string): Wallet | null {
    // Validate address format
    if (!this.validateAddress(address)) {
      console.error(`Invalid address format: ${address}`);
      return null;
    }

    try {
      // First check if migration is needed (only runs once per session)
      this.migrateLegacyWallet();

      const storageKey = this.getStorageKey(address);
      const json = localStorage.getItem(storageKey);

      if (json) {
        const parsed = JSON.parse(json) as StoredWallet;

        // Validate stored data structure
        if (!parsed.id || !parsed.address || !Array.isArray(parsed.tokens)) {
          console.error(`Invalid wallet structure in storage for ${address}`);
          localStorage.removeItem(storageKey);
          return null;
        }

        // Verify address match - critical security check
        if (parsed.address !== address) {
          console.error(
            `Address mismatch: requested ${address}, stored ${parsed.address}. Removing corrupted data.`
          );
          localStorage.removeItem(storageKey);
          return null;
        }

        const tokens = parsed.tokens.map((t: Partial<Token>) => new Token(t));
        const wallet = new Wallet(
          parsed.id,
          parsed.name,
          parsed.address,
          tokens
        );

        this._wallet = wallet;
        this._currentAddress = address;
        this._nametag = parsed.nametag || null;

        // Parse tombstones - handle legacy format (string[]) by discarding it
        this._tombstones = [];
        if (parsed.tombstones && Array.isArray(parsed.tombstones)) {
          for (const entry of parsed.tombstones) {
            // New format: TombstoneEntry objects
            if (
              typeof entry === "object" &&
              entry !== null &&
              typeof (entry as TombstoneEntry).tokenId === "string" &&
              typeof (entry as TombstoneEntry).stateHash === "string" &&
              typeof (entry as TombstoneEntry).timestamp === "number"
            ) {
              this._tombstones.push(entry as TombstoneEntry);
            }
            // Legacy string format: discard (no state hash info)
          }
        }

        // Load archived tokens
        this._archivedTokens = new Map();
        if (parsed.archivedTokens && typeof parsed.archivedTokens === "object") {
          for (const [tokenId, txfToken] of Object.entries(parsed.archivedTokens)) {
            if (txfToken && typeof txfToken === "object" && (txfToken as TxfToken).genesis) {
              this._archivedTokens.set(tokenId, txfToken as TxfToken);
            }
          }
        }

        // Load forked tokens
        this._forkedTokens = new Map();
        if (parsed.forkedTokens && typeof parsed.forkedTokens === "object") {
          for (const [key, txfToken] of Object.entries(parsed.forkedTokens)) {
            if (txfToken && typeof txfToken === "object" && (txfToken as TxfToken).genesis) {
              this._forkedTokens.set(key, txfToken as TxfToken);
            }
          }
        }

        this.refreshWallet();

        const archiveInfo = this._archivedTokens.size > 0 ? `, ${this._archivedTokens.size} archived` : "";
        const forkedInfo = this._forkedTokens.size > 0 ? `, ${this._forkedTokens.size} forked` : "";
        console.log(`Loaded wallet for address ${address} with ${tokens.length} tokens${this._nametag ? `, nametag: ${this._nametag.name}` : ""}${this._tombstones.length > 0 ? `, ${this._tombstones.length} tombstones` : ""}${archiveInfo}${forkedInfo}`);
        return wallet;
      }

      return null;
    } catch (error) {
      console.error(`Failed to load wallet for address ${address}`, error);
      return null;
    }
  }

  /**
   * Switch to a different address
   */
  switchToAddress(address: string): Wallet | null {
    // Validate address format
    if (!this.validateAddress(address)) {
      console.error(`Cannot switch to invalid address: ${address}`);
      return null;
    }

    // Optimization: skip if already on the correct address
    if (this._currentAddress === address && this._wallet?.address === address) {
      return this._wallet;
    }

    console.log(`Switching from ${this._currentAddress || "none"} to ${address}`);
    return this.loadWalletForAddress(address);
  }

  // Transaction History Methods
  private loadTransactionHistory() {
    try {
      const json = localStorage.getItem(STORAGE_KEY_HISTORY);
      if (json) {
        this._transactionHistory = JSON.parse(json);
      }
    } catch (error) {
      console.error("Failed to load transaction history", error);
      this._transactionHistory = [];
    }
  }

  private saveTransactionHistory() {
    try {
      localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(this._transactionHistory));
    } catch (error) {
      console.error("Failed to save transaction history", error);
    }
  }

  addTransactionToHistory(entry: Omit<TransactionHistoryEntry, 'id'>): void {
    const historyEntry: TransactionHistoryEntry = {
      id: uuidv4(),
      ...entry,
    };
    this._transactionHistory.push(historyEntry);
    this.saveTransactionHistory();
    this.refreshWallet(); // Trigger UI update
  }

  getTransactionHistory(): TransactionHistoryEntry[] {
    return [...this._transactionHistory].sort((a, b) => b.timestamp - a.timestamp);
  }

  addSentTransaction(amount: string, coinId: string, symbol: string, iconUrl: string | undefined, recipientNametag: string): void {
    this.addTransactionToHistory({
      type: 'SENT',
      amount: amount,
      coinId: coinId,
      symbol: symbol,
      iconUrl: iconUrl,
      timestamp: Date.now(),
      recipientNametag: recipientNametag,
    });
  }

  createWallet(address: string, name: string = "My Wallet"): Wallet {
    // Validate address format
    if (!this.validateAddress(address)) {
      throw new Error(`Cannot create wallet with invalid address: ${address}`);
    }

    // Check if wallet already exists for this address
    const existing = this.loadWalletForAddress(address);
    if (existing) {
      console.log(`Wallet already exists for address ${address}, using existing wallet`);
      return existing;
    }

    const newWallet = new Wallet(uuidv4(), name, address, []);
    this._currentAddress = address;
    this.saveWallet(newWallet);
    console.log(`Created new wallet for address ${address}`);
    this.refreshWallet(); // Trigger wallet-updated for UI updates
    window.dispatchEvent(new Event("wallet-loaded")); // Signal wallet creation for Nostr initialization
    return newWallet;
  }

  private saveWallet(wallet: Wallet) {
    this._wallet = wallet;
    this._currentAddress = wallet.address;
    const storageKey = this.getStorageKey(wallet.address);

    // Include nametag, tombstones, and archived/forked tokens in stored data
    const storedData: StoredWallet = {
      id: wallet.id,
      name: wallet.name,
      address: wallet.address,
      tokens: wallet.tokens,
      nametag: this._nametag || undefined,
      tombstones: this._tombstones.length > 0 ? this._tombstones : undefined,
      archivedTokens: this._archivedTokens.size > 0 ? Object.fromEntries(this._archivedTokens) : undefined,
      forkedTokens: this._forkedTokens.size > 0 ? Object.fromEntries(this._forkedTokens) : undefined,
    };

    localStorage.setItem(storageKey, JSON.stringify(storedData));
  }

  getWallet(): Wallet | null {
    return this._wallet;
  }

  getTokens(): Token[] {
    return this._wallet?.tokens || [];
  }

  private isSameToken(t1: Token, t2: Token): boolean {
    if (t1.id === t2.id) return true;

    try {
      const p1 = JSON.parse(t1.jsonData || "{}");
      const p2 = JSON.parse(t2.jsonData || "{}");

      const id1 = p1.genesis?.data?.tokenId;
      const id2 = p2.genesis?.data?.tokenId;

      if (id1 && id2 && id1 === id2) return true;
    } catch {
      return false;
    }

    return false;
  }

  addToken(token: Token, skipHistory: boolean = false): void {
    console.log("💾 Repository: Adding token...", token.id);
    if (!this._wallet) {
      console.error("💾 Repository: Wallet not initialized!");
      return;
    }

    const currentTokens = this._wallet.tokens;

    const isDuplicate = currentTokens.some((existing) =>
      this.isSameToken(existing, token)
    );

    if (isDuplicate) {
      console.warn(
        `⛔ Duplicate token detected (CoinID: ${token.coinId}). Skipping add.`
      );
      return;
    }

    if (currentTokens.some((t) => t.id === token.id)) {
      console.warn(`Token ${token.id} already exists`);
      return;
    }

    const updatedTokens = [token, ...currentTokens];

    const updatedWallet = new Wallet(
      this._wallet.id,
      this._wallet.name,
      this._wallet.address,
      updatedTokens
    );

    this.saveWallet(updatedWallet);

    // Archive the token (ensures every token is preserved for sanity check restoration)
    this.archiveToken(token);

    // Add to transaction history (RECEIVED) - skip for change tokens from split
    if (!skipHistory && token.coinId && token.amount) {
      this.addTransactionToHistory({
        type: 'RECEIVED',
        amount: token.amount,
        coinId: token.coinId,
        symbol: token.symbol || 'UNK',
        iconUrl: token.iconUrl,
        timestamp: token.timestamp,
        senderPubkey: token.senderPubkey,
      });
    }

    console.log(`💾 Repository: Saved! Total tokens: ${updatedTokens.length}`);
    this.refreshWallet();
  }

  removeToken(tokenId: string, recipientNametag?: string, skipHistory: boolean = false): void {
    if (!this._wallet) return;

    // Find the token before removing to add to history
    const tokenToRemove = this._wallet.tokens.find((t) => t.id === tokenId);

    // Archive the token before removing (preserves spent token history)
    if (tokenToRemove?.jsonData) {
      this.archiveToken(tokenToRemove);
    }

    const updatedTokens = this._wallet.tokens.filter((t) => t.id !== tokenId);
    const updatedWallet = new Wallet(
      this._wallet.id,
      this._wallet.name,
      this._wallet.address,
      updatedTokens
    );

    // Add to tombstones with state hash (prevents zombie token resurrection during IPFS sync)
    // Extract current state hash from the token to tombstone the specific spent state
    let stateHash = "";
    if (tokenToRemove?.jsonData) {
      try {
        const txf = JSON.parse(tokenToRemove.jsonData);
        if (txf.transactions && txf.transactions.length > 0) {
          // Use newStateHash from the last transaction
          stateHash = txf.transactions[txf.transactions.length - 1].newStateHash || "";
        } else if (txf.genesis?.inclusionProof?.authenticator?.stateHash) {
          // No transactions - use genesis state hash
          stateHash = txf.genesis.inclusionProof.authenticator.stateHash;
        }
      } catch {
        console.warn(`💀 Could not extract state hash for token ${tokenId.slice(0, 8)}...`);
      }
    }

    // Get the actual SDK token ID from genesis data
    let actualTokenId = tokenId;
    if (tokenToRemove?.jsonData) {
      try {
        const txf = JSON.parse(tokenToRemove.jsonData);
        if (txf.genesis?.data?.tokenId) {
          actualTokenId = txf.genesis.data.tokenId;
        }
      } catch {
        // Use the provided tokenId as fallback
      }
    }

    // Only add if not already in tombstones (check by tokenId + stateHash)
    const alreadyTombstoned = this._tombstones.some(
      t => t.tokenId === actualTokenId && t.stateHash === stateHash
    );

    if (!alreadyTombstoned) {
      const tombstone: TombstoneEntry = {
        tokenId: actualTokenId,
        stateHash,
        timestamp: Date.now(),
      };
      this._tombstones.push(tombstone);
      console.log(`💀 Token ${actualTokenId.slice(0, 8)}... state ${stateHash.slice(0, 12)}... added to tombstones`);
    }

    this.saveWallet(updatedWallet);

    // Add to transaction history (SENT) - skip for split operations
    if (!skipHistory && tokenToRemove && tokenToRemove.coinId && tokenToRemove.amount) {
      this.addTransactionToHistory({
        type: 'SENT',
        amount: tokenToRemove.amount,
        coinId: tokenToRemove.coinId,
        symbol: tokenToRemove.symbol || 'UNK',
        iconUrl: tokenToRemove.iconUrl,
        timestamp: Date.now(),
        recipientNametag: recipientNametag,
      });
    }

    this.refreshWallet();
  }

  clearWallet(): void {
    if (this._currentAddress) {
      const storageKey = this.getStorageKey(this._currentAddress);
      localStorage.removeItem(storageKey);
    }
    // Also remove legacy key if it exists
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    this._wallet = null;
    this._currentAddress = null;
    this._nametag = null;
    this._tombstones = [];
    this._archivedTokens = new Map();
    this._forkedTokens = new Map();
    this.refreshWallet();
  }

  /**
   * Reset in-memory state without touching localStorage
   * Used when switching wallets - preserves per-identity token/nametag storage
   */
  resetInMemoryState(): void {
    this._wallet = null;
    this._currentAddress = null;
    this._nametag = null;
    this._tombstones = [];
    this._archivedTokens = new Map();
    this._forkedTokens = new Map();
    this.refreshWallet();
  }

  /**
   * Get the current active address
   */
  getCurrentAddress(): string | null {
    return this._currentAddress;
  }

  // ==========================================
  // Nametag Methods (One per identity)
  // ==========================================

  /**
   * Set the nametag for the current wallet/identity
   * Only one nametag is allowed per identity
   */
  setNametag(nametag: NametagData): void {
    if (!this._wallet) {
      console.error("Cannot set nametag: wallet not initialized");
      return;
    }

    this._nametag = nametag;

    // Re-save wallet to persist nametag
    this.saveWallet(this._wallet);

    console.log(`💾 Nametag set for ${this._wallet.address}: ${nametag.name}`);
    this.refreshWallet();
  }

  /**
   * Get the nametag for the current wallet/identity
   */
  getNametag(): NametagData | null {
    return this._nametag;
  }

  /**
   * Clear the nametag for the current wallet/identity
   */
  clearNametag(): void {
    if (!this._wallet) return;

    this._nametag = null;

    // Re-save wallet without nametag
    this.saveWallet(this._wallet);

    console.log(`💾 Nametag cleared for ${this._wallet.address}`);
    this.refreshWallet();
  }

  /**
   * Check if current identity already has a nametag
   */
  hasNametag(): boolean {
    return this._nametag !== null;
  }

  refreshWallet(): void {
    // Debounce at the source - coalesce rapid updates into one event
    if (this._refreshDebounceTimer) {
      clearTimeout(this._refreshDebounceTimer);
    }

    this._refreshDebounceTimer = setTimeout(() => {
      this._refreshDebounceTimer = null;
      window.dispatchEvent(new Event("wallet-updated"));
    }, 100); // 100ms debounce at source
  }

  // ==========================================
  // Tombstone Methods (IPFS sync)
  // ==========================================

  /**
   * Get all tombstones (state-hash-aware entries)
   * Used during IPFS sync to prevent zombie token resurrection
   */
  getTombstones(): TombstoneEntry[] {
    return [...this._tombstones];
  }

  /**
   * Check if a specific token state is tombstoned
   * Returns true if both tokenId AND stateHash match a tombstone
   */
  isStateTombstoned(tokenId: string, stateHash: string): boolean {
    return this._tombstones.some(
      t => t.tokenId === tokenId && t.stateHash === stateHash
    );
  }

  /**
   * Merge remote tombstones into local
   * Also removes any local tokens whose state matches a remote tombstone
   */
  mergeTombstones(remoteTombstones: TombstoneEntry[]): number {
    if (!this._wallet) return 0;

    let removedCount = 0;

    // Build a set of tombstoned states for quick lookup
    const tombstoneKeys = new Set(
      remoteTombstones.map(t => `${t.tokenId}:${t.stateHash}`)
    );

    // Find and remove any local tokens whose state matches a remote tombstone
    const tokensToRemove: Token[] = [];
    for (const token of this._wallet.tokens) {
      // Extract tokenId and stateHash from the token's jsonData
      if (token.jsonData) {
        try {
          const txf = JSON.parse(token.jsonData);
          const sdkTokenId = txf.genesis?.data?.tokenId;
          let currentStateHash = "";

          if (txf.transactions && txf.transactions.length > 0) {
            currentStateHash = txf.transactions[txf.transactions.length - 1].newStateHash || "";
          } else if (txf.genesis?.inclusionProof?.authenticator?.stateHash) {
            currentStateHash = txf.genesis.inclusionProof.authenticator.stateHash;
          }

          const key = `${sdkTokenId}:${currentStateHash}`;
          if (tombstoneKeys.has(key)) {
            tokensToRemove.push(token);
          }
        } catch {
          // Skip tokens with invalid jsonData
        }
      }
    }

    for (const token of tokensToRemove) {
      if (!this._wallet) break; // Type guard
      // Remove from wallet without adding to history (it's a sync operation)
      const currentTokens: Token[] = this._wallet.tokens;
      const updatedTokens: Token[] = currentTokens.filter((t: Token) => t.id !== token.id);
      this._wallet = new Wallet(
        this._wallet.id,
        this._wallet.name,
        this._wallet.address,
        updatedTokens
      );
      console.log(`💀 Removed tombstoned token ${token.id.slice(0, 8)}... from local (state matched)`);
      removedCount++;
    }

    // Merge tombstones (union of local and remote by tokenId+stateHash)
    for (const remoteTombstone of remoteTombstones) {
      const alreadyExists = this._tombstones.some(
        t => t.tokenId === remoteTombstone.tokenId && t.stateHash === remoteTombstone.stateHash
      );
      if (!alreadyExists) {
        this._tombstones.push(remoteTombstone);
      }
    }

    if (removedCount > 0) {
      this.saveWallet(this._wallet);
      this.refreshWallet();
    }

    return removedCount;
  }

  /**
   * Clear old tombstones (cleanup to prevent unlimited growth)
   * Uses timestamp-based pruning - removes tombstones older than maxAge
   */
  pruneTombstones(maxAge: number = 30 * 24 * 60 * 60 * 1000): void {
    const now = Date.now();
    const originalCount = this._tombstones.length;

    // Filter by age (keep tombstones newer than maxAge)
    this._tombstones = this._tombstones.filter(t => (now - t.timestamp) < maxAge);

    // Also limit to most recent 100 if still too many
    if (this._tombstones.length > 100) {
      // Sort by timestamp descending and keep newest 100
      this._tombstones.sort((a, b) => b.timestamp - a.timestamp);
      this._tombstones = this._tombstones.slice(0, 100);
    }

    if (this._tombstones.length < originalCount) {
      if (this._wallet) {
        this.saveWallet(this._wallet);
      }
      console.log(`💀 Pruned tombstones from ${originalCount} to ${this._tombstones.length}`);
    }
  }

  // ==========================================
  // Archived Token Methods (spent token history)
  // ==========================================

  /**
   * Archive a token before removal
   * Only updates archive if incoming token is an incremental (non-forking) update
   */
  archiveToken(token: Token): void {
    if (!token.jsonData) return;

    let txfToken: TxfToken;
    try {
      txfToken = JSON.parse(token.jsonData);
    } catch {
      console.warn(`📦 Cannot archive token ${token.id.slice(0, 8)}...: invalid JSON`);
      return;
    }

    // Get the actual SDK token ID from genesis
    const tokenId = txfToken.genesis?.data?.tokenId;
    if (!tokenId) {
      console.warn(`📦 Cannot archive token ${token.id.slice(0, 8)}...: missing genesis tokenId`);
      return;
    }

    // Check if we already have this token archived
    const existingArchive = this._archivedTokens.get(tokenId);

    if (existingArchive) {
      // Check if this is an incremental (non-forking) update
      if (this.isIncrementalUpdate(existingArchive, txfToken)) {
        this._archivedTokens.set(tokenId, txfToken);
        console.log(`📦 Updated archived token ${tokenId.slice(0, 8)}... (incremental update: ${existingArchive.transactions.length} → ${txfToken.transactions.length} txns)`);
      } else {
        // This is a forking update - store as forked token instead
        const stateHash = this.getCurrentStateHash(txfToken);
        this.storeForkedToken(tokenId, stateHash, txfToken);
        console.log(`📦 Archived token ${tokenId.slice(0, 8)}... is a fork, stored as forked`);
      }
    } else {
      // First time archiving this token
      this._archivedTokens.set(tokenId, txfToken);
      console.log(`📦 Archived token ${tokenId.slice(0, 8)}... (${txfToken.transactions.length} txns)`);
    }

    // Save to persist changes
    if (this._wallet) {
      this.saveWallet(this._wallet);
    }
  }

  /**
   * Check if an incoming token is an incremental (non-forking) update to an existing archived token
   *
   * Incremental update criteria:
   * 1. Same genesis (tokenId matches)
   * 2. Incoming has >= transactions than existing
   * 3. All existing transactions match incoming (same state hashes in order)
   * 4. New transactions have inclusion proofs (committed)
   */
  isIncrementalUpdate(existing: TxfToken, incoming: TxfToken): boolean {
    // 1. Same genesis (tokenId must match)
    if (existing.genesis?.data?.tokenId !== incoming.genesis?.data?.tokenId) {
      return false;
    }

    const existingTxns = existing.transactions || [];
    const incomingTxns = incoming.transactions || [];

    // 2. Incoming must have >= transactions
    if (incomingTxns.length < existingTxns.length) {
      return false;
    }

    // 3. All existing transactions must match incoming (same state hashes in order)
    for (let i = 0; i < existingTxns.length; i++) {
      const existingTx = existingTxns[i];
      const incomingTx = incomingTxns[i];

      if (existingTx.previousStateHash !== incomingTx.previousStateHash ||
          existingTx.newStateHash !== incomingTx.newStateHash) {
        return false;
      }
    }

    // 4. New transactions (if any) must have inclusion proofs (committed)
    for (let i = existingTxns.length; i < incomingTxns.length; i++) {
      const newTx = incomingTxns[i] as TxfTransaction;
      if (newTx.inclusionProof === null) {
        return false;
      }
    }

    return true;
  }

  /**
   * Get current state hash from a TxfToken
   */
  private getCurrentStateHash(txf: TxfToken): string {
    if (txf.transactions && txf.transactions.length > 0) {
      return txf.transactions[txf.transactions.length - 1].newStateHash || "";
    }
    return txf.genesis?.inclusionProof?.authenticator?.stateHash || "";
  }

  /**
   * Store a forked token (alternative unconfirmed transaction history)
   */
  storeForkedToken(tokenId: string, stateHash: string, txfToken: TxfToken): void {
    const key = `${tokenId}_${stateHash}`;

    // Don't store if we already have this exact fork
    if (this._forkedTokens.has(key)) {
      return;
    }

    this._forkedTokens.set(key, txfToken);
    console.log(`📦 Stored forked token ${tokenId.slice(0, 8)}... state ${stateHash.slice(0, 12)}...`);

    // Save to persist changes
    if (this._wallet) {
      this.saveWallet(this._wallet);
    }
  }

  /**
   * Get all archived tokens (spent token history)
   */
  getArchivedTokens(): Map<string, TxfToken> {
    return new Map(this._archivedTokens);
  }

  /**
   * Get the best archived version of a token (most committed transactions)
   * Checks both _archivedTokens and _forkedTokens
   * Used for sanity check restoration when tombstones are invalid
   */
  getBestArchivedVersion(tokenId: string): TxfToken | null {
    const candidates: TxfToken[] = [];

    // Check main archive
    const archived = this._archivedTokens.get(tokenId);
    if (archived) candidates.push(archived);

    // Check forked versions
    for (const [key, forked] of this._forkedTokens) {
      if (key.startsWith(tokenId + "_")) {
        candidates.push(forked);
      }
    }

    if (candidates.length === 0) return null;

    // Sort by number of committed transactions (desc)
    candidates.sort((a, b) => {
      const aCommitted = (a.transactions || []).filter((tx: TxfTransaction) => tx.inclusionProof !== null).length;
      const bCommitted = (b.transactions || []).filter((tx: TxfTransaction) => tx.inclusionProof !== null).length;
      return bCommitted - aCommitted;
    });

    return candidates[0];
  }

  /**
   * Restore a token from archive back to active tokens
   * Used when sanity check detects invalid tombstone/missing token
   * Returns true if restoration succeeded
   */
  restoreTokenFromArchive(tokenId: string, txfToken: TxfToken): boolean {
    if (!this._wallet) {
      console.error("Cannot restore token: wallet not initialized");
      return false;
    }

    try {
      // Create Token from TxfToken
      const coinData = txfToken.genesis?.data?.coinData || [];
      const totalAmount = coinData.reduce((sum: bigint, [, amt]: [string, string]) => {
        return sum + BigInt(amt || "0");
      }, BigInt(0));

      // Get coin ID
      let coinId = coinData[0]?.[0] || "";
      for (const [cid, amt] of coinData) {
        if (BigInt(amt || "0") > 0) {
          coinId = cid;
          break;
        }
      }

      const tokenType = txfToken.genesis?.data?.tokenType || "";
      const isNft = tokenType === "455ad8720656b08e8dbd5bac1f3c73eeea5431565f6c1c3af742b1aa12d41d89";

      const token = new Token({
        id: tokenId,
        name: isNft ? "NFT" : "Token",
        type: isNft ? "NFT" : "UCT",
        timestamp: Date.now(),
        jsonData: JSON.stringify(txfToken),
        status: TokenStatus.CONFIRMED,
        amount: totalAmount.toString(),
        coinId,
        symbol: isNft ? "NFT" : "UCT",
        sizeBytes: JSON.stringify(txfToken).length,
      });

      // Check if token already exists
      const existingIdx = this._wallet.tokens.findIndex(t => {
        try {
          const parsed = JSON.parse(t.jsonData || "{}");
          return parsed.genesis?.data?.tokenId === tokenId;
        } catch {
          return t.id === tokenId;
        }
      });

      if (existingIdx !== -1) {
        // Update existing token
        const updatedTokens = [...this._wallet.tokens];
        updatedTokens[existingIdx] = token;
        this._wallet = new Wallet(
          this._wallet.id,
          this._wallet.name,
          this._wallet.address,
          updatedTokens
        );
      } else {
        // Add new token
        const updatedTokens = [token, ...this._wallet.tokens];
        this._wallet = new Wallet(
          this._wallet.id,
          this._wallet.name,
          this._wallet.address,
          updatedTokens
        );
      }

      this.saveWallet(this._wallet);
      console.log(`📦 Restored token ${tokenId.slice(0, 8)}... from archive`);
      return true;
    } catch (err) {
      console.error(`Failed to restore token ${tokenId}:`, err);
      return false;
    }
  }

  /**
   * Get all forked tokens (alternative transaction histories)
   */
  getForkedTokens(): Map<string, TxfToken> {
    return new Map(this._forkedTokens);
  }

  /**
   * Import an archived token from remote (IPFS sync)
   * Only updates if incoming is incremental or archive doesn't exist
   */
  importArchivedToken(tokenId: string, txfToken: TxfToken): void {
    const existingArchive = this._archivedTokens.get(tokenId);

    if (existingArchive) {
      // Check if remote is an incremental update
      if (this.isIncrementalUpdate(existingArchive, txfToken)) {
        this._archivedTokens.set(tokenId, txfToken);
        console.log(`📦 Imported remote archived token ${tokenId.slice(0, 8)}... (incremental update)`);
      } else if (this.isIncrementalUpdate(txfToken, existingArchive)) {
        // Local is more advanced - keep local
        console.log(`📦 Kept local archived token ${tokenId.slice(0, 8)}... (local is more advanced)`);
      } else {
        // True fork - store remote as forked
        const stateHash = this.getCurrentStateHash(txfToken);
        this.storeForkedToken(tokenId, stateHash, txfToken);
        console.log(`📦 Remote archived token ${tokenId.slice(0, 8)}... is a fork, stored as forked`);
      }
    } else {
      // No local archive - accept remote
      this._archivedTokens.set(tokenId, txfToken);
      console.log(`📦 Imported remote archived token ${tokenId.slice(0, 8)}...`);
    }
  }

  /**
   * Import a forked token from remote (IPFS sync)
   */
  importForkedToken(key: string, txfToken: TxfToken): void {
    if (!this._forkedTokens.has(key)) {
      this._forkedTokens.set(key, txfToken);
      console.log(`📦 Imported remote forked token ${key.slice(0, 20)}...`);
    }
  }

  /**
   * Merge remote archived tokens into local
   * Returns number of tokens updated/added
   */
  mergeArchivedTokens(remoteArchived: Map<string, TxfToken>): number {
    let mergedCount = 0;

    for (const [tokenId, remoteTxf] of remoteArchived) {
      const existingArchive = this._archivedTokens.get(tokenId);

      if (!existingArchive) {
        // New token - add to archive
        this._archivedTokens.set(tokenId, remoteTxf);
        mergedCount++;
      } else if (this.isIncrementalUpdate(existingArchive, remoteTxf)) {
        // Remote is incremental update - accept
        this._archivedTokens.set(tokenId, remoteTxf);
        mergedCount++;
      } else if (!this.isIncrementalUpdate(remoteTxf, existingArchive)) {
        // True fork - store remote as forked
        const stateHash = this.getCurrentStateHash(remoteTxf);
        this.storeForkedToken(tokenId, stateHash, remoteTxf);
      }
      // Otherwise local is more advanced - keep local
    }

    if (mergedCount > 0 && this._wallet) {
      this.saveWallet(this._wallet);
    }

    return mergedCount;
  }

  /**
   * Merge remote forked tokens into local (union merge)
   * Returns number of tokens added
   */
  mergeForkedTokens(remoteForked: Map<string, TxfToken>): number {
    let addedCount = 0;

    for (const [key, remoteTxf] of remoteForked) {
      if (!this._forkedTokens.has(key)) {
        this._forkedTokens.set(key, remoteTxf);
        addedCount++;
      }
    }

    if (addedCount > 0 && this._wallet) {
      this.saveWallet(this._wallet);
    }

    return addedCount;
  }

  /**
   * Prune archived tokens to prevent unlimited growth
   * Keeps most recently archived tokens up to maxCount
   */
  pruneArchivedTokens(maxCount: number = 100): void {
    if (this._archivedTokens.size <= maxCount) return;

    // Convert to array for sorting - we don't have timestamp on TxfToken
    // so just keep arbitrary subset (could be improved by adding archive timestamp)
    const entries = [...this._archivedTokens.entries()];
    const toRemove = entries.slice(0, entries.length - maxCount);

    for (const [tokenId] of toRemove) {
      this._archivedTokens.delete(tokenId);
    }

    if (this._wallet) {
      this.saveWallet(this._wallet);
    }
    console.log(`📦 Pruned archived tokens to ${this._archivedTokens.size}`);
  }

  /**
   * Prune forked tokens to prevent unlimited growth
   */
  pruneForkedTokens(maxCount: number = 50): void {
    if (this._forkedTokens.size <= maxCount) return;

    const entries = [...this._forkedTokens.entries()];
    const toRemove = entries.slice(0, entries.length - maxCount);

    for (const [key] of toRemove) {
      this._forkedTokens.delete(key);
    }

    if (this._wallet) {
      this.saveWallet(this._wallet);
    }
    console.log(`📦 Pruned forked tokens to ${this._forkedTokens.size}`);
  }
}
