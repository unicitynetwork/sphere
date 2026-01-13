/**
 * Wallet Import/Export - Browser-specific code
 *
 * This file contains browser-specific code (FileReader, document.createElement, setTimeout).
 * Pure functions are in ../../sdk/ (wallet-json.ts, wallet-text.ts, wallet-dat.ts).
 */
import {
  // SDK functions
  hexToWIF,
  serializeWalletToJSON,
  parseWalletJSON,
  isJSONWalletFormat as sdkIsJSONWalletFormat,
  serializeWalletToText,
  serializeEncryptedWalletToText,
  parseWalletText,
  encryptForTextFormat,
  decryptFromTextFormat,
  parseWalletDat,
  decryptWalletDat,
  determineDerivationMode as sdkDetermineDerivationMode,
  determineSource as sdkDetermineSource,
  // Address key recovery
  recoverKeyWifHmac,
  recoverKeyBIP32AtPath,
  recoverKeyBIP32Scan,
  // Types
  type WalletJSON,
  type WalletJSONSource,
  type WalletJSONDerivationMode,
  type WalletJSONAddress,
  type WalletJSONExportOptions,
} from "../../sdk";
import type {
  Wallet,
  WalletAddress,
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

// Parsing and decryption functions are in ../../sdk/wallet-dat.ts
// - parseWalletDat, decryptWalletDat, decryptCMasterKey, decryptPrivateKey

/**
 * Restore wallet from wallet.dat (SQLite BIP32 format)
 * Supports both encrypted and unencrypted wallet.dat files
 * Uses SDK functions for parsing and decryption
 */
async function restoreFromWalletDat(file: File, password?: string): Promise<RestoreWalletResult> {
  try {
    const data = await readBinaryFile(file);

    // Use SDK to parse wallet.dat
    const parseResult = parseWalletDat(data);

    if (!parseResult.success || !parseResult.info) {
      return {
        success: false,
        wallet: {} as Wallet,
        error: parseResult.error || 'Failed to parse wallet.dat file'
      };
    }

    const { info } = parseResult;

    // Handle encrypted wallet
    if (info.isEncrypted) {
      if (!password) {
        return {
          success: false,
          wallet: {} as Wallet,
          error: 'This wallet.dat file is encrypted. Please provide a password to decrypt it.',
          isEncryptedDat: true
        };
      }

      // Decrypt using SDK (with yieldToMain for UI responsiveness)
      const decryptResult = await decryptWalletDat(data, password, yieldToMain);
      if (!decryptResult.success) {
        return {
          success: false,
          wallet: {} as Wallet,
          error: decryptResult.error || 'Failed to decrypt wallet.dat. The password may be incorrect.',
          isEncryptedDat: true
        };
      }

      // Successfully decrypted
      const wallet: Wallet = {
        masterPrivateKey: decryptResult.masterKey!,
        addresses: [],
        isEncrypted: false,
        encryptedMasterKey: '',
        childPrivateKey: null,
        isImportedAlphaWallet: true,
        masterChainCode: decryptResult.chainCode ?? null,
        chainCode: decryptResult.chainCode ?? undefined,
        descriptorPath: decryptResult.descriptorPath ?? undefined,
      };

      return {
        success: true,
        wallet,
        message: 'Encrypted wallet.dat decrypted and imported successfully!'
      };
    }

    // Unencrypted wallet - use parsed data directly
    if (!parseResult.masterKey) {
      return {
        success: false,
        wallet: {} as Wallet,
        error: 'No valid private keys found in wallet.dat file. The wallet might use an unsupported format.'
      };
    }

    // Determine import type for message
    let importType = 'wallet';
    if (info.isDescriptorWallet) {
      importType = 'descriptor wallet';
    } else if (info.hasHDChain) {
      importType = 'HD wallet';
    } else if (info.legacyKeys.length > 0) {
      importType = 'legacy wallet';
    }

    const wallet: Wallet = {
      masterPrivateKey: parseResult.masterKey,
      addresses: [],
      isEncrypted: false,
      encryptedMasterKey: '',
      childPrivateKey: null,
      isImportedAlphaWallet: true,
      masterChainCode: parseResult.chainCode ?? null,
      chainCode: parseResult.chainCode ?? undefined,
      descriptorPath: parseResult.descriptorPath ?? "84'/1'/0'",
    };

    return {
      success: true,
      wallet,
      message: `Wallet imported successfully from Alpha ${importType}! Note: The first address generated may differ from your original wallet's addresses due to derivation path differences.`
    };

  } catch (e) {
    console.error('Error importing wallet.dat:', e);
    return {
      success: false,
      wallet: {} as Wallet,
      error: 'Error importing wallet.dat: ' + (e instanceof Error ? e.message : String(e))
    };
  }
}

/**
 * Import wallet from backup file
 * Uses SDK parseWalletText for parsing, browser-specific decryption for compatibility
 */
export async function importWallet(
  file: File,
  password?: string
): Promise<RestoreWalletResult> {
  try {
    // Check for wallet.dat - use binary parser
    if (file.name.endsWith(".dat")) {
      return restoreFromWalletDat(file, password);
    }

    const fileContent = await file.text();

    // Use SDK to parse wallet text format
    const parseResult = parseWalletText(fileContent);

    if (!parseResult.success || !parseResult.data) {
      return {
        success: false,
        wallet: {} as Wallet,
        error: parseResult.error || "Could not parse wallet backup file.",
      };
    }

    const { data } = parseResult;
    let masterKey = data.masterPrivateKey;

    // Handle encrypted wallet - decrypt using SDK function
    if (data.isEncrypted) {
      if (!password) {
        return {
          success: false,
          wallet: {} as Wallet,
          error: "This is an encrypted wallet. Please enter the decryption password.",
        };
      }

      // Decrypt using SDK (original webwallet parameters)
      const decrypted = decryptFromTextFormat(masterKey, password);
      if (!decrypted) {
        return {
          success: false,
          wallet: {} as Wallet,
          error: "Failed to decrypt the wallet. The password may be incorrect.",
        };
      }
      masterKey = decrypted;
      console.log("Successfully decrypted master key:", masterKey.substring(0, 8) + "...");
    }

    // Determine wallet type
    const isImportedAlphaWallet = data.isBIP32 || !!data.chainCode;

    // Convert parsed addresses to WalletAddress format
    const parsedAddresses: WalletAddress[] = data.addresses.map((addr) => ({
      index: addr.index,
      address: addr.address,
      path: addr.path ?? null,
      createdAt: new Date().toISOString(),
    }));

    // Create wallet
    const wallet: Wallet = {
      masterPrivateKey: masterKey,
      addresses: parsedAddresses,
      isEncrypted: data.isEncrypted,
      encryptedMasterKey: data.isEncrypted ? data.masterPrivateKey : "",
      childPrivateKey: null,
      isImportedAlphaWallet,
      masterChainCode: data.chainCode ?? null,
      chainCode: data.chainCode ?? undefined,
      descriptorPath: data.descriptorPath ?? (isImportedAlphaWallet ? "84'/1'/0'" : null),
    };

    // For standard wallets, recover private keys for all addresses using SDK
    if (!isImportedAlphaWallet && parsedAddresses.length > 0) {
      for (let addrIdx = 0; addrIdx < wallet.addresses.length; addrIdx++) {
        const addr = wallet.addresses[addrIdx];

        // Use SDK function for WIF HMAC key recovery
        const result = recoverKeyWifHmac(wallet.masterPrivateKey, addr.address);

        if (!result.success || !result.key) {
          console.error('WALLET INTEGRITY CHECK FAILED');
          console.error('Address from file:', addr.address);
          return {
            success: false,
            wallet: {} as Wallet,
            error: `Wallet integrity check failed: ${result.error}`,
          };
        }

        console.log(`✓ Found correct derivation for address ${addrIdx + 1} at index ${result.key.index}!`);
        addr.privateKey = result.key.privateKey;
        addr.publicKey = result.key.publicKey;
        addr.path = result.key.path;
        addr.index = result.key.index;

        // Set childPrivateKey for first address (for backward compatibility)
        if (addrIdx === 0) {
          wallet.childPrivateKey = result.key.privateKey;
        }
      }
    }

    // For BIP32 wallets (Alpha wallet), recover private keys using SDK
    if (isImportedAlphaWallet && data.chainCode && parsedAddresses.length > 0) {
      for (let addrIdx = 0; addrIdx < wallet.addresses.length; addrIdx++) {
        const addr = wallet.addresses[addrIdx];

        // If address has path info, derive the key directly using SDK
        if (addr.path && addr.path.startsWith("m/")) {
          const result = recoverKeyBIP32AtPath(
            masterKey,
            data.chainCode,
            addr.path,
            addr.address
          );

          if (!result.success || !result.key) {
            console.error(`BIP32: ${result.error}`);
            return {
              success: false,
              wallet: {} as Wallet,
              error: `Wallet integrity check failed: ${result.error}`,
            };
          }

          console.log(`✓ BIP32: Recovered key for address ${addrIdx + 1} at path ${addr.path}`);
          addr.privateKey = result.key.privateKey;
          addr.publicKey = result.key.publicKey;
          addr.isChange = result.key.isChange;
        } else {
          // No path info - scan to find correct derivation using SDK
          console.warn(`BIP32: Address ${addrIdx + 1} has no path info, scanning...`);
          const basePath = data.descriptorPath || "84'/1'/0'";

          const result = recoverKeyBIP32Scan(
            masterKey,
            data.chainCode,
            addr.address,
            basePath
          );

          if (!result.success || !result.key) {
            console.error(`BIP32: ${result.error}`);
            return {
              success: false,
              wallet: {} as Wallet,
              error: result.error || `Could not find BIP32 derivation path for address ${addr.address}`,
            };
          }

          console.log(`✓ BIP32: Found address ${addrIdx + 1} at ${result.key.path}`);
          addr.privateKey = result.key.privateKey;
          addr.publicKey = result.key.publicKey;
          addr.path = result.key.path;
          addr.index = result.key.index;
          addr.isChange = result.key.isChange;
        }
      }
    }

    return {
      success: true,
      wallet,
      message: "Wallet restored successfully!",
    };
  } catch (e) {
    console.error("Error restoring wallet:", e);
    return {
      success: false,
      wallet: {} as Wallet,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Export wallet to text format
 * Uses SDK serialization with browser-specific encryption
 */
export function exportWallet(wallet: Wallet, options: ExportOptions = {}): string {
  const { password } = options;

  if (!wallet || !wallet.masterPrivateKey) {
    throw new Error("Invalid wallet - missing master private key");
  }

  const isBIP32 = !!(wallet.isImportedAlphaWallet && wallet.masterChainCode);
  const addresses = wallet.addresses.map((addr) => ({
    index: addr.index,
    address: addr.address,
    path: addr.path ?? undefined,
    isChange: addr.isChange,
  }));

  if (password) {
    // Encrypt using SDK function (original webwallet parameters)
    const encryptedMasterKey = encryptForTextFormat(wallet.masterPrivateKey, password);

    // Use SDK for text serialization
    return serializeEncryptedWalletToText({
      encryptedMasterKey,
      chainCode: wallet.masterChainCode ?? undefined,
      isBIP32,
      addresses,
    });
  }

  // Unencrypted - use SDK serialization
  return serializeWalletToText({
    masterPrivateKey: wallet.masterPrivateKey,
    masterPrivateKeyWIF: hexToWIF(wallet.masterPrivateKey),
    chainCode: wallet.masterChainCode ?? undefined,
    descriptorPath: wallet.descriptorPath ?? undefined,
    isBIP32,
    addresses,
  });
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
// JSON Export/Import Functions (v1.0)
// Uses functions from ../../sdk/wallet-json.ts
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
 * Supports all wallet types:
 * - Mnemonic-based (new BIP32 standard)
 * - File import with chain code (BIP32)
 * - File import without chain code (HMAC)
 * - wallet.dat import (descriptor/HD/legacy)
 *
 * Uses serializeWalletToJSON from SDK for core serialization.
 */
export function exportWalletToJSON(params: ExportToJSONParams): WalletJSON {
  const { wallet, mnemonic, importSource, options = {} } = params;
  const { includeAllAddresses = false, addressCount = 1 } = options;

  if (!wallet || !wallet.masterPrivateKey) {
    throw new Error("Invalid wallet - missing master private key");
  }

  const chainCode = wallet.chainCode || wallet.masterChainCode || undefined;
  const derivationMode = sdkDetermineDerivationMode({
    chainCode: wallet.chainCode,
    masterChainCode: wallet.masterChainCode,
  });
  const source = sdkDetermineSource({
    chainCode: wallet.chainCode,
    masterChainCode: wallet.masterChainCode,
    descriptorPath: wallet.descriptorPath,
    isBIP32: wallet.isBIP32,
    mnemonic,
    importSource,
  });

  // Prepare addresses for SDK if includeAllAddresses
  const addresses = includeAllAddresses && wallet.addresses.length > 0
    ? wallet.addresses.map((addr, idx) => ({
        address: addr.address,
        publicKey: addr.publicKey,
        path: addr.path || `m/44'/0'/${idx}'`,
        index: addr.index,
        isChange: addr.isChange,
      }))
    : undefined;

  // Use SDK function for serialization
  return serializeWalletToJSON({
    masterPrivateKey: wallet.masterPrivateKey,
    chainCode,
    mnemonic,
    derivationMode,
    source,
    descriptorPath: wallet.descriptorPath ?? undefined,
    addresses,
    options: {
      password: options.password,
      includeAllAddresses,
      addressCount,
    },
  });
}

/**
 * Import wallet from JSON format
 *
 * Supports:
 * - New JSON format (v1.0)
 * - Encrypted JSON files
 * - All source types (mnemonic, file_bip32, file_standard, dat_*)
 *
 * Uses parseWalletJSON from SDK for core parsing and validation.
 */
export async function importWalletFromJSON(
  jsonContent: string,
  password?: string
): Promise<WalletJSONImportResult> {
  // Use SDK function for parsing and validation
  const sdkResult = parseWalletJSON(jsonContent, password);

  if (!sdkResult.success) {
    return {
      success: false,
      error: sdkResult.error,
    };
  }

  // SDK parsed successfully - build L1 Wallet object
  const isBIP32 = sdkResult.derivationMode === "bip32";
  const isImportedAlphaWallet = sdkResult.source?.startsWith("dat_") || sdkResult.source === "file_bip32";

  const wallet: Wallet = {
    masterPrivateKey: sdkResult.masterPrivateKey!,
    addresses: [],
    isEncrypted: false,
    childPrivateKey: null,
    isBIP32,
    isImportedAlphaWallet,
  };

  if (sdkResult.chainCode) {
    wallet.chainCode = sdkResult.chainCode;
    wallet.masterChainCode = sdkResult.chainCode;
  }

  if (sdkResult.descriptorPath) {
    wallet.descriptorPath = sdkResult.descriptorPath;
  }

  // Add first address
  if (sdkResult.firstAddress) {
    wallet.addresses.push({
      address: sdkResult.firstAddress.address,
      publicKey: sdkResult.firstAddress.publicKey,
      path: sdkResult.firstAddress.path,
      index: sdkResult.firstAddress.index ?? 0,
      isChange: sdkResult.firstAddress.isChange,
      createdAt: new Date().toISOString(),
    });
  }

  // Add additional addresses
  if (sdkResult.addresses) {
    for (const addr of sdkResult.addresses) {
      wallet.addresses.push({
        address: addr.address,
        publicKey: addr.publicKey,
        path: addr.path,
        index: addr.index ?? wallet.addresses.length,
        isChange: addr.isChange,
        createdAt: new Date().toISOString(),
      });
    }
  }

  return {
    success: true,
    wallet,
    source: sdkResult.source,
    derivationMode: sdkResult.derivationMode,
    hasMnemonic: !!sdkResult.mnemonic,
    mnemonic: sdkResult.mnemonic,
    message: `Wallet imported successfully from JSON (source: ${sdkResult.source}, mode: ${sdkResult.derivationMode})`,
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
