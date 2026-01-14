/**
 * UnityWallet - Unified L1 + L3 Wallet SDK
 *
 * Combines Layer 1 (Alpha blockchain) and Layer 3 (Unicity tokens)
 * with shared keys derived from a single mnemonic.
 *
 * Usage:
 * ```typescript
 * import { UnityWallet } from '@unicity/wallet-sdk';
 * import { BrowserWSAdapter, IndexedDBVestingCache } from '@unicity/wallet-sdk/browser';
 *
 * // Create new wallet
 * const wallet = await UnityWallet.create(
 *   new BrowserWSAdapter(),
 *   new IndexedDBVestingCache()
 * );
 *
 * // Restore from mnemonic
 * const wallet = await UnityWallet.fromMnemonic(
 *   'word1 word2 ...',
 *   new BrowserWSAdapter(),
 *   new IndexedDBVestingCache()
 * );
 *
 * // Use L1 operations
 * const l1Balance = await wallet.l1.getBalance(address);
 * await wallet.l1.send(wallet.getL1Wallet(), toAddress, amount);
 *
 * // Use L3 operations
 * const identity = await wallet.l3.createIdentity(privateKey);
 * ```
 */

import { L1Wallet } from './L1Wallet';
import type { L1WalletConfig } from './L1Wallet';
import { L3Wallet } from './L3Wallet';
import type { L3WalletConfig } from './L3Wallet';
import { createWallet, restoreFromMnemonic, validateMnemonic } from '../core/wallet';
import { deriveDefaultUnifiedAddress, deriveUnifiedAddress } from '../address/unified';
import type { WebSocketAdapter } from '../network/websocket';
import type { VestingCacheProvider, WalletKeys, UnifiedAddress, BaseWallet } from '../types';

// ==========================================
// Configuration
// ==========================================

export interface UnityWalletConfig {
  /** L1 wallet configuration */
  l1?: L1WalletConfig;
  /** L3 wallet configuration */
  l3?: L3WalletConfig;
}

// ==========================================
// UnityWallet Class
// ==========================================

/**
 * Unified Wallet combining L1 (Alpha blockchain) and L3 (Unicity tokens)
 *
 * Both layers share the same master keys derived from a single mnemonic,
 * allowing unified identity across the Unicity ecosystem.
 */
export class UnityWallet {
  /** L1 wallet instance for Alpha blockchain operations */
  readonly l1: L1Wallet;

  /** L3 wallet instance for Unicity token operations */
  readonly l3: L3Wallet;

  /** Wallet keys (master key, chain code, optional mnemonic) */
  private readonly keys: WalletKeys;

  private constructor(
    keys: WalletKeys,
    wsAdapter: WebSocketAdapter,
    cacheProvider?: VestingCacheProvider,
    config: UnityWalletConfig = {}
  ) {
    this.keys = keys;
    this.l1 = new L1Wallet(wsAdapter, cacheProvider, config.l1);
    this.l3 = new L3Wallet(config.l3);
  }

  // ==========================================
  // Static Factory Methods
  // ==========================================

  /**
   * Create a new wallet with fresh mnemonic
   *
   * @param wsAdapter - WebSocket adapter for L1 network
   * @param cacheProvider - Optional vesting cache provider
   * @param config - Optional wallet configuration
   * @param wordCount - Number of words in mnemonic (12 or 24)
   * @returns New UnityWallet instance
   *
   * @example
   * const wallet = await UnityWallet.create(
   *   new BrowserWSAdapter(),
   *   new IndexedDBVestingCache()
   * );
   * console.log('Backup mnemonic:', wallet.getMnemonic());
   */
  static async create(
    wsAdapter: WebSocketAdapter,
    cacheProvider?: VestingCacheProvider,
    config?: UnityWalletConfig,
    wordCount: 12 | 24 = 12
  ): Promise<UnityWallet> {
    const keys = createWallet(wordCount);
    return new UnityWallet(keys, wsAdapter, cacheProvider, config);
  }

