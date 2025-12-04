/**
 * Wallet Import/Export - Strict copy of index.html logic
 */
import CryptoJS from "crypto-js";
import { hexToWIF } from "./crypto";
import { createBech32 } from "./bech32";
import { deriveKeyAtPath } from "./address";
import type { Wallet, WalletAddress, RestoreWalletResult, ExportOptions } from "./types";

// Re-export types
export type { RestoreWalletResult, ExportOptions };

// Elliptic for key derivation
import elliptic from "elliptic";
const ec = new elliptic.ec("secp256k1");

/**
 * Helper: hex string to Uint8Array
 */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

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
 * Exact port of index.html restoreFromWalletDat() logic
 */
async function restoreFromWalletDat(file: File): Promise<RestoreWalletResult> {
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
        return {
          success: false,
          wallet: {} as Wallet,
          error: 'This wallet.dat file is encrypted. Encrypted wallet.dat files are not currently supported. Please decrypt the wallet in Bitcoin Core first, or export as text file.'
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
      return restoreFromWalletDat(file);
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
          const testSha256 = CryptoJS.SHA256(CryptoJS.enc.Hex.parse(testPublicKey));
          const testRipemd = CryptoJS.RIPEMD160(testSha256);
          const testAddress = createBech32(
            "alpha",
            witnessVersion,
            hexToBytes(testRipemd.toString())
          );

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
            const sha256 = CryptoJS.SHA256(CryptoJS.enc.Hex.parse(publicKey));
            const ripemd = CryptoJS.RIPEMD160(sha256);
            const derivedAddress = createBech32(
              "alpha",
              witnessVersion,
              hexToBytes(ripemd.toString())
            );

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
                const sha256 = CryptoJS.SHA256(CryptoJS.enc.Hex.parse(publicKey));
                const ripemd = CryptoJS.RIPEMD160(sha256);
                const testAddress = createBech32(
                  "alpha",
                  witnessVersion,
                  hexToBytes(ripemd.toString())
                );

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
