const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const elliptic = require('elliptic');
const ec = new elliptic.ec('secp256k1');

// Base58 decode function for xpubs
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

function analyzeWalletDat(filePath, expectedAddress) {
    const data = fs.readFileSync(filePath);
    console.log(`\n=== Analyzing ${path.basename(filePath)} ===`);
    console.log('File size:', data.length, 'bytes');
    if (expectedAddress) {
        console.log('Expected address:', expectedAddress);
    }
    
    const result = {
        descriptorKeys: [],
        xpubs: [],
        descriptors: [],
        privateKeys: [],
        chainCodes: []
    };
    
    // Look for walletdescriptorkey pattern
    const descriptorKeyPattern = Buffer.from('walletdescriptorkey');
    let index = 0;
    while ((index = data.indexOf(descriptorKeyPattern, index)) !== -1) {
        console.log(`Found walletdescriptorkey at position ${index}`);
        
        // Look for private key after the pattern
        for (let checkPos = index + descriptorKeyPattern.length; 
             checkPos < Math.min(index + descriptorKeyPattern.length + 200, data.length - 40); 
             checkPos++) {
            
            // Pattern: d30201010420 
            if (data[checkPos] === 0xd3 &&
                data[checkPos + 1] === 0x02 &&
                data[checkPos + 2] === 0x01 &&
                data[checkPos + 3] === 0x01 &&
                data[checkPos + 4] === 0x04 &&
                data[checkPos + 5] === 0x20) {
                
                const privKey = data.slice(checkPos + 6, checkPos + 38);
                const privKeyHex = privKey.toString('hex');
                result.descriptorKeys.push(privKeyHex);
                console.log(`  Found descriptor private key: ${privKeyHex}`);
                break;
            }
        }
        index++;
    }
    
    // Look for any DER-encoded private keys
    const derPattern = Buffer.from([0x02, 0x01, 0x01, 0x04, 0x20]);
    index = 0;
    while ((index = data.indexOf(derPattern, index)) !== -1) {
        if (index >= 2 && data[index - 2] === 0x30) {
            // This looks like a DER sequence
            const privKey = data.slice(index + 5, index + 37);
            const privKeyHex = privKey.toString('hex');
            if (!result.privateKeys.includes(privKeyHex) && privKeyHex.match(/^[0-9a-f]{64}$/)) {
                result.privateKeys.push(privKeyHex);
                console.log(`Found DER private key at ${index}: ${privKeyHex}`);
            }
        }
        index++;
    }
    
    // Look for xpubs and extract chain codes
    const xpubPattern = Buffer.from('xpub');
    const base58Chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    let searchPos = 0;
    
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
            try {
                const decoded = base58Decode(xpubStr);
                const depth = decoded[4];
                const fingerprint = decoded.slice(5, 9).toString('hex');
                const childNum = decoded.slice(9, 13);
                const chainCode = decoded.slice(13, 45);
                const publicKey = decoded.slice(45, 78);
                
                const xpubInfo = {
                    xpub: xpubStr.substring(0, 50) + '...',
                    depth: depth,
                    fingerprint: fingerprint,
                    chainCode: chainCode.toString('hex'),
                    publicKey: publicKey.toString('hex')
                };
                
                result.xpubs.push(xpubInfo);
                
                if (depth === 0 && !result.chainCodes.includes(xpubInfo.chainCode)) {
                    result.chainCodes.push(xpubInfo.chainCode);
                    console.log(`Found master chain code at depth 0: ${xpubInfo.chainCode}`);
                }
            } catch (e) {
                // Invalid xpub
            }
        }
        
        searchPos = xpubIndex + 4;
    }
    
    console.log(`Found ${result.xpubs.length} xpub(s), depths: ${[...new Set(result.xpubs.map(x => x.depth))].sort().join(', ')}`);
    
    // Look for wpkh descriptors
    const wpkhPattern = Buffer.from('wpkh([');
    let wpkhIndex = data.indexOf(wpkhPattern, 0);
    while (wpkhIndex !== -1) {
        const descriptorArea = data.slice(wpkhIndex, Math.min(wpkhIndex + 300, data.length));
        let descriptorStr = '';
        
        for (let i = 0; i < descriptorArea.length; i++) {
            const byte = descriptorArea[i];
            if (byte >= 32 && byte <= 126) {
                descriptorStr += String.fromCharCode(byte);
                if (descriptorStr.includes('*))')) break;
            }
        }
        
        if (descriptorStr.length > 10) {
            result.descriptors.push(descriptorStr);
            console.log(`Found descriptor: ${descriptorStr.substring(0, 80)}...`);
            
            // Parse the path
            const pathMatch = descriptorStr.match(/\[[\da-f]+\/(\d+'\/\d+'\/\d+')?\]/);
            if (pathMatch) {
                console.log(`  Descriptor path: ${pathMatch[1] || 'root'}`);
            }
        }
        
        wpkhIndex = data.indexOf(wpkhPattern, wpkhIndex + 1);
    }
    
    // Look for specific patterns that might indicate wallet type
    const patterns = [
        { name: 'hdchain', pattern: Buffer.from('hdchain') },
        { name: 'master', pattern: Buffer.from('master') },
        { name: 'DESC', pattern: Buffer.from('DESC') },
        { name: 'range', pattern: Buffer.from('range') }
    ];
    
    console.log('\nPattern occurrences:');
    patterns.forEach(({ name, pattern }) => {
        let count = 0;
        let idx = 0;
        while ((idx = data.indexOf(pattern, idx)) !== -1) {
            count++;
            idx++;
        }
        if (count > 0) {
            console.log(`  ${name}: ${count} occurrence(s)`);
        }
    });
    
    return result;
}

// Analyze both files
const jeromeResult = analyzeWalletDat('debug-service/examples/jerome.dat', 'alpha1q5fv0lcer68nk7knq5j4nwjdl8tj60vltf55xra');
const miningResult = analyzeWalletDat('debug-service/examples/main_mining (1).dat', null);

// Compare results
console.log('\n=== COMPARISON ===');
console.log('\njerome.dat:');
console.log('  Descriptor keys:', jeromeResult.descriptorKeys.length);
console.log('  Private keys:', jeromeResult.privateKeys.length);
console.log('  Chain codes:', jeromeResult.chainCodes.length);
console.log('  Descriptors:', jeromeResult.descriptors.length);
if (jeromeResult.descriptors.length > 0) {
    console.log('  First descriptor:', jeromeResult.descriptors[0].substring(0, 100));
}

console.log('\nmain_mining (1).dat:');
console.log('  Descriptor keys:', miningResult.descriptorKeys.length);
console.log('  Private keys:', miningResult.privateKeys.length);  
console.log('  Chain codes:', miningResult.chainCodes.length);
console.log('  Descriptors:', miningResult.descriptors.length);
if (miningResult.descriptors.length > 0) {
    console.log('  First descriptor:', miningResult.descriptors[0].substring(0, 100));
}

// If we have private keys, test them
if (jeromeResult.privateKeys.length > 0) {
    console.log('\n=== Testing jerome.dat private keys ===');
    const expectedAddress = 'alpha1q5fv0lcer68nk7knq5j4nwjdl8tj60vltf55xra';
    
    jeromeResult.privateKeys.forEach((privKey, idx) => {
        console.log(`\nTesting private key ${idx + 1}: ${privKey}`);
        
        // Generate address directly
        const keyPair = ec.keyFromPrivate(privKey);
        const publicKey = keyPair.getPublic(true, 'hex');
        const publicKeyBuf = Buffer.from(publicKey, 'hex');
        
        const sha256 = crypto.createHash('sha256').update(publicKeyBuf).digest();
        const ripemd160 = crypto.createHash('ripemd160').update(sha256).digest();
        
        // Simple bech32 encoding for comparison
        const address = 'alpha1' + ripemd160.toString('hex'); // Simplified for comparison
        console.log('  Public key:', publicKey);
        console.log('  Pubkey hash:', ripemd160.toString('hex'));
        console.log('  Expected hash:', 'a2587fc71930d36792913964ed71279e517397f'); // from the expected address
    });
}