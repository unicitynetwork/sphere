/**
 * KeyManager - Platform-independent key management logic
 *
 * This module provides pure functions for wallet key operations without
 * any browser-specific dependencies (no localStorage, no CryptoJS).
 *
 * Supports TWO derivation modes for webwallet compatibility:
 * 1. Standard BIP32 - When chain code is available (full HD wallet)
 * 2. WIF HMAC - When only master key is available (simple wallet)
 *
 * Same private keys are used for:
 * - L1 Alpha addresses (P2WPKH bech32)
 * - L3 Unicity identities (secp256k1)
 * - Nostr keypairs (secp256k1/schnorr)
 * - IPFS keys (HKDF-derived Ed25519)
 *
 * Usage:
 * ```typescript
 * import {
 *   parseWalletFileContent,
 *   formatWalletExport,
 *   validatePrivateKey,
 *   type WalletFileData,
 * } from '@unicity/wallet-sdk';
 *
 * // Parse wallet file
 * const data = parseWalletFileContent(fileContent);
 * if (data.masterKey) {
 *   // Use the parsed data
 * }
 *
 * // Export wallet to text
 * const text = formatWalletExport({
 *   masterKey: '...',
 *   chainCode: '...',
 *   address0: { l1Address: '...', publicKey: '...' },
 *   basePath: "m/84'/1'/0'",
 * });
 * ```
 */

import elliptic from "elliptic";
import {
  generateHDAddressBIP32,
  generateAddressFromMasterKey,
  generateHDAddress,
} from "../address";
import {
  type DerivationMode,
  DEFAULT_BASE_PATH,
} from "../types";

const ec = new elliptic.ec("secp256k1");

// ==========================================
// Types
// ==========================================

export type WalletSource = "mnemonic" | "file" | "unknown";

export interface DerivedAddress {
  privateKey: string;
  publicKey: string;
  l1Address: string;
  index: number;
  path: string;
  isChange?: boolean;
}

export interface WalletInfo {
  source: WalletSource;
  hasMnemonic: boolean;
  hasChainCode: boolean;
  derivationMode: DerivationMode;
  address0: string | null;
}

/**
 * Data parsed from a wallet file
 */
export interface WalletFileData {
  masterKey: string;
  chainCode: string | null;
  derivationMode: DerivationMode;
}

/**
 * Options for formatting wallet export
 */
export interface WalletExportOptions {
  masterKey: string;
  chainCode: string;
  address0: {
    l1Address: string;
    publicKey: string;
  };
  basePath: string;
  mnemonic?: string;
}

/**
 * Wallet state for KeyManager operations
 */
export interface KeyManagerState {
  mnemonic: string | null;
  masterKey: string | null;
  chainCode: string | null;
  derivationMode: DerivationMode;
  basePath: string;
  source: WalletSource;
}

// ==========================================
// Validation Functions
// ==========================================

/**
 * Validate a private key by trying to create a keypair
 * @param privateKey - Hex string of the private key
 * @returns true if valid, false otherwise
 */
