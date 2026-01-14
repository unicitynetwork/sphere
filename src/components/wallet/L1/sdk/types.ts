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

// ==========================================
// Path-based address utilities
// ==========================================

/**
 * Parse BIP32 path components from a derivation path string
 * @param path - Full path like "m/84'/1'/0'/0/5" or "m/44'/0'/0'/1/3"
 * @returns { chain: number, index: number } where chain=0 is external, chain=1 is change
 *          Returns null if path is invalid
 *
 * Examples:
 *   "m/84'/1'/0'/0/5" -> { chain: 0, index: 5 } (external address 5)
 *   "m/84'/1'/0'/1/3" -> { chain: 1, index: 3 } (change address 3)
 */
export function parsePathComponents(path: string): { chain: number; index: number } | null {
  // Match paths like m/84'/1'/0'/0/5 or m/44'/0'/0'/1/3
  const match = path.match(/m\/\d+'\/\d+'\/\d+'\/(\d+)\/(\d+)/);
  if (!match) return null;
  return { chain: parseInt(match[1], 10), index: parseInt(match[2], 10) };
}

/**
 * Check if a BIP32 path represents a change address (chain=1)
 * @param path - Full BIP32 path string
 * @returns true if this is a change address path
 */
export function isChangePath(path: string): boolean {
  const parsed = parsePathComponents(path);
  return parsed?.chain === 1;
}

/**
 * Get display-friendly index from path (for UI display only)
 * @param path - Full BIP32 path string
 * @returns The address index number, or 0 if invalid
 */
export function getIndexFromPath(path: string): number {
  const parsed = parsePathComponents(path);
  return parsed?.index ?? 0;
}

/**
 * Convert a BIP32 path to a DOM-safe ID string
 * Replaces characters that are invalid in DOM IDs:
 * - ' (apostrophe) -> 'h' (hardened marker)
 * - / (forward slash) -> '-' (dash)
 *
 * @param path - Full BIP32 path like "m/84'/1'/0'/0/5"
 * @returns DOM-safe ID like "m-84h-1h-0h-0-5"
 *
 * Examples:
 *   "m/84'/1'/0'/0/5" -> "m-84h-1h-0h-0-5"
 *   "m/44'/0'/0'/1/3" -> "m-44h-0h-0h-1-3"
 */
export function pathToDOMId(path: string): string {
  return path.replace(/'/g, "h").replace(/\//g, "-");
}

/**
 * Convert a DOM-safe ID back to a BIP32 path string
 * Reverses the transformation done by pathToDOMId:
 * - 'h' -> ' (apostrophe for hardened)
 * - '-' -> / (forward slash)
 *
 * @param encoded - DOM-safe ID like "m-84h-1h-0h-0-5"
 * @returns BIP32 path like "m/84'/1'/0'/0/5"
 *
 * Examples:
 *   "m-84h-1h-0h-0-5" -> "m/84'/1'/0'/0/5"
 *   "m-44h-0h-0h-1-3" -> "m/44'/0'/0'/1/3"
 */
export function domIdToPath(encoded: string): string {
  // Split by dash, then restore path format
  const parts = encoded.split("-");
  return parts
    .map((part, idx) => {
      if (idx === 0) return part; // 'm' stays as-is
      // Restore hardened marker: ends with 'h' -> ends with "'"
      return part.endsWith("h") ? `${part.slice(0, -1)}'` : part;
    })
    .join("/");
}
