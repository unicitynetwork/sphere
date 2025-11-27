const fs = require('fs');
const crypto = require('crypto');
const elliptic = require('elliptic');
const ec = new elliptic.ec('secp256k1');

const data = fs.readFileSync('debug-service/examples/enc_test.dat');
const password = '123456';

console.log('Decrypting enc_test.dat with password:', password);
console.log('Expected first address: alpha1q2rs2cdargs5z43z57mv3awe6ajntk83evuy6n2');
console.log('');

// Find mkey at position 7069
const mkeyPos = 7069;
console.log('Processing mkey at position:', mkeyPos);

// Skip "mkey" (4 bytes) + version bytes (4 bytes) + length byte (1 byte)
const mkeyDataStart = mkeyPos + 4 + 4 + 1;
const mkeyDataLength = 48; // 0x30 = 48 bytes

const mkeyData = data.slice(mkeyDataStart, mkeyDataStart + mkeyDataLength);
console.log('mkey data (48 bytes):', mkeyData.toString('hex'));

// Parse the structure:
// First 8 bytes: salt
// Next 4 bytes: derivation method (should be 0)
// Next 4 bytes: iterations
// Remaining 32 bytes: encrypted master key
const salt = mkeyData.slice(0, 8);
const derivMethod = mkeyData.readUInt32LE(8);
const iterations = mkeyData.readUInt32LE(12);
const encryptedMasterKey = mkeyData.slice(16, 48);

console.log('\nParsed mkey structure:');
console.log('  Salt:', salt.toString('hex'));
console.log('  Derivation method:', derivMethod);
console.log('  Iterations:', iterations);
console.log('  Encrypted master key:', encryptedMasterKey.toString('hex'));

// Decrypt the master key
console.log('\nDecrypting master key...');

// Bitcoin Core uses PBKDF2 with SHA512
const derivedKey = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha512');
console.log('  Derived key:', derivedKey.toString('hex'));

// Generate IV using double SHA256
const ivSeed = Buffer.concat([derivedKey, salt]);
const iv = crypto.createHash('sha256').update(
    crypto.createHash('sha256').update(ivSeed).digest()
).digest().slice(0, 16);
console.log('  IV:', iv.toString('hex'));

try {
    // Decrypt using AES-256-CBC
    const decipher = crypto.createDecipheriv('aes-256-cbc', derivedKey, iv);
    decipher.setAutoPadding(true);
    
    const decryptedMasterKey = Buffer.concat([
        decipher.update(encryptedMasterKey),
        decipher.final()
    ]);
    
    console.log('  Decrypted master key:', decryptedMasterKey.toString('hex'));
    console.log('  ✓ Master key decrypted successfully!');
    
    // Now use the master key to decrypt private keys
    const masterKey = decryptedMasterKey.slice(0, 32);
    
    // Find walletdescriptorckey entries
    console.log('\n=== Decrypting private keys ===');
    
    const ckeyPattern = Buffer.from('walletdescriptorckey');
    let ckeyPos = data.indexOf(ckeyPattern);
    
    if (ckeyPos !== -1) {
        console.log('Found walletdescriptorckey at position:', ckeyPos);
        
        // Parse the encrypted key structure
        // Format: "walletdescriptorckey" + record data
        // The record contains: public key + encrypted private key
        
        let offset = ckeyPos + ckeyPattern.length;
        
        // Skip any length bytes or markers
        while (offset < data.length && data[offset] < 0x20) {
            offset++;
        }
        
        // Look for compressed public key (33 bytes starting with 0x02 or 0x03)
        if (data[offset] === 0x21) { // Length byte for 33-byte pubkey
            const pubKey = data.slice(offset + 1, offset + 34);
            console.log('  Public key:', pubKey.toString('hex'));
            
            // After public key comes the encrypted private key
            // It's typically 48 bytes (32 bytes key + 16 bytes padding for AES)
            offset = offset + 34;
            
            // Skip any markers
            while (offset < data.length && data[offset] < 0x20) {
                offset++;
            }
            
            const encryptedPrivKey = data.slice(offset, offset + 48);
            console.log('  Encrypted private key:', encryptedPrivKey.toString('hex'));
            
            // Decrypt the private key using the master key
            try {
                // Use the public key as part of the IV generation
                const privIvSeed = Buffer.concat([masterKey, pubKey]);
                const privIv = crypto.createHash('sha256').update(
                    crypto.createHash('sha256').update(privIvSeed).digest()
                ).digest().slice(0, 16);
                
                const privDecipher = crypto.createDecipheriv('aes-256-cbc', masterKey, privIv);
                privDecipher.setAutoPadding(true);
                
                const decryptedPrivKey = Buffer.concat([
                    privDecipher.update(encryptedPrivKey),
                    privDecipher.final()
                ]);
                
                const privateKey = decryptedPrivKey.slice(0, 32);
                console.log('  Decrypted private key:', privateKey.toString('hex'));
                
                // Generate address from the private key
                const keyPair = ec.keyFromPrivate(privateKey.toString('hex'));
                const publicKey = keyPair.getPublic(true, 'hex');
                
                // Create Alpha address (bech32)
                const pubKeyBuf = Buffer.from(publicKey, 'hex');
                const sha256Hash = crypto.createHash('sha256').update(pubKeyBuf).digest();
                const ripemd160Hash = crypto.createHash('ripemd160').update(sha256Hash).digest();
                
                // Simple bech32 encoding for testing
                console.log('  Generated public key:', publicKey);
                console.log('  Pubkey hash:', ripemd160Hash.toString('hex'));
                
                // Expected: alpha1q2rs2cdargs5z43z57mv3awe6ajntk83evuy6n2
                // The 'q' after alpha1 indicates witness version 0
                // The rest is the bech32-encoded pubkey hash
                
            } catch (e) {
                console.log('  Failed to decrypt private key:', e.message);
            }
        }
    }
    
} catch (e) {
    console.log('  ✗ Failed to decrypt master key:', e.message);
}