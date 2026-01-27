/**
 * BrowserKeyManager - Browser-specific key management with storage and encryption
 *
 * This module provides browser-specific implementations for:
 * - localStorage persistence
 * - AES encryption via CryptoJS
 * - Singleton pattern with session key
 *
 * Uses the platform-independent KeyManager for core logic.
 *
 * Usage:
 * ```typescript
 * import { BrowserKeyManager, getBrowserKeyManager } from '@unicity/wallet-sdk/browser';
 *
 * // Get singleton instance
 * const keyManager = getBrowserKeyManager('session-key');
 *
 * // Initialize from storage
 * const initialized = await keyManager.initialize();
 *
 * // Or get instance via static method
 * const km = BrowserKeyManager.getInstance('session-key');
 * ```
 */

import CryptoJS from "crypto-js";
import {
  type KeyManagerState,
  type WalletSource,
  type DerivedAddress,
  type WalletInfo,
  createEmptyState,
  parseWalletFileContent,
  deriveAddressFromPath,
  getDefaultAddressPath,
  getWalletInfo,
  isWalletInitialized,
  formatWalletExport,
  validatePrivateKey,
} from "../../wallets/KeyManager";
import {
  createWallet as coreCreateWallet,
  restoreFromMnemonic as coreRestoreFromMnemonic,
  deriveKeyAtPath,
} from "../../core";
import {
  type DerivationMode,
  DEFAULT_BASE_PATH,
} from "../../types";
import {
  exportWalletToJSON,
  downloadJSON,
  importWalletFromJSON,
  type WalletJSON,
  type WalletJSONExportOptions,
} from "../import-export";

// ==========================================
// Types
// ==========================================

/**
 * Storage keys configuration for browser persistence
 */
export interface BrowserKeyManagerStorageKeys {
  mnemonic: string;
  masterKey: string;
  chainCode: string;
  source: string;
  derivationMode: string;
  basePath: string;
}

/**
 * Configuration for BrowserKeyManager
 */
export interface BrowserKeyManagerConfig {
  storageKeys: BrowserKeyManagerStorageKeys;
  clearAllData?: (fullCleanup: boolean) => void;
}

// Re-export types from KeyManager
export type { WalletSource, DerivedAddress, WalletInfo, KeyManagerState };

// ==========================================
// Singleton Instance
// ==========================================

let browserKeyManagerInstance: BrowserKeyManager | null = null;

// ==========================================
// BrowserKeyManager Class
// ==========================================

/**
 * BrowserKeyManager provides browser-specific key management with
 * localStorage persistence and AES encryption.
 */
export class BrowserKeyManager {
  private state: KeyManagerState;
  private sessionKey: string;
  private config: BrowserKeyManagerConfig;

  // Initialization guards
  private isInitializing: boolean = false;
  private hasInitialized: boolean = false;
  private initializePromise: Promise<boolean> | null = null;

  constructor(sessionKey: string, config: BrowserKeyManagerConfig) {
    this.sessionKey = sessionKey;
    this.config = config;
    this.state = createEmptyState();
  }

  /**
   * Get the singleton instance
   */
  static getInstance(
    sessionKey: string,
    config: BrowserKeyManagerConfig
  ): BrowserKeyManager {
    if (!browserKeyManagerInstance) {
      browserKeyManagerInstance = new BrowserKeyManager(sessionKey, config);
    } else if (browserKeyManagerInstance.sessionKey !== sessionKey) {
      // Session key mismatch! This is a critical error that would cause
      // decryption to fail. Log the issue and update the session key.
      console.error(
        "WARNING: BrowserKeyManager session key mismatch detected!",
        "This can cause data loss. Updating session key to maintain consistency."
      );
      browserKeyManagerInstance.sessionKey = sessionKey;
    }
    return browserKeyManagerInstance;
  }

  /**
   * Reset the singleton instance
   * Call this after clear() to ensure fresh state on next getInstance()
   */
  static resetInstance(): void {
    browserKeyManagerInstance = null;
    console.log("🔐 BrowserKeyManager instance reset");
  }

