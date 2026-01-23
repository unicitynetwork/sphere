/**
 * UnifiedKeyManager - Single source of truth for L1 and L3 key management
 *
 * Supports TWO derivation modes for webwallet compatibility:
 * 1. Standard BIP32 - When chain code is available (full HD wallet)
 * 2. WIF HMAC - When only master key is available (simple wallet)
 *
 * Same private keys are used for:
 * - L1 Alpha addresses (P2WPKH bech32)
 * - L3 Unicity identities (secp256k1)
 * - Nostr keypairs (secp256k1/schnorr)
 * - IPFS keys (HKDF-derived Ed25519)
 */

import * as bip39 from "bip39";
import CryptoJS from "crypto-js";
import elliptic from "elliptic";
import {
  deriveKeyAtPath,
  generateMasterKeyFromSeed,
  generateHDAddressBIP32,
  generateAddressFromMasterKey,
  generateHDAddress,
} from "../../L1/sdk/address";
import {
  exportWalletToJSON,
  downloadWalletJSON,
  importWalletFromJSON,
  type WalletJSON,
  type WalletJSONExportOptions,
} from "../../L1/sdk/import-export";
import { STORAGE_KEYS, clearAllSphereData } from "../../../../config/storageKeys";

const ec = new elliptic.ec("secp256k1");

// Default base path for BIP32 derivation
const DEFAULT_BASE_PATH = "m/44'/0'/0'";

export type WalletSource = "mnemonic" | "file" | "unknown";

/**
 * Derivation mode determines how child keys are derived:
 * - "bip32": Standard BIP32 with chain code (IL + parentKey) mod n
 * - "legacy_hmac": Legacy Sphere HMAC derivation with chain code (HMAC-SHA512(chainCode, masterKey || index))
 * - "wif_hmac": Simple HMAC derivation without chain code (HMAC-SHA512(pathString, masterKey))
 */
export type DerivationMode = "bip32" | "legacy_hmac" | "wif_hmac";

export interface DerivedAddress {
  privateKey: string;
  publicKey: string;
  l1Address: string;
  index: number;
  path: string;
  isChange?: boolean;
}

export interface WalletInfo {
  source: WalletSource;
  hasMnemonic: boolean;
  hasChainCode: boolean;
  derivationMode: DerivationMode;
  address0: string | null;
}

/**
 * UnifiedKeyManager provides a single interface for key management
 * across L1 and L3 wallets.
 *
 * Supports both BIP32 (with chain code) and WIF HMAC (without chain code) derivation.
 */
export class UnifiedKeyManager {
  private static instance: UnifiedKeyManager | null = null;

  private mnemonic: string | null = null;
  private masterKey: string | null = null;
  private chainCode: string | null = null;
  private derivationMode: DerivationMode = "bip32";
  private basePath: string = DEFAULT_BASE_PATH;
  private source: WalletSource = "unknown";
  private sessionKey: string;

  // Initialization guards
  private isInitializing: boolean = false;
  private hasInitialized: boolean = false;
  private initializePromise: Promise<boolean> | null = null;

  private constructor(sessionKey: string) {
    this.sessionKey = sessionKey;
  }

  static getInstance(sessionKey: string): UnifiedKeyManager {
    if (!UnifiedKeyManager.instance) {
      UnifiedKeyManager.instance = new UnifiedKeyManager(sessionKey);
    } else if (UnifiedKeyManager.instance.sessionKey !== sessionKey) {
      // Session key mismatch! This is a critical error that would cause
      // decryption to fail. Log the issue and update the session key.
      console.error(
        "WARNING: UnifiedKeyManager session key mismatch detected!",
        "This can cause data loss. Updating session key to maintain consistency."
      );
      UnifiedKeyManager.instance.sessionKey = sessionKey;
    }
    return UnifiedKeyManager.instance;
  }

