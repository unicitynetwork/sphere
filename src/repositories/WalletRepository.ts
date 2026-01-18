import { Token, Wallet, TokenStatus } from "../components/wallet/L3/data/model";
import type { TombstoneEntry, TxfToken, TxfTransaction, InvalidatedNametagEntry } from "../components/wallet/L3/services/types/TxfTypes";
import { v4 as uuidv4 } from "uuid";
import { STORAGE_KEYS, STORAGE_KEY_GENERATORS, STORAGE_KEY_PREFIXES } from "../config/storageKeys";
import { assertValidNametagData, sanitizeNametagForLogging, validateTokenJson } from "../utils/tokenValidation";

// Session flag to indicate active import flow
// This allows wallet creation during import even when credentials exist
// (because during import, credentials are set BEFORE wallet data is created)
const IMPORT_SESSION_FLAG = "sphere_active_import";

// DEBUG: Log wallet state on module load (BEFORE any code runs)
// This helps diagnose if corruption happens before or during app initialization
(function debugModuleLoad() {
  try {
    console.log("🔍 [MODULE LOAD] WalletRepository module initializing...");
    const walletKeys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("sphere_wallet_DIRECT://")) {
        walletKeys.push(key);
      }
    }
    if (walletKeys.length === 0) {
      console.log("🔍 [MODULE LOAD] No wallet data found in localStorage");
    } else {
      for (const key of walletKeys) {
        const value = localStorage.getItem(key);
        if (value) {
          try {
            const parsed = JSON.parse(value);
            console.log(`🔍 [MODULE LOAD] Found wallet: key=${key.slice(0, 60)}..., size=${value.length} bytes`);
            console.log(`🔍 [MODULE LOAD]   id=${parsed.id?.slice(0, 8)}..., tokens=${parsed.tokens?.length || 0}, nametag=${parsed.nametag?.name || 'none'}`);
          } catch {
            console.log(`🔍 [MODULE LOAD] Found wallet: key=${key.slice(0, 60)}..., size=${value.length} bytes (parse error)`);
          }
        }
      }
    }
  } catch (e) {
    console.error("🔍 [MODULE LOAD] Error checking localStorage:", e);
  }
})();

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
  invalidatedNametags?: InvalidatedNametagEntry[];  // Nametags invalidated due to Nostr pubkey mismatch
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
  private _invalidatedNametags: InvalidatedNametagEntry[] = []; // Nametags invalidated due to Nostr pubkey mismatch

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

    const storageKey = STORAGE_KEY_GENERATORS.walletByAddress(address);
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
   * Check if an address has tokens without loading the full wallet
   * Static method for use during onboarding address selection
   */
  static checkTokensForAddress(address: string): boolean {
    if (!address) return false;

    const storageKey = STORAGE_KEY_GENERATORS.walletByAddress(address);
    try {
      const json = localStorage.getItem(storageKey);
      if (json) {
        const parsed = JSON.parse(json) as StoredWallet;
        return Array.isArray(parsed.tokens) && parsed.tokens.length > 0;
      }
    } catch (error) {
      console.error("Error checking tokens for address:", error);
    }
    return false;
  }

  /**
   * Mark that we're in an active import flow.
   * During import, credentials are saved BEFORE wallet data, so the safeguard
   * that prevents wallet creation when credentials exist needs to be bypassed.
   * This flag is stored in sessionStorage so it's cleared on browser close.
   */
  static setImportInProgress(): void {
    console.log("📦 [IMPORT] Setting import-in-progress flag");
    sessionStorage.setItem(IMPORT_SESSION_FLAG, "true");
  }

  /**
   * Clear the import-in-progress flag.
   * Should be called when import completes (success or failure).
   */
  static clearImportInProgress(): void {
    console.log("📦 [IMPORT] Clearing import-in-progress flag");
    sessionStorage.removeItem(IMPORT_SESSION_FLAG);
  }

  /**
   * Check if we're in an active import flow.
   */
  static isImportInProgress(): boolean {
    return sessionStorage.getItem(IMPORT_SESSION_FLAG) === "true";
  }

  /**
   * Save nametag for an address without loading the full wallet
   * Used during onboarding when we fetch nametag from IPNS
   * Creates minimal wallet structure if needed
   *
   * CRITICAL: Validates nametag data before saving to prevent corruption.
   * Will throw if nametag.token is empty or invalid.
   */
  static saveNametagForAddress(address: string, nametag: NametagData): void {
    if (!address || !nametag) return;

    console.log(`📦 [saveNametagForAddress] Called for address=${address.slice(0, 20)}..., nametag="${nametag.name}"`);

    // CRITICAL VALIDATION: Prevent saving corrupted nametag data
    // This check prevents the bug where `token: {}` was saved
    try {
      assertValidNametagData(nametag, "saveNametagForAddress");
    } catch (validationError) {
      console.error("❌ BLOCKED: Attempted to save invalid nametag data:", {
        address: address.slice(0, 20) + "...",
        nametagInfo: sanitizeNametagForLogging(nametag),
        error: validationError instanceof Error ? validationError.message : String(validationError),
      });
      // Do NOT save corrupted data - throw to alert caller
      throw validationError;
    }

    const storageKey = STORAGE_KEY_GENERATORS.walletByAddress(address);
    try {
      // Load existing wallet data or create minimal structure
      let walletData: StoredWallet;
      const existingJson = localStorage.getItem(storageKey);

      console.log(`📦 [saveNametagForAddress] Existing data: ${existingJson ? `${existingJson.length} bytes` : 'null'}`);

      if (existingJson) {
        walletData = JSON.parse(existingJson) as StoredWallet;
        console.log(`📦 [saveNametagForAddress] Updating existing wallet id=${walletData.id?.slice(0, 8)}..., tokens=${walletData.tokens?.length || 0}`);
        walletData.nametag = nametag;
      } else {
        // CRITICAL SAFEGUARD: If wallet credentials exist but wallet data doesn't,
        // something is very wrong. DO NOT create a minimal wallet - this would
        // overwrite the user's tokens when they restart. This case can happen if
        // localStorage was corrupted or cleared while credentials remain intact.
        //
        // EXCEPTION: During active import flow, credentials are saved BEFORE wallet
        // data, so we check for the import flag to allow creation in that case.
        const hasMasterKey = localStorage.getItem(STORAGE_KEYS.UNIFIED_WALLET_MASTER);
        const hasMnemonic = localStorage.getItem(STORAGE_KEYS.UNIFIED_WALLET_MNEMONIC);
        const isImporting = WalletRepository.isImportInProgress();
        if ((hasMasterKey || hasMnemonic) && !isImporting) {
          console.error(`🚨 CRITICAL: saveNametagForAddress called with null existingJson but wallet credentials exist!`);
          console.error(`   This would create a minimal wallet and overwrite user's tokens on restart!`);
          console.error(`   Address: ${address.slice(0, 30)}...`);
          console.error(`   Nametag: ${nametag.name}`);
          console.error(`   hasMasterKey: ${!!hasMasterKey}, hasMnemonic: ${!!hasMnemonic}`);
          console.trace(`🚨 Call stack:`);
          // DO NOT create a new wallet - throw to prevent data loss
          throw new Error(`Cannot save nametag: wallet data missing but credentials exist. This would cause data loss.`);
        }

        if (isImporting) {
          console.log(`📦 [saveNametagForAddress] Import in progress - allowing wallet creation despite credentials`);
        }

        // Create minimal wallet structure with just the nametag
        // This should only happen during FRESH onboarding (no credentials) OR during import
        const newId = crypto.randomUUID ? crypto.randomUUID() : `wallet-${Date.now()}`;
        console.warn(`⚠️ [saveNametagForAddress] Creating NEW minimal wallet! id=${newId.slice(0, 8)}... - this should only happen during onboarding`);
        console.trace(`📦 [saveNametagForAddress] Call stack for new wallet creation:`);
        walletData = {
          id: newId,
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
      throw error; // Re-throw to alert caller of storage failure
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
    return STORAGE_KEY_GENERATORS.walletByAddress(address);
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
      const legacyJson = localStorage.getItem(STORAGE_KEYS.WALLET_DATA_LEGACY);
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
        localStorage.removeItem(STORAGE_KEYS.WALLET_DATA_LEGACY);
        this._migrationComplete = true;
        return;
      }

      localStorage.setItem(newKey, legacyJson);
      localStorage.removeItem(STORAGE_KEYS.WALLET_DATA_LEGACY);
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
    console.log(`📦 [LOAD] loadWalletForAddress called for ${address?.slice(0, 30)}...`);

    // Validate address format
    if (!this.validateAddress(address)) {
      console.error(`📦 [LOAD] FAILED: Invalid address format: ${address}`);
      return null;
    }

    try {
      // First check if migration is needed (only runs once per session)
      this.migrateLegacyWallet();

      const storageKey = this.getStorageKey(address);
      const json = localStorage.getItem(storageKey);

      console.log(`📦 [LOAD] Storage key: ${storageKey}`);
      console.log(`📦 [LOAD] localStorage has data: ${!!json}, length: ${json?.length || 0}`);

      if (json) {
        const parsed = JSON.parse(json) as StoredWallet;

        console.log(`📦 [LOAD] Parsed wallet: id=${parsed.id?.slice(0, 8)}..., tokens=${parsed.tokens?.length || 0}, archived=${Object.keys(parsed.archivedTokens || {}).length}`);

        // Validate stored data structure
        if (!parsed.id || !parsed.address || !Array.isArray(parsed.tokens)) {
          console.error(`📦 [LOAD] FAILED: Invalid wallet structure - id=${!!parsed.id}, address=${!!parsed.address}, tokens=${Array.isArray(parsed.tokens)}`);
          localStorage.removeItem(storageKey);
          return null;
        }

        // Verify address match - critical security check
        if (parsed.address !== address) {
          console.error(
            `📦 [LOAD] FAILED: Address mismatch: requested ${address}, stored ${parsed.address}. Removing corrupted data.`
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

        // Load invalidated nametags
        this._invalidatedNametags = [];
        if (parsed.invalidatedNametags && Array.isArray(parsed.invalidatedNametags)) {
          for (const entry of parsed.invalidatedNametags) {
            if (
              typeof entry === "object" &&
              entry !== null &&
              typeof (entry as InvalidatedNametagEntry).name === "string" &&
              typeof (entry as InvalidatedNametagEntry).invalidatedAt === "number"
            ) {
              this._invalidatedNametags.push(entry as InvalidatedNametagEntry);
            }
          }
        }

        // Don't call refreshWallet() here - loading is a read operation, not a write
        // refreshWallet() should only be called when data actually changes

        const archiveInfo = this._archivedTokens.size > 0 ? `, ${this._archivedTokens.size} archived` : "";
        const forkedInfo = this._forkedTokens.size > 0 ? `, ${this._forkedTokens.size} forked` : "";
        console.log(`📦 [LOAD] SUCCESS: wallet id=${parsed.id.slice(0, 8)}..., ${tokens.length} tokens${this._nametag ? `, nametag: ${this._nametag.name}` : ""}${this._tombstones.length > 0 ? `, ${this._tombstones.length} tombstones` : ""}${archiveInfo}${forkedInfo}`);
        return wallet;
      }

      console.log(`📦 [LOAD] No wallet found in localStorage for key ${storageKey}`);
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
      const json = localStorage.getItem(STORAGE_KEYS.TRANSACTION_HISTORY);
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
      localStorage.setItem(STORAGE_KEYS.TRANSACTION_HISTORY, JSON.stringify(this._transactionHistory));
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
    console.log(`📦 [CREATE] createWallet called for ${address?.slice(0, 30)}...`);

    // Validate address format
    if (!this.validateAddress(address)) {
      throw new Error(`Cannot create wallet with invalid address: ${address}`);
    }

    // Check if wallet already exists for this address
    const existing = this.loadWalletForAddress(address);
    if (existing) {
      console.log(`📦 [CREATE] Wallet already exists (id=${existing.id.slice(0, 8)}...), using existing`);
      return existing;
    }

    // RECOVERY SCENARIO DETECTION: If wallet credentials exist but wallet data doesn't,
    // this is likely a "cache cleared" scenario. The user's tokens can be recovered from IPFS
    // because the mnemonic can derive the IPNS key for fetching remote data.
    //
    // Previously this threw an error, but that caused an infinite loop in React Query.
    // Now we log a warning and allow wallet creation - the IPFS sync flow will recover tokens.
    //
    // EXCEPTION: During active import flow, credentials are saved BEFORE wallet
    // data, so we check for the import flag to allow creation in that case.
    const hasMasterKey = localStorage.getItem(STORAGE_KEYS.UNIFIED_WALLET_MASTER);
    const hasMnemonic = localStorage.getItem(STORAGE_KEYS.UNIFIED_WALLET_MNEMONIC);
    const isImporting = WalletRepository.isImportInProgress();
    const isRecoveryScenario = (hasMasterKey || hasMnemonic) && !isImporting;

    if (isRecoveryScenario) {
      console.warn(`⚠️ [RECOVERY] Wallet credentials exist but wallet data is missing.`);
      console.warn(`⚠️ [RECOVERY] Address: ${address}`);
      console.warn(`⚠️ [RECOVERY] Has master key: ${!!hasMasterKey}, Has mnemonic: ${!!hasMnemonic}`);
      console.warn(`⚠️ [RECOVERY] Creating empty wallet - tokens will be recovered from IPFS sync.`);
    }

    if (isImporting) {
      console.log(`📦 [CREATE] Import in progress - allowing wallet creation despite credentials`);
    }

    const newId = uuidv4();
    console.log(`📦 [CREATE] Creating NEW wallet with id=${newId.slice(0, 8)}...`);
    console.trace(`📦 [CREATE] Call stack for new wallet creation:`);

    const newWallet = new Wallet(newId, name, address, []);
    this._currentAddress = address;
    this.saveWallet(newWallet);
    console.log(`📦 [CREATE] Saved new wallet for address ${address}`);
    this.refreshWallet(); // Trigger wallet-updated for UI updates
    window.dispatchEvent(new Event("wallet-loaded")); // Signal wallet creation for Nostr initialization
    return newWallet;
  }

  private saveWallet(wallet: Wallet) {
    console.log(`📦 [SAVE] saveWallet called: id=${wallet.id.slice(0, 8)}..., tokens=${wallet.tokens.length}, address=${wallet.address.slice(0, 30)}...`);

    const storageKey = this.getStorageKey(wallet.address);

    // CRITICAL SAFETY CHECK: Merge wallet data on ID mismatch
    // This is the last line of defense against data corruption
    try {
      const existingJson = localStorage.getItem(storageKey);
      if (existingJson) {
        const existing = JSON.parse(existingJson) as StoredWallet;

        // DETECT: Wallet ID mismatch - merge instead of overwrite
        if (existing.id && existing.id !== wallet.id) {
          const isImporting = WalletRepository.isImportInProgress();
          if (!isImporting) {
            console.error(`🚨 CRITICAL: Wallet ID mismatch detected!`);
            console.error(`🚨 Existing ID: ${existing.id}`);
            console.error(`🚨 Incoming ID: ${wallet.id}`);
            console.error(`🚨 Existing tokens: ${existing.tokens?.length || 0}`);
            console.error(`🚨 Incoming tokens: ${wallet.tokens.length}`);
            console.trace(`🚨 Call stack for wallet ID mismatch:`);

            // MERGE wallet data instead of just preserving ID
            wallet = this.mergeWalletData(existing, wallet);

            // Also merge other StoredWallet fields into memory
            this.mergeStoredWalletFields(existing);
          } else {
            console.log(`📦 [SAVE] Allowing wallet ID change during import (old: ${existing.id.slice(0, 8)}..., new: ${wallet.id.slice(0, 8)}...)`);
          }
        }

        // WARN: Token count decrease (but allow it - could be valid due to transfers)
        if (existing.tokens && existing.tokens.length > wallet.tokens.length) {
          console.warn(`⚠️ [SAVE] TOKEN COUNT DECREASE! Old: ${existing.tokens.length}, New: ${wallet.tokens.length}`);
          console.trace(`📦 [SAVE] Call stack for token decrease:`);
        }
      }
    } catch (e) {
      console.error(`📦 [SAVE] Error in safety check:`, e);
      // Proceed with save on error - don't block legitimate saves
    }

    this._wallet = wallet;
    this._currentAddress = wallet.address;

    // Include nametag, tombstones, archived/forked tokens, and invalidated nametags in stored data
    const storedData: StoredWallet = {
      id: wallet.id,
      name: wallet.name,
      address: wallet.address,
      tokens: wallet.tokens,
      nametag: this._nametag || undefined,
      tombstones: this._tombstones.length > 0 ? this._tombstones : undefined,
      archivedTokens: this._archivedTokens.size > 0 ? Object.fromEntries(this._archivedTokens) : undefined,
      forkedTokens: this._forkedTokens.size > 0 ? Object.fromEntries(this._forkedTokens) : undefined,
      invalidatedNametags: this._invalidatedNametags.length > 0 ? this._invalidatedNametags : undefined,
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

  // ==========================================
  // Wallet Data Merge Methods (ID mismatch handling)
  // ==========================================

  /**
   * Merge two wallet data sets when ID mismatch is detected.
   * Preserves existing wallet ID and merges tokens from both sources.
   *
   * @param existing - The wallet data currently in localStorage
   * @param incoming - The wallet data being saved
   * @returns Merged wallet with existing.id preserved
   */
  private mergeWalletData(existing: StoredWallet, incoming: Wallet): Wallet {
    console.log(`🔀 [MERGE] Merging wallet data due to ID mismatch`);
    console.log(`🔀 [MERGE] Existing: id=${existing.id.slice(0, 8)}..., tokens=${existing.tokens?.length || 0}`);
    console.log(`🔀 [MERGE] Incoming: id=${incoming.id.slice(0, 8)}..., tokens=${incoming.tokens.length}`);

    // 1. Merge tokens by SDK tokenId
    const mergedTokens = this.mergeTokenArrays(
      existing.tokens || [],
      incoming.tokens
    );

    // 2. Create merged wallet with EXISTING ID preserved
    const mergedWallet = new Wallet(
      existing.id,           // PRESERVE existing ID
      incoming.name,         // Use incoming name
      incoming.address,      // Address must match
      mergedTokens           // Merged tokens
    );

    console.log(`🔀 [MERGE] Result: id=${mergedWallet.id.slice(0, 8)}..., tokens=${mergedWallet.tokens.length}`);
    return mergedWallet;
  }

  /**
   * Merge other StoredWallet fields (tombstones, archives, etc.) into memory.
   * Called after mergeWalletData when ID mismatch is detected.
   */
  private mergeStoredWalletFields(existing: StoredWallet): void {
    // Merge tombstones (union by tokenId:stateHash)
    if (existing.tombstones && Array.isArray(existing.tombstones)) {
      for (const entry of existing.tombstones) {
        if (
          typeof entry === "object" &&
          entry !== null &&
          typeof (entry as TombstoneEntry).tokenId === "string" &&
          typeof (entry as TombstoneEntry).stateHash === "string"
        ) {
          const typedEntry = entry as TombstoneEntry;
          const alreadyExists = this._tombstones.some(
            t => t.tokenId === typedEntry.tokenId && t.stateHash === typedEntry.stateHash
          );
          if (!alreadyExists) {
            this._tombstones.push(typedEntry);
          }
        }
      }
    }

    // Merge archived tokens (prefer more complete version)
    if (existing.archivedTokens && typeof existing.archivedTokens === "object") {
      for (const [tokenId, txfToken] of Object.entries(existing.archivedTokens)) {
        if (txfToken && typeof txfToken === "object" && (txfToken as TxfToken).genesis) {
          const typedTxf = txfToken as TxfToken;
          const existingArchive = this._archivedTokens.get(tokenId);
          if (!existingArchive) {
            this._archivedTokens.set(tokenId, typedTxf);
          } else if (this.isIncrementalUpdate(existingArchive, typedTxf)) {
            // Existing localStorage version is more advanced
            this._archivedTokens.set(tokenId, typedTxf);
          }
        }
      }
    }

    // Merge forked tokens (union by tokenId_stateHash)
    if (existing.forkedTokens && typeof existing.forkedTokens === "object") {
      for (const [key, txfToken] of Object.entries(existing.forkedTokens)) {
        if (txfToken && typeof txfToken === "object" && (txfToken as TxfToken).genesis) {
          if (!this._forkedTokens.has(key)) {
            this._forkedTokens.set(key, txfToken as TxfToken);
          }
        }
      }
    }

    // Merge invalidated nametags (union by name)
    if (existing.invalidatedNametags && Array.isArray(existing.invalidatedNametags)) {
      for (const entry of existing.invalidatedNametags) {
        if (
          typeof entry === "object" &&
          entry !== null &&
          typeof (entry as InvalidatedNametagEntry).name === "string"
        ) {
          const typedEntry = entry as InvalidatedNametagEntry;
          const alreadyExists = this._invalidatedNametags.some(e => e.name === typedEntry.name);
          if (!alreadyExists) {
            this._invalidatedNametags.push(typedEntry);
          }
        }
      }
    }

    // Merge nametag (prefer valid over corrupted, prefer existing if both valid)
    if (existing.nametag && !this._nametag) {
      this._nametag = existing.nametag;
    }

    console.log(`🔀 [MERGE] Merged fields: ${this._tombstones.length} tombstones, ${this._archivedTokens.size} archived, ${this._forkedTokens.size} forked, ${this._invalidatedNametags.length} invalidated nametags`);
  }

  /**
   * Merge two token arrays by SDK tokenId.
   * For duplicates, use conflict resolution (longer chain > more proofs).
   */
  private mergeTokenArrays(
    existingTokens: Partial<Token>[],
    incomingTokens: Token[]
  ): Token[] {
    const tokenMap = new Map<string, Token>();

    // Helper to get SDK token ID from a token
    const getSdkTokenId = (t: Partial<Token>): string | null => {
      try {
        if (t.jsonData) {
          const parsed = JSON.parse(t.jsonData);
          return parsed.genesis?.data?.tokenId || null;
        }
      } catch { /* ignore */ }
      return null;
    };

    // Add existing tokens to map
    for (const t of existingTokens) {
      const sdkId = getSdkTokenId(t);
      const key = sdkId || t.id || crypto.randomUUID();
      if (!tokenMap.has(key)) {
        // Convert Partial<Token> to Token
        tokenMap.set(key, new Token(t));
      }
    }

    // Merge incoming tokens
    for (const t of incomingTokens) {
      const sdkId = getSdkTokenId(t);
      const key = sdkId || t.id || crypto.randomUUID();

      if (tokenMap.has(key)) {
        // Conflict: use resolution logic
        const existing = tokenMap.get(key)!;
        const winner = this.resolveTokenConflict(existing, t);
        tokenMap.set(key, winner);
      } else {
        // New token: add it
        tokenMap.set(key, t);
      }
    }

    const result = Array.from(tokenMap.values());
    console.log(`🔀 [MERGE] Tokens: existing=${existingTokens.length}, incoming=${incomingTokens.length}, merged=${result.length}`);
    return result;
  }

  /**
   * Resolve conflict between two tokens with same SDK ID.
   * Priority: longer transaction chain > more proofs > existing wins tie
   */
  private resolveTokenConflict(existing: Token, incoming: Token): Token {
    try {
      const existingData = existing.jsonData ? JSON.parse(existing.jsonData) : null;
      const incomingData = incoming.jsonData ? JSON.parse(incoming.jsonData) : null;

      // Compare transaction chain length
      const existingTxCount = existingData?.transactions?.length || 0;
      const incomingTxCount = incomingData?.transactions?.length || 0;

      if (incomingTxCount > existingTxCount) {
        console.log(`🔀 [CONFLICT] Incoming wins (more tx: ${incomingTxCount} > ${existingTxCount})`);
        return incoming;
      }
      if (existingTxCount > incomingTxCount) {
        console.log(`🔀 [CONFLICT] Existing wins (more tx: ${existingTxCount} > ${incomingTxCount})`);
        return existing;
      }

      // Compare proofs (inclusionProofs array)
      const existingProofs = existingData?.inclusionProofs?.length || 0;
      const incomingProofs = incomingData?.inclusionProofs?.length || 0;

      if (incomingProofs > existingProofs) {
        console.log(`🔀 [CONFLICT] Incoming wins (more proofs: ${incomingProofs} > ${existingProofs})`);
        return incoming;
      }
      if (existingProofs > incomingProofs) {
        console.log(`🔀 [CONFLICT] Existing wins (more proofs: ${existingProofs} > ${incomingProofs})`);
        return existing;
      }

      // Tie: prefer existing (already in storage)
      console.log(`🔀 [CONFLICT] Tie - keeping existing`);
      return existing;
    } catch (e) {
      console.warn(`🔀 [CONFLICT] Error comparing tokens, keeping existing:`, e);
      return existing;
    }
  }

  addToken(token: Token, skipHistory: boolean = false): void {
    console.log("💾 Repository: Adding token...", token.id);
    if (!this._wallet) {
      console.error("💾 Repository: Wallet not initialized!");
      return;
    }

    // CRITICAL: Validate token data before storing
    if (token.jsonData) {
      try {
        const tokenJson = JSON.parse(token.jsonData);
        const validation = validateTokenJson(tokenJson, {
          context: `addToken(${token.id})`,
          requireInclusionProof: false, // Proofs may be stripped in some flows
        });
        if (!validation.isValid) {
          console.error(`❌ BLOCKED: Attempted to add token with invalid data:`, {
            tokenId: token.id,
            errors: validation.errors,
          });
          throw new Error(`Invalid token data: ${validation.errors[0]}`);
        }
      } catch (parseError) {
        if (parseError instanceof SyntaxError) {
          console.error(`❌ BLOCKED: Token jsonData is not valid JSON:`, token.id);
          throw new Error(`Token jsonData is not valid JSON`);
        }
        throw parseError;
      }
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

  /**
   * Update an existing token with a new version
   * Used when remote has a better version (more transactions/proofs)
   */
  updateToken(token: Token): void {
    console.log("💾 Repository: Updating token...", token.id);
    if (!this._wallet) {
      console.error("💾 Repository: Wallet not initialized!");
      return;
    }

    // CRITICAL: Validate token data before storing
    if (token.jsonData) {
      try {
        const tokenJson = JSON.parse(token.jsonData);
        const validation = validateTokenJson(tokenJson, {
          context: `updateToken(${token.id})`,
          requireInclusionProof: false, // Proofs may be stripped in some flows
        });
        if (!validation.isValid) {
          console.error(`❌ BLOCKED: Attempted to update token with invalid data:`, {
            tokenId: token.id,
            errors: validation.errors,
          });
          throw new Error(`Invalid token data: ${validation.errors[0]}`);
        }
      } catch (parseError) {
        if (parseError instanceof SyntaxError) {
          console.error(`❌ BLOCKED: Token jsonData is not valid JSON:`, token.id);
          throw new Error(`Token jsonData is not valid JSON`);
        }
        throw parseError;
      }
    }

    // Find the existing token by genesis tokenId
    let existingIndex = -1;
    let existingToken: Token | null = null;

    for (let i = 0; i < this._wallet.tokens.length; i++) {
      const existing = this._wallet.tokens[i];
      // Compare by token ID from jsonData (genesis.data.tokenId)
      if (existing.jsonData && token.jsonData) {
        try {
          const existingTxf = JSON.parse(existing.jsonData);
          const incomingTxf = JSON.parse(token.jsonData);
          if (existingTxf?.genesis?.data?.tokenId === incomingTxf?.genesis?.data?.tokenId) {
            existingIndex = i;
            existingToken = existing;
            break;
          }
        } catch {
          // Continue checking
        }
      }
      // Fallback: compare by token.id
      if (existing.id === token.id) {
        existingIndex = i;
        existingToken = existing;
        break;
      }
    }

    if (existingIndex === -1 || !existingToken) {
      console.warn(`💾 Repository: Token ${token.id} not found for update, adding instead`);
      this.addToken(token, true); // skipHistory since it's an update
      return;
    }

    // Replace the token at the same position
    const updatedTokens = [...this._wallet.tokens];
    updatedTokens[existingIndex] = token;

    const updatedWallet = new Wallet(
      this._wallet.id,
      this._wallet.name,
      this._wallet.address,
      updatedTokens
    );

    this.saveWallet(updatedWallet);

    // Archive the updated token
    this.archiveToken(token);

    console.log(`💾 Repository: Updated token ${token.id.slice(0, 8)}...`);
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
    localStorage.removeItem(STORAGE_KEYS.WALLET_DATA_LEGACY);
    this._wallet = null;
    this._currentAddress = null;
    this._nametag = null;
    this._tombstones = [];
    this._archivedTokens = new Map();
    this._forkedTokens = new Map();
    this._invalidatedNametags = [];
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
    this._invalidatedNametags = [];
    this.refreshWallet();
  }

  /**
   * Clear ALL wallet data from localStorage
   * This removes all per-address wallet data (tokens, nametags)
   * Used when deleting wallet completely
   */
  static clearAllWalletStorage(): void {
    console.log("🗑️ Clearing all wallet storage from localStorage...");

    // Find and remove all keys that start with wallet address prefix
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(STORAGE_KEY_PREFIXES.WALLET_ADDRESS)) {
        keysToRemove.push(key);
      }
    }

    // Also remove legacy key and transaction history
    keysToRemove.push(STORAGE_KEYS.WALLET_DATA_LEGACY);
    keysToRemove.push(STORAGE_KEYS.TRANSACTION_HISTORY);

    // Remove all found keys
    for (const key of keysToRemove) {
      localStorage.removeItem(key);
      console.log(`  Removed: ${key}`);
    }

    console.log(`🗑️ Cleared ${keysToRemove.length} wallet storage keys`);
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
   *
   * CRITICAL: Validates nametag data before saving to prevent corruption.
   * Will throw if nametag.token is empty or invalid.
   */
  setNametag(nametag: NametagData): void {
    if (!this._wallet) {
      console.error("Cannot set nametag: wallet not initialized");
      return;
    }

    // CRITICAL VALIDATION: Prevent saving corrupted nametag data
    try {
      assertValidNametagData(nametag, "setNametag");
    } catch (validationError) {
      console.error("❌ BLOCKED: Attempted to set invalid nametag data:", {
        address: this._wallet.address.slice(0, 20) + "...",
        nametagInfo: sanitizeNametagForLogging(nametag),
        error: validationError instanceof Error ? validationError.message : String(validationError),
      });
      throw validationError;
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

  // ==========================================
  // Invalidated Nametag Methods
  // ==========================================

  /**
   * Add a nametag to the invalidated list
   * Called when Nostr pubkey mismatch is detected
   */
  addInvalidatedNametag(entry: InvalidatedNametagEntry): void {
    // Avoid duplicates by name
    const exists = this._invalidatedNametags.some(e => e.name === entry.name);
    if (!exists) {
      this._invalidatedNametags.push(entry);
      if (this._wallet) {
        this.saveWallet(this._wallet);
      }
      console.log(`💀 Nametag "${entry.name}" added to invalidated list: ${entry.invalidationReason}`);
    }
  }

  /**
   * Get all invalidated nametags for this identity
   */
  getInvalidatedNametags(): InvalidatedNametagEntry[] {
    return [...this._invalidatedNametags];
  }

  /**
   * Merge invalidated nametags from remote (IPFS sync)
   * Returns number of nametags added
   */
  mergeInvalidatedNametags(remoteEntries: InvalidatedNametagEntry[]): number {
    let mergedCount = 0;
    for (const entry of remoteEntries) {
      const exists = this._invalidatedNametags.some(e => e.name === entry.name);
      if (!exists) {
        this._invalidatedNametags.push(entry);
        mergedCount++;
      }
    }
    if (mergedCount > 0 && this._wallet) {
      this.saveWallet(this._wallet);
    }
    return mergedCount;
  }

  /**
   * Remove an invalidated nametag by name (for recovery from false positives)
   * Returns the removed entry or null if not found
   */
  removeInvalidatedNametag(nametagName: string): InvalidatedNametagEntry | null {
    const index = this._invalidatedNametags.findIndex(e => e.name === nametagName);
    if (index === -1) {
      return null;
    }
    const [removed] = this._invalidatedNametags.splice(index, 1);
    if (this._wallet) {
      this.saveWallet(this._wallet);
    }
    return removed;
  }

  /**
   * Restore an invalidated nametag back to active status
   * This removes it from invalidatedNametags and sets it as the current nametag
   * Returns true if restored successfully, false if not found
   */
  restoreInvalidatedNametag(nametagName: string): boolean {
    const entry = this.removeInvalidatedNametag(nametagName);
    if (!entry) {
      console.warn(`Cannot restore nametag "${nametagName}" - not found in invalidated list`);
      return false;
    }

    // Restore as current nametag (without the invalidation metadata)
    this._nametag = {
      name: entry.name,
      token: entry.token,
      timestamp: entry.timestamp,
      format: entry.format,
      version: entry.version,
    };

    if (this._wallet) {
      this.saveWallet(this._wallet);
    }

    console.log(`✅ Restored nametag "${nametagName}" from invalidated list`);
    this.refreshWallet();
    return true;
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

  /**
   * Force immediate cache refresh, bypassing the 100ms debounce.
   *
   * CRITICAL: Use this when a token MUST be visible to IPFS sync immediately.
   * The normal refreshWallet() debounces by 100ms which can cause race conditions
   * when IPFS sync is triggered immediately after saving a token.
   *
   * This method:
   * 1. Cancels any pending debounced refresh
   * 2. Dispatches wallet-updated event immediately
   *
   * Use case: After saving change token during split, before triggering IPFS sync.
   */
  forceRefreshCache(): void {
    // Cancel any pending debounced refresh
    if (this._refreshDebounceTimer) {
      clearTimeout(this._refreshDebounceTimer);
      this._refreshDebounceTimer = null;
    }
    // Note: this._wallet is already updated by saveWallet() which is called before this
    // We just need to dispatch the event immediately
    window.dispatchEvent(new Event("wallet-updated"));
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
          }
          // NOTE: For genesis-only tokens (no transactions), we leave currentStateHash empty.
          // The genesis.inclusionProof.authenticator.stateHash is the MINT COMMITMENT hash,
          // NOT the state hash. Genesis-only tokens have never been transferred, so they
          // shouldn't match any tombstones anyway (tombstones are created on transfer).

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

  /**
   * Remove a specific tombstone entry
   * Used for recovery when tombstone is detected as invalid (token not actually spent)
   */
  removeTombstone(tokenId: string, stateHash: string): boolean {
    const initialLength = this._tombstones.length;
    this._tombstones = this._tombstones.filter(
      t => !(t.tokenId === tokenId && t.stateHash === stateHash)
    );

    if (this._tombstones.length < initialLength && this._wallet) {
      this.saveWallet(this._wallet);
      return true;
    }
    return false;
  }

  /**
   * Remove ALL tombstones for a given tokenId (regardless of stateHash)
   * Used when archive recovery detects that a token is not actually spent
   * and all tombstones for that token are invalid
   */
  removeTombstonesForToken(tokenId: string): number {
    const initialLength = this._tombstones.length;
    this._tombstones = this._tombstones.filter(t => t.tokenId !== tokenId);

    const removedCount = initialLength - this._tombstones.length;
    if (removedCount > 0 && this._wallet) {
      this.saveWallet(this._wallet);
    }
    return removedCount;
  }

  /**
   * Revert a token to its last committed state
   * Replaces the token in wallet with a reverted version
   * Used for recovery when a transfer fails but token is still valid
   */
  revertTokenToCommittedState(localId: string, revertedToken: Token): boolean {
    if (!this._wallet) {
      console.warn(`📦 Cannot revert token: no wallet loaded`);
      return false;
    }

    // Find the token index by localId
    const tokenIndex = this._wallet.tokens.findIndex(t => t.id === localId);

    if (tokenIndex === -1) {
      console.warn(`📦 Cannot revert token ${localId.slice(0, 8)}...: not found in wallet`);
      return false;
    }

    // Replace the token with the reverted version
    const updatedTokens = [...this._wallet.tokens];
    updatedTokens[tokenIndex] = revertedToken;

    this._wallet = new Wallet(
      this._wallet.id,
      this._wallet.name,
      this._wallet.address,
      updatedTokens
    );

    this.saveWallet(this._wallet);
    console.log(`📦 Reverted token ${localId.slice(0, 8)}... to committed state`);

    return true;
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
   * Get a specific archived token by tokenId
   * Returns null if not found
   */
  getArchivedToken(_address: string, tokenId: string): TxfToken | null {
    // Note: _address parameter is for API consistency but not used since
    // WalletRepository is already scoped to current wallet
    return this._archivedTokens.get(tokenId) || null;
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
   * Get a specific forked token by tokenId and stateHash
   * Returns null if not found
   */
  getForkedToken(_address: string, tokenId: string, stateHash: string): TxfToken | null {
    // Note: _address parameter is for API consistency but not used since
    // WalletRepository is already scoped to current wallet
    const key = `${tokenId}_${stateHash}`;
    return this._forkedTokens.get(key) || null;
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