  // ==========================================
  // Initialization
  // ==========================================

  /**
   * Initialize wallet from stored data (if available)
   */
  async initialize(): Promise<boolean> {
    // Return cached result if already initialized
    if (this.hasInitialized) {
      return this.state.masterKey !== null;
    }

    // Return existing promise if initialization in progress
    if (this.isInitializing && this.initializePromise) {
      return this.initializePromise;
    }

    // Start initialization
    this.isInitializing = true;
    this.initializePromise = this.doInitialize();

    try {
      const result = await this.initializePromise;
      this.hasInitialized = true;
      return result;
    } finally {
      this.isInitializing = false;
    }
  }

  private async doInitialize(): Promise<boolean> {
    const { storageKeys } = this.config;

    try {
      // Try to load from storage
      const encryptedMnemonic = localStorage.getItem(storageKeys.mnemonic);
      const encryptedMaster = localStorage.getItem(storageKeys.masterKey);
      const chainCode = localStorage.getItem(storageKeys.chainCode);
      const source = localStorage.getItem(storageKeys.source) as WalletSource;
      const derivationMode = localStorage.getItem(storageKeys.derivationMode) as DerivationMode;
      const storedBasePath = localStorage.getItem(storageKeys.basePath);

      console.log("🔐 BrowserKeyManager initializing...", {
        hasMnemonic: !!encryptedMnemonic,
        hasMaster: !!encryptedMaster,
        hasChainCode: !!chainCode,
        source,
        derivationMode,
      });

      if (encryptedMnemonic) {
        // Wallet was created from mnemonic
        const mnemonic = this.decrypt(encryptedMnemonic);
        if (mnemonic) {
          await this.createFromMnemonic(mnemonic, false); // Don't save again
          console.log("✅ Wallet initialized from mnemonic");
          return true;
        } else {
          console.error("❌ Failed to decrypt mnemonic - session key mismatch?");
        }
      } else if (encryptedMaster) {
        // Wallet was imported from file
        const masterKey = this.decrypt(encryptedMaster);
        if (masterKey) {
          this.state.masterKey = masterKey;
          this.state.chainCode = chainCode || null;
          this.state.source = source || "file";
          this.state.derivationMode = derivationMode || (chainCode ? "bip32" : "wif_hmac");
          this.state.basePath = storedBasePath || DEFAULT_BASE_PATH;
          console.log(`✅ Wallet initialized from file import (basePath: ${this.state.basePath})`);
          return true;
        } else {
          console.error("❌ Failed to decrypt master key - session key mismatch?");
        }
      }

      console.log("ℹ️ No wallet data found in storage");
      return false;
    } catch (error) {
      console.error("Failed to initialize BrowserKeyManager:", error);
      return false;
    }
  }

  // ==========================================
  // Wallet Creation/Import
  // ==========================================

  /**
   * Create a new wallet from a BIP39 mnemonic
   * Delegates to WalletCore for pure crypto operations
   */
  async createFromMnemonic(mnemonic: string, save: boolean = true): Promise<void> {
    // Use WalletCore for validation and key derivation
    const keys = coreRestoreFromMnemonic(mnemonic);

    this.state.mnemonic = mnemonic;
    this.state.masterKey = keys.masterKey;
    this.state.chainCode = keys.chainCode;
    this.state.source = "mnemonic";
    this.state.derivationMode = "bip32";

    if (save) {
      this.saveToStorage();
    }

    console.log("🔐 Unified wallet created from mnemonic (via WalletCore)");
  }

  /**
   * Generate a new wallet with a fresh mnemonic
   * Delegates to WalletCore for pure crypto operations
   */
  async generateNew(wordCount: 12 | 24 = 12): Promise<string> {
    // Use WalletCore for wallet creation
    const keys = coreCreateWallet(wordCount);

    this.state.mnemonic = keys.mnemonic!;
    this.state.masterKey = keys.masterKey;
    this.state.chainCode = keys.chainCode;
    this.state.source = "mnemonic";
    this.state.derivationMode = "bip32";

    this.saveToStorage();

    console.log("🔐 New wallet generated (via WalletCore)");
    return keys.mnemonic!;
  }

