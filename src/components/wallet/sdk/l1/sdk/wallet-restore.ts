import CryptoJS from "crypto-js";
import elliptic from "elliptic";
import type { Wallet, WalletAddress } from "./types";

// ===========================
// ТИПЫ
// ===========================

export interface RestoreOptions {
    file: File;
    password?: string;
    wallet: Wallet;
    currentUtxos: any[];
    currentTransactions: any[];
    currentTransactionPage: number;
    currentUtxoPage: number;
    offlineUtxoData: any;
    lazyScanInterval: any;
    lastScannedWalletData: any;
    scannedWallets: any[];
    electrumConnected: boolean;
    isInitialLoad: boolean;
}

export interface RestoreUIElements {
    restoreStatus: HTMLElement;
    restorePasswordInput: HTMLInputElement;
    walletBalance: HTMLElement | null;
    walletUnconfirmed: HTMLElement | null;
    passwordStrength: HTMLElement;
}

export interface RestoreCallbacks {
    restoreFromWalletDat: (file: File) => Promise<void>;
    generateNewAddress: () => void;
    addAddressToUI: (addressInfo: WalletAddress) => void;
    saveWalletData: () => void;
    closeRestoreModal: () => void;
    showInAppNotification: (title: string, message: string, type?: string) => void;
    refreshBalance: () => void;
    updateTransactionHistory: () => void;
    updateButtonStates: (enabled: boolean) => void;
    hexToWIF: (hex: string) => string;
    createBech32: (hrp: string, witnessVersion: number, data: Uint8Array) => string;
    hexToBytes: (hex: string) => Uint8Array;
}

export interface RestoreResult {
    success: boolean;
    wallet: Wallet;
    message?: string;
    error?: string;
}

// ===========================
// ОСНОВНАЯ ФУНКЦИЯ RESTORE
// ===========================

/**
 * Восстановление кошелька из файла
 * Полный порт функции restoreWallet из index.html
 */
