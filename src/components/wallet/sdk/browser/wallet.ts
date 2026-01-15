/**
 * Browser Wallet Operations
 *
 * Browser-specific wallet creation and management.
 * Uses localStorage for persistence and CryptoJS for random generation.
 */

import CryptoJS from 'crypto-js';
import {
  generateHDAddressBIP32,
  generateAddressFromMasterKey,
} from '../address/address';
import type { BaseWallet, BaseWalletAddress } from '../types';
import {
  BrowserWalletStorage,
  type StorageKeyConfig,
} from './storage';

// ==========================================
// Types
// ==========================================

/**
 * Browser wallet extends BaseWallet with browser-specific fields
 */
export interface BrowserWallet extends BaseWallet {
  /** Wallet creation timestamp */
  createdAt?: number;
  /** Browser-specific: wallet is encrypted in localStorage */
  isEncrypted?: boolean;
  /** Browser-specific: encrypted master key for localStorage */
  encryptedMasterKey?: string;
  /** Imported from Alpha wallet.dat */
  isImportedAlphaWallet?: boolean;
}

// ==========================================
// Wallet Factory
// ==========================================

/**
 * Browser wallet factory with storage
 */
export class BrowserWalletFactory<T extends BrowserWallet = BrowserWallet> {
  private storage: BrowserWalletStorage<T>;

  constructor(storageConfig: StorageKeyConfig) {
    this.storage = new BrowserWalletStorage<T>(storageConfig);
  }

  /**
   * Create a new wallet with random private key
   * Uses 32-byte random private key with HMAC-SHA512 derivation
   */
  create(): T {
    // Generate 32 random bytes (256 bits) for the private key
    const randomBytes = CryptoJS.lib.WordArray.random(32);
    const masterPrivateKey = randomBytes.toString();

    // Generate first address using HMAC-SHA512 derivation
    const firstAddress = generateAddressFromMasterKey(masterPrivateKey, 0);

    const wallet = {
      masterPrivateKey,
      addresses: [firstAddress],
      createdAt: Date.now(),
      childPrivateKey: firstAddress.privateKey,
    } as T;

    this.storage.saveMain(wallet);
    return wallet;
  }

  /**
   * Load wallet from storage
   */
  load(): T | null {
    return this.storage.loadMain();
  }

  /**
   * Save wallet to storage
   */
  save(wallet: T): void {
    this.storage.saveMain(wallet);
  }

  /**
   * Delete wallet from storage
   */
  delete(): void {
    this.storage.deleteMain();
  }

  /**
   * Check if wallet exists
   */
  exists(): boolean {
    return this.storage.hasMain();
  }

  /**
   * Generate a new address for the wallet
   * For standard wallets: uses HMAC-SHA512 derivation
   * For imported BIP32 wallets: uses proper BIP32 derivation
   */
  generateAddress(wallet: T): BaseWalletAddress {
    // Find the next external address index
    const externalAddresses = wallet.addresses.filter(addr => !addr.isChange);
    const maxExternalIndex = externalAddresses.length > 0
      ? Math.max(...externalAddresses.map(addr => addr.index ?? 0))
      : -1;
    const index = maxExternalIndex + 1;

    // For imported BIP32 wallets with chainCode, use BIP32 derivation
    // For standard wallets, use HMAC-SHA512 derivation
    const addr = wallet.isImportedAlphaWallet && wallet.chainCode
      ? generateHDAddressBIP32(
          wallet.masterPrivateKey,
          wallet.chainCode,
          index,
          wallet.descriptorPath ? `m/${wallet.descriptorPath}` : undefined,
          false  // isChange=false - always generate external addresses
        )
      : generateAddressFromMasterKey(wallet.masterPrivateKey, index);

    wallet.addresses.push(addr);
    this.storage.saveMain(wallet);

    return addr;
  }

  /**
   * Get storage instance for advanced operations
   */
  getStorage(): BrowserWalletStorage<T> {
    return this.storage;
  }
}

// ==========================================
// Standalone Functions
// ==========================================

/**
 * Create a new wallet (without storage)
 */
export function createWallet(): BrowserWallet {
  const randomBytes = CryptoJS.lib.WordArray.random(32);
  const masterPrivateKey = randomBytes.toString();
  const firstAddress = generateAddressFromMasterKey(masterPrivateKey, 0);

  return {
    masterPrivateKey,
    addresses: [firstAddress],
    createdAt: Date.now(),
    childPrivateKey: firstAddress.privateKey,
  };
}

/**
 * Generate a new address for wallet (without storage)
 */
export function generateAddress(wallet: BrowserWallet): BaseWalletAddress {
  const externalAddresses = wallet.addresses.filter(addr => !addr.isChange);
  const maxExternalIndex = externalAddresses.length > 0
    ? Math.max(...externalAddresses.map(addr => addr.index ?? 0))
    : -1;
  const index = maxExternalIndex + 1;

  const addr = wallet.isImportedAlphaWallet && wallet.chainCode
    ? generateHDAddressBIP32(
        wallet.masterPrivateKey,
        wallet.chainCode,
        index,
        wallet.descriptorPath ? `m/${wallet.descriptorPath}` : undefined,
        false
      )
    : generateAddressFromMasterKey(wallet.masterPrivateKey, index);

  wallet.addresses.push(addr);
  return addr;
}

// ==========================================
// Default Wallet Factory Instance
// ==========================================

import { DEFAULT_WALLET_STORAGE_CONFIG, buildWalletStorageKeys, DEFAULT_STORAGE_PREFIX } from './storage';

// Default keys for wallet operations
const DEFAULT_KEYS = buildWalletStorageKeys(DEFAULT_STORAGE_PREFIX);

// Singleton factory instance
let defaultFactory: BrowserWalletFactory | null = null;

/**
 * Get the default wallet factory
 */
export function getDefaultWalletFactory(): BrowserWalletFactory {
  if (!defaultFactory) {
    defaultFactory = new BrowserWalletFactory(DEFAULT_WALLET_STORAGE_CONFIG);
  }
  return defaultFactory;
}

/**
 * Create and save a new wallet (uses default storage)
 */
export function createAndSaveWallet(): BrowserWallet {
  return getDefaultWalletFactory().create();
}

/**
 * Load wallet from storage (uses default storage)
 */
export function loadWallet(): BrowserWallet | null {
  return getDefaultWalletFactory().load();
}

/**
 * Delete wallet from storage (uses default storage)
 */
export function deleteWallet(): void {
  localStorage.removeItem(DEFAULT_KEYS.L1_WALLET_MAIN);
}

/**
 * Generate and save a new address (uses default storage)
 */
export function generateAndSaveAddress(wallet: BrowserWallet): BaseWalletAddress {
  return getDefaultWalletFactory().generateAddress(wallet);
}