  /**
   * Import wallet from webwallet txt file content
   * Uses platform-independent parseWalletFileContent
   */
  async importFromFileContent(content: string): Promise<void> {
    const { storageKeys } = this.config;

    // Use SDK function for parsing
    const fileData = parseWalletFileContent(content);

    // Clear any existing mnemonic storage (so file import takes precedence)
    localStorage.removeItem(storageKeys.mnemonic);

    this.state.mnemonic = null;
    this.state.masterKey = fileData.masterKey;
    this.state.chainCode = fileData.chainCode;
    this.state.source = "file";
    this.state.derivationMode = fileData.derivationMode;

    // Mark as initialized since we have valid data
    this.hasInitialized = true;

    this.saveToStorage();

    if (fileData.chainCode) {
      console.log("🔐 Unified wallet imported with BIP32 mode (chain code present)");
    } else {
      console.log("🔐 Unified wallet imported with WIF HMAC mode (no chain code)");
    }
  }

  /**
   * Import wallet from a File object
   */
  async importFromFile(file: File): Promise<void> {
    const content = await file.text();
    return this.importFromFileContent(content);
  }

  /**
   * Import wallet with explicit derivation mode
   * Use this when you know the derivation mode the wallet was created with
   * @param basePath - The BIP32 base path (e.g., "m/84'/1'/0'" from wallet.dat descriptor)
   */
  async importWithMode(
    masterKey: string,
    chainCode: string | null,
    mode: DerivationMode,
    basePath?: string
  ): Promise<void> {
    // Validate key
    if (!validatePrivateKey(masterKey)) {
      throw new Error("Invalid master private key format");
    }

    this.state.mnemonic = null;
    this.state.masterKey = masterKey;
    this.state.chainCode = chainCode;
    this.state.derivationMode = mode;
    this.state.basePath = basePath || DEFAULT_BASE_PATH;
    this.state.source = "file";

    // Mark as initialized since we have valid data
    this.hasInitialized = true;

    this.saveToStorage();

    console.log(`🔐 Unified wallet imported with ${mode} mode (basePath: ${this.state.basePath})`);
  }

  /**
   * Set derivation mode (useful for switching modes after import)
   */
  setDerivationMode(mode: DerivationMode): void {
    if (mode === "bip32" || mode === "legacy_hmac") {
      if (!this.state.chainCode) {
        throw new Error(`${mode} mode requires chain code`);
      }
    }
    this.state.derivationMode = mode;
    this.saveToStorage();
    console.log(`🔐 Derivation mode changed to ${mode}`);
  }

  // ==========================================
  // Address Derivation
  // ==========================================

  /**
   * Derive address from a full BIP32 path string
   * This is the ONLY method for address derivation - PATH is the single identifier
   * @param path - Full path like "m/84'/1'/0'/0/5" or "m/44'/0'/0'/1/3" or "m/44'/0'/0'" (HMAC style)
   */
  deriveAddressFromPath(path: string): DerivedAddress {
    return deriveAddressFromPath(this.state, path);
  }

  /**
   * Get the default address path (first external address)
   * Returns path like "m/44'/0'/0'/0/0" based on wallet's base path
   */
  getDefaultAddressPath(): string {
    return getDefaultAddressPath(this.state.basePath);
  }

  /**
   * Derive private key at a custom path
   */
  deriveKeyAtPath(path: string): { privateKey: string; chainCode: string } {
    if (!this.state.masterKey || !this.state.chainCode) {
      throw new Error("Wallet not initialized");
    }

    return deriveKeyAtPath(this.state.masterKey, this.state.chainCode, path);
  }

  // ==========================================
  // Getters
  // ==========================================

  /**
   * Get the mnemonic phrase (for backup purposes)
   * Returns null if wallet was imported from file
   */
  getMnemonic(): string | null {
    return this.state.mnemonic;
  }

  /**
   * Get the master private key in hex format
   * Used by L1 wallet for signing transactions
   */
  getMasterKeyHex(): string | null {
    return this.state.masterKey;
  }

