/**
 * Wallet Import/Export - L1-specific wrappers
 *
 * Uses SDK browser import/export with L1-specific type conversions.
 * Core implementation is in ../../sdk/browser/import-export.ts
 */
import {
  importWalletFromFile as sdkImportWalletFromFile,
  importWalletFromJSON as sdkImportWalletFromJSON,
  exportWalletToText as sdkExportWalletToText,
  exportWalletToJSON as sdkExportWalletToJSON,
  downloadTextFile,
  downloadJSON,
  isJSONWalletFormat as sdkIsJSONWalletFormat,
  type ImportWalletResult,
} from "../../sdk/browser/import-export";
import type {
  Wallet,
  RestoreWalletResult,
  ExportOptions,
  WalletJSON,
  WalletJSONSource,
  WalletJSONDerivationMode,
  WalletJSONAddress,
  WalletJSONExportOptions,
  WalletJSONImportResult,
} from "./types";

// Re-export types
export type {
  RestoreWalletResult,
  ExportOptions,
  WalletJSON,
  WalletJSONSource,
  WalletJSONDerivationMode,
  WalletJSONAddress,
  WalletJSONExportOptions,
  WalletJSONImportResult,
};

// ==========================================
// Conversion helpers
// ==========================================

/**
 * Convert SDK ImportWalletResult to L1 RestoreWalletResult
 */
function toRestoreWalletResult(sdkResult: ImportWalletResult): RestoreWalletResult {
  if (!sdkResult.success || !sdkResult.wallet) {
    return {
      success: false,
      wallet: {} as Wallet,
      error: sdkResult.error,
      isEncryptedDat: sdkResult.isEncryptedDat,
    };
  }

  const wallet: Wallet = {
    masterPrivateKey: sdkResult.wallet.masterPrivateKey,
    addresses: sdkResult.wallet.addresses.map((addr) => ({
      address: addr.address,
      publicKey: addr.publicKey,
      privateKey: addr.privateKey,
      path: addr.path,
      index: addr.index,
      isChange: addr.isChange,
      createdAt: new Date().toISOString(),
    })),
    chainCode: sdkResult.wallet.chainCode,
    masterChainCode: sdkResult.wallet.masterChainCode,
    isBIP32: sdkResult.wallet.isBIP32,
    descriptorPath: sdkResult.wallet.descriptorPath,
    childPrivateKey: sdkResult.wallet.childPrivateKey,
    isEncrypted: false,
    encryptedMasterKey: '',
    isImportedAlphaWallet: sdkResult.source?.startsWith('dat_') || sdkResult.source === 'file_bip32',
  };

  return {
    success: true,
    wallet,
    message: sdkResult.message,
  };
}

// ==========================================
// Import Functions
// ==========================================

/**
 * Import wallet from backup file
 */
export async function importWallet(
  file: File,
  password?: string
): Promise<RestoreWalletResult> {
  try {
    const sdkResult = await sdkImportWalletFromFile(file, password);
    return toRestoreWalletResult(sdkResult);
  } catch (e) {
    console.error("Error restoring wallet:", e);
    return {
      success: false,
      wallet: {} as Wallet,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ==========================================
// Export Functions
// ==========================================

/**
 * Export wallet to text format
 */
export function exportWallet(wallet: Wallet, options: ExportOptions = {}): string {
  const { password } = options;

  if (!wallet || !wallet.masterPrivateKey) {
    throw new Error("Invalid wallet - missing master private key");
  }

  return sdkExportWalletToText(
    {
      masterPrivateKey: wallet.masterPrivateKey,
      addresses: wallet.addresses.map(addr => ({
        address: addr.address,
        publicKey: addr.publicKey,
        privateKey: addr.privateKey,
        path: addr.path,
        index: addr.index,
        isChange: addr.isChange,
      })),
      chainCode: wallet.chainCode ?? wallet.masterChainCode ?? undefined,
      descriptorPath: wallet.descriptorPath ?? undefined,
      isBIP32: wallet.isImportedAlphaWallet && !!wallet.masterChainCode,
    },
    { password }
  );
}

/**
 * Download wallet file
 */
export function downloadWalletFile(
  content: string,
  filename: string = "alpha_wallet_backup.txt"
): void {
  const finalFilename = filename.endsWith(".txt") ? filename : filename + ".txt";
  downloadTextFile(content, finalFilename);
}

// ==========================================
// JSON Export/Import Functions
// ==========================================

export interface ExportToJSONParams {
  wallet: Wallet;
  mnemonic?: string;
  importSource?: "dat" | "file";
  options?: WalletJSONExportOptions;
}

/**
 * Export wallet to JSON format
 */
export function exportWalletToJSON(params: ExportToJSONParams): WalletJSON {
  const { wallet, mnemonic, importSource, options = {} } = params;

  if (!wallet || !wallet.masterPrivateKey) {
    throw new Error("Invalid wallet - missing master private key");
  }

  return sdkExportWalletToJSON(
    {
      masterPrivateKey: wallet.masterPrivateKey,
      addresses: wallet.addresses.map(addr => ({
        address: addr.address,
        publicKey: addr.publicKey,
        privateKey: addr.privateKey,
        path: addr.path,
        index: addr.index,
        isChange: addr.isChange,
      })),
      chainCode: wallet.chainCode ?? wallet.masterChainCode ?? undefined,
      descriptorPath: wallet.descriptorPath ?? undefined,
      isBIP32: wallet.isBIP32 ?? (wallet.isImportedAlphaWallet && !!wallet.masterChainCode),
    },
    {
      password: options.password,
      mnemonic,
      importSource,
    }
  );
}

/**
 * Import wallet from JSON format
 */
export async function importWalletFromJSON(
  jsonContent: string,
  password?: string
): Promise<WalletJSONImportResult> {
  const sdkResult = await sdkImportWalletFromJSON(jsonContent, password);

  if (!sdkResult.success || !sdkResult.wallet) {
    return {
      success: false,
      error: sdkResult.error,
    };
  }

  const wallet: Wallet = {
    masterPrivateKey: sdkResult.wallet.masterPrivateKey,
    addresses: sdkResult.wallet.addresses.map(addr => ({
      address: addr.address,
      publicKey: addr.publicKey,
      privateKey: addr.privateKey,
      path: addr.path,
      index: addr.index,
      isChange: addr.isChange,
      createdAt: new Date().toISOString(),
    })),
    chainCode: sdkResult.wallet.chainCode,
    masterChainCode: sdkResult.wallet.masterChainCode,
    isBIP32: sdkResult.wallet.isBIP32,
    descriptorPath: sdkResult.wallet.descriptorPath,
    childPrivateKey: sdkResult.wallet.childPrivateKey,
    isEncrypted: false,
    isImportedAlphaWallet: sdkResult.source?.startsWith('dat_') || sdkResult.source === 'file_bip32',
  };

  return {
    success: true,
    wallet,
    source: sdkResult.source,
    derivationMode: sdkResult.derivationMode,
    hasMnemonic: !!sdkResult.mnemonic,
    mnemonic: sdkResult.mnemonic,
    message: sdkResult.message,
  };
}

/**
 * Download wallet as JSON file
 */
export function downloadWalletJSON(
  json: WalletJSON,
  filename: string = "alpha_wallet_backup.json"
): void {
  downloadJSON(json, filename);
}

/**
 * Check if file content is JSON wallet format
 */
export function isJSONWalletFormat(content: string): boolean {
  return sdkIsJSONWalletFormat(content);
}
