/**
 * Wallet Import/Export - Pure SDK functions
 *
 * Universal import/export functions that work on any platform.
 * No browser APIs (FileReader, document, setTimeout).
 *
 * Platform-specific wrappers handle IO (File/fs/AsyncStorage).
 */

import {
  parseWalletText,
  decryptFromTextFormat,
  serializeWalletToText,
  serializeEncryptedWalletToText,
  encryptForTextFormat,
} from './wallet-text';
import {
  parseWalletJSON,
  isJSONWalletFormat,
  serializeWalletToJSON,
  determineDerivationMode,
  determineSource,
} from './wallet-json';

// Re-export isJSONWalletFormat for convenience
export { isJSONWalletFormat } from './wallet-json';
import {
  parseWalletDat,
  decryptWalletDat,
} from './wallet-dat';
import {
  recoverKeyWifHmac,
  recoverKeyBIP32AtPath,
  recoverKeyBIP32Scan,
} from '../address/address';
import { hexToWIF } from '../core/crypto';
import { extractBasePathFromFullPath } from '../core/derivation';
import type {
  BaseWallet,
  BaseWalletAddress,
  WalletJSONSource,
  WalletJSONDerivationMode,
} from '../types';

// ==========================================
// Types
// ==========================================

/**
 * Result of importing a wallet from content
 */
export interface ImportWalletResult {
  success: boolean;
  wallet?: BaseWallet;
  /** Source type of the imported wallet */
  source?: WalletJSONSource;
  /** Derivation mode used */
  derivationMode?: WalletJSONDerivationMode;
  /** Mnemonic phrase if available */
  mnemonic?: string;
  /** Success message */
  message?: string;
  /** Error message if failed */
  error?: string;
  /** True if wallet.dat is encrypted and needs password */
  isEncryptedDat?: boolean;
}

/**
 * Options for importing wallet
 */
export interface ImportWalletOptions {
  /** Password for decryption */
  password?: string;
  /** Yield callback for UI responsiveness (optional) */
  yieldCallback?: () => Promise<void>;
  /** Content type hint (optional, auto-detected if not provided) */
  contentType?: 'text' | 'json' | 'dat';
}

/**
 * Options for exporting wallet
 */
export interface ExportWalletOptions {
  /** Password for encryption (optional) */
  password?: string;
  /** Export format */
  format?: 'text' | 'json';
  /** Include mnemonic (only for JSON format) */
  mnemonic?: string;
  /** Import source hint (for JSON export) */
  importSource?: 'dat' | 'file';
}

// ==========================================
// Import Functions
// ==========================================

/**
 * Detect content type from content
 */
function detectContentType(content: string | Uint8Array): 'text' | 'json' | 'dat' {
  if (content instanceof Uint8Array) {
    // Binary content - check for SQLite signature or BDB
    const signature = String.fromCharCode(...content.slice(0, 16));
    if (signature.startsWith('SQLite format 3')) {
      return 'dat';
    }
    // Check for BDB format (older wallet.dat)
    if (content[0] === 0x00 && content[1] === 0x05) {
      return 'dat';
    }
    // Try to parse as text
    try {
      const text = new TextDecoder().decode(content);
      if (isJSONWalletFormat(text)) return 'json';
      return 'text';
    } catch {
      return 'dat';
    }
  }

  // String content
  if (isJSONWalletFormat(content)) return 'json';
  return 'text';
}

/**
 * Import wallet from text format
 */
