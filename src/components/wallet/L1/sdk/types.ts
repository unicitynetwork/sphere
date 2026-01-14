import type { BaseWallet, BaseWalletAddress } from "../../sdk";

/**
 * L1 WalletAddress - alias for BaseWalletAddress
 */
export type WalletAddress = BaseWalletAddress;

/**
 * L1 Wallet extends BaseWallet with browser-specific fields
 */
export interface Wallet extends BaseWallet {
  addresses: WalletAddress[];  // Override with L1-specific WalletAddress
  /** Browser-specific: wallet is encrypted in localStorage */
  isEncrypted?: boolean;
  /** Browser-specific: encrypted master key for localStorage */
  encryptedMasterKey?: string;
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
  /** Indicates that the wallet.dat file is encrypted and requires a password */
  isEncryptedDat?: boolean;
}

export interface ExportOptions {
  password?: string;
  filename?: string;
}

// Re-export JSON wallet types from common SDK
export type {
  WalletJSONSource,
  WalletJSONDerivationMode,
  WalletJSONAddress,
  WalletJSON,
  WalletJSONExportOptions,
} from "../../sdk/types";

// L1-specific import result (includes Wallet object)
export interface WalletJSONImportResult {
  success: boolean;
  wallet?: Wallet;
  source?: import("../../sdk/types").WalletJSONSource;
  derivationMode?: import("../../sdk/types").WalletJSONDerivationMode;
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

