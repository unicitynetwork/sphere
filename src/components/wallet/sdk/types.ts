/**
 * Unicity Wallet SDK Types
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

// ==========================================
// Wallet JSON Format Types
// ==========================================

/**
 * Derivation mode for JSON wallet format
 */
export type WalletJSONDerivationMode = 'bip32' | 'legacy_hmac' | 'wif_hmac';

/**
 * Source of wallet for JSON format
 */
export type WalletJSONSource =
  | 'mnemonic'
  | 'file_bip32'
  | 'file_standard'
  | 'dat_descriptor'
  | 'dat_hd'
  | 'dat_legacy';

/**
 * Address in JSON wallet format
 */
export interface WalletJSONAddress {
  address: string;
  publicKey: string;
  path: string;
  index?: number;
  isChange?: boolean;
}

/**
 * JSON Wallet Export structure (v1.0)
 */
export interface WalletJSON {
  /** Format version */
  version: '1.0';
  /** Generation timestamp ISO 8601 */
  generated: string;
  /** Security warning */
  warning: string;
  /** Master private key (hex, 64 chars) - absent when encrypted */
  masterPrivateKey?: string;
  /** Master chain code for BIP32 (hex, 64 chars) */
  chainCode?: string;
  /** BIP39 mnemonic phrase - only if source is "mnemonic" */
  mnemonic?: string;
  /** Derivation mode used */
  derivationMode: WalletJSONDerivationMode;
  /** Source of the wallet */
  source: WalletJSONSource;
  /** First address for verification */
  firstAddress: WalletJSONAddress;
  /** Descriptor path for BIP32 wallets (e.g., "84'/0'/0'") */
  descriptorPath?: string;
  /** Encrypted fields (when password protected) */
  encrypted?: {
    masterPrivateKey: string;
    mnemonic?: string;
    salt: string;
    iterations: number;
  };
  /** Additional addresses beyond first */
  addresses?: WalletJSONAddress[];
}

/**
 * Options for exporting wallet to JSON
 */
export interface WalletJSONExportOptions {
  /** Password for encryption */
  password?: string;
  /** Include all addresses */
  includeAllAddresses?: boolean;
  /** Number of addresses to include */
  addressCount?: number;
}

/**
 * Result of parsing wallet JSON
 */
export interface WalletJSONImportResult {
  success: boolean;
  masterPrivateKey?: string;
  chainCode?: string;
  mnemonic?: string;
  source?: WalletJSONSource;
  derivationMode?: WalletJSONDerivationMode;
  descriptorPath?: string;
  firstAddress?: WalletJSONAddress;
  addresses?: WalletJSONAddress[];
  error?: string;
}
