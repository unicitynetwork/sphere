/**
 * Wallet JSON Serialization
 *
 * Pure functions for serializing/deserializing wallet data to JSON format.
 * No browser APIs (FileReader, document, localStorage).
 */

import CryptoJS from 'crypto-js';
import elliptic from 'elliptic';
import { deriveKeyAtPath } from '../core/derivation';
import { publicKeyToAddress } from '../address/address';
import { bytesToHex, isValidPrivateKey } from '../core/utils';
import type {
  WalletJSON,
  WalletJSONAddress,
  WalletJSONDerivationMode,
  WalletJSONSource,
  WalletJSONExportOptions,
  WalletJSONImportResult,
} from '../types';

const ec = new elliptic.ec('secp256k1');

// ==========================================
// Constants
// ==========================================

const JSON_WALLET_VERSION = '1.0' as const;
const JSON_WALLET_WARNING = 'Keep this file secure! Anyone with this data can access your funds.';
const PBKDF2_ITERATIONS = 100000;
const PBKDF2_SALT_PREFIX = 'unicity_wallet_json_';

// ==========================================
// Encryption helpers (JSON-specific)
// ==========================================

function generateSalt(): string {
  const randomBytes = new Uint8Array(16);
  crypto.getRandomValues(randomBytes);
  return PBKDF2_SALT_PREFIX + bytesToHex(randomBytes);
}

function deriveEncryptionKey(password: string, salt: string): string {
  return CryptoJS.PBKDF2(password, salt, {
    keySize: 256 / 32,
    iterations: PBKDF2_ITERATIONS,
    hasher: CryptoJS.algo.SHA256,
  }).toString();
}

function encryptWithPassword(data: string, password: string, salt: string): string {
  const key = deriveEncryptionKey(password, salt);
  return CryptoJS.AES.encrypt(data, key).toString();
}

function decryptWithPassword(encrypted: string, password: string, salt: string): string | null {
  try {
    const key = deriveEncryptionKey(password, salt);
    const decrypted = CryptoJS.AES.decrypt(encrypted, key);
    const result = decrypted.toString(CryptoJS.enc.Utf8);
    return result || null;
  } catch {
    return null;
  }
}

// ==========================================
// Address generation for export
// ==========================================

/**
 * Generate address from master key for JSON export
 */
export function generateAddressForJSON(
  masterKey: string,
  chainCode: string | null | undefined,
  derivationMode: WalletJSONDerivationMode,
  index: number,
  descriptorPath?: string | null
): WalletJSONAddress {
  const witnessVersion = 0;

  if (derivationMode === 'bip32' && chainCode) {
    // BIP32 derivation
    const basePath = descriptorPath || "44'/0'/0'";
    const fullPath = `m/${basePath}/0/${index}`;
    const derived = deriveKeyAtPath(masterKey, chainCode, fullPath);
    const keyPair = ec.keyFromPrivate(derived.privateKey);
    const publicKey = keyPair.getPublic(true, 'hex');
    const address = publicKeyToAddress(publicKey, 'alpha', witnessVersion);

    return {
      address,
      publicKey,
      path: fullPath,
      index,
    };
  } else {
    // WIF HMAC derivation
    const derivationPath = `m/44'/0'/${index}'`;
    const hmacInput = CryptoJS.enc.Hex.parse(masterKey);
    const hmac = CryptoJS.HmacSHA512(hmacInput, CryptoJS.enc.Utf8.parse(derivationPath)).toString();
    const childKey = hmac.substring(0, 64);
    const keyPair = ec.keyFromPrivate(childKey);
    const publicKey = keyPair.getPublic(true, 'hex');
    const address = publicKeyToAddress(publicKey, 'alpha', witnessVersion);

    return {
      address,
      publicKey,
      path: derivationPath,
      index,
    };
  }
}

// ==========================================
// Helper functions for determining wallet type
// ==========================================

