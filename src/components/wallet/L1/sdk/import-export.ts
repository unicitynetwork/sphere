/**
 * Wallet Import/Export - Browser-specific wrappers
 *
 * This file contains browser-specific code (FileReader, document.createElement, setTimeout).
 * Core import/export logic is in ../../sdk/import-export.ts
 */
import {
  // SDK universal import/export
  importWalletFromContent,
  exportWalletToText as sdkExportWalletToText,
  exportWalletToJSON as sdkExportWalletToJSON,
  // Types
  type ImportWalletResult,
  type WalletJSON,
  type WalletJSONSource,
  type WalletJSONDerivationMode,
  type WalletJSONAddress,
  type WalletJSONExportOptions,
  // For backwards compatibility
  isJSONWalletFormat as sdkIsJSONWalletFormat,
} from "../../sdk";
import type {
  Wallet,
  RestoreWalletResult,
  ExportOptions,
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
// Browser-specific helpers
// ==========================================

/**
 * Read binary file as Uint8Array (browser-specific: FileReader)
 */
function readBinaryFile(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(new Uint8Array(e.target?.result as ArrayBuffer));
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Yield to the event loop to prevent UI freeze (browser-specific)
 */
function yieldToMain(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

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

  // Convert BaseWallet to L1 Wallet
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
    masterChainCode: sdkResult.wallet.masterChainCode ?? null,
    isBIP32: sdkResult.wallet.isBIP32,
    descriptorPath: sdkResult.wallet.descriptorPath ?? null,
    childPrivateKey: sdkResult.wallet.childPrivateKey ?? null,
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
// Import Functions (Browser wrappers)
// ==========================================

/**
 * Import wallet from backup file
 *
 * Browser-specific wrapper around SDK importWalletFromContent.
 * Handles File object reading and UI responsiveness.
 */
export async function importWallet(
  file: File,
  password?: string
): Promise<RestoreWalletResult> {
  try {
    // Determine content type and read file
    const isDat = file.name.endsWith(".dat");
    const content = isDat
      ? await readBinaryFile(file)
      : await file.text();

    // Use SDK function
    const sdkResult = await importWalletFromContent(content, {
      password,
      yieldCallback: yieldToMain,
      contentType: isDat ? 'dat' : undefined,
    });

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
// Export Functions (Browser wrappers)
// ==========================================

/**
 * Export wallet to text format
 *
 * Browser-specific wrapper around SDK exportWalletToText.
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
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  const finalFilename = filename.endsWith(".txt") ? filename : filename + ".txt";
  a.download = finalFilename;
  document.body.appendChild(a);
  a.click();

  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

// ==========================================
// JSON Export/Import Functions
// ==========================================

export interface ExportToJSONParams {
  /** The wallet to export */
  wallet: Wallet;
  /** BIP39 mnemonic phrase (if available) */
  mnemonic?: string;
  /** Source of import: "dat" for wallet.dat, "file" for txt file */
  importSource?: "dat" | "file";
  /** Export options */
  options?: WalletJSONExportOptions;
}

/**
 * Export wallet to JSON format
 *
 * Browser-specific wrapper around SDK exportWalletToJSON.
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
      mnemonic,
      importSource,
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
 *
 * Browser-specific wrapper around SDK importWalletFromContent.
 */
export async function importWalletFromJSON(
  jsonContent: string,
  password?: string
): Promise<WalletJSONImportResult> {
  const sdkResult = await importWalletFromContent(jsonContent, {
    password,
    contentType: 'json',
  });

  if (!sdkResult.success || !sdkResult.wallet) {
    return {
      success: false,
      error: sdkResult.error,
    };
  }

  // Convert to L1 Wallet
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
    masterChainCode: sdkResult.wallet.masterChainCode ?? null,
    isBIP32: sdkResult.wallet.isBIP32,
    descriptorPath: sdkResult.wallet.descriptorPath ?? null,
    childPrivateKey: sdkResult.wallet.childPrivateKey ?? null,
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
  const content = JSON.stringify(json, null, 2);
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  const finalFilename = filename.endsWith(".json") ? filename : filename + ".json";
  a.download = finalFilename;
  document.body.appendChild(a);
  a.click();

  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

/**
 * Check if file content is JSON wallet format
 * Re-exports SDK function for backwards compatibility
 */
export function isJSONWalletFormat(content: string): boolean {
  return sdkIsJSONWalletFormat(content);
}
