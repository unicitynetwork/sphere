const crypto = require('crypto');
const elliptic = require('elliptic');
const ec = new elliptic.ec('secp256k1');

// Master private key from the faulty wallet
const masterPrivateKey = '187e6965162cc24af690ad1f6c375989b5a6189c165dbbfcaad58a34cd4a4429';

// Target address details
const targetAddress = 'alpha1qllh2t42ytsgnx8fferxwms6npec7whvnaxta7d';
const targetPubkeyHash = 'ffeea5d5445c11331d29c8ccedc3530e71e75d93';

console.log('Searching for derivation path...');
console.log('Master Private Key:', masterPrivateKey);
console.log('Target Address:', targetAddress);
console.log('Target Pubkey Hash:', targetPubkeyHash);
console.log('');

// Function to derive child key using HMAC (standard wallet method)
function deriveChildKey(masterKey, index) {
    const path = `m/44'/0'/${index}'`;
    const hmac = crypto.createHmac('sha512', path);
    hmac.update(Buffer.from(masterKey, 'hex'));
    const output = hmac.digest('hex');
    return output.substring(0, 64); // First 32 bytes
}

// Function to get pubkey hash from private key
function getPubkeyHash(privateKeyHex) {
    const keyPair = ec.keyFromPrivate(privateKeyHex, 'hex');
    const publicKey = keyPair.getPublic(true, 'hex'); // compressed
    const sha256 = crypto.createHash('sha256').update(Buffer.from(publicKey, 'hex')).digest();
    const ripemd160 = crypto.createHash('ripemd160').update(sha256).digest();
    return ripemd160.toString('hex');
}

// Try different indices
console.log('Testing standard HMAC derivation (m/44\'/0\'/index\')...\n');
for (let i = 0; i < 100; i++) {
    const childPrivateKey = deriveChildKey(masterPrivateKey, i);
    const pubkeyHash = getPubkeyHash(childPrivateKey);
    
    if (i < 10 || pubkeyHash === targetPubkeyHash) {
        const keyPair = ec.keyFromPrivate(childPrivateKey, 'hex');
        const publicKey = keyPair.getPublic(true, 'hex');
        console.log(`Index ${i} (m/44'/0'/${i}'):`);
        console.log(`  Private Key: ${childPrivateKey}`);
        console.log(`  Public Key: ${publicKey}`);
        console.log(`  Pubkey Hash: ${pubkeyHash}`);
        
        if (pubkeyHash === targetPubkeyHash) {
            console.log(`  ✓ MATCH FOUND! This is the correct derivation path!`);
            console.log(`\nSUCCESS: The address was derived at index ${i} with path m/44'/0'/${i}'`);
            console.log(`Child Private Key to use: ${childPrivateKey}`);
            break;
        } else {
            console.log(`  ✗ No match`);
        }
        console.log('');
    }
}

// Also try using the master key directly (no derivation)
console.log('\nTesting master key directly (no derivation)...');
const masterPubkeyHash = getPubkeyHash(masterPrivateKey);
const masterKeyPair = ec.keyFromPrivate(masterPrivateKey, 'hex');
const masterPublicKey = masterKeyPair.getPublic(true, 'hex');
console.log('Master Private Key:', masterPrivateKey);
console.log('Master Public Key:', masterPublicKey);
console.log('Master Pubkey Hash:', masterPubkeyHash);
if (masterPubkeyHash === targetPubkeyHash) {
    console.log('✓ MATCH FOUND! The address uses the master key directly!');
} else {
    console.log('✗ No match');
}