  /**
   * Get the chain code in hex format
   * Used by L1 wallet for BIP32 derivation
   */
  getChainCodeHex(): string | null {
    return this.state.chainCode;
  }

  /**
   * Get the base derivation path (e.g., "m/84'/1'/0'" from wallet.dat descriptor)
   * Used for BIP32 address derivation
   */
  getBasePath(): string {
    return this.state.basePath;
  }

  /**
   * Get wallet info
   */
  getWalletInfo(): WalletInfo {
    return getWalletInfo(this.state);
  }

  /**
   * Check if wallet is initialized
   */
  isInitialized(): boolean {
    return isWalletInitialized(this.state);
  }

  /**
   * Get current derivation mode
   */
  getDerivationMode(): DerivationMode {
    return this.state.derivationMode;
  }

  // ==========================================
  // Export Functions
  // ==========================================

  /**
   * Export wallet to txt format (compatible with webwallet)
   */
  exportToTxt(): string {
    if (!this.state.masterKey || !this.state.chainCode) {
      throw new Error("Wallet not initialized");
    }

    const address0 = this.deriveAddressFromPath(this.getDefaultAddressPath());

    return formatWalletExport({
      masterKey: this.state.masterKey,
      chainCode: this.state.chainCode,
      address0: {
        l1Address: address0.l1Address,
        publicKey: address0.publicKey,
      },
      basePath: this.state.basePath,
      mnemonic: this.state.mnemonic || undefined,
    });
  }

