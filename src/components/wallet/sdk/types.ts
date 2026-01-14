/**
 * Unicity Wallet SDK Types
 *
 * Pure type definitions for wallet operations.
 * No dependencies on React, localStorage, or browser APIs.
 */

// ==========================================
// Base Wallet Types
// ==========================================

/**
 * Base wallet address (minimal interface for SDK functions)
 */
export interface BaseWalletAddress {
  address: string;
  publicKey?: string;
  privateKey?: string;
  path: string | null;
  index: number;
  isChange?: boolean;
  createdAt?: string;
}

/**
 * Base wallet structure (minimal interface for SDK functions)
 * Platform implementations can extend this with additional fields.
 */
export interface BaseWallet {
  masterPrivateKey: string;
  chainCode?: string;
  masterChainCode?: string;
  addresses: BaseWalletAddress[];
  childPrivateKey?: string | null;
  isBIP32?: boolean;
  descriptorPath?: string | null;
  createdAt?: number;
  /** Wallet was imported from Alpha wallet.dat or backup file */
  isImportedAlphaWallet?: boolean;
}

// ==========================================
// L1 (Alpha Blockchain) Types
// ==========================================

/**
 * L1 UTXO (Unspent Transaction Output)
 */
export interface L1UTXO {
  txid?: string;
  tx_hash?: string;
  vout?: number;
  tx_pos?: number;
  value: number;
  height?: number;
  address?: string;
}

/** @deprecated Use L1UTXO instead */
export type UTXO = L1UTXO;

/**
 * L1 Transaction input
 */
export interface L1TxInput {
  txid: string;
  vout: number;
  value: number;
  address: string;
}

/**
 * L1 Transaction output
 */
export interface L1TxOutput {
  address: string;
  value: number;
}

/**
 * L1 Planned transaction
 */
export interface L1PlannedTx {
  input: L1TxInput;
  outputs: L1TxOutput[];
  fee: number;
  changeAmount: number;
  changeAddress: string;
}

/**
 * L1 Transaction plan result
 */
export interface L1TxPlanResult {
  success: boolean;
  transactions: L1PlannedTx[];
  error?: string;
}

// Legacy aliases for backwards compatibility
/** @deprecated Use L1TxInput instead */
export type TxInput = L1TxInput;
/** @deprecated Use L1TxOutput instead */
export type TxOutput = L1TxOutput;
/** @deprecated Use L1PlannedTx instead */
export type PlannedTx = L1PlannedTx;
/** @deprecated Use L1TxPlanResult instead */
export type TxPlanResult = L1TxPlanResult;

// ==========================================
// L1 Network Provider Interface
// ==========================================

/**
 * L1 Network provider interface for Alpha blockchain operations.
 * Implementations provide platform-specific network access.
 *
 * Browser: WebSocket to Fulcrum
 * Node.js: ws package to Fulcrum
 * React Native: platform WebSocket
 */
export interface L1NetworkProvider {
  /** Get balance for address in satoshis */
  getBalance(address: string): Promise<number>;

  /** Get UTXOs for address */
  getUtxos(address: string): Promise<L1UTXO[]>;

  /** Broadcast raw transaction hex, returns txid */
  broadcast(rawTxHex: string): Promise<string>;

  /** Get transaction details by txid */
  getTransaction?(txid: string): Promise<unknown>;

  /** Get transaction history for address */
  getHistory?(address: string): Promise<Array<{ tx_hash: string; height: number }>>;
}

/** @deprecated Use L1NetworkProvider instead */
export type NetworkProvider = L1NetworkProvider;

// ==========================================
// Storage Provider Interface
// ==========================================

/**
 * Storage provider interface for wallet persistence.
 * Implementations provide platform-specific storage.
 *
 * Browser: localStorage
 * Node.js: file system or database
 * React Native: AsyncStorage
 */
export interface StorageProvider {
  /** Get item by key */
  getItem(key: string): Promise<string | null>;

  /** Set item by key */
  setItem(key: string, value: string): Promise<void>;

  /** Remove item by key */
  removeItem(key: string): Promise<void>;

  /** Get all keys with prefix */
  getKeysWithPrefix?(prefix: string): Promise<string[]>;
}

// ==========================================
// Vesting Cache Provider Interface
// ==========================================

/**
 * Cache entry for vesting classification
 */
export interface VestingCacheEntry {
  /** Coinbase block height (null if not yet computed) */
  blockHeight: number | null;
  /** Whether this is a coinbase transaction */
  isCoinbase: boolean;
  /** Input transaction ID (for non-coinbase txs) */
  inputTxId: string | null;
}

/**
 * Cache provider interface for vesting classification.
 * Implementations provide platform-specific caching.
 *
 * Browser: IndexedDB
 * Node.js: SQLite or LevelDB
 * React Native: AsyncStorage or SQLite
 */
export interface VestingCacheProvider {
  /** Initialize the cache (create tables, etc.) */
  init(): Promise<void>;

  /** Get cached entry for transaction */
  get(txHash: string): Promise<VestingCacheEntry | null>;

  /** Save entry to cache */
  set(txHash: string, entry: VestingCacheEntry): Promise<void>;

  /** Clear all cached entries */
  clear(): Promise<void>;
}

// ==========================================
// Key Derivation Types
// ==========================================

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
 * Note: DEFAULT_BASE_PATH uses BIP84 testnet (84'/1'/0') to match webwallet
 * for compatibility with wallet.dat imports from Alpha Core
 */
export const DEFAULT_BASE_PATH = "m/84'/1'/0'";
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
