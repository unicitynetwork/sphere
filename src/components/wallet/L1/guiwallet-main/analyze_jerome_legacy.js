const fs = require('fs');
const crypto = require('crypto');
const elliptic = require('elliptic');
const ec = new elliptic.ec('secp256k1');

// Read jerome.dat
const data = fs.readFileSync('debug-service/examples/jerome.dat');
console.log('Analyzing jerome.dat as legacy wallet...');
console.log('File size:', data.length, 'bytes');
console.log('Expected address: alpha1q5fv0lcer68nk7knq5j4nwjdl8tj60vltf55xra');
console.log('');

// Look for "key" records (legacy wallet format)
const keyPattern = Buffer.from('key');
let keyIndex = 0;
const foundKeys = [];

console.log('Searching for legacy "key" records...');
while ((keyIndex = data.indexOf(keyPattern, keyIndex)) !== -1) {
    // In legacy wallets, private keys often appear after "key" pattern
    // Look for 32-byte sequences that could be private keys
    
    for (let offset = keyIndex + 3; offset < Math.min(keyIndex + 100, data.length - 32); offset++) {
        // Look for potential 32-byte private key
        const candidate = data.slice(offset, offset + 32);
        const candidateHex = candidate.toString('hex');
        
        // Check if it looks like a valid private key (not all zeros, not all FFs, etc.)
        if (candidateHex.match(/^[0-9a-f]{64}$/) && 
            candidateHex !== '0'.repeat(64) && 
            candidateHex !== 'f'.repeat(64) &&
            !candidateHex.startsWith('00000000')) {
            
            // Check if we haven't seen this key before
            if (!foundKeys.find(k => k.hex === candidateHex)) {
                foundKeys.push({
                    position: offset,
                    hex: candidateHex,
                    context: data.slice(Math.max(0, offset - 10), Math.min(data.length, offset + 42)).toString('hex')
                });
            }
        }
    }
    
    keyIndex++;
}

console.log(`Found ${foundKeys.length} potential private keys`);

// Test each key
foundKeys.forEach((keyInfo, idx) => {
    console.log(`\nKey ${idx + 1} at position ${keyInfo.position}:`);
    console.log('  Hex:', keyInfo.hex);
    
    try {
        // Generate address
        const keyPair = ec.keyFromPrivate(keyInfo.hex);
        const publicKey = keyPair.getPublic(true, 'hex');
        const publicKeyBuf = Buffer.from(publicKey, 'hex');
        
        const sha256 = crypto.createHash('sha256').update(publicKeyBuf).digest();
        const ripemd160 = crypto.createHash('ripemd160').update(sha256).digest();
        
        console.log('  Public key:', publicKey);
        console.log('  Pubkey hash:', ripemd160.toString('hex'));
        
        // Expected pubkey hash from the address alpha1q5fv0lcer68nk7knq5j4nwjdl8tj60vltf55xra
        // After 'alpha1q' comes the bech32-encoded pubkey hash
        // The 'q' in alpha1q represents witness version 0
        // The rest '5fv0lcer68nk7knq5j4nwjdl8tj60vltf55xra' is the data
        
        if (ripemd160.toString('hex') === 'a2587fc71930d36792913964ed71279e517397f') {
            console.log('  ✓ MATCHES EXPECTED ADDRESS!');
        }
    } catch (e) {
        console.log('  Invalid key:', e.message);
    }
});

// Look for specific wallet type indicators
console.log('\n=== Wallet Type Analysis ===');

const patterns = [
    { name: 'walletdescriptor', pattern: Buffer.from('walletdescriptor') },
    { name: 'hdchain', pattern: Buffer.from('hdchain') },
    { name: 'hdmaster', pattern: Buffer.from('hdmaster') },
    { name: 'hdseed', pattern: Buffer.from('hdseed') },
    { name: 'master', pattern: Buffer.from('master') },
    { name: 'mkey', pattern: Buffer.from('mkey') },
    { name: 'ckey', pattern: Buffer.from('ckey') },
    { name: 'keymeta', pattern: Buffer.from('keymeta') },
    { name: 'watchmeta', pattern: Buffer.from('watchmeta') },
    { name: 'purpose', pattern: Buffer.from('purpose') }
];

patterns.forEach(({ name, pattern }) => {
    let count = 0;
    let idx = 0;
    const positions = [];
    while ((idx = data.indexOf(pattern, idx)) !== -1) {
        positions.push(idx);
        count++;
        idx++;
    }
    if (count > 0) {
        console.log(`${name}: ${count} occurrence(s) at positions:`, positions.slice(0, 5));
    }
});

// Check if this might be an encrypted wallet
const encryptedPattern = Buffer.from('encrypted');
if (data.indexOf(encryptedPattern) !== -1) {
    console.log('\n⚠️  This wallet may be encrypted!');
}

// Look for Bitcoin Core/Alpha Core specific markers
console.log('\n=== Looking for Core wallet markers ===');
const corePatterns = [
    Buffer.from('0201010420'), // DER private key prefix
    Buffer.from([0x30, 0x81, 0xd3, 0x02, 0x01, 0x01]), // Another DER format
    Buffer.from([0x30, 0x82]) // Yet another DER format
];

corePatterns.forEach((pattern, idx) => {
    let count = 0;
    let pos = 0;
    while ((pos = data.indexOf(pattern, pos)) !== -1) {
        count++;
        pos++;
    }
    if (count > 0) {
        console.log(`DER pattern ${idx + 1}: ${count} occurrence(s)`);
    }
});