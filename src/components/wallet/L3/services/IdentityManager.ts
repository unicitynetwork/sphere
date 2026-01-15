import CryptoJS from "crypto-js";
import { UnifiedKeyManager } from "../../shared/services/UnifiedKeyManager";
import { STORAGE_KEYS } from "../../../../config/storageKeys";
import {
  // SDK identity functions
  deriveIdentityFromPrivateKey as sdkDeriveIdentityFromPrivateKey,
  getWalletDirectAddress,
  validateMnemonic,
  deriveL3Address,
  type DirectAddress,
  type WalletStatePersistence,
} from "../../sdk";
import { BrowserWalletStatePersistence } from "../../sdk/browser/wallet-state-persistence-browser";

// Re-export UserIdentity type from SDK for consumers
export type { UserIdentity } from "../../sdk";
import type { UserIdentity } from "../../sdk";

const DEFAULT_SESSION_KEY = "user-pin-1234";

export class IdentityManager {
  private static instance: IdentityManager;
  private sessionKey: string;
  private statePersistence: WalletStatePersistence;

  private constructor(sessionKey: string, statePersistence?: WalletStatePersistence) {
    this.sessionKey = sessionKey;
    // Use provided persistence or default to browser localStorage
    this.statePersistence = statePersistence ?? new BrowserWalletStatePersistence();
  }

  static getInstance(sessionKey: string = DEFAULT_SESSION_KEY): IdentityManager {
    if (!IdentityManager.instance) {
      IdentityManager.instance = new IdentityManager(sessionKey);
    }
    return IdentityManager.instance;
  }

  /**
   * Get the UnifiedKeyManager instance
   * NOTE: Always fetch fresh from singleton to avoid stale references after resetInstance()
   */
  getUnifiedKeyManager(): UnifiedKeyManager {
    // Always get fresh instance from singleton - don't cache!
    // UnifiedKeyManager.resetInstance() can make cached references stale
    return UnifiedKeyManager.getInstance(this.sessionKey);
  }

  /**
   * Get the selected address PATH for identity derivation
   * Returns null if not set (caller should use default first address)
   */
  getSelectedAddressPath(): string | null {
    return this.statePersistence.getString(STORAGE_KEYS.L3_SELECTED_ADDRESS_PATH);
  }

  /**
   * Set the selected address PATH for identity derivation
   * @param path - Full BIP32 path like "m/84'/1'/0'/0/0"
   */
  setSelectedAddressPath(path: string): void {
    this.statePersistence.setString(STORAGE_KEYS.L3_SELECTED_ADDRESS_PATH, path);
    // Clean up legacy index key
    this.statePersistence.remove(STORAGE_KEYS.L3_SELECTED_ADDRESS_INDEX_LEGACY);
  }

  /**
   * Clear the selected address path (for wallet reset)
   */
  clearSelectedAddressPath(): void {
    this.statePersistence.remove(STORAGE_KEYS.L3_SELECTED_ADDRESS_PATH);
    this.statePersistence.remove(STORAGE_KEYS.L3_SELECTED_ADDRESS_INDEX_LEGACY);
  }

  /**
   * Generate a new identity using the UnifiedKeyManager (standard BIP32)
   * This creates a unified wallet where L1 and L3 share the same keypairs
   */
  async generateNewIdentity(): Promise<UserIdentity> {
    const keyManager = this.getUnifiedKeyManager();
    const mnemonic = await keyManager.generateNew(12);
    // Use path-based derivation - PATH is the single identifier
    const basePath = keyManager.getBasePath();
    const defaultPath = `${basePath}/0/0`;
    const identity = await this.deriveIdentityFromPath(defaultPath);
    // Save mnemonic for legacy compatibility
    if (mnemonic) {
      this.saveSeed(mnemonic);
    }
    return { ...identity, mnemonic };
  }

