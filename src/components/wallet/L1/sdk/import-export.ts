/**
 * Wallet Import/Export - Strict copy of index.html logic
 */
import CryptoJS from "crypto-js";
import { hexToWIF } from "./crypto";
import { createBech32 } from "./bech32";
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
 * Import wallet from backup file
 * Exact copy of index.html restoreWallet() logic
 */
export async function importWallet(
  file: File,
  password?: string
): Promise<RestoreWalletResult> {
  try {
    // Check for wallet.dat
    if (file.name.endsWith(".dat")) {
      throw new Error("wallet.dat files are not supported. Please export as text file.");
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
        try {
          console.log("Attempting to decrypt with provided password...");
          const salt = "alpha_wallet_salt";
          const passwordKey = CryptoJS.PBKDF2(password, salt, {
            keySize: 256 / 32,
            iterations: 100000,
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
          console.warn(`Could not recover private key for address ${addrIdx + 1}: ${addr.address}`);
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
    const salt = "alpha_wallet_salt";
    const passwordKey = CryptoJS.PBKDF2(password, salt, {
      keySize: 256 / 32,
      iterations: 100000,
    }).toString();

    const encryptedMasterKey = CryptoJS.AES.encrypt(
      wallet.masterPrivateKey,
      passwordKey
    ).toString();

    // Get addresses text
    let addressesText: string;
    if (wallet.isImportedAlphaWallet) {
      addressesText = wallet.addresses
        .map((addr, index) => `Address ${index + 1}: ${addr.address}`)
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

WALLET TYPE: BIP32 hierarchical deterministic wallet

ENCRYPTION STATUS: Not encrypted
This key is in plaintext and not protected. Anyone with this file can access your wallet.`;

      addressesText = wallet.addresses
        .map((addr, index) => `Address ${index + 1}: ${addr.address}`)
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
