const fs = require('fs');
const crypto = require('crypto');
const elliptic = require('elliptic');
const ec = new elliptic.ec('secp256k1');

const data = fs.readFileSync('debug-service/examples/jerome.dat');
console.log('Searching for master private key in jerome.dat...\n');

// From the xpub, we know:
const masterPublicKey = '023dd9af882b75bda02fad844de00ad10d72b4e4957f7886e7202990bb993604';
const masterChainCode = '3a6b5c2dee915adb83dfa2d3acff1e4f420c9712503d6871082c348b5ff8879d';

console.log('Master public key from xpub:', masterPublicKey);
console.log('Master chain code from xpub:', masterChainCode);
console.log('');

// Try to find private key that corresponds to this public key
// Search for potential 32-byte private keys
const candidates = [];

// Pattern 1: Look for DER-encoded private keys (0201010420)
const derPattern = Buffer.from([0x02, 0x01, 0x01, 0x04, 0x20]);
let index = 0;
while ((index = data.indexOf(derPattern, index)) !== -1) {
    if (index >= 2) {
        const privKey = data.slice(index + 5, index + 37);
        const privKeyHex = privKey.toString('hex');
        
        // Test if this generates our public key
        try {
            const keyPair = ec.keyFromPrivate(privKeyHex);
            const pubKey = keyPair.getPublic(true, 'hex');
            
            if (pubKey === masterPublicKey) {
                console.log('✓ FOUND MASTER PRIVATE KEY!');
                console.log('  Position:', index);
                console.log('  Private key:', privKeyHex);
                console.log('  Public key:', pubKey);
                candidates.push({ position: index, privateKey: privKeyHex, type: 'DER' });
            }
        } catch (e) {
            // Invalid key
        }
    }
    index++;
}

// Pattern 2: Look for raw 32-byte sequences
console.log('\nSearching for raw 32-byte sequences...');
for (let i = 0; i < data.length - 32; i++) {
    const candidate = data.slice(i, i + 32);
    const candidateHex = candidate.toString('hex');
    
    // Quick filter - must look like a valid private key
    if (!candidateHex.match(/^[0-9a-f]{64}$/)) continue;
    if (candidateHex === '0'.repeat(64)) continue;
    if (candidateHex === 'f'.repeat(64)) continue;
    
    try {
        const keyPair = ec.keyFromPrivate(candidateHex);
        const pubKey = keyPair.getPublic(true, 'hex');
        
        if (pubKey === masterPublicKey) {
            console.log('✓ FOUND MASTER PRIVATE KEY (raw)!');
            console.log('  Position:', i);
            console.log('  Private key:', candidateHex);
            console.log('  Public key:', pubKey);
            candidates.push({ position: i, privateKey: candidateHex, type: 'raw' });
        }
    } catch (e) {
        // Invalid key
    }
    
    // Progress indicator
    if (i % 10000 === 0) {
        process.stdout.write(`\rProgress: ${Math.round(i * 100 / data.length)}%`);
    }
}
console.log('\r                    '); // Clear progress line

if (candidates.length === 0) {
    console.log('\n✗ Master private key not found directly');
    console.log('  The wallet might be encrypted or using a different storage format');
    
    // Let's look for patterns around where xpubs are stored
    console.log('\nLooking for key storage patterns near xpubs...');
    
    const xpubPattern = Buffer.from('xpub661MyMwAqRbcF8AiyTDeMyVW6efPP3Da7SWTSPpgv5ULkXN6FGkhJiEwbFCfwAYeuFJad2kZkDBqfnNfsossyPgPDszKYdrd46G1YBUJNQW');
    const xpubPos = data.indexOf(xpubPattern);
    if (xpubPos !== -1) {
        console.log('Found xpub at position:', xpubPos);
        
        // Look for patterns before the xpub
        console.log('\nBytes before xpub:');
        const before = data.slice(Math.max(0, xpubPos - 100), xpubPos);
        console.log(before.toString('hex'));
        
        // Look for key-related patterns
        const keyPatterns = ['key', 'ckey', 'mkey', 'hdmaster', 'hdseed'];
        keyPatterns.forEach(pattern => {
            const patternBuf = Buffer.from(pattern);
            const patternPos = before.lastIndexOf(patternBuf);
            if (patternPos !== -1) {
                console.log(`Found "${pattern}" at relative position:`, patternPos - before.length);
            }
        });
    }
} else {
    console.log(`\nFound ${candidates.length} candidate(s) for master private key`);
    
    // Test with expected address
    const expectedAddress = 'alpha1q5fv0lcer68nk7knq5j4nwjdl8tj60vltf55xra';
    console.log('\nTesting with expected address:', expectedAddress);
    
    candidates.forEach((cand, idx) => {
        console.log(`\nCandidate ${idx + 1}:`);
        console.log('  Private key:', cand.privateKey);
        console.log('  Type:', cand.type);
        
        // Test derivation path m/84'/1'/0'/0/0
        // This would be the first address
        // We'll need proper BIP32 derivation for this
    });
}