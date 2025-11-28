const fs = require('fs');
const crypto = require('crypto');

// Read the encrypted wallet
const data = fs.readFileSync('debug-service/examples/enc_test.dat');
console.log('Analyzing enc_test.dat (encrypted wallet)...');
console.log('File size:', data.length, 'bytes');
console.log('Password: 123456');
console.log('Expected first address: alpha1q2rs2cdargs5z43z57mv3awe6ajntk83evuy6n2');
console.log('');

// Look for encryption-related patterns
const patterns = [
    { name: 'mkey', pattern: Buffer.from('mkey') },
    { name: 'ckey', pattern: Buffer.from('ckey') },
    { name: 'keymeta', pattern: Buffer.from('keymeta') },
    { name: 'walletdescriptor', pattern: Buffer.from('walletdescriptor') },
    { name: 'walletdescriptorckey', pattern: Buffer.from('walletdescriptorckey') },
    { name: 'walletdescriptorkey', pattern: Buffer.from('walletdescriptorkey') },
    { name: 'defaultkey', pattern: Buffer.from('defaultkey') },
    { name: 'bestblock', pattern: Buffer.from('bestblock') },
];

console.log('Pattern search results:');
patterns.forEach(({ name, pattern }) => {
    let count = 0;
    let index = 0;
    const positions = [];
    while ((index = data.indexOf(pattern, index)) !== -1) {
        positions.push(index);
        count++;
        index++;
    }
    if (count > 0) {
        console.log(`  ${name}: ${count} occurrence(s) at positions:`, positions.slice(0, 3));
    }
});

// Look for mkey (master key) - this contains the encrypted master key
const mkeyPattern = Buffer.from('mkey');
const mkeyPos = data.indexOf(mkeyPattern);
if (mkeyPos !== -1) {
    console.log('\n=== Master Key (mkey) Analysis ===');
    console.log('Found mkey at position:', mkeyPos);
    
    // The mkey record typically contains:
    // - Salt (8 bytes)
    // - Derivation method (usually 0)
    // - Derivation iterations (4 bytes)
    // - Encrypted key material
    
    // Read some bytes after mkey
    const mkeyData = data.slice(mkeyPos, Math.min(mkeyPos + 200, data.length));
    console.log('mkey area (hex):', mkeyData.toString('hex').substring(0, 200));
    
    // Try to parse the structure
    // Skip the "mkey" text and any length indicators
    let offset = 4; // Skip "mkey"
    
    // Look for structured data
    // In Bitcoin Core wallets, after mkey there's usually a length byte, then the data
    if (mkeyPos + offset + 50 < data.length) {
        const lengthByte = mkeyData[offset];
        console.log('Length byte after mkey:', lengthByte);
        
        if (lengthByte > 0 && lengthByte < 100) {
            const encryptedData = mkeyData.slice(offset + 1, offset + 1 + lengthByte);
            console.log('Encrypted data length:', encryptedData.length);
            console.log('Encrypted data (hex):', encryptedData.toString('hex'));
            
            // The structure is typically:
            // 8 bytes salt + 4 bytes iterations + rest is encrypted key
            if (encryptedData.length >= 12) {
                const salt = encryptedData.slice(0, 8);
                const iterations = encryptedData.slice(8, 12).readUInt32LE(0);
                const encryptedKey = encryptedData.slice(12);
                
                console.log('\nParsed mkey structure:');
                console.log('  Salt:', salt.toString('hex'));
                console.log('  Iterations:', iterations);
                console.log('  Encrypted key length:', encryptedKey.length);
                console.log('  Encrypted key:', encryptedKey.toString('hex'));
            }
        }
    }
}

// Look for ckey (encrypted private keys)
console.log('\n=== Encrypted Keys (ckey) Analysis ===');
const ckeyPattern = Buffer.from('ckey');
let ckeyIndex = 0;
let ckeyCount = 0;
while ((ckeyIndex = data.indexOf(ckeyPattern, ckeyIndex)) !== -1 && ckeyCount < 3) {
    console.log(`\nckey ${ckeyCount + 1} at position:`, ckeyIndex);
    
    // ckey format: 
    // "ckey" + public key (33 bytes) + encrypted private key
    const ckeyData = data.slice(ckeyIndex, Math.min(ckeyIndex + 100, data.length));
    
    // Skip "ckey" and look for the public key
    let offset = 4;
    
    // Public key is typically 33 bytes (compressed) or 65 bytes (uncompressed)
    // Check for compressed public key (starts with 0x02 or 0x03)
    if (ckeyData[offset] === 0x21 && (ckeyData[offset + 1] === 0x02 || ckeyData[offset + 1] === 0x03)) {
        const pubKey = ckeyData.slice(offset + 1, offset + 34);
        console.log('  Public key:', pubKey.toString('hex'));
        
        // After public key comes the encrypted private key
        // Usually 48 bytes for AES-256-CBC encrypted 32-byte key with padding
        const encPrivKey = ckeyData.slice(offset + 34, offset + 34 + 48);
        console.log('  Encrypted private key length:', encPrivKey.length);
        console.log('  Encrypted private key:', encPrivKey.toString('hex'));
    }
    
    ckeyCount++;
    ckeyIndex++;
}

// Look for walletdescriptorckey (encrypted descriptor keys)
console.log('\n=== Descriptor Encrypted Keys Analysis ===');
const descriptorCkeyPattern = Buffer.from('walletdescriptorckey');
let descriptorCkeyPos = data.indexOf(descriptorCkeyPattern);
if (descriptorCkeyPos !== -1) {
    console.log('Found walletdescriptorckey at position:', descriptorCkeyPos);
    
    // Similar structure to ckey but for descriptor wallets
    const dckeyData = data.slice(descriptorCkeyPos, Math.min(descriptorCkeyPos + 200, data.length));
    console.log('Descriptor ckey area (hex):', dckeyData.toString('hex').substring(0, 200));
}

console.log('\n=== Wallet Type ===');
if (data.indexOf(Buffer.from('walletdescriptor')) !== -1) {
    console.log('This is a DESCRIPTOR wallet (modern format)');
} else {
    console.log('This is a LEGACY wallet (old format)');
}

console.log('\n=== Encryption Info ===');
console.log('The wallet uses Bitcoin Core encryption:');
console.log('1. Master key (mkey) is encrypted with password-derived key');
console.log('2. Private keys (ckey) are encrypted with the master key');
console.log('3. Decryption process:');
console.log('   a. Derive key from password using PBKDF2/scrypt');
console.log('   b. Decrypt master key from mkey record');
console.log('   c. Use master key to decrypt individual private keys');