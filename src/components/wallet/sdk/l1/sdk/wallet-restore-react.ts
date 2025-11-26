/**
 * React-friendly версия wallet restore
 * Упрощенная версия для использования в L1WalletView.tsx
 */

import CryptoJS from "crypto-js";
import elliptic from "elliptic";
import type { Wallet, WalletAddress } from "./types";

export interface RestoreWalletResult {
    success: boolean;
    wallet: Wallet;
    message?: string;
    error?: string;
}

/**
 * Восстановление кошелька из файла (React версия)
 * Упрощенная версия без DOM манипуляций
 */
export async function restoreWalletReact(
    file: File,
    password?: string,
    createBech32?: (hrp: string, witnessVersion: number, data: Uint8Array) => string,
    hexToBytes?: (hex: string) => Uint8Array
): Promise<RestoreWalletResult> {
    try {
        // Check if this is a wallet.dat file (SQLite) - not supported in React
        if (file.name.endsWith('.dat')) {
            throw new Error('wallet.dat files are not supported in React version. Please export as text file.');
        }

        // Read file content
        const fileContent = await file.text();

        // Parse the master key from the file
        let masterKey = '';
        let isEncrypted = false;
        let encryptedMasterKey = '';

        // Check if this is an encrypted wallet
        if (fileContent.includes('ENCRYPTED MASTER KEY')) {
            isEncrypted = true;
            console.log('Loading encrypted wallet...');

            // Extract the encrypted master key
            const encryptedKeyMatch = fileContent.match(/ENCRYPTED MASTER KEY \(password protected\):\s*([^\n]+)/);
            if (encryptedKeyMatch && encryptedKeyMatch[1]) {
                encryptedMasterKey = encryptedKeyMatch[1].trim();
                console.log('Found encrypted master key');

                // Get the decryption password
                if (!password) {
                    return {
                        success: false,
                        wallet: {} as Wallet,
                        error: 'This is an encrypted wallet. Please enter the decryption password.'
                    } as RestoreWalletResult;
                }

                // Decrypt the master key
                try {
                    console.log('Attempting to decrypt with provided password...');
                    const salt = "alpha_wallet_salt";
                    const passwordKey = CryptoJS.PBKDF2(password, salt, { keySize: 256/32, iterations: 100000 }).toString();

                    // Try to decrypt
                    const decryptedBytes = CryptoJS.AES.decrypt(encryptedMasterKey, passwordKey);
                    masterKey = decryptedBytes.toString(CryptoJS.enc.Utf8);

                    if (!masterKey) {
                        return {
                            success: false,
                            wallet: {} as Wallet,
                            error: 'Failed to decrypt the wallet. The password may be incorrect.'
                        } as RestoreWalletResult;
                    }
                    console.log('Successfully decrypted master key:', masterKey.substring(0, 8) + '...');
                } catch (e: any) {
                    return {
                        success: false,
                        wallet: {} as Wallet,
                        error: 'Error decrypting wallet: ' + e.message
                    } as RestoreWalletResult;
                }
            } else {
                return {
                    success: false,
                    wallet: {} as Wallet,
                    error: 'Could not find the encrypted master key in the backup file.'
                } as RestoreWalletResult;
            }
        } else {
            // Unencrypted wallet, extract the master key directly
            const masterKeyMatch = fileContent.match(/MASTER PRIVATE KEY \(keep secret!\):\s*([^\n]+)/);
            if (masterKeyMatch && masterKeyMatch[1]) {
                masterKey = masterKeyMatch[1].trim();
            } else {
                return {
                    success: false,
                    wallet: {} as Wallet,
                    error: 'Could not find the master private key in the backup file.'
                } as RestoreWalletResult;
            }
        }

        // Check if this is an Alpha descriptor wallet with chain code
        let masterChainCode: string | null | undefined = null;
        let isImportedAlphaWallet = false;

        const chainCodeMatch = fileContent.match(/MASTER CHAIN CODE \(for (?:BIP32 HD|Alpha) wallet compatibility\):\s*([^\n]+)/);
        if (chainCodeMatch && chainCodeMatch[1]) {
            masterChainCode = chainCodeMatch[1].trim();
            isImportedAlphaWallet = true;
        }

        // Also check wallet type explicitly
        if (fileContent.includes('WALLET TYPE: BIP32 hierarchical deterministic wallet') ||
            fileContent.includes('WALLET TYPE: Alpha descriptor wallet')) {
            isImportedAlphaWallet = true;
        }

        // Parse addresses from the backup file
        let parsedAddresses: WalletAddress[] = [];
        const addressSection = fileContent.match(/YOUR ADDRESSES:\s*\n([\s\S]*?)(?:\n\nGenerated on:|$)/);
        console.log('Address section found:', !!addressSection);

        if (addressSection && addressSection[1]) {
            const addressLines = addressSection[1].trim().split('\n');
            console.log('Address lines to parse:', addressLines);

            for (const line of addressLines) {
                // Parse lines like: "Address 1: alpha1qllh2t42ytsgnx8fferxwms6npec7whvnaxta7d (Path: m/44'/0'/0')"
                const addressMatch = line.match(/Address\s+(\d+):\s+(\w+)(?:\s*\(Path:\s*([^)]*)\))?/);
                if (addressMatch) {
                    const index = parseInt(addressMatch[1]) - 1; // Convert to 0-based index
                    const address = addressMatch[2];
                    const path = addressMatch[3] === 'undefined' ? null : (addressMatch[3] || null);
                    const addressInfo: WalletAddress = {
                        index: index,
                        address: address,
                        path: path,
                        createdAt: new Date().toISOString()
                    };
                    console.log('Parsed address:', addressInfo);
                    parsedAddresses.push(addressInfo);
                }
            }
        }
        console.log('Total parsed addresses:', parsedAddresses.length, parsedAddresses);

        // Create a new wallet with the restored master key
        const newWallet: Wallet = {
            masterPrivateKey: masterKey,
            addresses: parsedAddresses,
            isEncrypted: isEncrypted,
            encryptedMasterKey: encryptedMasterKey,
            childPrivateKey: null,
            isImportedAlphaWallet: isImportedAlphaWallet,
            masterChainCode: masterChainCode,
            chainCode: masterChainCode || undefined
        };

        // For standard wallets with addresses, recover and verify child private key
        if (!isImportedAlphaWallet && parsedAddresses.length > 0 && createBech32 && hexToBytes) {
            console.log('Recovering standard wallet with parsed addresses:', newWallet.addresses);

            // Keep only the first address for standard wallets
            if (newWallet.addresses.length > 1) {
                newWallet.addresses = [newWallet.addresses[0]];
            }

            // Recover childPrivateKey for the first address
            const result = recoverChildPrivateKey(newWallet, createBech32, hexToBytes);

            if (!result.success) {
                console.warn('Could not verify address:', result.message);
            }
        }

        return {
            success: true,
            wallet: newWallet,
            message: 'Wallet restored successfully!'
        };

    } catch (e: any) {
        console.error('Error restoring wallet:', e);
        return {
            success: false,
            wallet: {} as Wallet,
            error: e.message
        } as RestoreWalletResult;
    }
}

