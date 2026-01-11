/**
 * Wallet Import/Export - Strict copy of index.html logic
 */
import CryptoJS from "crypto-js";
import { hexToWIF } from "./crypto";
import { deriveKeyAtPath } from "./address";
import type {
  Wallet,
  WalletAddress,
  RestoreWalletResult,
  ExportOptions,
  WalletJSON,
  WalletJSONSource,
  WalletJSONDerivationMode,
  WalletJSONAddress,
  WalletJSONExportOptions,
  WalletJSONImportResult,
} from "./types";
import { publicKeyToAddress, ec } from "../../shared/utils/cryptoUtils";

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

/**
 * Helper: bytes to hex string
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Helper: read binary file as Uint8Array
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
 * Helper: find pattern in Uint8Array
 */
function findPattern(data: Uint8Array, pattern: Uint8Array, startIndex: number = 0): number {
  for (let i = startIndex; i <= data.length - pattern.length; i++) {
    let found = true;
    for (let j = 0; j < pattern.length; j++) {
      if (data[i + j] !== pattern[j]) {
        found = false;
        break;
      }
    }
    if (found) return i;
  }
  return -1;
}

/**
 * Validate if a hex string is a valid secp256k1 private key
 */
function isValidPrivateKey(hex: string): boolean {
  try {
    const n = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');
    const key = BigInt('0x' + hex);
    return key > 0n && key < n;
  } catch {
    return false;
  }
}

/**
 * Yield to the event loop to prevent UI freeze
 */
