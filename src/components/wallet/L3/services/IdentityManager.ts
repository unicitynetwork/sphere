import { SigningService } from "@unicitylabs/state-transition-sdk/lib/sign/SigningService";
import { TokenType } from "@unicitylabs/state-transition-sdk/lib/token/TokenType";
import * as bip39 from "bip39";
import CryptoJS from "crypto-js";
import { HashAlgorithm } from "@unicitylabs/state-transition-sdk/lib/hash/HashAlgorithm";
import type { DirectAddress } from "@unicitylabs/state-transition-sdk/lib/address/DirectAddress";
import { UnmaskedPredicateReference } from "@unicitylabs/state-transition-sdk/lib/predicate/embedded/UnmaskedPredicateReference";
import { UnifiedKeyManager } from "../../shared/services/UnifiedKeyManager";
import { STORAGE_KEYS } from "../../../../config/storageKeys";
import { deriveIpnsNameFromPrivateKey } from "./IpnsUtils";
const UNICITY_TOKEN_TYPE_HEX =
  "f8aa13834268d29355ff12183066f0cb902003629bbc5eb9ef0efbe397867509";
const DEFAULT_SESSION_KEY = "user-pin-1234";

/**
 * User identity for L3 Unicity wallet.
 *
 * NOTE: The wallet address is derived using UnmaskedPredicateReference (no nonce/salt).
 * This creates a stable, reusable DirectAddress from publicKey + tokenType.
 * The SDK's UnmaskedPredicate (which uses salt) is only used for token ownership
 * predicates during transfers, where the salt comes from the transaction itself.
 */
export interface UserIdentity {
  privateKey: string;
  publicKey: string;
  address: string;
  mnemonic?: string;
  l1Address?: string; // Alpha L1 address (if derived from unified wallet)
  addressIndex?: number; // BIP44 address index
  ipnsName?: string; // IPNS name derived from privateKey (for inventory sync)
}

export class IdentityManager {
  private static instance: IdentityManager;
  private sessionKey: string;
  // CPU OPTIMIZATION: Cache derived identity to avoid repeated crypto operations
  private cachedIdentity: UserIdentity | null = null;
  private cachedIdentityPath: string | null = null;

  private constructor(sessionKey: string) {
    this.sessionKey = sessionKey;
  }

  static getInstance(sessionKey: string = DEFAULT_SESSION_KEY): IdentityManager {
    if (!IdentityManager.instance) {
      IdentityManager.instance = new IdentityManager(sessionKey);
    }
    return IdentityManager.instance;
  }

  /**
   * Clear the identity cache - call when wallet changes or address switches
   */
  clearIdentityCache(): void {
    this.cachedIdentity = null;
    this.cachedIdentityPath = null;
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
    return localStorage.getItem(STORAGE_KEYS.L3_SELECTED_ADDRESS_PATH);
  }

  /**
   * Set the selected address PATH for identity derivation
   * @param path - Full BIP32 path like "m/84'/1'/0'/0/0"
   */
  setSelectedAddressPath(path: string): void {
    localStorage.setItem(STORAGE_KEYS.L3_SELECTED_ADDRESS_PATH, path);
    // Clean up legacy index key
    localStorage.removeItem(STORAGE_KEYS.L3_SELECTED_ADDRESS_INDEX_LEGACY);
    // Clear cache since path changed
    this.clearIdentityCache();
  }

  /**
   * Clear the selected address path (for wallet reset)
   */
  clearSelectedAddressPath(): void {
    localStorage.removeItem(STORAGE_KEYS.L3_SELECTED_ADDRESS_PATH);
    localStorage.removeItem(STORAGE_KEYS.L3_SELECTED_ADDRESS_INDEX_LEGACY);
    // Clear cache since wallet is being reset
    this.clearIdentityCache();
  }

  /**
   * Generate a new identity using the UnifiedKeyManager (standard BIP32)
   * This creates a unified wallet where L1 and L3 share the same keypairs
   */
  async generateNewIdentity(): Promise<UserIdentity> {
    // Clear cache before generating new wallet
    this.clearIdentityCache();

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

    // Cache the new identity
    this.cachedIdentity = { ...identity, mnemonic };
    this.cachedIdentityPath = defaultPath;

    return { ...identity, mnemonic };
  }