  /**
   * Derive L3 identity from a BIP32 path
   * This is the PREFERRED method - use path as the single identifier
   * Delegates to WalletCore for L3 address derivation
   * @param path - Full BIP32 path like "m/84'/1'/0'/0/0"
   */
  async deriveIdentityFromPath(path: string): Promise<UserIdentity> {
    const keyManager = this.getUnifiedKeyManager();

    if (!keyManager.isInitialized()) {
      throw new Error("Unified wallet not initialized");
    }

    // Get L1 address info from UnifiedKeyManager
    const derived = keyManager.deriveAddressFromPath(path);

    // Use SDK for L3 address derivation
    const l3 = await deriveL3Address(derived.privateKey);

    // Parse path to get index for addressIndex field
    const match = path.match(/\/(\d+)$/);
    const index = match ? parseInt(match[1], 10) : 0;

    return {
      privateKey: derived.privateKey,
      publicKey: l3.publicKey,
      address: l3.address,
      mnemonic: keyManager.getMnemonic() || undefined,
      l1Address: derived.l1Address,
      addressIndex: index,
    };
  }

  /**
   * Derive identity from a raw private key
   * Useful for external integrations
   * Delegates to SDK for L3 address derivation
   */
  async deriveIdentityFromPrivateKey(privateKey: string): Promise<UserIdentity> {
    // Use SDK identity function
    return sdkDeriveIdentityFromPrivateKey(privateKey);
  }

  /**
   * Derive identity from mnemonic using UnifiedKeyManager
   * This always uses BIP32 derivation for consistency with L1
   * Uses WalletCore for mnemonic validation
   */
  async deriveIdentityFromMnemonic(mnemonic: string): Promise<UserIdentity> {
    // Use WalletCore for mnemonic validation
    if (!validateMnemonic(mnemonic)) {
      throw new Error("Invalid recovery phrase. Please check your words and try again.");
    }

    // Use UnifiedKeyManager for BIP32 derivation - PATH is the single identifier
    const keyManager = this.getUnifiedKeyManager();
    await keyManager.createFromMnemonic(mnemonic);

    // Use path-based derivation for the default first external address
    const basePath = keyManager.getBasePath();
    const defaultPath = `${basePath}/0/0`;
    const identity = await this.deriveIdentityFromPath(defaultPath);

    // Save mnemonic for legacy compatibility
    this.saveSeed(mnemonic);

    return { ...identity, mnemonic };
  }

  private saveSeed(mnemonic: string) {
    const encrypted = CryptoJS.AES.encrypt(
      mnemonic,
      this.sessionKey
    ).toString();
    this.statePersistence.setString(STORAGE_KEYS.ENCRYPTED_SEED, encrypted);
  }

  async getCurrentIdentity(): Promise<UserIdentity | null> {
    // ONLY use UnifiedKeyManager - L1 and L3 share the same keys
    // Legacy mnemonic-only wallets are no longer supported
    const keyManager = this.getUnifiedKeyManager();
    const initialized = await keyManager.initialize();

    if (initialized) {
      // Use path-based derivation (not index-based) - PATH is the ONLY reliable identifier
      const selectedPath = this.getSelectedAddressPath();
      if (selectedPath) {
        return this.deriveIdentityFromPath(selectedPath);
      }

      // Fallback to first external address if no path stored
      const basePath = keyManager.getBasePath();
      const defaultPath = `${basePath}/0/0`;
      return this.deriveIdentityFromPath(defaultPath);
    }

    // No wallet initialized - user must create or import a wallet
    return null;
  }

  /**
   * Get the L1 Alpha address associated with current identity
   */
  async getL1Address(): Promise<string | null> {
    const identity = await this.getCurrentIdentity();
    return identity?.l1Address || null;
  }

  async getWalletAddress(): Promise<DirectAddress | null> {
    const identity = await this.getCurrentIdentity();
    if (!identity) return null;

    try {
      // Use SDK function for wallet address derivation
      return await getWalletDirectAddress(identity.privateKey);
    } catch (error) {
      console.error("Failed to derive wallet address", error);
      return null;
    }
  }
}
