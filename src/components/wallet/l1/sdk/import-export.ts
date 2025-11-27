import CryptoJS from "crypto-js";
import elliptic from "elliptic";
import { hexToWIF } from "./crypto";
import type {
  Wallet,
  WalletAddress,
  RestoreWalletResult,
  ExportOptions,
} from "./types";

// Re-export types for convenience
export type { RestoreWalletResult, ExportOptions };

/**
 * Restore wallet from file (React version)
 * Compatible with both Old (Legacy) and New wallet formats
 */
export async function importWallet(
  file: File,
  password?: string,
  createBech32?: (
    hrp: string,
    witnessVersion: number,
    data: Uint8Array
  ) => string,
  hexToBytes?: (hex: string) => Uint8Array
): Promise<RestoreWalletResult> {
  try {
    // Check if this is a wallet.dat file (SQLite) - not supported in React
    if (file.name.endsWith(".dat")) {
      throw new Error(
        "wallet.dat files are not supported in React version. Please export as text file."
      );
    }

    // Read file content and normalize line endings
    const fileContent = (await file.text()).replace(/\r\n/g, "\n");

    // Parse the master key from the file
    let masterKey = "";
    let isEncrypted = false;
    let encryptedMasterKey = "";

    // Check if this is an encrypted wallet
    if (fileContent.includes("ENCRYPTED MASTER KEY")) {
      isEncrypted = true;
      console.log("Loading encrypted wallet...");

      // Extract the encrypted master key
      // Updated Regex to be more robust with whitespace
      const encryptedKeyMatch = fileContent.match(
        /ENCRYPTED MASTER KEY \(password protected\):\s*([^\n\r]+)/
      );

      if (encryptedKeyMatch && encryptedKeyMatch[1]) {
        encryptedMasterKey = encryptedKeyMatch[1].trim();
        console.log("Found encrypted master key");

        // Get the decryption password
        if (!password) {
          return {
            success: false,
            wallet: {} as Wallet,
            error:
              "This is an encrypted wallet. Please enter the decryption password.",
          } as RestoreWalletResult;
        }

        // Decrypt the master key
        // We try multiple strategies to ensure backward compatibility
        try {
          console.log("Attempting to decrypt...");
          const saltStr = "alpha_wallet_salt";

          // Strategy 1: Explicit Legacy Mode (SHA1 + Explicit string salt)
          // This usually matches the old browser-based CryptoJS behavior best
          masterKey = tryDecrypt(encryptedMasterKey, password, saltStr, {
            hasher: CryptoJS.algo.SHA1,
          });

          // Strategy 2: Default Mode (If strategy 1 fails)
          if (!masterKey) {
            console.log("Legacy decryption failed, trying default mode...");
            masterKey = tryDecrypt(encryptedMasterKey, password, saltStr, {});
          }

          if (!masterKey) {
            // Strategy 3: Try parsing salt as UTF8 explicit (sometimes needed for v4)
            console.log("Default decryption failed, trying UTF8 salt mode...");
            // This logic is handled inside tryDecrypt usually, but let's be sure
            // If we are here, decryption completely failed
            throw new Error("Decryption returned empty result");
          }

          console.log(
            "Successfully decrypted master key:",
            masterKey.substring(0, 8) + "..."
          );
        } catch (e: unknown) {
          console.error("Decryption failed:", e);
          return {
            success: false,
            wallet: {} as Wallet,
            error:
              "Failed to decrypt. Password may be incorrect or file is corrupted.",
          } as RestoreWalletResult;
        }
      } else {
        return {
          success: false,
          wallet: {} as Wallet,
          error: "Could not find the encrypted master key in the backup file.",
        } as RestoreWalletResult;
      }
    } else {
      // Unencrypted wallet, extract the master key directly
      const masterKeyMatch = fileContent.match(
        /MASTER PRIVATE KEY \(keep secret!\):\s*([^\n\r]+)/
      );
      if (masterKeyMatch && masterKeyMatch[1]) {
        masterKey = masterKeyMatch[1].trim();
      } else {
        return {
          success: false,
          wallet: {} as Wallet,
          error: "Could not find the master private key in the backup file.",
        } as RestoreWalletResult;
      }
    }

    // Verify masterKey validity (simple check)
    if (!masterKey || masterKey.length < 10) {
      throw new Error("Decrypted key appears invalid.");
    }

    // Check if this is an Alpha descriptor wallet with chain code
    let masterChainCode: string | null | undefined = null;
    let isImportedAlphaWallet = false;

    const chainCodeMatch = fileContent.match(
      /MASTER CHAIN CODE \(for (?:BIP32 HD|Alpha) wallet compatibility\):\s*([^\n\r]+)/
    );
    if (chainCodeMatch && chainCodeMatch[1]) {
      masterChainCode = chainCodeMatch[1].trim();
      isImportedAlphaWallet = true;
    }

    // Also check wallet type explicitly
    if (
      fileContent.includes(
        "WALLET TYPE: BIP32 hierarchical deterministic wallet"
      ) ||
      fileContent.includes("WALLET TYPE: Alpha descriptor wallet")
    ) {
      isImportedAlphaWallet = true;
    }

    // Parse addresses from the backup file
    const parsedAddresses: WalletAddress[] = [];
    const addressSection = fileContent.match(
      /YOUR ADDRESSES:\s*\n([\s\S]*?)(?:\n\nGenerated on:|$)/
    );

    if (addressSection && addressSection[1]) {
      const addressLines = addressSection[1].trim().split("\n");

      for (const line of addressLines) {
        // Parse lines like: "Address 1: alpha1qllh2t42ytsgnx8fferxwms6npec7whvnaxta7d (Path: m/44'/0'/0')"
        const addressMatch = line.match(
          /Address\s+(\d+):\s+(\w+)(?:\s*\(Path:\s*([^)]*)\))?/
        );
        if (addressMatch) {
          const index = parseInt(addressMatch[1]) - 1; // Convert to 0-based index
          const address = addressMatch[2];
          const path =
            addressMatch[3] === "undefined" ? null : addressMatch[3] || null;
          const addressInfo: WalletAddress = {
            index: index,
            address: address,
            path: path,
            createdAt: new Date().toISOString(),
          };
          parsedAddresses.push(addressInfo);
        }
      }
    }

    // Create a new wallet with the restored master key
    const newWallet: Wallet = {
      masterPrivateKey: masterKey,
      addresses: parsedAddresses,
      isEncrypted: isEncrypted,
      encryptedMasterKey: encryptedMasterKey,
      childPrivateKey: null,
      isImportedAlphaWallet: isImportedAlphaWallet,
      masterChainCode: masterChainCode,
      chainCode: masterChainCode || undefined,
    };

    // For standard wallets with addresses, recover and verify child private key
    if (
      !isImportedAlphaWallet &&
      parsedAddresses.length > 0 &&
      createBech32 &&
      hexToBytes
    ) {
      // Keep only the first address for standard wallets
      if (newWallet.addresses.length > 1) {
        newWallet.addresses = [newWallet.addresses[0]];
      }

      // Recover childPrivateKey for the first address
      const result = recoverChildPrivateKey(
        newWallet,
        createBech32,
        hexToBytes
      );

      if (!result.success) {
        console.warn("Could not verify address:", result.message);
      }
    }

    return {
      success: true,
      wallet: newWallet,
      message: "Wallet restored successfully!",
    };
  } catch (e: unknown) {
    console.error("Error restoring wallet:", e);
    return {
      success: false,
      wallet: {} as Wallet,
      error: e instanceof Error ? e.message : String(e),
    } as RestoreWalletResult;
  }
}

