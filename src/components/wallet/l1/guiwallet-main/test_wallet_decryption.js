const fs = require('fs');
const crypto = require('crypto');

// Read the encrypted wallet
const data = fs.readFileSync('debug-service/examples/enc_test.dat');
const password = '123456';

console.log('Testing wallet decryption with password:', password);
console.log('');

// Find mkey record - contains encrypted master key
const mkeyPattern = Buffer.from('mkey');
const mkeyPos = data.indexOf(mkeyPattern);

if (mkeyPos === -1) {
    console.log('No mkey found - wallet may not be encrypted');
    process.exit(1);
}

console.log('Found mkey at position:', mkeyPos);

// Parse mkey structure
// The format after "mkey" is typically:
// - Length byte for the key record
// - Then another length byte for the actual data
// - Then: nDerivationMethod (4 bytes), nDeriveIterations (4 bytes), vchSalt (8 bytes), vchCryptedKey (remaining)

let offset = mkeyPos + 4; // Skip "mkey"

// Skip any record length bytes (SQLite structure)
// We need to find the actual crypto parameters
// Look for a pattern that makes sense

// Search for the actual encrypted master key data
// It should be near the mkey marker
for (let skip = 0; skip < 50; skip++) {
    const testPos = offset + skip;
    if (testPos + 48 > data.length) continue;
    
    // Check if this looks like valid crypto data
    // Format: derivation method (4 bytes) + iterations (4 bytes) + salt (8 bytes) + encrypted (32+ bytes)
    const testData = data.slice(testPos, testPos + 100);
    
    // Derivation method is usually 0 (SHA512)
    const derivMethod = testData.readUInt32LE(0);
    const iterations = testData.readUInt32LE(4);
    
    // Iterations should be reasonable (25000-100000 typically)
    if (derivMethod === 0 && iterations > 10000 && iterations < 1000000) {
        console.log(`\nFound potential crypto params at offset ${skip}:`);
        console.log('  Derivation method:', derivMethod, '(0 = SHA512)');
        console.log('  Iterations:', iterations);
        
        const salt = testData.slice(8, 16);
        console.log('  Salt:', salt.toString('hex'));
        
        // The encrypted master key follows (typically 48 bytes for AES-256-CBC with padding)
        const encryptedMasterKey = testData.slice(16, 64);
        console.log('  Encrypted master key length:', encryptedMasterKey.length);
        console.log('  Encrypted master key:', encryptedMasterKey.toString('hex'));
        
        // Try to decrypt
        console.log('\nAttempting decryption...');
        
        // Derive key from password using PBKDF2
        // Bitcoin Core uses SHA512 for key derivation
        const derivedKey = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha512');
        console.log('  Derived key:', derivedKey.toString('hex'));
        
        // The encrypted data also contains an IV (first 16 bytes of derived key hash)
        // Bitcoin Core uses double-SHA256 for the IV
        const ivData = Buffer.concat([derivedKey, salt]);
        const iv = crypto.createHash('sha256').update(
            crypto.createHash('sha256').update(ivData).digest()
        ).digest().slice(0, 16);
        console.log('  IV:', iv.toString('hex'));
        
        try {
            // Decrypt using AES-256-CBC
            const decipher = crypto.createDecipheriv('aes-256-cbc', derivedKey, iv);
            decipher.setAutoPadding(true);
            
            const decrypted = Buffer.concat([
                decipher.update(encryptedMasterKey),
                decipher.final()
            ]);
            
            console.log('  Decrypted length:', decrypted.length);
            console.log('  Decrypted (hex):', decrypted.toString('hex'));
            
            // The decrypted master key should be 32 bytes
            if (decrypted.length >= 32) {
                const masterKey = decrypted.slice(0, 32);
                console.log('  Master key:', masterKey.toString('hex'));
                console.log('  ✓ Decryption successful!');
                
                // Now we can use this master key to decrypt the actual private keys
                break;
            }
        } catch (e) {
            console.log('  ✗ Decryption failed:', e.message);
        }
    }
}

// Also try with EVP_BytesToKey method (older Bitcoin Core versions)
console.log('\n=== Trying EVP_BytesToKey method ===');

function evpBytesToKey(password, salt, keyLen, ivLen) {
    const m = [];
    let i = 0;
    let count = 0;
    
    while (count < (keyLen + ivLen)) {
        const data = i === 0 ? Buffer.from(password) : Buffer.concat([m[i-1], Buffer.from(password)]);
        if (salt) {
            data = Buffer.concat([data, salt]);
        }
        
        const hash = crypto.createHash('sha256').update(data).digest();
        m.push(hash);
        count += hash.length;
        i++;
    }
    
    const ms = Buffer.concat(m);
    const key = ms.slice(0, keyLen);
    const iv = ms.slice(keyLen, keyLen + ivLen);
    
    return { key, iv };
}