export interface DetermineDerivationModeParams {
  chainCode?: string | null;
  masterChainCode?: string | null;
}

/**
 * Determine derivation mode from wallet properties
 * ChainCode is REQUIRED for BIP32 derivation
 */
export function determineDerivationMode(params: DetermineDerivationModeParams): WalletJSONDerivationMode {
  if (params.chainCode || params.masterChainCode) {
    return 'bip32';
  }
  return 'wif_hmac';
}

export interface DetermineSourceParams {
  chainCode?: string | null;
  masterChainCode?: string | null;
  descriptorPath?: string | null;
  isBIP32?: boolean;
  mnemonic?: string;
  importSource?: 'dat' | 'file';
}

/**
 * Determine source type from wallet properties
 */
export function determineSource(params: DetermineSourceParams): WalletJSONSource {
  // If mnemonic is provided, it's from mnemonic
  if (params.mnemonic) {
    return 'mnemonic';
  }

  // If imported from dat file
  if (params.importSource === 'dat') {
    if (params.descriptorPath) {
      return 'dat_descriptor';
    }
    if (params.isBIP32 || params.chainCode || params.masterChainCode) {
      return 'dat_hd';
    }
    return 'dat_legacy';
  }

  // Imported from txt file
  if (params.chainCode || params.masterChainCode) {
    return 'file_bip32';
  }
  return 'file_standard';
}

// ==========================================
// Export functions
// ==========================================

export interface SerializeToJSONParams {
  masterPrivateKey: string;
  chainCode?: string;
  mnemonic?: string;
  derivationMode: WalletJSONDerivationMode;
  source: WalletJSONSource;
  descriptorPath?: string;
  addresses?: Array<{
    address: string;
    publicKey?: string;
    path?: string;
    index: number;
    isChange?: boolean;
  }>;
  options?: WalletJSONExportOptions;
}

/**
 * Serialize wallet data to JSON format
 *
 * Pure function - no browser APIs, can run anywhere.
 */
export function serializeWalletToJSON(params: SerializeToJSONParams): WalletJSON {
  const {
    masterPrivateKey,
    chainCode,
    mnemonic,
    derivationMode,
    source,
    descriptorPath,
    addresses,
    options = {},
  } = params;

  const { password, includeAllAddresses = false, addressCount = 1 } = options;

  if (!masterPrivateKey) {
    throw new Error('Invalid wallet - missing master private key');
  }

  // Generate first address for verification
  const firstAddress = generateAddressForJSON(
    masterPrivateKey,
    chainCode,
    derivationMode,
    0,
    descriptorPath
  );

  // Build base JSON structure
  const json: WalletJSON = {
    version: JSON_WALLET_VERSION,
    generated: new Date().toISOString(),
    warning: JSON_WALLET_WARNING,
    masterPrivateKey,
    derivationMode,
    source,
    firstAddress,
  };

  // Add chain code if available
  if (chainCode) {
    json.chainCode = chainCode;
  }

  // Add mnemonic if available (and not encrypted)
  if (mnemonic && !password) {
    json.mnemonic = mnemonic;
  }

  // Add descriptor path for BIP32 wallets
  if (descriptorPath) {
    json.descriptorPath = descriptorPath;
  }

  // Handle encryption
  if (password) {
    const salt = generateSalt();
    json.encrypted = {
      masterPrivateKey: encryptWithPassword(masterPrivateKey, password, salt),
      salt,
      iterations: PBKDF2_ITERATIONS,
    };

    if (mnemonic) {
      json.encrypted.mnemonic = encryptWithPassword(mnemonic, password, salt);
    }

    // Remove plaintext sensitive data when encrypted
    delete json.masterPrivateKey;
    delete json.mnemonic;
  }

  // Add additional addresses if requested
  if (includeAllAddresses && addresses && addresses.length > 0) {
    json.addresses = addresses.map((addr, idx) => ({
      address: addr.address,
      publicKey: addr.publicKey || '',
      path: addr.path || `m/44'/0'/${idx}'`,
      index: addr.index,
      isChange: addr.isChange,
    }));
  } else if (addressCount > 1) {
    const additionalAddresses: WalletJSONAddress[] = [];
    for (let i = 1; i < addressCount; i++) {
      additionalAddresses.push(
        generateAddressForJSON(masterPrivateKey, chainCode, derivationMode, i, descriptorPath)
      );
    }
    if (additionalAddresses.length > 0) {
      json.addresses = additionalAddresses;
    }
  }

  return json;
}

