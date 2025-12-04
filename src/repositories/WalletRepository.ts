import { Token, Wallet } from "../components/wallet/L3/data/model";
import { v4 as uuidv4 } from "uuid";

const LEGACY_STORAGE_KEY = "unicity_wallet_data";
const STORAGE_KEY_PREFIX = "unicity_wallet_";

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
 * Interface for stored wallet data (for type safety when parsing JSON)
 */
interface StoredWallet {
  id: string;
  name: string;
  address: string;
  tokens: Partial<Token>[];
  nametag?: NametagData;  // One nametag per wallet/identity
}

export class WalletRepository {
  private static instance: WalletRepository;

  private _wallet: Wallet | null = null;
  private _currentAddress: string | null = null;
  private _migrationComplete: boolean = false;
  private _nametag: NametagData | null = null;

  private constructor() {
    // Don't auto-load wallet in constructor - wait for address
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
        this.refreshWallet();

        console.log(`Loaded wallet for address ${address} with ${tokens.length} tokens${this._nametag ? `, nametag: ${this._nametag.name}` : ""}`);
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
    return newWallet;
  }

  private saveWallet(wallet: Wallet) {
    this._wallet = wallet;
    this._currentAddress = wallet.address;
    const storageKey = this.getStorageKey(wallet.address);

    // Include nametag in stored data
    const storedData: StoredWallet = {
      id: wallet.id,
      name: wallet.name,
      address: wallet.address,
      tokens: wallet.tokens,
      nametag: this._nametag || undefined,
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

  addToken(token: Token): void {
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
    console.log(`💾 Repository: Saved! Total tokens: ${updatedTokens.length}`);
    this.refreshWallet();
  }

  removeToken(tokenId: string): void {
    if (!this._wallet) return;

    const updatedTokens = this._wallet.tokens.filter((t) => t.id !== tokenId);
    const updatedWallet = new Wallet(
      this._wallet.id,
      this._wallet.name,
      this._wallet.address,
      updatedTokens
    );

    this.saveWallet(updatedWallet);
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
    window.dispatchEvent(new Event("wallet-updated"));
  }
}