/**
 * Helper function to attempt decryption
 */
function tryDecrypt(
  encryptedStr: string,
  pass: string,
  salt: string,
  options: any
): string {
  try {
    const passwordKey = CryptoJS.PBKDF2(pass, salt, {
      keySize: 256 / 32,
      iterations: 100000,
      ...options, // Mix in options like hasher: CryptoJS.algo.SHA1
    }).toString();

    const decryptedBytes = CryptoJS.AES.decrypt(encryptedStr, passwordKey);

    // Convert to string
    const result = decryptedBytes.toString(CryptoJS.enc.Utf8);

    // Check if result looks like a valid key (not empty)
    if (result && result.length > 0) return result;
    return "";
  } catch (e) {
    return "";
  }
}

/**
 * Recover childPrivateKey for standard wallet
 */
function recoverChildPrivateKey(
  wallet: Wallet,
  createBech32: (
    hrp: string,
    witnessVersion: number,
    data: Uint8Array
  ) => string,
  hexToBytes: (hex: string) => Uint8Array
): { success: boolean; message?: string } {
  const addressIndex = wallet.addresses[0].index || 0;
  const derivationPath = `m/44'/0'/${addressIndex}'`;

  // Derive child key using HMAC (standard wallet method)
  const hmacInput = CryptoJS.enc.Hex.parse(wallet.masterPrivateKey);
  const hmacKey = CryptoJS.enc.Utf8.parse(derivationPath);
  const hmacOutput = CryptoJS.HmacSHA512(hmacInput, hmacKey).toString();
  const childPrivateKey = hmacOutput.substring(0, 64);

  // Generate address from the derived key to verify
  const ec = new elliptic.ec("secp256k1");
  const keyPair = ec.keyFromPrivate(childPrivateKey);
  const publicKey = keyPair.getPublic(true, "hex");

  // Calculate address
  const sha256Hash = CryptoJS.SHA256(CryptoJS.enc.Hex.parse(publicKey));
  const ripemd160Hash = CryptoJS.RIPEMD160(sha256Hash);
  const programData = ripemd160Hash.toString();
  const witnessVersion = 0;
  const derivedAddress = createBech32(
    "alpha",
    witnessVersion,
    hexToBytes(programData)
  );

  // Verify the address matches
  if (derivedAddress === wallet.addresses[0].address) {
    wallet.childPrivateKey = childPrivateKey;
    wallet.addresses[0].publicKey = publicKey;
    wallet.addresses[0].path = derivationPath;

    return {
      success: true,
      message: "Address verified and private key recovered.",
    };
  } else {
    // Try to recover by scanning for the correct index
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

      if (testAddress === wallet.addresses[0].address) {
        wallet.childPrivateKey = testChildKey;
        wallet.addresses[0].publicKey = testPublicKey;
        wallet.addresses[0].path = testPath;
        wallet.addresses[0].index = i;

        return {
          success: true,
          message: `Found correct key at index ${i}.`,
        };
      }
    }

    // Still set the childPrivateKey to avoid using master key
    wallet.childPrivateKey = childPrivateKey;

    return {
      success: false,
      message: "Could not verify address. Wallet may not work correctly.",
    };
  }
}