  /**
   * Export wallet to JSON format (new standard)
   */
  exportToJSON(options: WalletJSONExportOptions = {}): WalletJSON {
    if (!this.state.masterKey) {
      throw new Error("Wallet not initialized");
    }

    // Build addresses array for export using path-based derivation
    const address0 = this.deriveAddressFromPath(this.getDefaultAddressPath());
    const addresses = [{
      address: address0.l1Address,
      publicKey: address0.publicKey,
      path: address0.path,
      index: address0.index,
    }];

    // Add more addresses if requested
    const addressCount = options.addressCount || 1;
    for (let i = 1; i < addressCount; i++) {
      const path = `${this.state.basePath}/0/${i}`;
      const addr = this.deriveAddressFromPath(path);
      addresses.push({
        address: addr.l1Address,
        publicKey: addr.publicKey,
        path: addr.path,
        index: addr.index,
      });
    }

    // Build wallet object for export
    const wallet = {
      masterPrivateKey: this.state.masterKey,
      chainCode: this.state.chainCode || undefined,
      masterChainCode: this.state.chainCode || undefined,
      addresses,
      isBIP32: this.state.derivationMode === "bip32",
      isImportedAlphaWallet: this.state.source === "file",
      descriptorPath: this.state.derivationMode === "bip32"
        ? this.state.basePath.replace(/^m\//, '')
        : null,
    };

    return exportWalletToJSON(wallet, {
      ...options,
      mnemonic: this.state.mnemonic || undefined,
      importSource: this.state.source === "file" ? "file" : undefined,
    });
  }

  /**
   * Download wallet as JSON file
   */
  downloadJSON(filename?: string, options: WalletJSONExportOptions = {}): void {
    const json = this.exportToJSON(options);
    const defaultFilename = this.state.mnemonic
      ? "alpha_wallet_mnemonic_backup.json"
      : "alpha_wallet_backup.json";
    downloadJSON(json, filename || defaultFilename);
  }

  /**
   * Import wallet from JSON content
   * Returns the mnemonic if present in the JSON (for recovery purposes)
   */
  async importFromJSON(
    jsonContent: string,
    password?: string
  ): Promise<{ success: boolean; mnemonic?: string; error?: string }> {
    const result = await importWalletFromJSON(jsonContent, password);

    if (!result.success || !result.wallet) {
      return { success: false, error: result.error };
    }

    // If mnemonic is available, use createFromMnemonic
    if (result.mnemonic) {
      try {
        await this.createFromMnemonic(result.mnemonic);
        console.log("🔐 Wallet restored from JSON with mnemonic");
        return { success: true, mnemonic: result.mnemonic };
      } catch (e) {
        return {
          success: false,
          error: `Failed to restore from mnemonic: ${e instanceof Error ? e.message : String(e)}`,
        };
      }
    }

    // Otherwise, import as file-based wallet
    const chainCode = result.wallet.chainCode || result.wallet.masterChainCode || null;
    const mode = result.derivationMode || (chainCode ? "bip32" : "wif_hmac");
    const basePath = result.wallet.descriptorPath
      ? `m/${result.wallet.descriptorPath}`
      : undefined;

    await this.importWithMode(result.wallet.masterPrivateKey, chainCode, mode, basePath);
    console.log(`🔐 Wallet restored from JSON (source: ${result.source}, mode: ${mode}, basePath: ${basePath || DEFAULT_BASE_PATH})`);

    return { success: true };
  }

  // ==========================================
  // Clear/Reset
  // ==========================================

  /**
   * Clear wallet data
   */
  clear(): void {
    const { storageKeys } = this.config;

    this.state = createEmptyState();

    // Reset initialization state
    this.hasInitialized = false;
    this.isInitializing = false;
    this.initializePromise = null;

    localStorage.removeItem(storageKeys.mnemonic);
    localStorage.removeItem(storageKeys.masterKey);
    localStorage.removeItem(storageKeys.chainCode);
    localStorage.removeItem(storageKeys.source);
    localStorage.removeItem(storageKeys.derivationMode);
    localStorage.removeItem(storageKeys.basePath);

    console.log("🔐 BrowserKeyManager wallet cleared");
  }

  /**
   * Clear ALL wallet data from localStorage and reset singleton
   * Use this before creating/importing a new wallet to ensure clean slate
   *
   * @param fullCleanup - If true (default), deletes ALL data (use for logout).
   *                      If false, preserves onboarding flags (use during onboarding).
   */
  clearAll(fullCleanup: boolean = true): void {
    console.log("🔐 Clearing all wallet data...");

    // Use provided cleanup function if available
    if (this.config.clearAllData) {
      this.config.clearAllData(fullCleanup);
    }

    // Reset state
    this.state = createEmptyState();
    this.hasInitialized = false;
    this.isInitializing = false;
    this.initializePromise = null;

    console.log("🔐 All wallet data cleared");
  }

  // ==========================================
  // Storage (Private)
  // ==========================================

  private saveToStorage(): void {
    const { storageKeys } = this.config;

    if (this.state.mnemonic) {
      const encryptedMnemonic = this.encrypt(this.state.mnemonic);
      localStorage.setItem(storageKeys.mnemonic, encryptedMnemonic);
    } else if (this.state.masterKey) {
      const encryptedMaster = this.encrypt(this.state.masterKey);
      localStorage.setItem(storageKeys.masterKey, encryptedMaster);
    }

    if (this.state.chainCode) {
      localStorage.setItem(storageKeys.chainCode, this.state.chainCode);
    } else {
      localStorage.removeItem(storageKeys.chainCode);
    }

    localStorage.setItem(storageKeys.source, this.state.source);
    localStorage.setItem(storageKeys.derivationMode, this.state.derivationMode);
    localStorage.setItem(storageKeys.basePath, this.state.basePath);
  }

  private encrypt(data: string): string {
    return CryptoJS.AES.encrypt(data, this.sessionKey).toString();
  }

  private decrypt(encrypted: string): string | null {
    try {
      const bytes = CryptoJS.AES.decrypt(encrypted, this.sessionKey);
      const decrypted = bytes.toString(CryptoJS.enc.Utf8);
      if (!decrypted) {
        console.error("Decryption failed: empty result. Possible session key mismatch.");
        return null;
      }
      return decrypted;
    } catch (error) {
      console.error("Decryption error:", error);
      return null;
    }
  }
}

/**
 * Get the singleton BrowserKeyManager instance
 * Convenience function for common usage patterns
 */
export function getBrowserKeyManager(
  sessionKey: string,
  config: BrowserKeyManagerConfig
): BrowserKeyManager {
  return BrowserKeyManager.getInstance(sessionKey, config);
}