function yieldToMain(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * Convert Uint8Array to CryptoJS WordArray via hex encoding
 * This is the most reliable cross-platform method
 */
function uint8ArrayToWordArray(u8arr: Uint8Array): CryptoJS.lib.WordArray {
  // Convert to hex string first, then parse - this is unambiguous
  const hex = bytesToHex(u8arr);
  return CryptoJS.enc.Hex.parse(hex);
}

/**
 * Decrypt master key from CMasterKey structure
 * Uses iterative SHA-512 (Bitcoin Core's method from crypter.cpp)
 * Async to prevent UI freeze during heavy computation
 */
async function decryptMasterKey(
  encryptedKey: Uint8Array,
  salt: Uint8Array,
  iterations: number,
  password: string
): Promise<string> {
  // Derive key and IV using iterative SHA-512 (Bitcoin Core's BytesToKeySHA512AES method)
  // First hash: SHA512(password + salt)
  const passwordHex = bytesToHex(new TextEncoder().encode(password));
  const saltHex = bytesToHex(salt);
  const inputHex = passwordHex + saltHex;

  // Parse hex to WordArray for SHA512
  let hash = CryptoJS.SHA512(CryptoJS.enc.Hex.parse(inputHex));

  // Process remaining iterations in batches to avoid blocking UI
  const BATCH_SIZE = 1000;
  for (let i = 0; i < iterations - 1; i++) {
    hash = CryptoJS.SHA512(hash);
    // Yield every BATCH_SIZE iterations to keep UI responsive
    if (i % BATCH_SIZE === 0) {
      await yieldToMain();
    }
  }

  // Key is first 32 bytes (8 words), IV is next 16 bytes (4 words)
  const derivedKey = CryptoJS.lib.WordArray.create(hash.words.slice(0, 8));
  const derivedIv = CryptoJS.lib.WordArray.create(hash.words.slice(8, 12));

  // Decrypt master key using AES-256-CBC
  const encryptedWords = uint8ArrayToWordArray(encryptedKey);

  const decrypted = CryptoJS.AES.decrypt(
    { ciphertext: encryptedWords } as CryptoJS.lib.CipherParams,
    derivedKey,
    { iv: derivedIv, padding: CryptoJS.pad.Pkcs7, mode: CryptoJS.mode.CBC }
  );

  const result = CryptoJS.enc.Hex.stringify(decrypted);

  if (!result || result.length !== 64) {
    throw new Error('Master key decryption failed - incorrect password');
  }

  return result;
}

interface CMasterKeyData {
  encryptedKey: Uint8Array;
  salt: Uint8Array;
  derivationMethod: number;
  iterations: number;
  position: number;
}

/**
 * Find ALL CMasterKey structures in wallet.dat
 * Returns array of all found structures (wallet may have multiple)
 *
 * CMasterKey format:
 * - vchCryptedKey: compact_size (1 byte = 0x30) + encrypted_key (48 bytes)
 * - vchSalt: compact_size (1 byte = 0x08) + salt (8 bytes)
 * - nDerivationMethod: uint32 (4 bytes)
 * - nDeriveIterations: uint32 (4 bytes)
 */
function findAllCMasterKeys(data: Uint8Array): CMasterKeyData[] {
  const results: CMasterKeyData[] = [];

  // Search for CMasterKey structure pattern:
  // 0x30 (encrypted key length = 48) followed by 48 bytes,
  // then 0x08 (salt length = 8) followed by 8 bytes,
  // then derivation method (4 bytes) and iterations (4 bytes)

  for (let pos = 0; pos < data.length - 70; pos++) {
    if (data[pos] === 0x30) { // 48 = encrypted key length
      const saltLenPos = pos + 1 + 48;
      if (saltLenPos < data.length && data[saltLenPos] === 0x08) { // 8 = salt length
        const iterPos = saltLenPos + 1 + 8 + 4; // after salt + derivation method
        if (iterPos + 4 <= data.length) {
          const iterations = data[iterPos] | (data[iterPos + 1] << 8) |
                            (data[iterPos + 2] << 16) | (data[iterPos + 3] << 24);
          // Bitcoin Core typically uses 25000-500000 iterations
          if (iterations >= 1000 && iterations <= 10000000) {
            const encryptedKey = data.slice(pos + 1, pos + 1 + 48);
            const salt = data.slice(saltLenPos + 1, saltLenPos + 1 + 8);
            const derivationMethod = data[saltLenPos + 1 + 8] | (data[saltLenPos + 1 + 8 + 1] << 8) |
                                    (data[saltLenPos + 1 + 8 + 2] << 16) | (data[saltLenPos + 1 + 8 + 3] << 24);

            console.log(`Found CMasterKey at position ${pos}, iterations: ${iterations}`);
            results.push({ encryptedKey, salt, derivationMethod, iterations, position: pos });
          }
        }
      }
    }
  }

  console.log(`Total CMasterKey structures found: ${results.length}`);
  return results;
}

/**
 * Decrypt encrypted wallet.dat file and extract keys
 * Port of webwallet's decryptAndImportWallet() function
 * Async to prevent UI freeze during heavy computation
 */
async function decryptEncryptedWalletDat(data: Uint8Array, password: string): Promise<{
  masterKey: string;
  chainCode: string;
  descriptorPath: string;
} | null> {
  try {
    // Step 1: Find ALL CMasterKey structures (wallet may have multiple)
    const cmasterKeys = findAllCMasterKeys(data);

    if (cmasterKeys.length === 0) {
      throw new Error('Could not find CMasterKey structure in wallet');
    }

    // Try to decrypt each CMasterKey until one succeeds
    let masterKeyHex: string | null = null;
    for (const cmk of cmasterKeys) {
      try {
        console.log(`Trying CMasterKey at position ${cmk.position}...`);
        masterKeyHex = await decryptMasterKey(
          cmk.encryptedKey,
          cmk.salt,
          cmk.iterations,
          password
        );
        if (masterKeyHex && masterKeyHex.length === 64) {
          console.log(`✓ Successfully decrypted with CMasterKey at position ${cmk.position}`);
          break;
        }
      } catch (e) {
        console.log(`✗ Failed with CMasterKey at position ${cmk.position}: ${e instanceof Error ? e.message : e}`);
        // Continue to next CMasterKey
      }
    }

    if (!masterKeyHex || masterKeyHex.length !== 64) {
      throw new Error('Master key decryption failed - incorrect password');
    }

    // Step 2: Find wpkh descriptor with /0/* (receive addresses)
    const descriptorPattern = new TextEncoder().encode('walletdescriptor');
    let descriptorIndex = 0;
    let descriptorId: Uint8Array | null = null;
    let xpubString: string | null = null;

    while ((descriptorIndex = findPattern(data, descriptorPattern, descriptorIndex)) !== -1) {
      // Skip descriptor ID (32 bytes) - it's between the prefix and the value
      let scanPos = descriptorIndex + descriptorPattern.length + 32;

      // Read the descriptor value (starts with compact size)
      const descLen = data[scanPos];
      scanPos++;

      const descBytes = data.slice(scanPos, scanPos + Math.min(descLen, 200));
      let descStr = '';
      for (let i = 0; i < descBytes.length && descBytes[i] >= 32 && descBytes[i] <= 126; i++) {
        descStr += String.fromCharCode(descBytes[i]);
      }

      // Look for native SegWit receive descriptor: wpkh(...84h/1h/0h/0/*)
      if (descStr.startsWith('wpkh(xpub') && descStr.includes('/0/*)')) {
        // Extract xpub
        const xpubMatch = descStr.match(/xpub[1-9A-HJ-NP-Za-km-z]{100,}/);
        if (xpubMatch) {
          xpubString = xpubMatch[0];

          // Extract descriptor ID (32 bytes after "walletdescriptor" prefix)
          const descIdStart = descriptorIndex + descriptorPattern.length;
          descriptorId = data.slice(descIdStart, descIdStart + 32);
          break;
        }
      }

      descriptorIndex++;
    }

    if (!descriptorId || !xpubString) {
      throw new Error('Could not find native SegWit receive descriptor');
    }

    // Step 3: Extract chain code from xpub
    const xpubDecoded = base58Decode(xpubString);
    const chainCode = bytesToHex(xpubDecoded.slice(13, 45));

    // Step 4: Find and decrypt the BIP32 master private key
    const ckeyPattern = new TextEncoder().encode('walletdescriptorckey');
    let ckeyIndex = findPattern(data, ckeyPattern, 0);
    let bip32MasterKey: string | null = null;

    while (ckeyIndex !== -1 && !bip32MasterKey) {
      // Check if this record matches our descriptor ID
      const recordDescId = data.slice(ckeyIndex + ckeyPattern.length, ckeyIndex + ckeyPattern.length + 32);

      if (Array.from(recordDescId).every((b, i) => b === descriptorId![i])) {
        // Found the matching record - extract and decrypt the private key
        let keyPos = ckeyIndex + ckeyPattern.length + 32;
        const pubkeyLen = data[keyPos];
        keyPos++;
        const pubkey = data.slice(keyPos, keyPos + pubkeyLen);

        // Find the value field (encrypted key) - search forward
        for (let searchPos = keyPos + pubkeyLen; searchPos < Math.min(keyPos + pubkeyLen + 100, data.length - 50); searchPos++) {
          // Look for a compact size followed by encrypted data (typically 48 bytes)
          const valueLen = data[searchPos];
          if (valueLen >= 32 && valueLen <= 64) {
            const encryptedPrivKey = data.slice(searchPos + 1, searchPos + 1 + valueLen);

            // Decrypt using master key with IV derived from pubkey hash (double SHA256)
            const pubkeyWords = uint8ArrayToWordArray(pubkey);
            const pubkeyHashWords = CryptoJS.SHA256(CryptoJS.SHA256(pubkeyWords));
            const ivWords = CryptoJS.lib.WordArray.create(pubkeyHashWords.words.slice(0, 4));
            const masterKeyWords = CryptoJS.enc.Hex.parse(masterKeyHex);
            const encryptedWords = uint8ArrayToWordArray(encryptedPrivKey);

            const decrypted = CryptoJS.AES.decrypt(
              { ciphertext: encryptedWords } as CryptoJS.lib.CipherParams,
              masterKeyWords,
              { iv: ivWords, padding: CryptoJS.pad.Pkcs7, mode: CryptoJS.mode.CBC }
            );

            bip32MasterKey = CryptoJS.enc.Hex.stringify(decrypted);

            if (bip32MasterKey.length === 64) {
              console.log(`✓ BIP32 master key decrypted: ${bip32MasterKey.substring(0, 16)}...`);
              break;
            }
          }
        }
        break;
      }

      ckeyIndex = findPattern(data, ckeyPattern, ckeyIndex + 1);
    }

    if (!bip32MasterKey || bip32MasterKey.length !== 64) {
      throw new Error('Could not decrypt BIP32 master private key');
    }

    return {
      masterKey: bip32MasterKey,
      chainCode: chainCode,
      descriptorPath: "84'/1'/0'" // BIP84 for Alpha network
    };
  } catch (error) {
    console.error('Error decrypting encrypted wallet.dat:', error);
    return null;
  }
}

/**
 * Base58 decode function for decoding extended keys
 */
function base58Decode(str: string): Uint8Array {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const ALPHABET_MAP: Record<string, number> = {};
  for (let i = 0; i < ALPHABET.length; i++) {
    ALPHABET_MAP[ALPHABET[i]] = i;
  }

  // Count leading zeros (represented as '1' in base58)
  let zeros = 0;
  for (let i = 0; i < str.length && str[i] === '1'; i++) {
    zeros++;
  }

  // Decode from base58 to number
  let num = BigInt(0);
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (!(char in ALPHABET_MAP)) {
      throw new Error('Invalid base58 character: ' + char);
    }
    num = num * BigInt(58) + BigInt(ALPHABET_MAP[char]);
  }

  // Convert to bytes
  const bytes: number[] = [];
  while (num > 0) {
    bytes.unshift(Number(num % BigInt(256)));
    num = num / BigInt(256);
  }

  // Add leading zeros
  for (let i = 0; i < zeros; i++) {
    bytes.unshift(0);
  }

  return new Uint8Array(bytes);
}