// ===========================
// WALLET EXPORT
// ===========================

/**
 * Export wallet to text format
 * Compatible with index.html format (Legacy)
 */
export function exportWallet(
  wallet: Wallet,
  options: ExportOptions = {}
): string {
  const { password } = options;

  if (!wallet || !wallet.masterPrivateKey) {
    throw new Error("Invalid wallet - missing master private key");
  }

  let content: string;

  if (password) {
    // === ENCRYPTED WALLET ===

    const salt = "alpha_wallet_salt";

    // !!! CRITICAL FOR BACKWARD COMPATIBILITY !!!
    // We explicitly use SHA1 hasher to match the legacy browser defaults.
    // This ensures files created here can be opened by the old wallet.
    const passwordKey = CryptoJS.PBKDF2(password, salt, {
      keySize: 256 / 32,
      iterations: 100000,
      hasher: CryptoJS.algo.SHA1,
    }).toString();

    // The old wallet uses the passwordKey string as a Passphrase for AES
    const encryptedMasterKey = CryptoJS.AES.encrypt(
      wallet.masterPrivateKey,
      passwordKey
    ).toString();

    // Address format depends on wallet type
    let addressesText: string;
    if (wallet.isImportedAlphaWallet) {
      // BIP32 wallet - WITHOUT paths
      addressesText = wallet.addresses
        .map((addr, index) => `Address ${index + 1}: ${addr.address}`)
        .join("\n");
    } else {
      // Standard wallet - WITH paths
      addressesText = wallet.addresses
        .map(
          (a) =>
            `Address ${a.index + 1}: ${a.address} (Path: ${
              a.path || "undefined"
            })`
        )
        .join("\n");
    }

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
    // === UNENCRYPTED WALLET === (Logic remains mostly the same)

    const masterKeyWIF = hexToWIF(wallet.masterPrivateKey);

    let masterKeySection: string;
    let addressesText: string;

    if (wallet.isImportedAlphaWallet && wallet.masterChainCode) {
      // BIP32 format
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
      // Standard format
      addressesText = wallet.addresses
        .map(
          (a) =>
            `Address ${a.index + 1}: ${a.address} (Path: ${
              a.path || "undefined"
            })`
        )
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

// ===========================
// UTILITIES
// ===========================

export function downloadWalletFile(
  content: string,
  filename: string = "alpha_wallet_backup.txt"
): void {
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  const finalFilename = filename.endsWith(".txt")
    ? filename
    : filename + ".txt";
  a.download = finalFilename;
  document.body.appendChild(a);
  a.click();

  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}
