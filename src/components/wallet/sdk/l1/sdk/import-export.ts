import type { Wallet } from "./types";
import { encryptWallet, decryptWallet, hexToWIF } from "./crypto";

export interface ExportOptions {
    filename?: string;
    password?: string;
}

export interface ImportResult {
    wallet: Wallet;
    wasEncrypted: boolean;
    addressCount?: number;
}

/**
 * Export wallet to text format (compatible with index.html format)
 */
export function exportWallet(wallet: Wallet, options: ExportOptions = {}): string {
    const { password } = options;

    let content: string;

    if (password) {
        // Encrypt the master key
        const encryptedMasterKey = encryptWallet(wallet.masterPrivateKey, password);

        // Format addresses
        const addressesText = wallet.addresses
            .map((addr, index) => `Address ${index + 1}: ${addr.address} (Path: ${addr.path})`)
            .join("\n");

        content = `UNICITY WALLET DETAILS
===========================

ENCRYPTED MASTER KEY (password protected):
${encryptedMasterKey}

MASTER CHAIN CODE (for BIP32 HD wallet compatibility):
${wallet.chainCode}

WALLET TYPE: Standard wallet (HMAC-based)

ENCRYPTION STATUS: Encrypted with password
To use this key, you will need the password you set in the wallet.

YOUR ADDRESSES:
${addressesText}

Generated on: ${new Date().toLocaleString()}

WARNING: Keep your master private key safe and secure.
Anyone with your master private key can access all your funds.`;
    } else {
        // Unencrypted wallet
        const masterKeyWIF = hexToWIF(wallet.masterPrivateKey);

        const addressesText = wallet.addresses
            .map((addr, index) => `Address ${index + 1}: ${addr.address} (Path: ${addr.path})`)
            .join("\n");

        content = `UNICITY WALLET DETAILS
===========================

MASTER PRIVATE KEY (keep secret!):
${wallet.masterPrivateKey}

MASTER PRIVATE KEY IN WIF FORMAT (for importprivkey command):
${masterKeyWIF}

MASTER CHAIN CODE (for BIP32 HD wallet compatibility):
${wallet.chainCode}

WALLET TYPE: Standard wallet (HMAC-based)

ENCRYPTION STATUS: Not encrypted
This key is in plaintext and not protected. Anyone with this file can access your wallet.

YOUR ADDRESSES:
${addressesText}

Generated on: ${new Date().toLocaleString()}

WARNING: Keep your master private key safe and secure.
Anyone with your master private key can access all your funds.`;
    }

    return content;
}

/**
 * Import wallet from text content
 */
export function importWallet(fileContent: string, password?: string): ImportResult {
    // Check if the wallet is encrypted
    const encryptedMatch = fileContent.match(/ENCRYPTED MASTER KEY \(password protected\):\s*([^\n]+)/);

    if (encryptedMatch) {
        // Encrypted wallet
        if (!password) {
            throw new Error("This wallet is encrypted. Please provide the password.");
        }

        const encryptedKey = encryptedMatch[1].trim();
        let masterPrivateKey: string;

        try {
            masterPrivateKey = decryptWallet(encryptedKey, password);

            if (!masterPrivateKey || masterPrivateKey.length === 0) {
                throw new Error("Decryption failed");
            }
        } catch (error) {
            throw new Error("Incorrect password or corrupted wallet file");
        }

        // Extract chain code
        const chainCodeMatch = fileContent.match(/MASTER CHAIN CODE.*?:\s*([a-f0-9]+)/i);
        if (!chainCodeMatch) {
            throw new Error("Invalid wallet format: missing chain code");
        }

        const chainCode = chainCodeMatch[1].trim();

        // Count addresses to regenerate
        const addressMatches = fileContent.match(/Address \d+:/g);
        const addressCount = addressMatches ? addressMatches.length : 1;

        // Create wallet object (addresses will be regenerated)
        const wallet: Wallet = {
            masterPrivateKey,
            chainCode,
            addresses: [],
            createdAt: Date.now(),
        };

        return {
            wallet,
            wasEncrypted: true,
            addressCount,
        };
    } else {
        // Unencrypted wallet
        const masterKeyMatch = fileContent.match(/MASTER PRIVATE KEY \(keep secret!\):\s*([a-f0-9]+)/i);
        if (!masterKeyMatch) {
            throw new Error("Invalid wallet format: missing master private key");
        }

        const masterPrivateKey = masterKeyMatch[1].trim();

        // Extract chain code
        const chainCodeMatch = fileContent.match(/MASTER CHAIN CODE.*?:\s*([a-f0-9]+)/i);
        if (!chainCodeMatch) {
            throw new Error("Invalid wallet format: missing chain code");
        }

        const chainCode = chainCodeMatch[1].trim();

        // Count addresses to regenerate
        const addressMatches = fileContent.match(/Address \d+:/g);
        const addressCount = addressMatches ? addressMatches.length : 1;

        // Create wallet object (addresses will be regenerated)
        const wallet: Wallet = {
            masterPrivateKey,
            chainCode,
            addresses: [],
            createdAt: Date.now(),
        };

        return {
            wallet,
            wasEncrypted: false,
            addressCount,
        };
    }
}

/**
 * Download wallet file
 */
export function downloadWalletFile(content: string, filename: string = "alpha_wallet_backup.txt"): void {
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = filename.endsWith(".txt") ? filename : `${filename}.txt`;
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 100);
}
