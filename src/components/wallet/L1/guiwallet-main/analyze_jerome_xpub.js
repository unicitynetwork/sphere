const fs = require('fs');

// Base58 decode function
function base58Decode(str) {
    const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    const ALPHABET_MAP = {};
    for (let i = 0; i < ALPHABET.length; i++) {
        ALPHABET_MAP[ALPHABET[i]] = i;
    }
    
    let zeros = 0;
    for (let i = 0; i < str.length && str[i] === '1'; i++) {
        zeros++;
    }
    
    let num = BigInt(0);
    for (let i = 0; i < str.length; i++) {
        const char = str[i];
        if (!(char in ALPHABET_MAP)) {
            throw new Error('Invalid base58 character: ' + char);
        }
        num = num * BigInt(58) + BigInt(ALPHABET_MAP[char]);
    }
    
    const bytes = [];
    while (num > 0) {
        bytes.unshift(Number(num % BigInt(256)));
        num = num / BigInt(256);
    }
    
    for (let i = 0; i < zeros; i++) {
        bytes.unshift(0);
    }
    
    return new Uint8Array(bytes);
}

const data = fs.readFileSync('debug-service/examples/jerome.dat');
console.log('Analyzing xpubs in jerome.dat...\n');

// Find all xpubs
const xpubPattern = Buffer.from('xpub');
const base58Chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
let searchPos = 0;
const xpubs = [];

while (searchPos < data.length) {
    let xpubIndex = data.indexOf(xpubPattern, searchPos);
    if (xpubIndex === -1) break;
    
    let xpubStr = 'xpub';
    let pos = xpubIndex + 4;
    
    while (pos < data.length && xpubStr.length < 120) {
        const char = String.fromCharCode(data[pos]);
        if (base58Chars.includes(char)) {
            xpubStr += char;
            pos++;
        } else {
            break;
        }
    }
    
    if (xpubStr.length > 100) {
        xpubs.push({ position: xpubIndex, xpub: xpubStr });
    }
    
    searchPos = xpubIndex + 4;
}

console.log(`Found ${xpubs.length} xpub(s)\n`);

// Analyze the first few xpubs
xpubs.slice(0, 5).forEach((item, idx) => {
    console.log(`\nXPUB ${idx + 1} at position ${item.position}:`);
    console.log('Full xpub:', item.xpub);
    
    try {
        const decoded = base58Decode(item.xpub);
        
        // xpub structure:
        // 4 bytes: version
        // 1 byte: depth
        // 4 bytes: parent fingerprint
        // 4 bytes: child number
        // 32 bytes: chain code
        // 33 bytes: public key
        
        const version = decoded.slice(0, 4);
        const depth = decoded[4];
        const fingerprint = decoded.slice(5, 9);
        const childNum = decoded.slice(9, 13);
        const chainCode = decoded.slice(13, 45);
        const publicKey = decoded.slice(45, 78);
        
        console.log('  Depth:', depth);
        console.log('  Parent fingerprint:', fingerprint.toString('hex'));
        console.log('  Child number:', Buffer.from(childNum).readUInt32BE(0));
        console.log('  Chain code:', chainCode.toString('hex'));
        console.log('  Public key:', publicKey.toString('hex'));
        
        if (depth === 0) {
            console.log('  *** This is a MASTER xpub (depth 0) ***');
        }
    } catch (e) {
        console.log('  Error decoding:', e.message);
    }
});

// Check if this is really a BIP32 wallet
console.log('\n=== Wallet Type Detection ===');
const hasMasterXpub = xpubs.some(item => {
    try {
        const decoded = base58Decode(item.xpub);
        return decoded[4] === 0; // depth 0
    } catch {
        return false;
    }
});

if (hasMasterXpub) {
    console.log('✓ This IS a BIP32 HD wallet (has master xpub at depth 0)');
} else {
    console.log('✗ This is NOT a BIP32 HD wallet (no master xpub found)');
    console.log('  It might be a watch-only wallet or imported keys wallet');
}

// Check for wallet type markers
const markers = [
    { name: 'hdchain', pattern: Buffer.from('hdchain') },
    { name: 'hdseed', pattern: Buffer.from('hdseed') },
    { name: 'hdmaster', pattern: Buffer.from('hdmaster') }
];

markers.forEach(({ name, pattern }) => {
    if (data.indexOf(pattern) !== -1) {
        console.log(`  Found ${name} marker - HD wallet indicator`);
    }
});