async function importFromText(
  content: string,
  password?: string
): Promise<ImportWalletResult> {
  const parseResult = parseWalletText(content);

  if (!parseResult.success || !parseResult.data) {
    return {
      success: false,
      error: parseResult.error || 'Could not parse wallet backup file.',
    };
  }

  const { data } = parseResult;
  let masterKey = data.masterPrivateKey;

  // Handle encrypted wallet
  if (data.isEncrypted) {
    if (!password) {
      return {
        success: false,
        error: 'This is an encrypted wallet. Please enter the decryption password.',
      };
    }

    const decrypted = decryptFromTextFormat(masterKey, password);
    if (!decrypted) {
      return {
        success: false,
        error: 'Failed to decrypt the wallet. The password may be incorrect.',
      };
    }
    masterKey = decrypted;
  }

  // Build addresses array
  const addresses: BaseWalletAddress[] = data.addresses.map((addr) => ({
    index: addr.index,
    address: addr.address,
    path: addr.path ?? null,
  }));

  // Recover private keys for addresses
  const isBIP32 = data.isBIP32 || !!data.chainCode;

  if (!isBIP32 && addresses.length > 0) {
    // WIF HMAC derivation - recover keys using SDK
    for (const addr of addresses) {
      const result = recoverKeyWifHmac(masterKey, addr.address);
      if (!result.success || !result.key) {
        return {
          success: false,
          error: `Wallet integrity check failed: ${result.error}`,
        };
      }
      addr.privateKey = result.key.privateKey;
      addr.publicKey = result.key.publicKey;
      addr.path = result.key.path;
      addr.index = result.key.index;
    }
  } else if (isBIP32 && data.chainCode && addresses.length > 0) {
    // BIP32 derivation - recover keys using SDK
    for (const addr of addresses) {
      if (addr.path && addr.path.startsWith('m/')) {
        const result = recoverKeyBIP32AtPath(
          masterKey,
          data.chainCode,
          addr.path,
          addr.address
        );
        if (!result.success || !result.key) {
          return {
            success: false,
            error: `Wallet integrity check failed: ${result.error}`,
          };
        }
        addr.privateKey = result.key.privateKey;
        addr.publicKey = result.key.publicKey;
        addr.isChange = result.key.isChange;
      } else {
        // No path info - scan to find correct derivation
        const basePath = data.descriptorPath || "84'/1'/0'";
        const result = recoverKeyBIP32Scan(
          masterKey,
          data.chainCode,
          addr.address,
          basePath
        );
        if (!result.success || !result.key) {
          return {
            success: false,
            error: result.error || `Could not find BIP32 derivation path for address ${addr.address}`,
          };
        }
        addr.privateKey = result.key.privateKey;
        addr.publicKey = result.key.publicKey;
        addr.path = result.key.path;
        addr.index = result.key.index;
        addr.isChange = result.key.isChange;
      }
    }
  }

  // Determine derivation mode and source
  const derivationMode = determineDerivationMode({
    chainCode: data.chainCode,
  });
  const source = determineSource({
    chainCode: data.chainCode,
    isBIP32: data.isBIP32,
  });

  // Infer descriptorPath from recovered address path if not explicitly set
  // This is needed because webwallet doesn't include DESCRIPTOR PATH in TXT exports
  // e.g., "m/84'/1'/0'/0/0" → "84'/1'/0'"
  let inferredDescriptorPath = data.descriptorPath ?? null;
  if (!inferredDescriptorPath && isBIP32 && addresses.length > 0 && addresses[0].path) {
    inferredDescriptorPath = extractBasePathFromFullPath(addresses[0].path);
  }

  const wallet: BaseWallet = {
    masterPrivateKey: masterKey,
    addresses,
    chainCode: data.chainCode,
    masterChainCode: data.chainCode,
    isBIP32,
    descriptorPath: inferredDescriptorPath,
    childPrivateKey: addresses[0]?.privateKey ?? null,
  };

  return {
    success: true,
    wallet,
    source,
    derivationMode,
    message: 'Wallet restored successfully!',
  };
}

/**
 * Import wallet from JSON format
 */
async function importFromJSON(
  content: string,
  password?: string
): Promise<ImportWalletResult> {
  const sdkResult = parseWalletJSON(content, password);

  if (!sdkResult.success) {
    return {
      success: false,
      error: sdkResult.error,
    };
  }

  const isBIP32 = sdkResult.derivationMode === 'bip32';

  // Build addresses from first address + additional addresses
  const addresses: BaseWalletAddress[] = [];

  if (sdkResult.firstAddress) {
    addresses.push({
      address: sdkResult.firstAddress.address,
      publicKey: sdkResult.firstAddress.publicKey,
      path: sdkResult.firstAddress.path,
      index: sdkResult.firstAddress.index ?? 0,
      isChange: sdkResult.firstAddress.isChange,
    });
  }

  if (sdkResult.addresses) {
    for (const addr of sdkResult.addresses) {
      addresses.push({
        address: addr.address,
        publicKey: addr.publicKey,
        path: addr.path,
        index: addr.index ?? addresses.length,
        isChange: addr.isChange,
      });
    }
  }

  const wallet: BaseWallet = {
    masterPrivateKey: sdkResult.masterPrivateKey!,
    addresses,
    chainCode: sdkResult.chainCode,
    masterChainCode: sdkResult.chainCode,
    isBIP32,
    descriptorPath: sdkResult.descriptorPath ?? null,
    childPrivateKey: null,
  };

  return {
    success: true,
    wallet,
    source: sdkResult.source,
    derivationMode: sdkResult.derivationMode,
    mnemonic: sdkResult.mnemonic,
    message: `Wallet imported successfully from JSON (source: ${sdkResult.source}, mode: ${sdkResult.derivationMode})`,
  };
}

