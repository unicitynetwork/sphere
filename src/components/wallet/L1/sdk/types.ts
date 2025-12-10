export interface Wallet {
  masterPrivateKey: string;
  chainCode?: string;
  addresses: WalletAddress[];
  createdAt?: number;
  isEncrypted?: boolean;
  encryptedMasterKey?: string;
  childPrivateKey?: string | null;
  isImportedAlphaWallet?: boolean;
  masterChainCode?: string | null;
  isBIP32?: boolean;
  descriptorPath?: string | null;
}

export interface WalletAddress {
  address: string;
  publicKey?: string;
  privateKey?: string;
  path: string | null;
  index: number;
  createdAt?: string;
  isChange?: boolean; // true for change addresses (BIP32 chain 1)
}

export interface StoredWallet {
  key: string;
  data: Wallet;
}

export interface TransactionInput {
  txid: string;
  vout: number;
  value: number;
  address: string;
}

export interface TransactionOutput {
  value: number;
  address: string;
}

export interface Transaction {
  input: TransactionInput;
  outputs: TransactionOutput[];
  fee: number;
  changeAmount: number;
  changeAddress: string;
}

export interface TransactionPlan {
  success: boolean;
  transactions: Transaction[];
  error?: string;
}

export interface UTXO {
  txid?: string;
  tx_hash?: string;
  vout?: number;
  tx_pos?: number;
  value: number;
  height?: number;
  address?: string;
}

export interface RestoreWalletResult {
  success: boolean;
  wallet: Wallet;
  message?: string;
  error?: string;
}

export interface ExportOptions {
  password?: string;
  filename?: string;
}

/**
 * JSON Wallet Export Format v1.0
 *
 * Supports multiple wallet sources:
 * - "mnemonic": Created from BIP39 mnemonic phrase (new standard)
 * - "file_bip32": Imported from file with chain code (BIP32 HD wallet)
 * - "file_standard": Imported from file without chain code (HMAC-based)
 * - "dat_descriptor": Imported from wallet.dat descriptor wallet
 * - "dat_hd": Imported from wallet.dat HD wallet
 * - "dat_legacy": Imported from wallet.dat legacy wallet
 */
export type WalletJSONSource =
  | "mnemonic"           // New standard - has mnemonic phrase
  | "file_bip32"         // Imported from txt with chain code
  | "file_standard"      // Imported from txt without chain code (HMAC)
  | "dat_descriptor"     // Imported from wallet.dat (descriptor format)
  | "dat_hd"             // Imported from wallet.dat (HD format)
  | "dat_legacy";        // Imported from wallet.dat (legacy format)

export type WalletJSONDerivationMode = "bip32" | "wif_hmac" | "legacy_hmac";

export interface WalletJSONAddress {
  address: string;
  publicKey: string;
  path: string;
  index?: number;
  isChange?: boolean;
}

/**
 * JSON Wallet Export structure
 */
export interface WalletJSON {
  /** Format version */
  version: "1.0";

  /** Generation timestamp ISO 8601 */
  generated: string;

  /** Security warning */
  warning: string;

  /** Master private key (hex, 64 chars) */
  masterPrivateKey: string;

  /** Master chain code for BIP32 (hex, 64 chars) - optional for HMAC wallets */
  chainCode?: string;

  /** BIP39 mnemonic phrase - only present if source is "mnemonic" */
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
    /** Encrypted master private key (AES-256) */
    masterPrivateKey: string;
    /** Encrypted mnemonic (AES-256) - only if source is "mnemonic" */
    mnemonic?: string;
    /** Salt used for key derivation */
    salt: string;
    /** Number of PBKDF2 iterations */
    iterations: number;
  };

  /** Additional addresses beyond first (optional) */
  addresses?: WalletJSONAddress[];
}

export interface WalletJSONExportOptions {
  /** Password for encryption (optional) */
  password?: string;
  /** Include all addresses (default: only first address) */
  includeAllAddresses?: boolean;
  /** Number of addresses to include (if includeAllAddresses is false) */
  addressCount?: number;
}

export interface WalletJSONImportResult {
  success: boolean;
  wallet?: Wallet;
  source?: WalletJSONSource;
  derivationMode?: WalletJSONDerivationMode;
  /** Indicates if mnemonic was found in the JSON */
  hasMnemonic?: boolean;
  /** The decrypted mnemonic phrase (if available) */
  mnemonic?: string;
  message?: string;
  error?: string;
}

// Vesting types
export type VestingMode = "all" | "vested" | "unvested";

export interface ClassifiedUTXO extends UTXO {
  vestingStatus?: "vested" | "unvested" | "error";
  coinbaseHeight?: number | null;
}

export interface VestingBalances {
  vested: bigint;
  unvested: bigint;
  all: bigint;
}

export interface ClassificationResult {
  isVested: boolean;
  coinbaseHeight: number | null;
  error?: string;
}
