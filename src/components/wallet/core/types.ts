/**
 * Wallet Core Types
 *
 * Pure type definitions for wallet operations.
 * No dependencies on React, localStorage, or browser APIs.
 */

/**
 * Derivation mode for child key generation
 */
export type DerivationMode = 'bip32' | 'legacy_hmac' | 'wif_hmac';

/**
 * Source of wallet creation
 */
export type WalletSource = 'mnemonic' | 'file' | 'unknown';

/**
 * Master wallet keys (result of wallet creation)
 */
export interface WalletKeys {
  masterKey: string;
  chainCode: string;
  mnemonic?: string;
}

/**
 * L1 Address information (Alpha blockchain)
 */
export interface L1Address {
  address: string;      // bech32 P2WPKH address (alpha1...)
  privateKey: string;   // hex private key
  publicKey: string;    // hex compressed public key
  index: number;        // derivation index
  path: string;         // full BIP32 path
  isChange: boolean;    // true if change address (internal chain)
}

/**
 * L3 Address information (Unicity network)
 */
export interface L3Address {
  address: string;      // DirectAddress string
  privateKey: string;   // hex private key (same as L1)
  publicKey: string;    // hex public key
}

/**
 * Combined address info for both layers
 */
export interface UnifiedAddress {
  path: string;
  index: number;
  isChange: boolean;

  // L1 (Alpha blockchain)
  l1Address: string;
  privateKey: string;
  publicKey: string;

  // L3 (Unicity network)
  l3Address: string;
}

/**
 * Wallet configuration
 */
export interface WalletConfig {
  basePath?: string;           // BIP32 base path (default: m/44'/0'/0')
  derivationMode?: DerivationMode;
}

/**
 * Default configuration values
 */
export const DEFAULT_BASE_PATH = "m/44'/0'/0'";
export const DEFAULT_DERIVATION_MODE: DerivationMode = 'bip32';

/**
 * Unicity token type (used for L3 address derivation)
 */
export const UNICITY_TOKEN_TYPE_HEX =
  'f8aa13834268d29355ff12183066f0cb902003629bbc5eb9ef0efbe397867509';