/**
 * Import wallet from wallet.dat format
 */
async function importFromDat(
  data: Uint8Array,
  password?: string,
  yieldCallback?: () => Promise<void>
): Promise<ImportWalletResult> {
  // Parse wallet.dat
  const parseResult = parseWalletDat(data);

  if (!parseResult.success || !parseResult.info) {
    return {
      success: false,
      error: parseResult.error || 'Failed to parse wallet.dat file',
    };
  }

  const { info } = parseResult;

  // Handle encrypted wallet
  if (info.isEncrypted) {
    if (!password) {
      return {
        success: false,
        error: 'This wallet.dat file is encrypted. Please provide a password to decrypt it.',
        isEncryptedDat: true,
      };
    }

    // Decrypt using SDK
    const decryptResult = await decryptWalletDat(data, password, yieldCallback);
    if (!decryptResult.success) {
      return {
        success: false,
        error: decryptResult.error || 'Failed to decrypt wallet.dat. The password may be incorrect.',
        isEncryptedDat: true,
      };
    }

    const wallet: BaseWallet = {
      masterPrivateKey: decryptResult.masterKey!,
      addresses: [],
      chainCode: decryptResult.chainCode ?? undefined,
      masterChainCode: decryptResult.chainCode ?? undefined,
      isBIP32: true,
      descriptorPath: decryptResult.descriptorPath ?? undefined,
      childPrivateKey: null,
    };

    return {
      success: true,
      wallet,
      source: info.isDescriptorWallet ? 'dat_descriptor' : (info.hasHDChain ? 'dat_hd' : 'dat_legacy'),
      derivationMode: 'bip32',
      message: 'Encrypted wallet.dat decrypted and imported successfully!',
    };
  }

  // Unencrypted wallet
  if (!parseResult.masterKey) {
    return {
      success: false,
      error: 'No valid private keys found in wallet.dat file. The wallet might use an unsupported format.',
    };
  }

  // Determine import type
  let importType = 'wallet';
  let source: WalletJSONSource = 'dat_legacy';
  if (info.isDescriptorWallet) {
    importType = 'descriptor wallet';
    source = 'dat_descriptor';
  } else if (info.hasHDChain) {
    importType = 'HD wallet';
    source = 'dat_hd';
  } else if (info.legacyKeys.length > 0) {
    importType = 'legacy wallet';
    source = 'dat_legacy';
  }

  const wallet: BaseWallet = {
    masterPrivateKey: parseResult.masterKey,
    addresses: [],
    chainCode: parseResult.chainCode ?? undefined,
    masterChainCode: parseResult.chainCode ?? undefined,
    isBIP32: true,
    descriptorPath: parseResult.descriptorPath ?? "84'/1'/0'",
    childPrivateKey: null,
  };

  return {
    success: true,
    wallet,
    source,
    derivationMode: 'bip32',
    message: `Wallet imported successfully from Alpha ${importType}! Note: The first address generated may differ from your original wallet's addresses due to derivation path differences.`,
  };
}

/**
 * Import wallet from content (universal function)
 *
 * Works with any content type (text, JSON, wallet.dat binary).
 * Auto-detects format if not specified.
 *
 * @param content - Wallet content (string or Uint8Array)
 * @param options - Import options
 * @returns Import result with BaseWallet
 */
