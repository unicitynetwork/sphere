/**
 * Wallet Text Format Serialization
 *
 * Pure functions for serializing/deserializing wallet data to text format.
 * Compatible with original webwallet backup format.
 *
 * Includes encryption/decryption using original webwallet parameters
 * (alpha_wallet_salt, SHA1, 100000 iterations) for backwards compatibility.
 */

import CryptoJS from 'crypto-js';
import { extractFromText } from '../core/utils';

// ==========================================
// Types
// ==========================================

export interface WalletTextData {
  masterPrivateKey: string;
  chainCode?: string;
  descriptorPath?: string;
  isBIP32: boolean;
  isEncrypted: boolean;
  addresses: Array<{
    index: number;
    address: string;
    path?: string;
  }>;
}

export interface WalletTextExportOptions {
  /** Password for encryption (optional) */
  password?: string;
}

export interface WalletTextExportParams {
  masterPrivateKey: string;
  masterPrivateKeyWIF: string;
  chainCode?: string;
  descriptorPath?: string;
  isBIP32: boolean;
  addresses: Array<{
    index: number;
    address: string;
    path?: string;
    isChange?: boolean;
  }>;
  encryptedMasterKey?: string;
}

export interface WalletTextParseResult {
  success: boolean;
  data?: WalletTextData;
  error?: string;
}

// ==========================================
// Constants
// ==========================================

const WALLET_HEADER = 'UNICITY WALLET DETAILS';
const WALLET_SEPARATOR = '===========================';

// Original webwallet encryption parameters (for backwards compatibility)
const LEGACY_SALT = 'alpha_wallet_salt';
const LEGACY_ITERATIONS = 100000;

// ==========================================
// Encryption/Decryption (legacy webwallet compatible)
// ==========================================

/**
 * Derive encryption key using original webwallet parameters
 * Uses SHA1 for backwards compatibility
 */
function deriveLegacyKey(password: string): string {
  return CryptoJS.PBKDF2(password, LEGACY_SALT, {
    keySize: 256 / 32,
    iterations: LEGACY_ITERATIONS,
    hasher: CryptoJS.algo.SHA1, // SHA1 for compatibility with original webwallet
  }).toString();
}

/**
 * Encrypt master key for text format export
 * Uses original webwallet parameters for compatibility
 */
export function encryptForTextFormat(masterPrivateKey: string, password: string): string {
  const key = deriveLegacyKey(password);
  return CryptoJS.AES.encrypt(masterPrivateKey, key).toString();
}

/**
 * Decrypt master key from text format
 * Uses original webwallet parameters for compatibility
 *
 * @param encryptedKey - The encrypted master key string
 * @param password - User password
 * @returns Decrypted master key or null if decryption fails
 */
export function decryptFromTextFormat(encryptedKey: string, password: string): string | null {
  try {
    const key = deriveLegacyKey(password);
    const decrypted = CryptoJS.AES.decrypt(encryptedKey, key);
    const result = decrypted.toString(CryptoJS.enc.Utf8);
    return result || null;
  } catch {
    return null;
  }
}

// ==========================================
// Export Functions
// ==========================================

/**
 * Format addresses for text export
 */
function formatAddresses(
  addresses: WalletTextExportParams['addresses'],
  isBIP32: boolean
): string {
  return addresses
    .map((addr, index) => {
      const path = addr.path || (isBIP32
        ? `m/84'/1'/0'/${addr.isChange ? 1 : 0}/${addr.index}`
        : `m/44'/0'/${addr.index}'`);
      return `Address ${index + 1}: ${addr.address} (Path: ${path})`;
    })
    .join('\n');
}

/**
 * Serialize wallet to text format (unencrypted)
 */
export function serializeWalletToText(params: WalletTextExportParams): string {
  const {
    masterPrivateKey,
    masterPrivateKeyWIF,
    chainCode,
    descriptorPath,
    isBIP32,
    addresses,
  } = params;

  const addressesText = formatAddresses(addresses, isBIP32);

  let masterKeySection: string;

  if (isBIP32 && chainCode) {
    masterKeySection = `MASTER PRIVATE KEY (keep secret!):
${masterPrivateKey}

MASTER PRIVATE KEY IN WIF FORMAT (for importprivkey command):
${masterPrivateKeyWIF}

MASTER CHAIN CODE (for BIP32 HD wallet compatibility):
${chainCode}

DESCRIPTOR PATH: ${descriptorPath || "84'/1'/0'"}

WALLET TYPE: BIP32 hierarchical deterministic wallet

ENCRYPTION STATUS: Not encrypted
This key is in plaintext and not protected. Anyone with this file can access your wallet.`;
  } else {
    masterKeySection = `MASTER PRIVATE KEY (keep secret!):
${masterPrivateKey}

MASTER PRIVATE KEY IN WIF FORMAT (for importprivkey command):
${masterPrivateKeyWIF}

WALLET TYPE: Standard wallet (HMAC-based)

ENCRYPTION STATUS: Not encrypted
This key is in plaintext and not protected. Anyone with this file can access your wallet.`;
  }

  return `${WALLET_HEADER}
${WALLET_SEPARATOR}

${masterKeySection}

YOUR ADDRESSES:
${addressesText}

Generated on: ${new Date().toLocaleString()}

WARNING: Keep your master private key safe and secure.
Anyone with your master private key can access all your funds.`;
}