/**
 * Restore wallet from wallet.dat (SQLite BIP32 format)
 * Supports both encrypted and unencrypted wallet.dat files
 * Exact port of index.html restoreFromWalletDat() logic with encryption support
 */
async function restoreFromWalletDat(file: File, password?: string): Promise<RestoreWalletResult> {
  try {
    const data = await readBinaryFile(file);

    // Check SQLite header
    const header = new TextDecoder().decode(data.slice(0, 16));
    if (!header.startsWith('SQLite format 3')) {
      return {
        success: false,
        wallet: {} as Wallet,
        error: 'Invalid wallet.dat file - not an SQLite database'
      };
    }

    // Look for different wallet record types
    const walletInfo: {
      descriptorKeys: string[];
      hdChain: boolean | null;
      legacyKeys: string[];
      isDescriptorWallet: boolean;
    } = {
      descriptorKeys: [],
      hdChain: null,
      legacyKeys: [],
      isDescriptorWallet: false
    };

    // Pattern 1: Search for walletdescriptorkey records (modern descriptor wallets)
    const descriptorKeyPattern = new TextEncoder().encode('walletdescriptorkey');

    let index = 0;
    while ((index = findPattern(data, descriptorKeyPattern, index)) !== -1) {
      walletInfo.isDescriptorWallet = true;

      // Search for DER-encoded private key directly after walletdescriptorkey
      for (let checkPos = index + descriptorKeyPattern.length;
           checkPos < Math.min(index + descriptorKeyPattern.length + 200, data.length - 40);
           checkPos++) {

        // Look for DER sequence markers
        // Pattern: d30201010420 (the pattern that actually works)
        if (data[checkPos] === 0xd3 &&
            data[checkPos + 1] === 0x02 &&
            data[checkPos + 2] === 0x01 &&
            data[checkPos + 3] === 0x01 &&
            data[checkPos + 4] === 0x04 &&
            data[checkPos + 5] === 0x20) {

          // Extract the 32-byte private key
          const privKey = data.slice(checkPos + 6, checkPos + 38);
          const privKeyHex = bytesToHex(privKey);

          if (isValidPrivateKey(privKeyHex)) {
            walletInfo.descriptorKeys.push(privKeyHex);
            break;
          }
        }
      }

      index++;
    }

    // Pattern 2: Search for hdchain records (legacy HD wallets)
    const hdChainPattern = new TextEncoder().encode('hdchain');
    index = findPattern(data, hdChainPattern);
    if (index !== -1) {
      walletInfo.hdChain = true;
    }

    // Check if wallet is encrypted before trying legacy extraction
    const mkeyPattern = new TextEncoder().encode('mkey');
    const hasMkey = findPattern(data, mkeyPattern, 0) !== -1;

    if (hasMkey && walletInfo.descriptorKeys.length === 0) {
      console.warn('Wallet appears to be encrypted - legacy key extraction may fail');
    }

    // Pattern 3: Search for regular key records (legacy format)
    const keyPattern = new TextEncoder().encode('key');
    index = 0;
    while ((index = findPattern(data, keyPattern, index)) !== -1) {
      // Extract private key using simple pattern search
      const searchPattern = new Uint8Array([0x04, 0x20]); // DER encoding for 32-byte octet string
      for (let i = index; i < Math.min(index + 200, data.length - 34); i++) {
        if (data[i] === searchPattern[0] && data[i + 1] === searchPattern[1]) {
          const privKey = data.slice(i + 2, i + 34);
          const privKeyHex = bytesToHex(privKey);

          if (isValidPrivateKey(privKeyHex)) {
            walletInfo.legacyKeys.push(privKeyHex);
            break;
          }
        }
      }
      index++;
    }

    // Look for wpkh descriptor to extract derivation path
    let descriptorPath: string | null = null;
    const wpkhPattern = new TextEncoder().encode('wpkh([');
    const wpkhIndex = findPattern(data, wpkhPattern, 0);
    if (wpkhIndex !== -1) {
      // Read the descriptor (up to 200 bytes should be enough)
      const descriptorArea = data.slice(wpkhIndex, Math.min(wpkhIndex + 200, data.length));
      let descriptorStr = '';

      // Convert to string until we hit a non-printable character or closing parenthesis
      for (let i = 0; i < descriptorArea.length; i++) {
        const byte = descriptorArea[i];
        if (byte >= 32 && byte <= 126) { // Printable ASCII
          descriptorStr += String.fromCharCode(byte);
          if (descriptorStr.includes('*))')) break; // End of descriptor
        }
      }

      console.log('Found descriptor:', descriptorStr);

      // Parse the descriptor path
      // Format: wpkh([fingerprint/84'/0'/0']xpub.../0/*)
      const pathMatch = descriptorStr.match(/\[[\da-f]+\/(\d+'\/\d+'\/\d+')\]/);
      if (pathMatch) {
        descriptorPath = pathMatch[1];
        console.log('Extracted descriptor path:', descriptorPath);
      }
    }

    // Extract chain code from xpub for BIP32 wallets
    let masterChainCode: string | null = null;
    const xpubPattern = new TextEncoder().encode('xpub');
    const base58Chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    let searchPos = 0;
    let foundMasterChainCode = false;

    while (!foundMasterChainCode && searchPos < data.length) {
      const xpubIndex = findPattern(data, xpubPattern, searchPos);
      if (xpubIndex === -1) break;

      // Extract the full xpub
      let xpubStr = 'xpub';
      let pos = xpubIndex + 4;

      while (pos < data.length && xpubStr.length < 120) {
        const char = String.fromCharCode(data[pos]);
        if (base58Chars.includes(char)) {
          xpubStr += char;
          pos++;
        } else {
          break;
        }
      }

      if (xpubStr.length > 100) {
        try {
          // Decode the xpub to check depth and extract chain code
          const decoded = base58Decode(xpubStr);
          const depth = decoded[4];

          // We want the master key at depth 0
          if (depth === 0) {
            // Chain code is at bytes 13-45 (32 bytes)
            const chainCodeBytes = decoded.slice(13, 45);
            masterChainCode = bytesToHex(chainCodeBytes);
            console.log('Extracted master chain code from depth 0 xpub:', masterChainCode);
            foundMasterChainCode = true;
          }
        } catch (e) {
          console.error('Failed to decode xpub:', e);
        }
      }

      searchPos = xpubIndex + 4;
    }

    if (!masterChainCode) {
      console.warn('Could not extract chain code from wallet.dat - BIP32 derivation will not work correctly');
    }

    // Determine what we found
    let masterKey: string | null = null;
    let importType = '';

    if (walletInfo.isDescriptorWallet && walletInfo.descriptorKeys.length > 0) {
      // Modern descriptor wallet
      masterKey = walletInfo.descriptorKeys[0]; // Use first key found
      importType = 'descriptor wallet';
      console.log(`Found ${walletInfo.descriptorKeys.length} key(s) in descriptor wallet`);
    } else if (walletInfo.legacyKeys.length > 0) {
      // Legacy wallet with individual keys
      masterKey = walletInfo.legacyKeys[0]; // Use first key found
      importType = walletInfo.hdChain ? 'HD wallet' : 'legacy wallet';
      console.log(`Found ${walletInfo.legacyKeys.length} key(s) in ${importType}`);
    } else {
      // Check if this is an encrypted wallet
      if (hasMkey) {
        // Wallet is encrypted - try to decrypt if password is provided
        if (!password) {
          return {
            success: false,
            wallet: {} as Wallet,
            error: 'This wallet.dat file is encrypted. Please provide a password to decrypt it.',
            isEncryptedDat: true
          };
        }

        // Try to decrypt the encrypted wallet (async to prevent UI freeze)
        const decryptedData = await decryptEncryptedWalletDat(data, password);
        if (!decryptedData) {
          return {
            success: false,
            wallet: {} as Wallet,
            error: 'Failed to decrypt wallet.dat. The password may be incorrect.',
            isEncryptedDat: true
          };
        }

        // Successfully decrypted - create wallet with decrypted data
        const wallet: Wallet = {
          masterPrivateKey: decryptedData.masterKey,
          addresses: [],
          isEncrypted: false,
          encryptedMasterKey: '',
          childPrivateKey: null,
          isImportedAlphaWallet: true,
          masterChainCode: decryptedData.chainCode,
          chainCode: decryptedData.chainCode,
          descriptorPath: decryptedData.descriptorPath,
        };

        return {
          success: true,
          wallet,
          message: 'Encrypted wallet.dat decrypted and imported successfully!'
        };
      } else {
        return {
          success: false,
          wallet: {} as Wallet,
          error: 'No valid private keys found in wallet.dat file. The wallet might use an unsupported format.'
        };
      }
    }

    // Create wallet with the extracted key
    const wallet: Wallet = {
      masterPrivateKey: masterKey,
      addresses: [],
      isEncrypted: false,
      encryptedMasterKey: '',
      childPrivateKey: null,
      isImportedAlphaWallet: true, // Mark as imported from Alpha wallet.dat
      masterChainCode: masterChainCode,
      chainCode: masterChainCode || undefined,
      descriptorPath: descriptorPath || "84'/1'/0'", // Default to BIP84 for Alpha network if not found
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
 * Exact copy of index.html restoreWallet() logic
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

    let masterKey = "";
    let isEncrypted = false;
    let encryptedMasterKey = "";

    // Check if encrypted wallet
    if (fileContent.includes("ENCRYPTED MASTER KEY")) {
      isEncrypted = true;
      console.log("Loading encrypted wallet...");

      // Extract encrypted master key - exact regex from index.html
      const encryptedKeyMatch = fileContent.match(
        /ENCRYPTED MASTER KEY \(password protected\):\s*([^\n]+)/
      );

      if (encryptedKeyMatch && encryptedKeyMatch[1]) {
        encryptedMasterKey = encryptedKeyMatch[1].trim();
        console.log("Found encrypted master key");

        if (!password) {
          return {
            success: false,
            wallet: {} as Wallet,
            error: "This is an encrypted wallet. Please enter the decryption password.",
          };
        }

        // Decrypt - exact method from index.html
        // Use explicit parameters for cross-version CryptoJS compatibility
        try {
          console.log("Attempting to decrypt with provided password...");
          const salt = "alpha_wallet_salt";
          const passwordKey = CryptoJS.PBKDF2(password, salt, {
            keySize: 256 / 32,
            iterations: 100000,
            hasher: CryptoJS.algo.SHA1, // Explicitly specify SHA1 hasher for compatibility
          }).toString();

          const decryptedBytes = CryptoJS.AES.decrypt(encryptedMasterKey, passwordKey);
          masterKey = decryptedBytes.toString(CryptoJS.enc.Utf8);

          if (!masterKey) {
            return {
              success: false,
              wallet: {} as Wallet,
              error: "Failed to decrypt the wallet. The password may be incorrect.",
            };
          }
          console.log("Successfully decrypted master key:", masterKey.substring(0, 8) + "...");
        } catch (e) {
          return {
            success: false,
            wallet: {} as Wallet,
            error: "Error decrypting wallet: " + (e instanceof Error ? e.message : String(e)),
          };
        }
      } else {
        return {
          success: false,
          wallet: {} as Wallet,
          error: "Could not find the encrypted master key in the backup file.",
        };
      }
    } else {
      // Unencrypted - exact regex from index.html
      const masterKeyMatch = fileContent.match(
        /MASTER PRIVATE KEY \(keep secret!\):\s*([^\n]+)/
      );
      if (masterKeyMatch && masterKeyMatch[1]) {
        masterKey = masterKeyMatch[1].trim();
      } else {
        return {
          success: false,
          wallet: {} as Wallet,
          error: "Could not find the master private key in the backup file.",
        };
      }
    }

    // Check for chain code - exact regex from index.html
    let masterChainCode: string | null = null;
    let isImportedAlphaWallet = false;

    const chainCodeMatch = fileContent.match(
      /MASTER CHAIN CODE \(for (?:BIP32 HD|Alpha) wallet compatibility\):\s*([^\n]+)/
    );
    if (chainCodeMatch && chainCodeMatch[1]) {
      masterChainCode = chainCodeMatch[1].trim();
      isImportedAlphaWallet = true;
    }

    // Check wallet type explicitly
    if (
      fileContent.includes("WALLET TYPE: BIP32 hierarchical deterministic wallet") ||
      fileContent.includes("WALLET TYPE: Alpha descriptor wallet")
    ) {
      isImportedAlphaWallet = true;
    }

    // Parse descriptor path for BIP32 wallets
    let descriptorPath: string | null = null;
    const descriptorPathMatch = fileContent.match(/DESCRIPTOR PATH:\s*([^\n]+)/);
    if (descriptorPathMatch && descriptorPathMatch[1]) {
      descriptorPath = descriptorPathMatch[1].trim();
    }

    // Parse addresses - exact regex from index.html
    const parsedAddresses: WalletAddress[] = [];
    const addressSection = fileContent.match(
      /YOUR ADDRESSES:\s*\n([\s\S]*?)(?:\n\nGenerated on:|$)/
    );

    if (addressSection && addressSection[1]) {
      const addressLines = addressSection[1].trim().split("\n");
      for (const line of addressLines) {
        // Exact regex from index.html
        const addressMatch = line.match(
          /Address\s+(\d+):\s+(\w+)\s*(?:\(Path:\s*([^)]*)\))?/
        );
        if (addressMatch) {
          const index = parseInt(addressMatch[1]) - 1;
          const address = addressMatch[2];
          const path = addressMatch[3] === "undefined" ? null : addressMatch[3] || null;
          parsedAddresses.push({
            index,
            address,
            path,
            createdAt: new Date().toISOString(),
          });
        }
      }
    }

    // Create wallet - exact structure from index.html
    const wallet: Wallet = {
      masterPrivateKey: masterKey,
      addresses: parsedAddresses,
      isEncrypted: isEncrypted,
      encryptedMasterKey: encryptedMasterKey,
      childPrivateKey: null,
      isImportedAlphaWallet: isImportedAlphaWallet,
      masterChainCode: masterChainCode,
      chainCode: masterChainCode || undefined,
      descriptorPath: descriptorPath || (isImportedAlphaWallet ? "84'/1'/0'" : null),
    };

    // For standard wallets, recover private keys for all addresses
    if (!isImportedAlphaWallet && parsedAddresses.length > 0) {
      const hmacInput = CryptoJS.enc.Hex.parse(wallet.masterPrivateKey);
      const witnessVersion = 0;

      // Recover private key for each address
      for (let addrIdx = 0; addrIdx < wallet.addresses.length; addrIdx++) {
        const addr = wallet.addresses[addrIdx];
        let recovered = false;

        // Try to find the correct derivation index for this address
        for (let i = 0; i < 100; i++) {
          const testPath = `m/44'/0'/${i}'`;
          const testHmac = CryptoJS.HmacSHA512(
            hmacInput,
            CryptoJS.enc.Utf8.parse(testPath)
          ).toString();
          const testChildKey = testHmac.substring(0, 64);
          const testKeyPair = ec.keyFromPrivate(testChildKey);
          const testPublicKey = testKeyPair.getPublic(true, "hex");
          const testAddress = publicKeyToAddress(testPublicKey, "alpha", witnessVersion);

          if (testAddress === addr.address) {
            console.log(`✓ Found correct derivation for address ${addrIdx + 1} at index ${i}!`);
            addr.privateKey = testChildKey;
            addr.publicKey = testPublicKey;
            addr.path = testPath;
            addr.index = i;
            recovered = true;

            // Set childPrivateKey for first address (for backward compatibility)
            if (addrIdx === 0) {
              wallet.childPrivateKey = testChildKey;
            }
            break;
          }
        }

        if (!recovered) {
          // CRITICAL: Address verification failed - abort import for security
          // This indicates the wallet file may be corrupted or from a different wallet
          console.error('WALLET INTEGRITY CHECK FAILED');
          console.error('Address from file:', addr.address);
          console.error('Recovery scan (0-99) failed to find matching key');
          return {
            success: false,
            wallet: {} as Wallet,
            error: `Wallet integrity check failed: Address ${addr.address} does not match any key derived from the master private key. This wallet file may be corrupted or from a different wallet.`,
          };
        }
      }
    }

    // For BIP32 wallets (Alpha wallet), recover private keys using path info
    if (isImportedAlphaWallet && masterChainCode && parsedAddresses.length > 0) {
      const witnessVersion = 0;

      for (let addrIdx = 0; addrIdx < wallet.addresses.length; addrIdx++) {
        const addr = wallet.addresses[addrIdx];

        // If address has path info, derive the key directly
        if (addr.path && addr.path.startsWith("m/")) {
          try {
            const derived = deriveKeyAtPath(masterKey, masterChainCode, addr.path);
            const keyPair = ec.keyFromPrivate(derived.privateKey);
            const publicKey = keyPair.getPublic(true, "hex");

            // Verify the derived address matches
            const derivedAddress = publicKeyToAddress(publicKey, "alpha", witnessVersion);

            if (derivedAddress === addr.address) {
              console.log(`✓ BIP32: Recovered key for address ${addrIdx + 1} at path ${addr.path}`);
              addr.privateKey = derived.privateKey;
              addr.publicKey = publicKey;

              // Check if this is a change address (chain 1)
              const pathParts = addr.path.split("/");
              if (pathParts.length >= 5) {
                const chain = parseInt(pathParts[pathParts.length - 2], 10);
                addr.isChange = chain === 1;
              }
            } else {
              console.error(`BIP32: Address mismatch at path ${addr.path}`);
              console.error(`  Expected: ${addr.address}`);
              console.error(`  Derived:  ${derivedAddress}`);
              return {
                success: false,
                wallet: {} as Wallet,
                error: `Wallet integrity check failed: Address ${addr.address} does not match derived address at path ${addr.path}`,
              };
            }
          } catch (e) {
            console.error(`Error deriving key at path ${addr.path}:`, e);
            return {
              success: false,
              wallet: {} as Wallet,
              error: `Failed to derive key at path ${addr.path}: ${e instanceof Error ? e.message : String(e)}`,
            };
          }
        } else {
          // No path info - need to scan to find the correct derivation
          console.warn(`BIP32: Address ${addrIdx + 1} has no path info, scanning...`);
          const basePath = descriptorPath || "84'/1'/0'";
          let recovered = false;

          // Scan both chains (0=external, 1=change) and first 100 indices
          for (const chain of [0, 1]) {
            if (recovered) break;
            for (let i = 0; i < 100; i++) {
              const testPath = `m/${basePath}/${chain}/${i}`;
              try {
                const derived = deriveKeyAtPath(masterKey, masterChainCode, testPath);
                const keyPair = ec.keyFromPrivate(derived.privateKey);
                const publicKey = keyPair.getPublic(true, "hex");
                const testAddress = publicKeyToAddress(publicKey, "alpha", witnessVersion);

                if (testAddress === addr.address) {
                  console.log(`✓ BIP32: Found address ${addrIdx + 1} at ${testPath}`);
                  addr.privateKey = derived.privateKey;
                  addr.publicKey = publicKey;
                  addr.path = testPath;
                  addr.index = i;
                  addr.isChange = chain === 1;
                  recovered = true;
                  break;
                }
              } catch {
                // Continue on derivation errors
              }
            }
          }

          if (!recovered) {
            console.error(`BIP32: Could not find derivation for address ${addr.address}`);
            return {
              success: false,
              wallet: {} as Wallet,
              error: `Could not find BIP32 derivation path for address ${addr.address}`,
            };
          }
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
 * Exact copy of index.html saveWallet() logic
 */
export function exportWallet(wallet: Wallet, options: ExportOptions = {}): string {
  const { password } = options;

  if (!wallet || !wallet.masterPrivateKey) {
    throw new Error("Invalid wallet - missing master private key");
  }

  let content: string;

  if (password) {
    // Encrypted wallet - exact method from index.html
    // Use explicit parameters for cross-version CryptoJS compatibility
    const salt = "alpha_wallet_salt";
    const passwordKey = CryptoJS.PBKDF2(password, salt, {
      keySize: 256 / 32,
      iterations: 100000,
      hasher: CryptoJS.algo.SHA1, // Explicitly specify SHA1 hasher for compatibility
    }).toString();

    const encryptedMasterKey = CryptoJS.AES.encrypt(
      wallet.masterPrivateKey,
      passwordKey
    ).toString();

    // Get addresses text
    let addressesText: string;
    if (wallet.isImportedAlphaWallet) {
      addressesText = wallet.addresses
        .map((addr, index) => {
          const path = addr.path || `m/84'/1'/0'/${addr.isChange ? 1 : 0}/${addr.index}`;
          return `Address ${index + 1}: ${addr.address} (Path: ${path})`;
        })
        .join("\n");
    } else {
      addressesText = wallet.addresses
        .map((a) => `Address ${a.index + 1}: ${a.address} (Path: ${a.path})`)
        .join("\n");
    }

    // Build encrypted content
    let encryptedContent = `ENCRYPTED MASTER KEY (password protected):
${encryptedMasterKey}`;

    if (wallet.isImportedAlphaWallet && wallet.masterChainCode) {
      // Match webwallet format exactly - no DESCRIPTOR PATH in encrypted format
      encryptedContent += `

MASTER CHAIN CODE (for BIP32 HD wallet compatibility):
${wallet.masterChainCode}

WALLET TYPE: BIP32 hierarchical deterministic wallet`;
    } else {
      encryptedContent += `

WALLET TYPE: Standard wallet (HMAC-based)`;
    }

    content = `UNICITY WALLET DETAILS
===========================

${encryptedContent}

ENCRYPTION STATUS: Encrypted with password
To use this key, you will need the password you set in the wallet.

YOUR ADDRESSES:
${addressesText}

Generated on: ${new Date().toLocaleString()}

WARNING: Keep your master private key safe and secure.
Anyone with your master private key can access all your funds.`;
  } else {
    // Unencrypted wallet - exact method from index.html
    const masterKeyWIF = hexToWIF(wallet.masterPrivateKey);

    let masterKeySection: string;
    let addressesText: string;

    if (wallet.isImportedAlphaWallet && wallet.masterChainCode) {
      masterKeySection = `MASTER PRIVATE KEY (keep secret!):
${wallet.masterPrivateKey}

MASTER PRIVATE KEY IN WIF FORMAT (for importprivkey command):
${masterKeyWIF}

MASTER CHAIN CODE (for BIP32 HD wallet compatibility):
${wallet.masterChainCode}

DESCRIPTOR PATH: ${wallet.descriptorPath || "84'/1'/0'"}

WALLET TYPE: BIP32 hierarchical deterministic wallet

ENCRYPTION STATUS: Not encrypted
This key is in plaintext and not protected. Anyone with this file can access your wallet.`;

      addressesText = wallet.addresses
        .map((addr, index) => {
          const path = addr.path || `m/84'/1'/0'/${addr.isChange ? 1 : 0}/${addr.index}`;
          return `Address ${index + 1}: ${addr.address} (Path: ${path})`;
        })
        .join("\n");
    } else {
      addressesText = wallet.addresses
        .map((a) => `Address ${a.index + 1}: ${a.address} (Path: ${a.path})`)
        .join("\n");

      masterKeySection = `MASTER PRIVATE KEY (keep secret!):
${wallet.masterPrivateKey}

MASTER PRIVATE KEY IN WIF FORMAT (for importprivkey command):
${masterKeyWIF}

WALLET TYPE: Standard wallet (HMAC-based)

ENCRYPTION STATUS: Not encrypted
This key is in plaintext and not protected. Anyone with this file can access your wallet.`;
    }

    content = `UNICITY WALLET DETAILS
===========================

${masterKeySection}

YOUR ADDRESSES:
${addressesText}

Generated on: ${new Date().toLocaleString()}

WARNING: Keep your master private key safe and secure.
Anyone with your master private key can access all your funds.`;
  }

  return content;
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
// ==========================================

const JSON_WALLET_VERSION = "1.0" as const;
const JSON_WALLET_WARNING = "Keep this file secure! Anyone with this data can access your funds.";
const PBKDF2_ITERATIONS = 100000;
const PBKDF2_SALT_PREFIX = "unicity_wallet_json_";

/**
 * Generate a random salt for encryption
 */
function generateSalt(): string {
  const randomBytes = new Uint8Array(16);
  crypto.getRandomValues(randomBytes);
  return PBKDF2_SALT_PREFIX + bytesToHex(randomBytes);
}

/**
 * Derive encryption key from password using PBKDF2
 */
function deriveEncryptionKey(password: string, salt: string): string {
  return CryptoJS.PBKDF2(password, salt, {
    keySize: 256 / 32,
    iterations: PBKDF2_ITERATIONS,
    hasher: CryptoJS.algo.SHA256,
  }).toString();
}

/**
 * Encrypt sensitive data with password
 */
function encryptWithPassword(data: string, password: string, salt: string): string {
  const key = deriveEncryptionKey(password, salt);
  return CryptoJS.AES.encrypt(data, key).toString();
}

/**
 * Decrypt data with password
 */
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

/**
 * Determine derivation mode from wallet
 * IMPORTANT: chainCode is the definitive indicator for BIP32 mode.
 * Without chainCode, BIP32 derivation is impossible regardless of flags.
 */
function determineDerivationMode(wallet: Wallet): WalletJSONDerivationMode {
  // ChainCode is REQUIRED for BIP32 derivation - check this first
  if (wallet.chainCode || wallet.masterChainCode) {
    return "bip32";
  }
  // Without chainCode, can only use WIF HMAC mode (even if isBIP32 flag is set)
  return "wif_hmac";
}

/**
 * Determine source type from wallet
 */
function determineSource(
  wallet: Wallet,
  mnemonic?: string,
  importSource?: "dat" | "file"
): WalletJSONSource {
  // If mnemonic is provided, it's from mnemonic
  if (mnemonic) {
    return "mnemonic";
  }

  // If imported from dat file
  if (importSource === "dat") {
    if (wallet.descriptorPath) {
      return "dat_descriptor";
    }
    if (wallet.isBIP32 || wallet.chainCode || wallet.masterChainCode) {
      return "dat_hd";
    }
    return "dat_legacy";
  }

  // Imported from txt file
  if (wallet.chainCode || wallet.masterChainCode) {
    return "file_bip32";
  }
  return "file_standard";
}

/**
 * Generate address from master key for JSON export
 */
function generateAddressForExport(
  masterKey: string,
  chainCode: string | null | undefined,
  derivationMode: WalletJSONDerivationMode,
  index: number,
  descriptorPath?: string | null
): WalletJSONAddress {
  const witnessVersion = 0;

  if (derivationMode === "bip32" && chainCode) {
    // BIP32 derivation
    const basePath = descriptorPath || "44'/0'/0'";
    const fullPath = `m/${basePath}/0/${index}`;
    const derived = deriveKeyAtPath(masterKey, chainCode, fullPath);
    const keyPair = ec.keyFromPrivate(derived.privateKey);
    const publicKey = keyPair.getPublic(true, "hex");
    const address = publicKeyToAddress(publicKey, "alpha", witnessVersion);

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
    const publicKey = keyPair.getPublic(true, "hex");
    const address = publicKeyToAddress(publicKey, "alpha", witnessVersion);

    return {
      address,
      publicKey,
      path: derivationPath,
      index,
    };
  }
}

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
 */
export function exportWalletToJSON(params: ExportToJSONParams): WalletJSON {
  const { wallet, mnemonic, importSource, options = {} } = params;
  const { password, includeAllAddresses = false, addressCount = 1 } = options;

  if (!wallet || !wallet.masterPrivateKey) {
    throw new Error("Invalid wallet - missing master private key");
  }

  const chainCode = wallet.chainCode || wallet.masterChainCode || undefined;
  const derivationMode = determineDerivationMode(wallet);
  const source = determineSource(wallet, mnemonic, importSource);

  // Generate first address for verification
  const firstAddress = generateAddressForExport(
    wallet.masterPrivateKey,
    chainCode,
    derivationMode,
    0,
    wallet.descriptorPath
  );

  // Build base JSON structure
  const json: WalletJSON = {
    version: JSON_WALLET_VERSION,
    generated: new Date().toISOString(),
    warning: JSON_WALLET_WARNING,
    masterPrivateKey: wallet.masterPrivateKey,
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
  if (wallet.descriptorPath) {
    json.descriptorPath = wallet.descriptorPath;
  }

  // Handle encryption
  if (password) {
    const salt = generateSalt();
    json.encrypted = {
      masterPrivateKey: encryptWithPassword(wallet.masterPrivateKey, password, salt),
      salt,
      iterations: PBKDF2_ITERATIONS,
    };

    if (mnemonic) {
      json.encrypted.mnemonic = encryptWithPassword(mnemonic, password, salt);
    }

    // Remove plaintext sensitive data when encrypted
    delete (json as Partial<WalletJSON>).masterPrivateKey;
    delete (json as Partial<WalletJSON>).mnemonic;
  }

  // Add additional addresses if requested
  if (includeAllAddresses && wallet.addresses.length > 0) {
    json.addresses = wallet.addresses.map((addr, idx) => ({
      address: addr.address,
      publicKey: addr.publicKey || "",
      path: addr.path || `m/44'/0'/${idx}'`,
      index: addr.index,
      isChange: addr.isChange,
    }));
  } else if (addressCount > 1) {
    const additionalAddresses: WalletJSONAddress[] = [];
    for (let i = 1; i < addressCount; i++) {
      additionalAddresses.push(
        generateAddressForExport(
          wallet.masterPrivateKey,
          chainCode,
          derivationMode,
          i,
          wallet.descriptorPath
        )
      );
    }
    if (additionalAddresses.length > 0) {
      json.addresses = additionalAddresses;
    }
  }

  return json;
}

/**
 * Import wallet from JSON format
 *
 * Supports:
 * - New JSON format (v1.0)
 * - Encrypted JSON files
 * - All source types (mnemonic, file_bip32, file_standard, dat_*)
 */
export async function importWalletFromJSON(
  jsonContent: string,
  password?: string
): Promise<WalletJSONImportResult> {
  try {
    const json = JSON.parse(jsonContent) as WalletJSON;

    // Validate version
    if (json.version !== "1.0") {
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
          error: "This wallet is encrypted. Please provide a password.",
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
          error: "Failed to decrypt wallet. The password may be incorrect.",
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
          error: "Invalid wallet JSON - missing master private key",
        };
      }
      masterPrivateKey = json.masterPrivateKey;
      mnemonic = json.mnemonic;
    }

    // Validate private key
    if (!isValidPrivateKey(masterPrivateKey)) {
      return {
        success: false,
        error: "Invalid master private key in wallet JSON",
      };
    }

    // Verify first address matches
    const verifyAddress = generateAddressForExport(
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

    // Determine wallet properties based on source
    const isBIP32 = json.derivationMode === "bip32";
    const isImportedAlphaWallet = json.source.startsWith("dat_") || json.source === "file_bip32";

    // Build wallet object
    const wallet: Wallet = {
      masterPrivateKey,
      addresses: [],
      isEncrypted: false,
      childPrivateKey: null,
      isBIP32,
      isImportedAlphaWallet,
    };

    if (json.chainCode) {
      wallet.chainCode = json.chainCode;
      wallet.masterChainCode = json.chainCode;
    }

    if (json.descriptorPath) {
      wallet.descriptorPath = json.descriptorPath;
    }

    // Add addresses
    wallet.addresses.push({
      address: json.firstAddress.address,
      publicKey: json.firstAddress.publicKey,
      path: json.firstAddress.path,
      index: json.firstAddress.index ?? 0,
      isChange: json.firstAddress.isChange,
      createdAt: new Date().toISOString(),
    });

    if (json.addresses) {
      for (const addr of json.addresses) {
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
      source: json.source,
      derivationMode: json.derivationMode,
      hasMnemonic: !!mnemonic,
      mnemonic, // Return decrypted mnemonic if available
      message: `Wallet imported successfully from JSON (source: ${json.source}, mode: ${json.derivationMode})`,
    };
  } catch (e) {
    if (e instanceof SyntaxError) {
      return {
        success: false,
        error: "Invalid JSON format. Please provide a valid wallet JSON file.",
      };
    }
    return {
      success: false,
      error: `Error importing wallet: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
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
 */
export function isJSONWalletFormat(content: string): boolean {
  try {
    const json = JSON.parse(content);
    return json.version === "1.0" && (json.masterPrivateKey || json.encrypted);
  } catch {
    return false;
  }
}

/**
 * Universal wallet import function
 * Automatically detects format (JSON, txt, dat) and imports accordingly
 */
export async function importWalletUniversal(
  file: File,
  password?: string
): Promise<WalletJSONImportResult> {
  try {
    // Check file extension
    const filename = file.name.toLowerCase();

    // Handle wallet.dat files
    if (filename.endsWith(".dat")) {
      const result = await importWallet(file, password);
      if (result.success) {
        return {
          success: true,
          wallet: result.wallet,
          source: result.wallet.descriptorPath ? "dat_descriptor" : "dat_hd",
          derivationMode: "bip32",
          hasMnemonic: false,
          message: result.message,
        };
      }
      return {
        success: false,
        error: result.error,
      };
    }

    // Read file content
    const content = await file.text();

    // Try JSON format first
    if (filename.endsWith(".json") || isJSONWalletFormat(content)) {
      return importWalletFromJSON(content, password);
    }

    // Fall back to txt format
    const result = await importWallet(file, password);
    if (result.success) {
      const hasChainCode = !!(result.wallet.chainCode || result.wallet.masterChainCode);
      return {
        success: true,
        wallet: result.wallet,
        source: hasChainCode ? "file_bip32" : "file_standard",
        derivationMode: hasChainCode ? "bip32" : "wif_hmac",
        hasMnemonic: false,
        message: result.message,
      };
    }
    return {
      success: false,
      error: result.error,
    };
  } catch (e) {
    return {
      success: false,
      error: `Error importing wallet: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
