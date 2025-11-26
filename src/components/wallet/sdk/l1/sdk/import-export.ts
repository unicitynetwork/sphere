import CryptoJS from "crypto-js";
import { hexToWIF } from "./crypto";
import type { Wallet, WalletAddress } from "./types";

// ===========================
// ТИПЫ
// ===========================

export interface ImportResult {
    wallet: Wallet;
    wasEncrypted: boolean;
    parsedAddresses: WalletAddress[];
    addressCount: number;
}

export interface ExportOptions {
    filename?: string;
    password?: string;
}

// ===========================
// ИМПОРТ КОШЕЛЬКА
// ===========================

/**
 * Импорт кошелька из текстового файла
 * Точная копия логики из index.html функции restoreWallet()
 */
export async function importWallet(fileContent: string, password?: string): Promise<ImportResult> {
    console.log('Starting wallet import...');
    
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
                throw new Error('This is an encrypted wallet. Please enter the decryption password.');
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
                    throw new Error('Failed to decrypt the wallet. The password may be incorrect.');
                }
                console.log('Successfully decrypted master key:', masterKey.substring(0, 8) + '...');
            } catch (e: any) {
                throw new Error('Error decrypting wallet: ' + e.message);
            }
        } else {
            throw new Error('Could not find the encrypted master key in the backup file.');
        }
    } else {
        // Unencrypted wallet, extract the master key directly
        const masterKeyMatch = fileContent.match(/MASTER PRIVATE KEY \(keep secret!\):\s*([^\n]+)/);
        if (masterKeyMatch && masterKeyMatch[1]) {
            masterKey = masterKeyMatch[1].trim();
        } else {
            throw new Error('Could not find the master private key in the backup file.');
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
    
    // Create wallet object
    const wallet: Wallet = {
        masterPrivateKey: masterKey,
        addresses: parsedAddresses,
        isEncrypted: isEncrypted,
        encryptedMasterKey: encryptedMasterKey,
        childPrivateKey: null,
        isImportedAlphaWallet: isImportedAlphaWallet,
        masterChainCode: masterChainCode
    };
    
    return {
        wallet,
        wasEncrypted: isEncrypted,
        parsedAddresses,
        addressCount: parsedAddresses.length || 1
    };
}

// ===========================
// ЭКСПОРТ КОШЕЛЬКА
// ===========================

/**
 * Экспорт кошелька в текстовый формат
 * Совместимо с форматом index.html
 */
export function exportWallet(wallet: Wallet, options: ExportOptions = {}): string {
    const { password } = options;
    
    if (!wallet || !wallet.masterPrivateKey) {
        throw new Error('Invalid wallet - missing master private key');
    }
    
    if (!wallet.addresses || wallet.addresses.length === 0) {
        throw new Error('Invalid wallet - no addresses');
    }
    
    let content: string;
    
    if (password) {
        // === ЗАШИФРОВАННЫЙ КОШЕЛЕК ===
        
        const salt = "alpha_wallet_salt";
        const passwordKey = CryptoJS.PBKDF2(password, salt, { 
            keySize: 256/32, 
            iterations: 100000 
        }).toString();
        
        const encryptedMasterKey = CryptoJS.AES.encrypt(
            wallet.masterPrivateKey, 
            passwordKey
        ).toString();
        
        // Формат адресов зависит от типа кошелька
        let addressesText: string;
        if (wallet.isImportedAlphaWallet) {
            // BIP32 кошелек - БЕЗ путей
            addressesText = wallet.addresses
                .map((addr, index) => `Address ${index + 1}: ${addr.address}`)
                .join('\n');
        } else {
            // Standard кошелек - С путями
            addressesText = wallet.addresses
                .map(a => `Address ${a.index + 1}: ${a.address} (Path: ${a.path || 'undefined'})`)
                .join('\n');
        }
        
        let encryptedContent = `ENCRYPTED MASTER KEY (password protected):\r\n${encryptedMasterKey}`;
        
        if (wallet.isImportedAlphaWallet && wallet.masterChainCode) {
            encryptedContent += `\r\n\r\nMASTER CHAIN CODE (for BIP32 HD wallet compatibility):\r\n${wallet.masterChainCode}\r\n\r\nWALLET TYPE: BIP32 hierarchical deterministic wallet`;
        } else {
            encryptedContent += `\r\n\r\nWALLET TYPE: Standard wallet (HMAC-based)`;
        }
        
        content = `UNICITY WALLET DETAILS\r\n===========================\r\n\r\n${encryptedContent}\r\n\r\nENCRYPTION STATUS: Encrypted with password\r\nTo use this key, you will need the password you set in the wallet.\r\n\r\nYOUR ADDRESSES:\r\n${addressesText}\r\n\r\nGenerated on: ${new Date().toLocaleString()}\r\n\r\nWARNING: Keep your master private key safe and secure.\r\nAnyone with your master private key can access all your funds.`;
        
    } else {
        // === НЕЗАШИФРОВАННЫЙ КОШЕЛЕК ===
        
        const masterKeyWIF = hexToWIF(wallet.masterPrivateKey);
        
        let masterKeySection: string;
        let addressesText: string;
        
        if (wallet.isImportedAlphaWallet && wallet.masterChainCode) {
            // BIP32 формат
            masterKeySection = `MASTER PRIVATE KEY (keep secret!):\r\n${wallet.masterPrivateKey}\r\n\r\nMASTER PRIVATE KEY IN WIF FORMAT (for importprivkey command):\r\n${masterKeyWIF}\r\n\r\nMASTER CHAIN CODE (for BIP32 HD wallet compatibility):\r\n${wallet.masterChainCode}\r\n\r\nWALLET TYPE: BIP32 hierarchical deterministic wallet\r\n\r\nENCRYPTION STATUS: Not encrypted\r\nThis key is in plaintext and not protected. Anyone with this file can access your wallet.`;
            
            addressesText = wallet.addresses
                .map((addr, index) => `Address ${index + 1}: ${addr.address}`)
                .join('\n');
        } else {
            // Standard формат
            addressesText = wallet.addresses
                .map(a => `Address ${a.index + 1}: ${a.address} (Path: ${a.path || 'undefined'})`)
                .join('\n');
            
            masterKeySection = `MASTER PRIVATE KEY (keep secret!):\r\n${wallet.masterPrivateKey}\r\n\r\nMASTER PRIVATE KEY IN WIF FORMAT (for importprivkey command):\r\n${masterKeyWIF}\r\n\r\nWALLET TYPE: Standard wallet (HMAC-based)\r\n\r\nENCRYPTION STATUS: Not encrypted\r\nThis key is in plaintext and not protected. Anyone with this file can access your wallet.`;
        }
        
        content = `UNICITY WALLET DETAILS\r\n===========================\r\n\r\n${masterKeySection}\r\n\r\nYOUR ADDRESSES:\r\n${addressesText}\r\n\r\nGenerated on: ${new Date().toLocaleString()}\r\n\r\nWARNING: Keep your master private key safe and secure.\r\nAnyone with your master private key can access all your funds.`;
    }
    
    return content;
}

// ===========================
// УТИЛИТЫ
// ===========================

/**
 * Скачивание файла кошелька
 */
export function downloadWalletFile(content: string, filename: string = "alpha_wallet_backup.txt"): void {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    const finalFilename = filename.endsWith('.txt') ? filename : filename + '.txt';
    a.download = finalFilename;
    document.body.appendChild(a);
    a.click();
    
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 100);
}