import { SigningService } from "@unicitylabs/state-transition-sdk/lib/sign/SigningService";
import { TokenType } from "@unicitylabs/state-transition-sdk/lib/token/TokenType";
import * as bip39 from "bip39";
import CryptoJS from "crypto-js";
import { HashAlgorithm } from "@unicitylabs/state-transition-sdk/lib/hash/HashAlgorithm";
import type { DirectAddress } from "@unicitylabs/state-transition-sdk/lib/address/DirectAddress";
import { UnmaskedPredicateReference } from "@unicitylabs/state-transition-sdk/lib/predicate/embedded/UnmaskedPredicateReference";
import { UnifiedKeyManager } from "../../shared/services/UnifiedKeyManager";

const STORAGE_KEY_ENC_SEED = "encrypted_seed";
const STORAGE_KEY_SELECTED_INDEX = "l3_selected_address_index";
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
}

export class IdentityManager {
  private static instance: IdentityManager;
  private sessionKey: string;
  private unifiedKeyManager: UnifiedKeyManager | null = null;

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
   * Get the UnifiedKeyManager instance
   */
  getUnifiedKeyManager(): UnifiedKeyManager {
    if (!this.unifiedKeyManager) {
      this.unifiedKeyManager = UnifiedKeyManager.getInstance(this.sessionKey);
    }
    return this.unifiedKeyManager;
  }

  /**
   * Get the selected address index for identity derivation
   * Defaults to 0 if not set
   */
  getSelectedAddressIndex(): number {
    const saved = localStorage.getItem(STORAGE_KEY_SELECTED_INDEX);
    return saved ? parseInt(saved, 10) : 0;
  }

  /**
   * Set the selected address index for identity derivation
   */
  setSelectedAddressIndex(index: number): void {
    localStorage.setItem(STORAGE_KEY_SELECTED_INDEX, index.toString());
  }

  /**
   * Clear the selected address index (for wallet reset)
   */
  clearSelectedAddressIndex(): void {
    localStorage.removeItem(STORAGE_KEY_SELECTED_INDEX);
  }

  /**
   * Generate a new identity using the UnifiedKeyManager (standard BIP32)
   * This creates a unified wallet where L1 and L3 share the same keypairs
   */
  async generateNewIdentity(): Promise<UserIdentity> {
    const keyManager = this.getUnifiedKeyManager();
    const mnemonic = await keyManager.generateNew(12);
    return this.deriveIdentityFromUnifiedWallet(0, mnemonic);
  }

  /**
   * Derive identity from the UnifiedKeyManager at a specific index
   * Uses standard BIP32 derivation: m/44'/0'/0'/{chain}/{index}
   * where chain=0 for external addresses and chain=1 for change addresses
   * @param index - BIP32 address index
   * @param mnemonic - Optional mnemonic for saving
   * @param isChange - True for change addresses (chain=1), false for external (chain=0)
   */
  async deriveIdentityFromUnifiedWallet(
    index: number = 0,
    mnemonic?: string,
    isChange: boolean = false
  ): Promise<UserIdentity> {
    const keyManager = this.getUnifiedKeyManager();

    if (!keyManager.isInitialized()) {
      throw new Error("Unified wallet not initialized");
    }

    const derived = keyManager.deriveAddress(index, isChange);
    const secret = Buffer.from(derived.privateKey, "hex");

    const l3Address = await this.deriveL3Address(secret);

    const signingService = await SigningService.createFromSecret(secret);
    const publicKey = Buffer.from(signingService.publicKey).toString("hex");

    const identity: UserIdentity = {
      privateKey: derived.privateKey,
      publicKey: publicKey,
      address: l3Address,
      mnemonic: mnemonic || keyManager.getMnemonic() || undefined,
      l1Address: derived.l1Address,
      addressIndex: index,
    };

    // Save mnemonic for legacy compatibility
    if (identity.mnemonic) {
      this.saveSeed(identity.mnemonic);
    }

    return identity;
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

    return {
      privateKey,
      publicKey,
      address: l3Address,
    };
  }

  /**
   * Derive identity from mnemonic using UnifiedKeyManager
   * This always uses BIP32 derivation for consistency with L1
   */
  async deriveIdentityFromMnemonic(mnemonic: string): Promise<UserIdentity> {
    // Validate mnemonic phrase
    const isValid = bip39.validateMnemonic(mnemonic);
    if (!isValid) {
      throw new Error("Invalid recovery phrase. Please check your words and try again.");
    }

    // Use UnifiedKeyManager for BIP32 derivation - no legacy fallback
    const keyManager = this.getUnifiedKeyManager();
    await keyManager.createFromMnemonic(mnemonic);
    return this.deriveIdentityFromUnifiedWallet(0, mnemonic);
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
    localStorage.setItem(STORAGE_KEY_ENC_SEED, encrypted);
  }

  async getCurrentIdentity(): Promise<UserIdentity | null> {
    // ONLY use UnifiedKeyManager - L1 and L3 share the same keys
    // Legacy mnemonic-only wallets are no longer supported
    const keyManager = this.getUnifiedKeyManager();
    const initialized = await keyManager.initialize();

    if (initialized) {
      const index = this.getSelectedAddressIndex(); // Use stored index instead of hardcoded 0
      return this.deriveIdentityFromUnifiedWallet(index);
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