  /**
   * Initialize wallet from stored data (if available)
   */
  async initialize(): Promise<boolean> {
    // Return cached result if already initialized
    if (this.hasInitialized) {
      return this.masterKey !== null;
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
    try {
      // Try to load from storage
      const encryptedMnemonic = localStorage.getItem(STORAGE_KEYS.UNIFIED_WALLET_MNEMONIC);
      const encryptedMaster = localStorage.getItem(STORAGE_KEYS.UNIFIED_WALLET_MASTER);
      const chainCode = localStorage.getItem(STORAGE_KEYS.UNIFIED_WALLET_CHAINCODE);
      const source = localStorage.getItem(STORAGE_KEYS.UNIFIED_WALLET_SOURCE) as WalletSource;
      const derivationMode = localStorage.getItem(STORAGE_KEYS.UNIFIED_WALLET_DERIVATION_MODE) as DerivationMode;
      const storedBasePath = localStorage.getItem(STORAGE_KEYS.UNIFIED_WALLET_BASE_PATH);

      console.log("🔐 UnifiedKeyManager initializing...", {
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
          this.masterKey = masterKey;
          this.chainCode = chainCode || null; // May be null for WIF HMAC mode
          this.source = source || "file";
          this.derivationMode = derivationMode || (chainCode ? "bip32" : "wif_hmac");
          this.basePath = storedBasePath || DEFAULT_BASE_PATH;
          console.log(`✅ Wallet initialized from file import (basePath: ${this.basePath})`);
          return true;
        } else {
          console.error("❌ Failed to decrypt master key - session key mismatch?");
        }
      }

      console.log("ℹ️ No wallet data found in storage");
      return false;
    } catch (error) {
      console.error("Failed to initialize UnifiedKeyManager:", error);
      return false;
    }
  }

  /**
   * Create a new wallet from a BIP39 mnemonic
   */
  async createFromMnemonic(mnemonic: string, save: boolean = true): Promise<void> {
    // Validate mnemonic
    if (!bip39.validateMnemonic(mnemonic)) {
      throw new Error("Invalid mnemonic phrase");
    }

    // Convert mnemonic to seed (64 bytes)
    const seed = await bip39.mnemonicToSeed(mnemonic);
    const seedHex = Buffer.from(seed).toString("hex");

    // Derive master key and chain code using BIP32 standard
    const { masterPrivateKey, masterChainCode } = generateMasterKeyFromSeed(seedHex);

    this.mnemonic = mnemonic;
    this.masterKey = masterPrivateKey;
    this.chainCode = masterChainCode;
    this.source = "mnemonic";

    if (save) {
      this.saveToStorage();
    }

    console.log("🔐 Unified wallet created from mnemonic");
  }

  /**
   * Generate a new wallet with a fresh mnemonic
   */
  async generateNew(wordCount: 12 | 24 = 12): Promise<string> {
    const strength = wordCount === 24 ? 256 : 128;
    const mnemonic = bip39.generateMnemonic(strength);
    await this.createFromMnemonic(mnemonic);
    return mnemonic;
  }

  /**
   * Import wallet from webwallet txt file content
   * Supports two formats:
   * 1. With Chain Code (BIP32 mode): Uses standard HD derivation
   * 2. Without Chain Code (WIF HMAC mode): Uses simple HMAC derivation
   */
  async importFromFileContent(content: string): Promise<void> {
    const lines = content.split("\n").map((l) => l.trim());

    let masterKey: string | null = null;
    let chainCode: string | null = null;
    let expectMasterKey = false;
    let expectChainCode = false;

    for (const line of lines) {
      // Check if this line is a label for master key (value on next line)
      // Handles formats like: "MASTER PRIVATE KEY (keep secret!):" or "MASTER PRIVATE KEY:"
      if (/MASTER\s*PRIVATE\s*KEY/i.test(line) && !/[a-fA-F0-9]{64}/.test(line)) {
        expectMasterKey = true;
        continue;
      }

      // Check if this line is a label for chain code (value on next line)
      // Handles formats like: "MASTER CHAIN CODE (for BIP32...):" or "MASTER CHAIN CODE:"
      if (/MASTER\s*CHAIN\s*CODE/i.test(line) && !/[a-fA-F0-9]{64}/.test(line)) {
        expectChainCode = true;
        continue;
      }

      // If we're expecting a master key and this line is a 64-char hex string
      if (expectMasterKey && /^[a-fA-F0-9]{64}$/.test(line)) {
        masterKey = line.toLowerCase();
        expectMasterKey = false;
        continue;
      }

      // If we're expecting a chain code and this line is a 64-char hex string
      if (expectChainCode && /^[a-fA-F0-9]{64}$/.test(line)) {
        chainCode = line.toLowerCase();
        expectChainCode = false;
        continue;
      }

      // Also try same-line format: "Master Private Key: <hex>"
      const masterMatch = line.match(/(?:Master\s*(?:Private\s*)?Key|masterPriv)[:\s]+([a-fA-F0-9]{64})/i);
      const chainMatch = line.match(/(?:Chain\s*Code|chainCode)[:\s]+([a-fA-F0-9]{64})/i);

      if (masterMatch) {
        masterKey = masterMatch[1].toLowerCase();
      }
      if (chainMatch) {
        chainCode = chainMatch[1].toLowerCase();
      }

      // Reset expectations if we hit a non-hex line
      if (!/^[a-fA-F0-9]{64}$/.test(line)) {
        expectMasterKey = false;
        expectChainCode = false;
      }
    }

    if (!masterKey) {
      throw new Error("Could not find master private key in file");
    }

    // Validate key by trying to create a keypair
    try {
      ec.keyFromPrivate(masterKey, "hex");
    } catch {
      throw new Error("Invalid master private key format");
    }

    // Clear any existing mnemonic storage (so file import takes precedence)
    localStorage.removeItem(STORAGE_KEYS.UNIFIED_WALLET_MNEMONIC);

    this.mnemonic = null; // No mnemonic when importing from file
    this.masterKey = masterKey;
    this.chainCode = chainCode; // May be null for WIF HMAC mode
    this.source = "file";

    // Determine derivation mode based on chain code presence
    if (chainCode) {
      this.derivationMode = "bip32";
      console.log("🔐 Unified wallet imported with BIP32 mode (chain code present)");
    } else {
      this.derivationMode = "wif_hmac";
      console.log("🔐 Unified wallet imported with WIF HMAC mode (no chain code)");
    }

    // Mark as initialized since we have valid data
    this.hasInitialized = true;

    this.saveToStorage();
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
    try {
      ec.keyFromPrivate(masterKey, "hex");
    } catch {
      throw new Error("Invalid master private key format");
    }

    this.mnemonic = null;
    this.masterKey = masterKey;
    this.chainCode = chainCode;
    this.derivationMode = mode;
    this.basePath = basePath || DEFAULT_BASE_PATH;
    this.source = "file";

    // Mark as initialized since we have valid data
    this.hasInitialized = true;

    this.saveToStorage();

    console.log(`🔐 Unified wallet imported with ${mode} mode (basePath: ${this.basePath})`);
  }

  /**
   * Set derivation mode (useful for switching modes after import)
   */
  setDerivationMode(mode: DerivationMode): void {
    if (mode === "bip32" || mode === "legacy_hmac") {
      if (!this.chainCode) {
        throw new Error(`${mode} mode requires chain code`);
      }
    }
    this.derivationMode = mode;
    this.saveToStorage();
    console.log(`🔐 Derivation mode changed to ${mode}`);
  }

  /**
   * Derive address from a full BIP32 path string
   * This is the ONLY method for address derivation - PATH is the single identifier
   * @param path - Full path like "m/84'/1'/0'/0/5" or "m/44'/0'/0'/1/3" or "m/44'/0'/0'" (HMAC style)
   */
  deriveAddressFromPath(path: string): DerivedAddress {
    if (!this.masterKey) {
      throw new Error("Wallet not initialized");
    }

    let index: number;
    let isChange: boolean;

    // Parse path to extract chain and index
    // Try 5-level BIP32 first: m/84'/1'/0'/0/5 or m/44'/0'/0'/1/3
    const bip32Match = path.match(/m\/(\d+)'\/(\d+)'\/(\d+)'\/(\d+)\/(\d+)/);
    if (bip32Match) {
      const chain = parseInt(bip32Match[4], 10);  // 0=external, 1=change
      index = parseInt(bip32Match[5], 10);
      isChange = chain === 1;
    } else {
      // Try 3-level HMAC path: m/44'/0'/0' (Standard wallet format)
      const hmacMatch = path.match(/m\/(\d+)'\/(\d+)'\/(\d+)'/);
      if (hmacMatch) {
        // In HMAC paths, the last hardened component is the index
        index = parseInt(hmacMatch[3], 10);
        isChange = false;  // HMAC wallets don't have change addresses
      } else {
        throw new Error(`Invalid BIP32 path: ${path}`);
      }
    }

    if (this.derivationMode === "bip32" && this.chainCode) {
      // Standard BIP32 derivation using wallet's base path (e.g., m/84'/1'/0'/0/{index})
      const result = generateHDAddressBIP32(
        this.masterKey,
        this.chainCode,
        index,
        this.basePath,  // Use wallet's stored base path instead of hardcoded default
        isChange  // Pass isChange to use correct chain (0=external, 1=change)
      );

      return {
        privateKey: result.privateKey,
        publicKey: result.publicKey,
        l1Address: result.address,
        index: result.index,
        path: result.path,
        isChange,
      };
    } else if (this.derivationMode === "legacy_hmac" && this.chainCode) {
      // Legacy Sphere HMAC: HMAC-SHA512(chainCode, masterKey || index)
      // Note: Legacy mode doesn't support change addresses, but we track the flag anyway
      const result = generateHDAddress(
        this.masterKey,
        this.chainCode,
        index
      );

      return {
        privateKey: result.privateKey,
        publicKey: result.publicKey,
        l1Address: result.address,
        index: result.index,
        path: result.path,
        isChange,
      };
    } else {
      // WIF HMAC derivation: HMAC-SHA512(masterKey, "m/44'/0'/{index}'")
      // Note: WIF mode doesn't support change addresses, but we track the flag anyway
      const result = generateAddressFromMasterKey(this.masterKey, index);

      return {
        privateKey: result.privateKey,
        publicKey: result.publicKey,
        l1Address: result.address,
        index: result.index,
        path: result.path,
        isChange,
      };
    }
  }

  /**
   * Get the default address path (first external address)
   * Returns path like "m/44'/0'/0'/0/0" based on wallet's base path
   *
   * Use this instead of hardcoding paths or using addresses[0]
   */
  getDefaultAddressPath(): string {
    return `${this.basePath}/0/0`;
  }

  /**
   * Derive private key at a custom path
   */
  deriveKeyAtPath(path: string): { privateKey: string; chainCode: string } {
    if (!this.masterKey || !this.chainCode) {
      throw new Error("Wallet not initialized");
    }

    return deriveKeyAtPath(this.masterKey, this.chainCode, path);
  }

  /**
   * Get the mnemonic phrase (for backup purposes)
   * Returns null if wallet was imported from file
   */
  getMnemonic(): string | null {
    return this.mnemonic;
  }

  /**
   * Get the master private key in hex format
   * Used by L1 wallet for signing transactions
   */
  getMasterKeyHex(): string | null {
    return this.masterKey;
  }

  /**
   * Get the chain code in hex format
   * Used by L1 wallet for BIP32 derivation
   */
  getChainCodeHex(): string | null {
    return this.chainCode;
  }

  /**
   * Get the base derivation path (e.g., "m/84'/1'/0'" from wallet.dat descriptor)
   * Used for BIP32 address derivation
   */
  getBasePath(): string {
    return this.basePath;
  }

  /**
   * Get wallet info
   */
  getWalletInfo(): WalletInfo {
    let address0: string | null = null;
    try {
      if (this.masterKey) {
        address0 = this.deriveAddressFromPath(this.getDefaultAddressPath()).l1Address;
      }
    } catch {
      // Ignore errors
    }

    return {
      source: this.source,
      hasMnemonic: this.mnemonic !== null,
      hasChainCode: this.chainCode !== null,
      derivationMode: this.derivationMode,
      address0,
    };
  }

  /**
   * Check if wallet is initialized
   */
  isInitialized(): boolean {
    // For BIP32 and legacy_hmac modes, we need both master key and chain code
    // For WIF HMAC mode, we only need master key
    if (this.derivationMode === "bip32" || this.derivationMode === "legacy_hmac") {
      return this.masterKey !== null && this.chainCode !== null;
    }
    return this.masterKey !== null;
  }

  /**
   * Get current derivation mode
   */
  getDerivationMode(): DerivationMode {
    return this.derivationMode;
  }

  /**
   * Export wallet to txt format (compatible with webwallet)
   */
  exportToTxt(): string {
    if (!this.masterKey || !this.chainCode) {
      throw new Error("Wallet not initialized");
    }

    const address0 = this.deriveAddressFromPath(this.getDefaultAddressPath());

    let output = `# Alpha Wallet Export\n`;
    output += `# Generated: ${new Date().toISOString()}\n`;
    output += `#\n`;
    output += `# WARNING: Keep this file secure! Anyone with this data can access your funds.\n`;
    output += `#\n\n`;
    output += `Master Private Key: ${this.masterKey}\n`;
    output += `Chain Code: ${this.chainCode}\n`;
    output += `\n`;
    output += `# First address (${this.getDefaultAddressPath()}):\n`;
    output += `Address: ${address0.l1Address}\n`;
    output += `Public Key: ${address0.publicKey}\n`;

    if (this.mnemonic) {
      output += `\n# Recovery Phrase (12 words):\n`;
      output += `Mnemonic: ${this.mnemonic}\n`;
    }

    return output;
  }

  /**
   * Export wallet to JSON format (new standard)
   *
   * This is the recommended export format as it:
   * - Preserves mnemonic phrase if available
   * - Supports encryption with password
   * - Includes verification address
   * - Maintains source and derivation mode information
   */
  exportToJSON(options: WalletJSONExportOptions = {}): WalletJSON {
    if (!this.masterKey) {
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
      const path = `${this.basePath}/0/${i}`;  // External addresses only for export
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
      masterPrivateKey: this.masterKey,
      chainCode: this.chainCode || undefined,
      masterChainCode: this.chainCode || undefined,
      addresses,
      isBIP32: this.derivationMode === "bip32",
      isImportedAlphaWallet: this.source === "file",
      descriptorPath: this.derivationMode === "bip32" ? this.basePath.replace(/^m\//, '') : null,
    };

    return exportWalletToJSON({
      wallet,
      mnemonic: this.mnemonic || undefined,
      importSource: this.source === "file" ? "file" : undefined,
      options,
    });
  }

  /**
   * Download wallet as JSON file
   */
  downloadJSON(filename?: string, options: WalletJSONExportOptions = {}): void {
    const json = this.exportToJSON(options);
    const defaultFilename = this.mnemonic
      ? "alpha_wallet_mnemonic_backup.json"
      : "alpha_wallet_backup.json";
    downloadWalletJSON(json, filename || defaultFilename);
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

    // If mnemonic is available (either plaintext or decrypted), use createFromMnemonic
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

    // Otherwise, import as file-based wallet (no mnemonic available)
    const chainCode = result.wallet.chainCode || result.wallet.masterChainCode || null;
    const mode = result.derivationMode || (chainCode ? "bip32" : "wif_hmac");
    // Get base path from wallet.dat descriptor (e.g., "84'/1'/0'" -> "m/84'/1'/0'")
    const basePath = result.wallet.descriptorPath
      ? `m/${result.wallet.descriptorPath}`
      : undefined;

    await this.importWithMode(result.wallet.masterPrivateKey, chainCode, mode, basePath);
    console.log(`🔐 Wallet restored from JSON (source: ${result.source}, mode: ${mode}, basePath: ${basePath || DEFAULT_BASE_PATH})`);

    return { success: true };
  }

  /**
   * Clear wallet data
   */
  clear(): void {
    this.mnemonic = null;
    this.masterKey = null;
    this.chainCode = null;
    this.derivationMode = "bip32";
    this.basePath = DEFAULT_BASE_PATH;
    this.source = "unknown";

    // Reset initialization state
    this.hasInitialized = false;
    this.isInitializing = false;
    this.initializePromise = null;

    localStorage.removeItem(STORAGE_KEYS.UNIFIED_WALLET_MNEMONIC);
    localStorage.removeItem(STORAGE_KEYS.UNIFIED_WALLET_MASTER);
    localStorage.removeItem(STORAGE_KEYS.UNIFIED_WALLET_CHAINCODE);
    localStorage.removeItem(STORAGE_KEYS.UNIFIED_WALLET_SOURCE);
    localStorage.removeItem(STORAGE_KEYS.UNIFIED_WALLET_DERIVATION_MODE);
    localStorage.removeItem(STORAGE_KEYS.UNIFIED_WALLET_BASE_PATH);

    console.log("🔐 Unified wallet cleared");
  }

  /**
   * Reset the singleton instance
   * Call this after clear() to ensure fresh state on next getInstance()
   */
  static resetInstance(): void {
    UnifiedKeyManager.instance = null;
    console.log("🔐 UnifiedKeyManager instance reset");
  }

  /**
   * Clear ALL wallet data from localStorage and reset singleton
   * Use this before creating/importing a new wallet to ensure clean slate
   * This is a static method that can be called without an instance
   *
   * @param fullCleanup - If true (default), deletes ALL data (use for logout).
   *                      If false, preserves onboarding flags (use during onboarding).
   */
  static clearAll(fullCleanup: boolean = true): void {
    console.log("🔐 Clearing all wallet data...");

    // Clear ALL sphere_* keys from localStorage in one go
    clearAllSphereData(fullCleanup);

    // Reset singleton instance (in-memory state)
    if (UnifiedKeyManager.instance) {
      UnifiedKeyManager.instance.mnemonic = null;
      UnifiedKeyManager.instance.masterKey = null;
      UnifiedKeyManager.instance.chainCode = null;
      UnifiedKeyManager.instance.derivationMode = "bip32";
      UnifiedKeyManager.instance.basePath = DEFAULT_BASE_PATH;
      UnifiedKeyManager.instance.source = "unknown";
      UnifiedKeyManager.instance.hasInitialized = false;
      UnifiedKeyManager.instance.isInitializing = false;
      UnifiedKeyManager.instance.initializePromise = null;
    }
    UnifiedKeyManager.instance = null;

    console.log("🔐 All wallet data cleared");
  }

  // ==========================================
  // Private methods
  // ==========================================

  private saveToStorage(): void {
    if (this.mnemonic) {
      const encryptedMnemonic = this.encrypt(this.mnemonic);
      localStorage.setItem(STORAGE_KEYS.UNIFIED_WALLET_MNEMONIC, encryptedMnemonic);
    } else if (this.masterKey) {
      const encryptedMaster = this.encrypt(this.masterKey);
      localStorage.setItem(STORAGE_KEYS.UNIFIED_WALLET_MASTER, encryptedMaster);
    }

    if (this.chainCode) {
      // Chain code is not secret (derived from public data in BIP32)
      // but we store it for convenience
      localStorage.setItem(STORAGE_KEYS.UNIFIED_WALLET_CHAINCODE, this.chainCode);
    } else {
      // Remove chain code if not present (WIF HMAC mode)
      localStorage.removeItem(STORAGE_KEYS.UNIFIED_WALLET_CHAINCODE);
    }

    localStorage.setItem(STORAGE_KEYS.UNIFIED_WALLET_SOURCE, this.source);
    localStorage.setItem(STORAGE_KEYS.UNIFIED_WALLET_DERIVATION_MODE, this.derivationMode);
    localStorage.setItem(STORAGE_KEYS.UNIFIED_WALLET_BASE_PATH, this.basePath);
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