export async function restoreWallet(
    options: RestoreOptions,
    uiElements: RestoreUIElements,
    callbacks: RestoreCallbacks
): Promise<RestoreResult> {
    const { file } = options;
    const { restoreStatus, restorePasswordInput, walletBalance, walletUnconfirmed, passwordStrength } = uiElements;

    if (!file) {
        restoreStatus.className = 'info-box error';
        restoreStatus.textContent = 'Please select a wallet backup file.';
        restoreStatus.style.display = 'block';
        return { success: false, wallet: options.wallet, error: 'No file selected' };
    }

    // Clear ALL previous wallet state before loading new wallet
    console.log('Clearing previous wallet state...');
    options.currentUtxos = [];
    options.currentTransactions = [];
    options.currentTransactionPage = 1;
    options.currentUtxoPage = 1;
    options.offlineUtxoData = null;

    // Clear UI displays
    if (walletBalance) walletBalance.textContent = '0.00000000 ALPHA';
    if (walletUnconfirmed) walletUnconfirmed.textContent = '';

    const transactionHistoryList = document.getElementById('transactionHistoryList');
    if (transactionHistoryList) {
        transactionHistoryList.innerHTML = '<div style="text-align: center; color: #666; padding: 20px;">Loading wallet...</div>';
    }

    const currentUtxoList = document.getElementById('currentUtxoList');
    if (currentUtxoList) {
        currentUtxoList.innerHTML = '<div style="text-align: center; color: #666; padding: 20px;">Loading wallet...</div>';
    }

    // Clear any existing scan cache when loading a new wallet
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith('walletScan_') ||
                   key.startsWith('walletScanCache_') ||
                   key === 'lastScannedWalletData' ||
                   key === 'lastLazyScanTime')) {
            keysToRemove.push(key);
        }
    }
    keysToRemove.forEach(key => {
        localStorage.removeItem(key);
        console.log('Cleared cached scan data on wallet load:', key);
    });

    // Clear in-memory scan data and stop any ongoing rescans
    options.lastScannedWalletData = null;
    options.scannedWallets = [];

    // Clear any existing rescan interval
    if (options.lazyScanInterval) {
        clearInterval(options.lazyScanInterval);
        options.lazyScanInterval = null;
    }

    try {
        // Check if this is a wallet.dat file (SQLite)
        if (file.name.endsWith('.dat')) {
            await callbacks.restoreFromWalletDat(file);
            return { success: true, wallet: options.wallet };
        }

        // Otherwise, read as text file (original backup format)
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
                const password = restorePasswordInput.value;
                if (!password) {
                    restoreStatus.className = 'info-box error';
                    restoreStatus.textContent = 'This is an encrypted wallet. Please enter the decryption password.';
                    restoreStatus.style.display = 'block';
                    return { success: false, wallet: options.wallet, error: 'Password required' };
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
                        restoreStatus.className = 'info-box error';
                        restoreStatus.textContent = 'Failed to decrypt the wallet. The password may be incorrect.';
                        restoreStatus.style.display = 'block';
                        return { success: false, wallet: options.wallet, error: 'Decryption failed' };
                    }
                    console.log('Successfully decrypted master key:', masterKey.substring(0, 8) + '...');
                } catch (e: any) {
                    restoreStatus.className = 'info-box error';
                    restoreStatus.textContent = 'Error decrypting wallet: ' + e.message;
                    restoreStatus.style.display = 'block';
                    return { success: false, wallet: options.wallet, error: e.message };
                }
            } else {
                restoreStatus.className = 'info-box error';
                restoreStatus.textContent = 'Could not find the encrypted master key in the backup file.';
                restoreStatus.style.display = 'block';
                return { success: false, wallet: options.wallet, error: 'Encrypted key not found' };
            }
        } else {
            // Unencrypted wallet, extract the master key directly
            const masterKeyMatch = fileContent.match(/MASTER PRIVATE KEY \(keep secret!\):\s*([^\n]+)/);
            if (masterKeyMatch && masterKeyMatch[1]) {
                masterKey = masterKeyMatch[1].trim();
            } else {
                restoreStatus.className = 'info-box error';
                restoreStatus.textContent = 'Could not find the master private key in the backup file.';
                restoreStatus.style.display = 'block';
                return { success: false, wallet: options.wallet, error: 'Master key not found' };
            }
        }

        // Check if this is an Alpha descriptor wallet with chain code
        let masterChainCode: string | null = null;
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
                // or: "Address 1: alpha1qllh2t42ytsgnx8fferxwms6npec7whvnaxta7d (Path: undefined)"
                const addressMatch = line.match(/Address\s+(\d+):\s+(\w+)\s*\(Path:\s*([^)]*)\)/);
                if (addressMatch) {
                    const index = parseInt(addressMatch[1]) - 1; // Convert to 0-based index
                    const address = addressMatch[2];
                    const path = addressMatch[3] === 'undefined' ? null : addressMatch[3];
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

        // Confirmation before overwriting
        if (options.wallet.masterPrivateKey) {
            const confirmOverwrite = confirm('This will overwrite your existing wallet. Are you sure you want to proceed?');
            if (!confirmOverwrite) {
                return { success: false, wallet: options.wallet, error: 'User cancelled' };
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
            masterChainCode: masterChainCode
        };

        // Update the wallet reference
        options.wallet = newWallet;

        // Update global reference if it exists
        if (typeof window !== 'undefined') {
            (window as any).walletGlobal = newWallet;
        }

        // Enable buttons
        callbacks.updateButtonStates(true);

        // Update encryption UI
        if (isEncrypted) {
            // Hide password strength indicator when wallet is encrypted
            passwordStrength.innerHTML = '';
        }

        // Generate addresses properly
        if (newWallet.isImportedAlphaWallet && newWallet.masterChainCode) {
            // For BIP32 wallets, ALWAYS regenerate addresses from master key
            // Don't trust the addresses in the file - derive them properly
            newWallet.addresses = [];
            callbacks.generateNewAddress();
        } else if (newWallet.addresses.length === 0) {
            // For standard wallets with no addresses, generate one
            callbacks.generateNewAddress();
        } else {
            // For standard wallets with addresses, recover and verify them
            console.log('Recovering standard wallet with parsed addresses:', newWallet.addresses);
            console.log('Master private key available:', !!newWallet.masterPrivateKey);
            console.log('Is encrypted:', newWallet.isEncrypted);

            // Keep only the first address for standard wallets
            if (newWallet.addresses.length > 1) {
                newWallet.addresses = [newWallet.addresses[0]];
            }

            // Recover childPrivateKey for the first address
            const result = await recoverChildPrivateKey(
                newWallet,
                callbacks.createBech32,
                callbacks.hexToBytes
            );

            if (result.success) {
                restoreStatus.className = 'info-box success';
                restoreStatus.textContent = result.message || 'Wallet restored successfully. Address verified and private key recovered.';
                restoreStatus.style.display = 'block';
            } else if (result.recovered) {
                restoreStatus.className = 'info-box success';
                restoreStatus.textContent = result.message || 'Wallet recovered!';
                restoreStatus.style.display = 'block';
            } else {
                restoreStatus.className = 'info-box warning';
                restoreStatus.textContent = result.message || 'Warning: Could not verify address. Wallet may not work correctly.';
                restoreStatus.style.display = 'block';
            }

            console.log('About to call addAddressToUI with:', newWallet.addresses[0]);
            callbacks.addAddressToUI(newWallet.addresses[0]);

            // Force wallet info section to be visible
            const walletInfoSection = document.getElementById('walletInfo');
            if (walletInfoSection) {
                walletInfoSection.style.display = 'block';
                console.log('Forced walletInfo section to be visible');
            }

            // Update the wallet address directly as backup
            const walletAddressElement = document.getElementById('walletAddress');
            if (walletAddressElement && newWallet.addresses[0]) {
                walletAddressElement.textContent = newWallet.addresses[0].address;
                console.log('Directly updated wallet address element to:', newWallet.addresses[0].address);
            }
        }

        // Save the restored wallet
        callbacks.saveWalletData();

        // Close the restore modal for non-BIP32 wallets
        if (!newWallet.isImportedAlphaWallet) {
            // Standard wallet - close modal and show wallet UI immediately
            callbacks.closeRestoreModal();

            // Show success notification
            if (isEncrypted) {
                callbacks.showInAppNotification('Encrypted Wallet Loaded', 'Successfully decrypted and recovered wallet', 'success');
            } else {
                callbacks.showInAppNotification('Wallet Loaded', 'Successfully loaded wallet', 'success');
            }
        }

        // If already connected to Fulcrum, refresh balance
        if (options.electrumConnected) {
            // Reset initial load flag when wallet is restored
            options.isInitialLoad = true;
            setTimeout(() => {
                callbacks.refreshBalance();
                callbacks.updateTransactionHistory();
                // Allow notifications after initial load
                setTimeout(() => {
                    options.isInitialLoad = false;
                }, 2000);
            }, 500);
        }

        // Show success message
        restoreStatus.className = 'info-box success';
        restoreStatus.textContent = 'Wallet restored successfully!';
        restoreStatus.style.display = 'block';
        callbacks.showInAppNotification('Wallet Restored', 'Your wallet has been successfully restored from backup', 'success');

        // Close modal after a delay
        setTimeout(() => {
            callbacks.closeRestoreModal();
        }, 2000);

        return {
            success: true,
            wallet: newWallet,
            message: 'Wallet restored successfully!'
        };

    } catch (e: any) {
        console.error('Error restoring wallet:', e);
        restoreStatus.className = 'info-box error';
        restoreStatus.textContent = 'Failed to restore wallet: ' + e.message;
        restoreStatus.style.display = 'block';
        return {
            success: false,
            wallet: options.wallet,
            error: e.message
        };
    }
}

