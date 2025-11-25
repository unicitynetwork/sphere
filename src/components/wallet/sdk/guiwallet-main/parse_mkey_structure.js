const fs = require('fs');
const crypto = require('crypto');

const data = fs.readFileSync('debug-service/examples/enc_test.dat');
const password = '123456';

// Find all mkey positions
const mkeyPattern = Buffer.from('mkey');
let mkeyPos = 0;
let mkeyCount = 0;

while ((mkeyPos = data.indexOf(mkeyPattern, mkeyPos)) !== -1) {
    console.log(`\n=== mkey ${++mkeyCount} at position ${mkeyPos} ===`);
    
    // Get context around mkey
    const contextStart = Math.max(0, mkeyPos - 20);
    const contextEnd = Math.min(data.length, mkeyPos + 100);
    const context = data.slice(contextStart, contextEnd);
    
    console.log('Context (hex):');
    console.log(context.toString('hex'));
    
    // Parse as SQLite record
    // In SQLite, the format is often: record_type + varint_length + data
    const mkeyData = data.slice(mkeyPos + 4, Math.min(mkeyPos + 100, data.length));
    
    // Look at the bytes after mkey
    console.log('\nBytes after mkey:');
    for (let i = 0; i < Math.min(20, mkeyData.length); i++) {
        console.log(`  [${i}]: 0x${mkeyData[i].toString(16).padStart(2, '0')} (${mkeyData[i]})`);
    }
    
    // The actual encrypted master key data might be in a specific format
    // Let's look for structures that make sense
    
    // Try to find the salt (8 bytes) + iterations (4 bytes) + encrypted key
    // The format might be: length_byte + data
    let parseOffset = 0;
    
    // Skip potential length bytes or record markers
    while (parseOffset < 10 && mkeyData[parseOffset] < 0x20) {
        parseOffset++;
    }
    
    if (parseOffset < mkeyData.length - 48) {
        console.log(`\nTrying to parse from offset ${parseOffset}:`);
        const testData = mkeyData.slice(parseOffset);
        
        // Method 1: Traditional Bitcoin Core format
        // salt (8) + method (4) + iterations (4) + encrypted (48)
        if (testData.length >= 64) {
            const salt = testData.slice(0, 8);
            const method = testData.readUInt32LE(8);
            const iterations = testData.readUInt32LE(12);
            const encrypted = testData.slice(16, 64);
            
            console.log('Parse attempt 1 (salt first):');
            console.log('  Salt:', salt.toString('hex'));
            console.log('  Method:', method);
            console.log('  Iterations:', iterations);
            console.log('  Encrypted:', encrypted.toString('hex'));
            
            if (iterations > 10000 && iterations < 1000000) {
                tryDecrypt(password, salt, iterations, encrypted, 'Method 1');
            }
        }
        
        // Method 2: Alternative format
        // method (4) + iterations (4) + salt (8) + encrypted (48)
        if (testData.length >= 64) {
            const method = testData.readUInt32LE(0);
            const iterations = testData.readUInt32LE(4);
            const salt = testData.slice(8, 16);
            const encrypted = testData.slice(16, 64);
            
            console.log('Parse attempt 2 (method first):');
            console.log('  Method:', method);
            console.log('  Iterations:', iterations);
            console.log('  Salt:', salt.toString('hex'));
            console.log('  Encrypted:', encrypted.toString('hex'));
            
            if (iterations > 10000 && iterations < 1000000) {
                tryDecrypt(password, salt, iterations, encrypted, 'Method 2');
            }
        }
    }
    
    mkeyPos++;
}

function tryDecrypt(password, salt, iterations, encryptedData, method) {
    console.log(`\n  Trying decryption with ${method}...`);
    
    try {
        // Derive key using PBKDF2 with SHA512 (Bitcoin Core standard)
        const derivedKey = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha512');
        console.log('    Derived key:', derivedKey.toString('hex'));
        
        // Generate IV - Bitcoin Core uses chained SHA256
        const ivSeed = Buffer.concat([derivedKey, salt]);
        const iv = crypto.createHash('sha256').update(
            crypto.createHash('sha256').update(ivSeed).digest()
        ).digest().slice(0, 16);
        console.log('    IV:', iv.toString('hex'));
        
        // Try AES-256-CBC decryption
        const decipher = crypto.createDecipheriv('aes-256-cbc', derivedKey, iv);
        decipher.setAutoPadding(true);
        
        const decrypted = Buffer.concat([
            decipher.update(encryptedData),
            decipher.final()
        ]);
        
        console.log('    Decrypted:', decrypted.toString('hex'));
        console.log('    ✓ Decryption successful!');
        
        // The master key should be 32 bytes
        if (decrypted.length >= 32) {
            const masterKey = decrypted.slice(0, 32);
            console.log('    Master key:', masterKey.toString('hex'));
            return masterKey;
        }
    } catch (e) {
        console.log('    ✗ Decryption failed:', e.message);
    }
    
    // Also try with just SHA256 for key derivation (older wallets)
    try {
        const derivedKey = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256');
        const iv = crypto.createHash('sha256').update(Buffer.concat([derivedKey, salt])).digest().slice(0, 16);
        
        const decipher = crypto.createDecipheriv('aes-256-cbc', derivedKey, iv);
        decipher.setAutoPadding(true);
        
        const decrypted = Buffer.concat([
            decipher.update(encryptedData),
            decipher.final()
        ]);
        
        console.log('    Alternative (SHA256) decrypted:', decrypted.toString('hex'));
        return decrypted.slice(0, 32);
    } catch (e) {
        // Failed
    }
    
    return null;
}