export async function importWalletFromContent(
  content: string | Uint8Array,
  options: ImportWalletOptions = {}
): Promise<ImportWalletResult> {
  const { password, yieldCallback, contentType } = options;

  // Detect content type if not specified
  const type = contentType ?? detectContentType(content);

  switch (type) {
    case 'json':
      if (content instanceof Uint8Array) {
        return importFromJSON(new TextDecoder().decode(content), password);
      }
      return importFromJSON(content, password);

    case 'dat':
      if (typeof content === 'string') {
        return {
          success: false,
          error: 'wallet.dat content must be binary (Uint8Array)',
        };
      }
      return importFromDat(content, password, yieldCallback);

    case 'text':
    default:
      if (content instanceof Uint8Array) {
        return importFromText(new TextDecoder().decode(content), password);
      }
      return importFromText(content, password);
  }
}

// ==========================================
// Export Functions
// ==========================================

/**
 * Parameters for exporting wallet
 */
export interface ExportWalletParams {
  /** Master private key (hex) */
  masterPrivateKey: string;
  /** Addresses to include */
  addresses: BaseWalletAddress[];
  /** Chain code for BIP32 wallets */
  chainCode?: string;
  /** Descriptor path for BIP32 wallets */
  descriptorPath?: string;
  /** Is BIP32 wallet */
  isBIP32?: boolean;
  /** Mnemonic phrase (for JSON export) */
  mnemonic?: string;
  /** Import source hint (for JSON export) */
  importSource?: 'dat' | 'file';
}

/**
 * Export wallet to text format
 *
 * @param params - Wallet data
 * @param options - Export options
 * @returns Serialized wallet text
 */
export function exportWalletToText(
  params: ExportWalletParams,
  options: ExportWalletOptions = {}
): string {
  const { password } = options;
  const { masterPrivateKey, addresses, chainCode, descriptorPath, isBIP32 } = params;

  if (!masterPrivateKey) {
    throw new Error('Invalid wallet - missing master private key');
  }

  const formattedAddresses = addresses.map((addr) => ({
    index: addr.index,
    address: addr.address,
    path: addr.path ?? undefined,
    isChange: addr.isChange,
  }));

  if (password) {
    const encryptedMasterKey = encryptForTextFormat(masterPrivateKey, password);

    return serializeEncryptedWalletToText({
      encryptedMasterKey,
      chainCode,
      isBIP32: isBIP32 ?? !!chainCode,
      addresses: formattedAddresses,
    });
  }

  return serializeWalletToText({
    masterPrivateKey,
    masterPrivateKeyWIF: hexToWIF(masterPrivateKey),
    chainCode,
    descriptorPath,
    isBIP32: isBIP32 ?? !!chainCode,
    addresses: formattedAddresses,
  });
}

/**
 * Export wallet to JSON format
 *
 * @param params - Wallet data
 * @param options - Export options
 * @returns WalletJSON object
 */
export function exportWalletToJSON(
  params: ExportWalletParams,
  options: ExportWalletOptions = {}
): ReturnType<typeof serializeWalletToJSON> {
  const { password, mnemonic, importSource } = options;
  const { masterPrivateKey, addresses, chainCode, descriptorPath, isBIP32 } = params;

  if (!masterPrivateKey) {
    throw new Error('Invalid wallet - missing master private key');
  }

  const derivationMode = determineDerivationMode({ chainCode });
  const source = determineSource({
    chainCode,
    descriptorPath,
    isBIP32,
    mnemonic,
    importSource,
  });

  const formattedAddresses = addresses.map((addr, idx) => ({
    address: addr.address,
    publicKey: addr.publicKey,
    path: addr.path || `m/44'/0'/${idx}'`,
    index: addr.index,
    isChange: addr.isChange,
  }));

  return serializeWalletToJSON({
    masterPrivateKey,
    chainCode,
    mnemonic,
    derivationMode,
    source,
    descriptorPath,
    addresses: formattedAddresses.length > 0 ? formattedAddresses : undefined,
    options: {
      password,
      includeAllAddresses: formattedAddresses.length > 0,
    },
  });
}

/**
 * Export wallet to specified format
 *
 * @param params - Wallet data
 * @param options - Export options (including format)
 * @returns Serialized wallet (string for text, object for JSON)
 */
export function exportWallet(
  params: ExportWalletParams,
  options: ExportWalletOptions = {}
): string | ReturnType<typeof serializeWalletToJSON> {
  const { format = 'text' } = options;

  if (format === 'json') {
    return exportWalletToJSON(params, options);
  }

  return exportWalletToText(params, options);
}