export function validatePrivateKey(privateKey: string): boolean {
  try {
    ec.keyFromPrivate(privateKey, "hex");
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate and normalize a private key
 * @param privateKey - Hex string of the private key
 * @returns Normalized lowercase hex string
 * @throws Error if invalid
 */
export function normalizePrivateKey(privateKey: string): string {
  const normalized = privateKey.toLowerCase();
  if (!validatePrivateKey(normalized)) {
    throw new Error("Invalid master private key format");
  }
  return normalized;
}

// ==========================================
// File Parsing Functions
// ==========================================

/**
 * Parse wallet file content to extract master key and chain code
 *
 * Supports two formats:
 * 1. With Chain Code (BIP32 mode): Uses standard HD derivation
 * 2. Without Chain Code (WIF HMAC mode): Uses simple HMAC derivation
 *
 * @param content - Raw text content of wallet file
 * @returns Parsed wallet data
 * @throws Error if master key not found or invalid
 */
export function parseWalletFileContent(content: string): WalletFileData {
  const lines = content.split("\n").map((l) => l.trim());

  let masterKey: string | null = null;
  let chainCode: string | null = null;
  let expectMasterKey = false;
  let expectChainCode = false;

  for (const line of lines) {
    // Check if this line is a label for master key (value on next line)
    // Handles formats like: "MASTER PRIVATE KEY (keep secret!):" or "MASTER PRIVATE KEY:"
    if (/MASTER\s*PRIVATE\s*KEY/i.test(line) && !/[a-fA-F0-9]{64}/.test(line)) {
      expectMasterKey = true;
      continue;
    }

    // Check if this line is a label for chain code (value on next line)
    // Handles formats like: "MASTER CHAIN CODE (for BIP32...):" or "MASTER CHAIN CODE:"
    if (/MASTER\s*CHAIN\s*CODE/i.test(line) && !/[a-fA-F0-9]{64}/.test(line)) {
      expectChainCode = true;
      continue;
    }

    // If we're expecting a master key and this line is a 64-char hex string
    if (expectMasterKey && /^[a-fA-F0-9]{64}$/.test(line)) {
      masterKey = line.toLowerCase();
      expectMasterKey = false;
      continue;
    }

    // If we're expecting a chain code and this line is a 64-char hex string
    if (expectChainCode && /^[a-fA-F0-9]{64}$/.test(line)) {
      chainCode = line.toLowerCase();
      expectChainCode = false;
      continue;
    }

    // Also try same-line format: "Master Private Key: <hex>"
    const masterMatch = line.match(/(?:Master\s*(?:Private\s*)?Key|masterPriv)[:\s]+([a-fA-F0-9]{64})/i);
    const chainMatch = line.match(/(?:Chain\s*Code|chainCode)[:\s]+([a-fA-F0-9]{64})/i);

    if (masterMatch) {
      masterKey = masterMatch[1].toLowerCase();
    }
    if (chainMatch) {
      chainCode = chainMatch[1].toLowerCase();
    }

    // Reset expectations if we hit a non-hex line
    if (!/^[a-fA-F0-9]{64}$/.test(line)) {
      expectMasterKey = false;
      expectChainCode = false;
    }
  }

  if (!masterKey) {
    throw new Error("Could not find master private key in file");
  }

  // Validate key
  if (!validatePrivateKey(masterKey)) {
    throw new Error("Invalid master private key format");
  }

  // Determine derivation mode based on chain code presence
  const derivationMode: DerivationMode = chainCode ? "bip32" : "wif_hmac";

  return {
    masterKey,
    chainCode,
    derivationMode,
  };
}

// ==========================================
// Export Formatting Functions
// ==========================================

/**
 * Format wallet data for text export (compatible with webwallet)
 *
 * @param options - Wallet data to export
 * @returns Formatted text string
 */
export function formatWalletExport(options: WalletExportOptions): string {
  const { masterKey, chainCode, address0, basePath, mnemonic } = options;

  let output = `# Alpha Wallet Export\n`;
  output += `# Generated: ${new Date().toISOString()}\n`;
  output += `#\n`;
  output += `# WARNING: Keep this file secure! Anyone with this data can access your funds.\n`;
  output += `#\n\n`;
  output += `Master Private Key: ${masterKey}\n`;
  output += `Chain Code: ${chainCode}\n`;
  output += `\n`;
  output += `# First address (${basePath}/0/0):\n`;
  output += `Address: ${address0.l1Address}\n`;
  output += `Public Key: ${address0.publicKey}\n`;

  if (mnemonic) {
    output += `\n# Recovery Phrase (12 words):\n`;
    output += `Mnemonic: ${mnemonic}\n`;
  }

  return output;
}

// ==========================================
// Address Derivation Functions
// ==========================================

/**
 * Derive address from a full BIP32 path string
 * This is the ONLY method for address derivation - PATH is the single identifier
 *
 * @param state - Current wallet state
 * @param path - Full path like "m/84'/1'/0'/0/5" or "m/44'/0'/0'/1/3" or "m/44'/0'/0'" (HMAC style)
 * @returns Derived address information
 * @throws Error if wallet not initialized or invalid path
 */
export function deriveAddressFromPath(
  state: KeyManagerState,
  path: string
): DerivedAddress {
  if (!state.masterKey) {
    throw new Error("Wallet not initialized");
  }

  let index: number;
  let isChange: boolean;

  // Parse path to extract chain and index
  // Try 5-level BIP32 first: m/84'/1'/0'/0/5 or m/44'/0'/0'/1/3
  const bip32Match = path.match(/m\/(\d+)'\/(\d+)'\/(\d+)'\/(\d+)\/(\d+)/);
  if (bip32Match) {
    const chain = parseInt(bip32Match[4], 10);  // 0=external, 1=change
    index = parseInt(bip32Match[5], 10);
    isChange = chain === 1;
  } else {
    // Try 3-level HMAC path: m/44'/0'/0' (Standard wallet format)
    const hmacMatch = path.match(/m\/(\d+)'\/(\d+)'\/(\d+)'/);
    if (hmacMatch) {
      // In HMAC paths, the last hardened component is the index
      index = parseInt(hmacMatch[3], 10);
      isChange = false;  // HMAC wallets don't have change addresses
    } else {
      throw new Error(`Invalid BIP32 path: ${path}`);
    }
  }

  if (state.derivationMode === "bip32" && state.chainCode) {
    // Standard BIP32 derivation using wallet's base path (e.g., m/84'/1'/0'/0/{index})
    const result = generateHDAddressBIP32(
      state.masterKey,
      state.chainCode,
      index,
      state.basePath,  // Use wallet's stored base path instead of hardcoded default
      isChange  // Pass isChange to use correct chain (0=external, 1=change)
    );

    return {
      privateKey: result.privateKey,
      publicKey: result.publicKey,
      l1Address: result.address,
      index: result.index,
      path: result.path,
      isChange,
    };
  } else if (state.derivationMode === "legacy_hmac" && state.chainCode) {
    // Legacy Sphere HMAC: HMAC-SHA512(chainCode, masterKey || index)
    // Note: Legacy mode doesn't support change addresses, but we track the flag anyway
    const result = generateHDAddress(
      state.masterKey,
      state.chainCode,
      index
    );

    return {
      privateKey: result.privateKey,
      publicKey: result.publicKey,
      l1Address: result.address,
      index: result.index,
      path: result.path,
      isChange,
    };
  } else {
    // WIF HMAC derivation: HMAC-SHA512(masterKey, "m/44'/0'/{index}'")
    // Note: WIF mode doesn't support change addresses, but we track the flag anyway
    const result = generateAddressFromMasterKey(state.masterKey, index);

    return {
      privateKey: result.privateKey,
      publicKey: result.publicKey,
      l1Address: result.address,
      index: result.index,
      path: result.path,
      isChange,
    };
  }
}

/**
 * Get the default address path (first external address)
 * Returns path like "m/44'/0'/0'/0/0" based on wallet's base path
 *
 * @param basePath - The wallet's base derivation path
 * @returns Full path for the first external address
 */
export function getDefaultAddressPath(basePath: string = DEFAULT_BASE_PATH): string {
  return `${basePath}/0/0`;
}

/**
 * Get wallet info from state
 *
 * @param state - Current wallet state
 * @returns Wallet information
 */
export function getWalletInfo(state: KeyManagerState): WalletInfo {
  let address0: string | null = null;
  try {
    if (state.masterKey) {
      const defaultPath = getDefaultAddressPath(state.basePath);
      address0 = deriveAddressFromPath(state, defaultPath).l1Address;
    }
  } catch {
    // Ignore errors
  }

  return {
    source: state.source,
    hasMnemonic: state.mnemonic !== null,
    hasChainCode: state.chainCode !== null,
    derivationMode: state.derivationMode,
    address0,
  };
}

/**
 * Check if wallet state is properly initialized
 *
 * @param state - Current wallet state
 * @returns true if wallet is ready to use
 */
export function isWalletInitialized(state: KeyManagerState): boolean {
  // For BIP32 and legacy_hmac modes, we need both master key and chain code
  // For WIF HMAC mode, we only need master key
  if (state.derivationMode === "bip32" || state.derivationMode === "legacy_hmac") {
    return state.masterKey !== null && state.chainCode !== null;
  }
  return state.masterKey !== null;
}

/**
 * Create initial empty wallet state
 *
 * @returns Empty wallet state
 */
export function createEmptyState(): KeyManagerState {
  return {
    mnemonic: null,
    masterKey: null,
    chainCode: null,
    derivationMode: "bip32",
    basePath: DEFAULT_BASE_PATH,
    source: "unknown",
  };
}

/**
 * Create wallet state from file data
 *
 * @param fileData - Parsed file data
 * @param basePath - Optional custom base path
 * @returns Wallet state
 */
export function createStateFromFileData(
  fileData: WalletFileData,
  basePath?: string
): KeyManagerState {
  return {
    mnemonic: null,
    masterKey: fileData.masterKey,
    chainCode: fileData.chainCode,
    derivationMode: fileData.derivationMode,
    basePath: basePath || DEFAULT_BASE_PATH,
    source: "file",
  };
}