// ===========================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ===========================

/**
 * Восстановление childPrivateKey для стандартного кошелька
 */
async function recoverChildPrivateKey(
    wallet: Wallet,
    createBech32: (hrp: string, witnessVersion: number, data: Uint8Array) => string,
    hexToBytes: (hex: string) => Uint8Array
): Promise<{ success: boolean; recovered?: boolean; message?: string }> {
    const addressIndex = wallet.addresses[0].index || 0;
    const derivationPath = `m/44'/0'/${addressIndex}'`;

    console.log('Attempting to derive child key for path:', derivationPath);
    console.log('Master key (first 8 chars):', wallet.masterPrivateKey ? wallet.masterPrivateKey.substring(0, 8) + '...' : 'null');

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
        console.log('✓ Address verification successful! Recovered childPrivateKey correctly.');
        console.log('  Address:', wallet.addresses[0].address);
        console.log('  Path:', derivationPath);
        console.log('  Child Private Key (first 8 chars):', childPrivateKey.substring(0, 8) + '...');

        wallet.childPrivateKey = childPrivateKey;
        wallet.addresses[0].publicKey = publicKey;
        wallet.addresses[0].path = derivationPath;

        return {
            success: true,
            message: 'Wallet restored successfully. Address verified and private key recovered.'
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
                    success: false,
                    recovered: true,
                    message: `Wallet recovered! Found correct key at index ${i}.`
                };
            }
        }

        // Still set the childPrivateKey to avoid using master key
        wallet.childPrivateKey = childPrivateKey;

        return {
            success: false,
            message: 'Warning: Could not verify address. Wallet may not work correctly.'
        };
    }
}