/**
 * Serialize wallet to text format (encrypted)
 */
export function serializeEncryptedWalletToText(params: {
  encryptedMasterKey: string;
  chainCode?: string;
  isBIP32: boolean;
  addresses: WalletTextExportParams['addresses'];
}): string {
  const { encryptedMasterKey, chainCode, isBIP32, addresses } = params;

  const addressesText = formatAddresses(addresses, isBIP32);

  let encryptedContent = `ENCRYPTED MASTER KEY (password protected):
${encryptedMasterKey}`;

  if (isBIP32 && chainCode) {
    encryptedContent += `

MASTER CHAIN CODE (for BIP32 HD wallet compatibility):
${chainCode}

WALLET TYPE: BIP32 hierarchical deterministic wallet`;
  } else {
    encryptedContent += `

WALLET TYPE: Standard wallet (HMAC-based)`;
  }

  return `${WALLET_HEADER}
${WALLET_SEPARATOR}

${encryptedContent}

ENCRYPTION STATUS: Encrypted with password
To use this key, you will need the password you set in the wallet.

YOUR ADDRESSES:
${addressesText}

Generated on: ${new Date().toLocaleString()}

WARNING: Keep your master private key safe and secure.
Anyone with your master private key can access all your funds.`;
}

// ==========================================
// Parse Functions
// ==========================================

/**
 * Parse wallet from text format
 * Returns parsed data without creating Wallet object
 */
export function parseWalletText(content: string): WalletTextParseResult {
  try {
    const isEncrypted = content.includes('ENCRYPTED MASTER KEY');

    let masterPrivateKey: string | null = null;

    if (isEncrypted) {
      // Extract encrypted key - caller will need to decrypt
      masterPrivateKey = extractFromText(
        content,
        /ENCRYPTED MASTER KEY \(password protected\):\s*([^\n]+)/
      );

      if (!masterPrivateKey) {
        return {
          success: false,
          error: 'Could not find the encrypted master key in the backup file.',
        };
      }
    } else {
      // Extract unencrypted master key
      masterPrivateKey = extractFromText(
        content,
        /MASTER PRIVATE KEY \(keep secret!\):\s*([^\n]+)/
      );

      if (!masterPrivateKey) {
        return {
          success: false,
          error: 'Could not find the master private key in the backup file.',
        };
      }
    }

    // Extract chain code
    const chainCode = extractFromText(
      content,
      /MASTER CHAIN CODE \(for (?:BIP32 HD|Alpha) wallet compatibility\):\s*([^\n]+)/
    );

    // Check wallet type
    const isBIP32 =
      content.includes('WALLET TYPE: BIP32 hierarchical deterministic wallet') ||
      content.includes('WALLET TYPE: Alpha descriptor wallet') ||
      !!chainCode;

    // Extract descriptor path
    const descriptorPath = extractFromText(content, /DESCRIPTOR PATH:\s*([^\n]+)/);

    // Parse addresses
    const addresses: WalletTextData['addresses'] = [];
    const addressSection = content.match(
      /YOUR ADDRESSES:\s*\n([\s\S]*?)(?:\n\nGenerated on:|$)/
    );

    if (addressSection?.[1]) {
      const addressLines = addressSection[1].trim().split('\n');
      for (const line of addressLines) {
        const addressMatch = line.match(
          /Address\s+(\d+):\s+(\w+)\s*(?:\(Path:\s*([^)]*)\))?/
        );
        if (addressMatch) {
          const index = parseInt(addressMatch[1]) - 1;
          const address = addressMatch[2];
          const path = addressMatch[3] === 'undefined' ? undefined : addressMatch[3];
          addresses.push({ index, address, path: path ?? undefined });
        }
      }
    }

    return {
      success: true,
      data: {
        masterPrivateKey,
        chainCode: chainCode ?? undefined,
        descriptorPath: descriptorPath ?? undefined,
        isBIP32,
        isEncrypted,
        addresses,
      },
    };
  } catch (e) {
    return {
      success: false,
      error: `Error parsing wallet text: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/**
 * Check if content is in wallet text format
 */
export function isWalletTextFormat(content: string): boolean {
  return (
    content.includes(WALLET_HEADER) &&
    (content.includes('MASTER PRIVATE KEY') || content.includes('ENCRYPTED MASTER KEY'))
  );
}
