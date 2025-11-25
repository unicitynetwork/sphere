const fs = require('fs');
const crypto = require('crypto');

const data = fs.readFileSync('debug-service/examples/enc_test.dat');
const password = '123456';

console.log('Testing standard Bitcoin/Alpha Core wallet decryption');
console.log('Password:', password);
console.log('');

// Standard Bitcoin Core mkey format after the record header:
// nDerivationMethod (4 bytes) - usually 0
// nDeriveIterations (4 bytes) - usually 25000-100000
// vchSalt (8 bytes)
// vchCryptedKey (32-48 bytes)

// But in the actual data, the format seems to be:
// Salt (8 bytes) first, then other data

const mkeyPos = 7069;
const dataStart = mkeyPos + 4 + 4 + 1; // Skip "mkey" + version + length byte
const mkeyData = data.slice(dataStart, dataStart + 48);

console.log('Raw mkey data (48 bytes):', mkeyData.toString('hex'));

// Try different common formats
const attempts = [
    {
        name: 'Format 1: salt(8) + iter(4) + method(4) + encrypted(32)',
        salt: mkeyData.slice(0, 8),
        iterations: mkeyData.readUInt32LE(8),
        method: mkeyData.readUInt32LE(12),
        encrypted: mkeyData.slice(16, 48)
    },
    {
        name: 'Format 2: iter(4) + salt(8) + encrypted(36)',
        iterations: mkeyData.readUInt32LE(0),
        salt: mkeyData.slice(4, 12),
        encrypted: mkeyData.slice(12, 48),
        method: 0
    },
    {
        name: 'Format 3: salt(8) + encrypted(40) with fixed iterations',
        salt: mkeyData.slice(0, 8),
        iterations: 25000, // Common default
        encrypted: mkeyData.slice(8, 48),
        method: 0
    },
    {
        name: 'Format 4: Simple format - all data is encrypted, use password hash as salt',
        salt: crypto.createHash('sha256').update(password).digest().slice(0, 8),
        iterations: 25000,
        encrypted: mkeyData,
        method: 0
    }
];

for (const attempt of attempts) {
    console.log(`\n=== ${attempt.name} ===`);
    console.log('  Salt:', attempt.salt.toString('hex'));
    console.log('  Iterations:', attempt.iterations);
    if (attempt.method !== undefined) console.log('  Method:', attempt.method);
    console.log('  Encrypted length:', attempt.encrypted.length);
    
    // Skip if iterations is unreasonable
    if (attempt.iterations < 1000 || attempt.iterations > 10000000) {
        console.log('  Skipping - unreasonable iteration count');
        continue;
    }
    
    // Try decryption with different methods
    const methods = ['sha512', 'sha256', 'sha1'];
    
    for (const hashMethod of methods) {
        try {
            // Derive key using PBKDF2
            const derivedKey = crypto.pbkdf2Sync(password, attempt.salt, attempt.iterations, 32, hashMethod);
            
            // Try different IV generation methods
            const ivMethods = [
                { name: 'double-sha256', iv: crypto.createHash('sha256').update(crypto.createHash('sha256').update(Buffer.concat([derivedKey, attempt.salt])).digest()).digest().slice(0, 16) },
                { name: 'single-sha256', iv: crypto.createHash('sha256').update(Buffer.concat([derivedKey, attempt.salt])).digest().slice(0, 16) },
                { name: 'derived-key', iv: derivedKey.slice(0, 16) },
                { name: 'zero-iv', iv: Buffer.alloc(16, 0) }
            ];
            
            for (const ivMethod of ivMethods) {
                try {
                    const decipher = crypto.createDecipheriv('aes-256-cbc', derivedKey, ivMethod.iv);
                    decipher.setAutoPadding(true);
                    
                    const decrypted = Buffer.concat([
                        decipher.update(attempt.encrypted),
                        decipher.final()
                    ]);
                    
                    // Check if decryption looks valid (should be 32 bytes or have valid padding)
                    if (decrypted.length >= 32) {
                        const masterKey = decrypted.slice(0, 32);
                        
                        // Check if it looks like a valid key (not all zeros, not all FFs)
                        const keyHex = masterKey.toString('hex');
                        if (keyHex !== '0'.repeat(64) && keyHex !== 'f'.repeat(64)) {
                            console.log(`  ✓ SUCCESS with ${hashMethod} + ${ivMethod.name}!`);
                            console.log('    Decrypted master key:', keyHex);
                            
                            // Save for further use
                            return { masterKey, derivedKey, iv: ivMethod.iv };
                        }
                    }
                } catch (e) {
                    // Decryption failed, try next
                }
            }
        } catch (e) {
            // Key derivation failed
        }
    }
    console.log('  ✗ All decryption attempts failed');
}

console.log('\n=== Checking other mkey records ===');
// Check the different mkey at position 12279
const mkey2Pos = 12279;
const data2Start = mkey2Pos + 4 + 4 + 1;
const mkey2Length = data[data2Start - 1];
console.log(`mkey at ${mkey2Pos}, length byte: ${mkey2Length}`);

if (mkey2Length === 8) {
    // This might be a different format - shorter record
    const mkey2Data = data.slice(data2Start, data2Start + 8);
    console.log('Short mkey data:', mkey2Data.toString('hex'));
    // This might just be metadata, not the actual encrypted key
}