/**
 * Convert WalletJSON to string
 */
export function stringifyWalletJSON(json: WalletJSON, pretty: boolean = true): string {
  return pretty ? JSON.stringify(json, null, 2) : JSON.stringify(json);
}

// ==========================================
// Import functions
// ==========================================

/**
 * Parse and validate wallet JSON string
 *
 * Pure function - no browser APIs, can run anywhere.
 * Returns parsed data without creating L1 Wallet object.
 */
export function parseWalletJSON(
  jsonContent: string,
  password?: string
): WalletJSONImportResult {
  try {
    const json = JSON.parse(jsonContent) as WalletJSON;

    // Validate version
    if (json.version !== '1.0') {
      return {
        success: false,
        error: `Unsupported wallet JSON version: ${json.version}. Expected 1.0`,
      };
    }

    let masterPrivateKey: string;
    let mnemonic: string | undefined;

    // Handle encrypted wallet
    if (json.encrypted) {
      if (!password) {
        return {
          success: false,
          error: 'This wallet is encrypted. Please provide a password.',
        };
      }

      const decryptedKey = decryptWithPassword(
        json.encrypted.masterPrivateKey,
        password,
        json.encrypted.salt
      );

      if (!decryptedKey) {
        return {
          success: false,
          error: 'Failed to decrypt wallet. The password may be incorrect.',
        };
      }

      masterPrivateKey = decryptedKey;

      // Decrypt mnemonic if present
      if (json.encrypted.mnemonic) {
        const decryptedMnemonic = decryptWithPassword(
          json.encrypted.mnemonic,
          password,
          json.encrypted.salt
        );
        if (decryptedMnemonic) {
          mnemonic = decryptedMnemonic;
        }
      }
    } else {
      // Unencrypted wallet
      if (!json.masterPrivateKey) {
        return {
          success: false,
          error: 'Invalid wallet JSON - missing master private key',
        };
      }
      masterPrivateKey = json.masterPrivateKey;
      mnemonic = json.mnemonic;
    }

    // Validate private key
    if (!isValidPrivateKey(masterPrivateKey)) {
      return {
        success: false,
        error: 'Invalid master private key in wallet JSON',
      };
    }

    // Verify first address matches
    const verifyAddress = generateAddressForJSON(
      masterPrivateKey,
      json.chainCode,
      json.derivationMode,
      0,
      json.descriptorPath
    );

    if (verifyAddress.address !== json.firstAddress.address) {
      return {
        success: false,
        error: `Wallet verification failed: derived address (${verifyAddress.address}) does not match expected (${json.firstAddress.address})`,
      };
    }

    return {
      success: true,
      masterPrivateKey,
      chainCode: json.chainCode,
      mnemonic,
      source: json.source,
      derivationMode: json.derivationMode,
      descriptorPath: json.descriptorPath,
      firstAddress: json.firstAddress,
      addresses: json.addresses,
    };
  } catch (e) {
    if (e instanceof SyntaxError) {
      return {
        success: false,
        error: 'Invalid JSON format. Please provide a valid wallet JSON file.',
      };
    }
    return {
      success: false,
      error: `Error parsing wallet: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/**
 * Check if content is JSON wallet format
 */
export function isJSONWalletFormat(content: string): boolean {
  try {
    const json = JSON.parse(content);
    return json.version === '1.0' && (json.masterPrivateKey || json.encrypted);
  } catch {
    return false;
  }
}