/**
 * Восстановление childPrivateKey для стандартного кошелька
 */
function recoverChildPrivateKey(
    wallet: Wallet,
    createBech32: (hrp: string, witnessVersion: number, data: Uint8Array) => string,
    hexToBytes: (hex: string) => Uint8Array
): { success: boolean; message?: string } {
    const addressIndex = wallet.addresses[0].index || 0;
    const derivationPath = `m/44'/0'/${addressIndex}'`;

    console.log('Attempting to derive child key for path:', derivationPath);

    // Derive child key using HMAC (standard wallet method)
    const hmacInput = CryptoJS.enc.Hex.parse(wallet.masterPrivateKey);
    const hmacKey = CryptoJS.enc.Utf8.parse(derivationPath);
    const hmacOutput = CryptoJS.HmacSHA512(hmacInput, hmacKey).toString();
    const childPrivateKey = hmacOutput.substring(0, 64);

    console.log('Derived child private key (first 8 chars):', childPrivateKey.substring(0, 8) + '...');

    // Generate address from the derived key to verify
    const ec = new elliptic.ec('secp256k1');
    const keyPair = ec.keyFromPrivate(childPrivateKey);
    const publicKey = keyPair.getPublic(true, 'hex');

    // Calculate address
    const sha256Hash = CryptoJS.SHA256(CryptoJS.enc.Hex.parse(publicKey));
    const ripemd160Hash = CryptoJS.RIPEMD160(sha256Hash);
    const programData = ripemd160Hash.toString();
    const witnessVersion = 0;
    const derivedAddress = createBech32('alpha', witnessVersion, hexToBytes(programData));

    // Verify the address matches
    if (derivedAddress === wallet.addresses[0].address) {
        console.log('✓ Address verification successful!');
        wallet.childPrivateKey = childPrivateKey;
        wallet.addresses[0].publicKey = publicKey;
        wallet.addresses[0].path = derivationPath;

        return {
            success: true,
            message: 'Address verified and private key recovered.'
        };
    } else {
        console.error('✗ Address verification failed!');
        console.error('Expected:', wallet.addresses[0].address);
        console.error('Derived:', derivedAddress);

        // Try to recover by scanning for the correct index
        for (let i = 0; i < 100; i++) {
            const testPath = `m/44'/0'/${i}'`;
            const testHmac = CryptoJS.HmacSHA512(hmacInput, CryptoJS.enc.Utf8.parse(testPath)).toString();
            const testChildKey = testHmac.substring(0, 64);
            const testKeyPair = ec.keyFromPrivate(testChildKey);
            const testPublicKey = testKeyPair.getPublic(true, 'hex');
            const testSha256 = CryptoJS.SHA256(CryptoJS.enc.Hex.parse(testPublicKey));
            const testRipemd = CryptoJS.RIPEMD160(testSha256);
            const testAddress = createBech32('alpha', witnessVersion, hexToBytes(testRipemd.toString()));

            if (testAddress === wallet.addresses[0].address) {
                console.log(`✓ Found correct derivation at index ${i}!`);
                wallet.childPrivateKey = testChildKey;
                wallet.addresses[0].publicKey = testPublicKey;
                wallet.addresses[0].path = testPath;
                wallet.addresses[0].index = i;

                return {
                    success: true,
                    message: `Found correct key at index ${i}.`
                };
            }
        }

        // Still set the childPrivateKey to avoid using master key
        wallet.childPrivateKey = childPrivateKey;

        return {
            success: false,
            message: 'Could not verify address. Wallet may not work correctly.'
        };
    }
}
