/**
 * Browser Import/Export Helpers
 *
 * Browser-specific wrappers around SDK import/export functions.
 * Handles File API, FileReader, Blob, and download functionality.
 */

import {
  importWalletFromContent,
  exportWalletToText as sdkExportWalletToText,
  exportWalletToJSON as sdkExportWalletToJSON,
  isJSONWalletFormat as sdkIsJSONWalletFormat,
  type ImportWalletResult,
  type ImportWalletOptions,
  type ExportWalletParams,
} from '../serialization/import-export';
import type {
  BaseWallet,
  WalletJSON,
  WalletJSONExportOptions,
} from '../types';

// Re-export SDK types
export type { ImportWalletResult, ImportWalletOptions };
export type { WalletJSON, WalletJSONExportOptions } from '../types';

// ==========================================
// Browser-specific helpers
// ==========================================

/**
 * Read binary file as Uint8Array (browser-specific: FileReader)
 */
export function readBinaryFile(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(new Uint8Array(e.target?.result as ArrayBuffer));
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Read text file as string (browser-specific: FileReader)
 */
export function readTextFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target?.result as string);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

/**
 * Yield to the event loop to prevent UI freeze (browser-specific)
 */
export function yieldToMain(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

// ==========================================
// Conversion helpers
// ==========================================

/**
 * Convert BaseWallet to ExportWalletParams
 */
function walletToExportParams(wallet: BaseWallet): ExportWalletParams {
  return {
    masterPrivateKey: wallet.masterPrivateKey,
    addresses: wallet.addresses,
    chainCode: wallet.chainCode ?? wallet.masterChainCode,
    descriptorPath: wallet.descriptorPath ?? undefined,
    isBIP32: wallet.isBIP32,
  };
}

// ==========================================
// Import Functions
// ==========================================

/**
 * Import wallet from File object
 *
 * Handles both binary (.dat) and text files.
 */
export async function importWalletFromFile(
  file: File,
  password?: string
): Promise<ImportWalletResult> {
  try {
    const isDat = file.name.endsWith('.dat');
    const content = isDat
      ? await readBinaryFile(file)
      : await file.text();

    return await importWalletFromContent(content, {
      password,
      yieldCallback: yieldToMain,
      contentType: isDat ? 'dat' : undefined,
    });
  } catch (e) {
    console.error('Error importing wallet from file:', e);
    return {
      success: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Import wallet from JSON string
 */
export async function importWalletFromJSON(
  jsonContent: string,
  password?: string
): Promise<ImportWalletResult> {
  return importWalletFromContent(jsonContent, {
    password,
    contentType: 'json',
  });
}

// ==========================================
// Export Functions
// ==========================================

export interface ExportToTextOptions {
  password?: string;
}

/**
 * Export wallet to text format
 */
export function exportWalletToText(
  wallet: BaseWallet,
  options: ExportToTextOptions = {}
): string {
  if (!wallet || !wallet.masterPrivateKey) {
    throw new Error('Invalid wallet - missing master private key');
  }

  return sdkExportWalletToText(walletToExportParams(wallet), { password: options.password });
}

export interface ExportToJSONOptions extends WalletJSONExportOptions {
  /** BIP39 mnemonic phrase (if available) */
  mnemonic?: string;
  /** Source of import: "dat" for wallet.dat, "file" for txt file */
  importSource?: 'dat' | 'file';
}

/**
 * Export wallet to JSON format
 */
export function exportWalletToJSON(
  wallet: BaseWallet,
  options: ExportToJSONOptions = {}
): WalletJSON {
  if (!wallet || !wallet.masterPrivateKey) {
    throw new Error('Invalid wallet - missing master private key');
  }

  const params = walletToExportParams(wallet);
  return sdkExportWalletToJSON(params, options);
}

// ==========================================
// Download Functions
// ==========================================

/**
 * Download content as text file
 */
export function downloadTextFile(
  content: string,
  filename: string = 'wallet_backup.txt',
  mimeType: string = 'text/plain'
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();

  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

/**
 * Download wallet as text file
 */
export function downloadWalletText(
  wallet: BaseWallet,
  filename: string = 'alpha_wallet_backup.txt',
  options: ExportToTextOptions = {}
): void {
  const content = exportWalletToText(wallet, options);
  const finalFilename = filename.endsWith('.txt') ? filename : filename + '.txt';
  downloadTextFile(content, finalFilename);
}

/**
 * Download wallet as JSON file
 */
export function downloadWalletJSON(
  wallet: BaseWallet,
  filename: string = 'alpha_wallet_backup.json',
  options: ExportToJSONOptions = {}
): void {
  const json = exportWalletToJSON(wallet, options);
  const content = JSON.stringify(json, null, 2);
  const finalFilename = filename.endsWith('.json') ? filename : filename + '.json';
  downloadTextFile(content, finalFilename, 'application/json');
}

/**
 * Download pre-built JSON object
 */
export function downloadJSON(
  json: WalletJSON,
  filename: string = 'alpha_wallet_backup.json'
): void {
  const content = JSON.stringify(json, null, 2);
  const finalFilename = filename.endsWith('.json') ? filename : filename + '.json';
  downloadTextFile(content, finalFilename, 'application/json');
}

// ==========================================
// Format Detection
// ==========================================

/**
 * Check if file content is JSON wallet format
 */
export function isJSONWalletFormat(content: string): boolean {
  return sdkIsJSONWalletFormat(content);
}

/**
 * Detect wallet file format from File object
 */
export function detectWalletFileFormat(file: File): 'dat' | 'json' | 'text' | 'unknown' {
  const name = file.name.toLowerCase();

  if (name.endsWith('.dat')) return 'dat';
  if (name.endsWith('.json')) return 'json';
  if (name.endsWith('.txt')) return 'text';

  // Check MIME type
  if (file.type === 'application/json') return 'json';
  if (file.type === 'text/plain') return 'text';

  return 'unknown';
}
