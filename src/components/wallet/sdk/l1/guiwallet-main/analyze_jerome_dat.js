const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const elliptic = require('elliptic');
const ec = new elliptic.ec('secp256k1');

// Read the wallet.dat file
const filePath = path.join(__dirname, 'debug-service/examples/jerome.dat');
const data = fs.readFileSync(filePath);

console.log('File size:', data.length, 'bytes');
console.log('Expected address: alpha1q5fv0lcer68nk7knq5j4nwjdl8tj60vltf55xra');

// Look for descriptor wallet patterns
const searchPatterns = [
    { name: 'Private key prefix', pattern: Buffer.from('0201010420', 'hex') },
    { name: 'Range marker', pattern: Buffer.from('range', 'utf8') },
    { name: 'DESC marker', pattern: Buffer.from('DESC', 'utf8') },
    { name: 'wpkh descriptor', pattern: Buffer.from('wpkh([', 'utf8') },
    { name: 'Master marker', pattern: Buffer.from('master', 'utf8') },
    { name: 'Extended key', pattern: Buffer.from('extkey', 'utf8') },
    { name: 'Address prefix', pattern: Buffer.from('alpha1', 'utf8') }
];

searchPatterns.forEach(({ name, pattern }) => {
    let index = 0;
    const positions = [];
    while ((index = data.indexOf(pattern, index)) !== -1) {
        positions.push(index);
        index += pattern.length;
    }
    if (positions.length > 0) {
        console.log(`Found "${name}" at ${positions.length} position(s):`, positions.slice(0, 5));
    }
});

// Look for the expected address
const expectedAddress = 'alpha1q5fv0lcer68nk7knq5j4nwjdl8tj60vltf55xra';
const addressBuffer = Buffer.from(expectedAddress, 'utf8');
const addressPos = data.indexOf(addressBuffer);
console.log('\nExpected address found at position:', addressPos);

if (addressPos !== -1) {
    console.log('Context around address:');
    const start = Math.max(0, addressPos - 100);
    const end = Math.min(data.length, addressPos + 100);
    const context = data.slice(start, end);
    console.log('Hex:', context.toString('hex'));
    console.log('ASCII:', context.toString('ascii').replace(/[^\x20-\x7E]/g, '.'));
}

// Look for private keys (32 bytes after 0201010420)
const keyPrefix = Buffer.from('0201010420', 'hex');
let keyIndex = 0;
const foundKeys = [];

while ((keyIndex = data.indexOf(keyPrefix, keyIndex)) !== -1) {
    if (keyIndex + keyPrefix.length + 32 <= data.length) {
        const privateKey = data.slice(keyIndex + keyPrefix.length, keyIndex + keyPrefix.length + 32);
        const privateKeyHex = privateKey.toString('hex');
        
        // Generate public key and address
        try {
            const keyPair = ec.keyFromPrivate(privateKeyHex);
            const publicKey = keyPair.getPublic(true, 'hex');
            
            // Calculate pubkey hash
            const sha256 = crypto.createHash('sha256').update(Buffer.from(publicKey, 'hex')).digest();
            const ripemd160 = crypto.createHash('ripemd160').update(sha256).digest();
            const pubkeyHash = ripemd160.toString('hex');
            
            foundKeys.push({
                position: keyIndex,
                privateKey: privateKeyHex,
                publicKey: publicKey,
                pubkeyHash: pubkeyHash
            });
        } catch (e) {
            // Invalid key, skip
        }
    }
    keyIndex += keyPrefix.length;
}

console.log(`\nFound ${foundKeys.length} private key(s):`);
foundKeys.forEach((key, index) => {
    console.log(`\nKey ${index + 1}:`);
    console.log('  Position:', key.position);
    console.log('  Private Key:', key.privateKey);
    console.log('  Public Key:', key.publicKey);
    console.log('  Pubkey Hash:', key.pubkeyHash);
});

// Look for extended keys (xprv/xpub patterns)
const xprvPattern = Buffer.from('0488ade4', 'hex'); // xprv magic bytes
const xpubPattern = Buffer.from('0488b21e', 'hex'); // xpub magic bytes

let xprvIndex = data.indexOf(xprvPattern);
if (xprvIndex !== -1) {
    console.log('\nFound xprv at position:', xprvIndex);
    // Extended key is 78 bytes
    if (xprvIndex + 78 <= data.length) {
        const extKey = data.slice(xprvIndex, xprvIndex + 78);
        console.log('Extended private key (hex):', extKey.toString('hex'));
    }
}

let xpubIndex = data.indexOf(xpubPattern);
if (xpubIndex !== -1) {
    console.log('\nFound xpub at position:', xpubIndex);
    if (xpubIndex + 78 <= data.length) {
        const extKey = data.slice(xpubIndex, xpubIndex + 78);
        console.log('Extended public key (hex):', extKey.toString('hex'));
    }
}