  /**
   * Derive L3 identity from a BIP32 path
   * This is the PREFERRED method - use path as the single identifier
   * @param path - Full BIP32 path like "m/84'/1'/0'/0/0"
   */
  async deriveIdentityFromPath(path: string): Promise<UserIdentity> {
    const keyManager = this.getUnifiedKeyManager();

    if (!keyManager.isInitialized()) {
      throw new Error("Unified wallet not initialized");
    }

    const derived = keyManager.deriveAddressFromPath(path);
    const secret = Buffer.from(derived.privateKey, "hex");

    const l3Address = await this.deriveL3Address(secret);

    const signingService = await SigningService.createFromSecret(secret);
    const publicKey = Buffer.from(signingService.publicKey).toString("hex");

    // Derive IPNS name for inventory sync (critical for IPFS initialization)
    let ipnsName: string | undefined;
    try {
      ipnsName = await deriveIpnsNameFromPrivateKey(derived.privateKey);
      console.log(`📦 [IdentityManager] Derived IPNS name: ${ipnsName?.slice(0, 20)}...`);
    } catch (err) {
      console.error('❌ [IdentityManager] Failed to derive IPNS name:', err);
      ipnsName = undefined;
    }

    // Parse path to get index for addressIndex field
    const match = path.match(/\/(\d+)$/);
    const index = match ? parseInt(match[1], 10) : 0;

    return {
      privateKey: derived.privateKey,
      publicKey: publicKey,
      address: l3Address,
      mnemonic: keyManager.getMnemonic() || undefined,
      l1Address: derived.l1Address,
      addressIndex: index,
      ipnsName: ipnsName,
    };
  }

  /**
   * Derive identity from a raw private key
   * Useful for external integrations
   */
  async deriveIdentityFromPrivateKey(privateKey: string): Promise<UserIdentity> {
    const secret = Buffer.from(privateKey, "hex");

    const l3Address = await this.deriveL3Address(secret);

    const signingService = await SigningService.createFromSecret(secret);
    const publicKey = Buffer.from(signingService.publicKey).toString("hex");

    // Derive IPNS name for inventory sync
    const ipnsName = await deriveIpnsNameFromPrivateKey(privateKey);

    return {
      privateKey,
      publicKey,
      address: l3Address,
      ipnsName: ipnsName,
    };
  }

  /**
   * Derive identity from mnemonic using UnifiedKeyManager
   * This always uses BIP32 derivation for consistency with L1
   */
  async deriveIdentityFromMnemonic(mnemonic: string): Promise<UserIdentity> {
    // Clear cache before restoring wallet
    this.clearIdentityCache();

    // Validate mnemonic phrase
    const isValid = bip39.validateMnemonic(mnemonic);
    if (!isValid) {
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

    // Cache the restored identity
    this.cachedIdentity = { ...identity, mnemonic };
    this.cachedIdentityPath = defaultPath;

    return { ...identity, mnemonic };
  }

  /**
   * Derive L3 Unicity address from secret
   * Uses UnmaskedPredicateReference (no nonce) for a stable, reusable address
   */
  private async deriveL3Address(secret: Buffer): Promise<string> {
    try {
      const signingService = await SigningService.createFromSecret(secret);

      const tokenTypeBytes = Buffer.from(UNICITY_TOKEN_TYPE_HEX, "hex");
      const tokenType = new TokenType(tokenTypeBytes);

      // Use UnmaskedPredicateReference for stable wallet address (no nonce)
      // This matches getWalletAddress() and is the correct approach per SDK
      const predicateRef = UnmaskedPredicateReference.create(
        tokenType,
        signingService.algorithm,
        signingService.publicKey,
        HashAlgorithm.SHA256
      );

      return (await (await predicateRef).toAddress()).toString();
    } catch (error) {
      console.error("Error deriving address", error);
      throw error;
    }
  }

  private saveSeed(mnemonic: string) {
    const encrypted = CryptoJS.AES.encrypt(
      mnemonic,
      this.sessionKey
    ).toString();
    localStorage.setItem(STORAGE_KEYS.ENCRYPTED_SEED, encrypted);
  }

  async getCurrentIdentity(): Promise<UserIdentity | null> {
    // ONLY use UnifiedKeyManager - L1 and L3 share the same keys
    // Legacy mnemonic-only wallets are no longer supported
    const keyManager = this.getUnifiedKeyManager();
    const initialized = await keyManager.initialize();

    if (initialized) {
      // Use path-based derivation (not index-based) - PATH is the ONLY reliable identifier
      const selectedPath = this.getSelectedAddressPath();
      const basePath = keyManager.getBasePath();
      const currentPath = selectedPath || `${basePath}/0/0`;

      // CPU OPTIMIZATION: Return cached identity if path hasn't changed
      if (this.cachedIdentity && this.cachedIdentityPath === currentPath) {
        return this.cachedIdentity;
      }

      // Derive and cache the identity
      const identity = await this.deriveIdentityFromPath(currentPath);
      this.cachedIdentity = identity;
      this.cachedIdentityPath = currentPath;
      return identity;
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
      const secret = Buffer.from(identity.privateKey, "hex");
      const signingService = await SigningService.createFromSecret(secret);
      const publicKey = signingService.publicKey;
      const tokenType = new TokenType(
        Buffer.from(UNICITY_TOKEN_TYPE_HEX, "hex")
      );

      // UnmaskedPredicateReference creates a stable, reusable DirectAddress
      // This does NOT use nonce - the address is derived only from publicKey + tokenType
      const predicateRef = UnmaskedPredicateReference.create(
        tokenType,
        signingService.algorithm,
        publicKey,
        HashAlgorithm.SHA256
      );

      return (await predicateRef).toAddress();
    } catch (error) {
      console.error("Failed to derive wallet address", error);
      return null;
    }
  }
}