  /**
   * Restore wallet from BIP39 mnemonic
   *
   * @param mnemonic - 12 or 24 word recovery phrase
   * @param wsAdapter - WebSocket adapter for L1 network
   * @param cacheProvider - Optional vesting cache provider
   * @param config - Optional wallet configuration
   * @returns Restored UnityWallet instance
   *
   * @example
   * const wallet = await UnityWallet.fromMnemonic(
   *   'word1 word2 word3 ...',
   *   new BrowserWSAdapter()
   * );
   */
  static async fromMnemonic(
    mnemonic: string,
    wsAdapter: WebSocketAdapter,
    cacheProvider?: VestingCacheProvider,
    config?: UnityWalletConfig
  ): Promise<UnityWallet> {
    const keys = restoreFromMnemonic(mnemonic);
    return new UnityWallet(keys, wsAdapter, cacheProvider, config);
  }

  /**
   * Restore wallet from master key and chain code
   *
   * @param masterKey - Master private key hex
   * @param chainCode - Chain code hex
   * @param wsAdapter - WebSocket adapter for L1 network
   * @param cacheProvider - Optional vesting cache provider
   * @param config - Optional wallet configuration
   * @returns Restored UnityWallet instance
   */
  static async fromMasterKey(
    masterKey: string,
    chainCode: string,
    wsAdapter: WebSocketAdapter,
    cacheProvider?: VestingCacheProvider,
    config?: UnityWalletConfig
  ): Promise<UnityWallet> {
    const keys: WalletKeys = { masterKey, chainCode };
    return new UnityWallet(keys, wsAdapter, cacheProvider, config);
  }

  /**
   * Validate mnemonic phrase
   */
  static validateMnemonic(mnemonic: string): boolean {
    return validateMnemonic(mnemonic);
  }

  // ==========================================
  // Key Management
  // ==========================================

  /**
   * Get mnemonic phrase (if available)
   * Only available for wallets created with create() or fromMnemonic()
   */
  getMnemonic(): string | undefined {
    return this.keys.mnemonic;
  }

  /**
   * Get master private key
   */
  getMasterKey(): string {
    return this.keys.masterKey;
  }

  /**
   * Get chain code
   */
  getChainCode(): string {
    return this.keys.chainCode;
  }

  /**
   * Check if mnemonic is available
   */
  hasMnemonic(): boolean {
    return !!this.keys.mnemonic;
  }

  // ==========================================
  // Address Derivation
  // ==========================================

  /**
   * Derive unified address (L1 + L3) at path
   *
   * @param path - BIP32 derivation path (e.g., "m/84'/1'/0'/0/0")
   * @returns Unified address with L1 and L3 components
   */
  async deriveAddress(path: string): Promise<UnifiedAddress> {
    return deriveUnifiedAddress(this.keys.masterKey, this.keys.chainCode, path);
  }

  /**
   * Derive default address (first address at index 0)
   */
  async deriveDefaultAddress(): Promise<UnifiedAddress> {
    return deriveDefaultUnifiedAddress(this.keys.masterKey, this.keys.chainCode);
  }

  /**
   * Get L1-compatible wallet object for transactions
   *
   * This returns a BaseWallet structure that can be used
   * with L1Wallet.send() for creating transactions.
   *
   * @param addresses - Array of wallet addresses with derived keys
   * @returns BaseWallet object for L1 operations
   */
  getL1Wallet(addresses: BaseWallet['addresses'] = []): BaseWallet {
    return {
      masterPrivateKey: this.keys.masterKey,
      chainCode: this.keys.chainCode,
      addresses,
      isBIP32: true,
    };
  }

  // ==========================================
  // Connection Management
  // ==========================================

  /**
   * Connect L1 wallet to network
   *
   * @param endpoint - Optional custom endpoint
   */
  async connectL1(endpoint?: string): Promise<void> {
    await this.l1.connect(endpoint);
  }

  /**
   * Disconnect L1 wallet from network
   */
  disconnectL1(): void {
    this.l1.disconnect();
  }

  /**
   * Check if L1 is connected
   */
  isL1Connected(): boolean {
    return this.l1.isConnected();
  }

  // ==========================================
  // Convenience Methods
  // ==========================================

  /**
   * Get total L1 balance across addresses
   */
  async getL1TotalBalance(addresses: string[]): Promise<number> {
    let total = 0;
    for (const addr of addresses) {
      total += await this.l1.getBalance(addr);
    }
    return total;
  }

  /**
   * Get L1 balance for single address
   */
  async getL1Balance(address: string): Promise<number> {
    return this.l1.getBalance(address);
  }
}
