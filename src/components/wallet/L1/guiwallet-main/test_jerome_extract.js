const fs = require('fs');
const crypto = require('crypto');
const elliptic = require('elliptic');
const ec = new elliptic.ec('secp256k1');

// Bech32 encoding function
function bech32Encode(hrp, witver, witprog) {
    const alphabet = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
    
    // Convert witness program to 5-bit groups
    const values = [witver];
    let acc = 0;
    let bits = 0;
    for (const byte of witprog) {
        acc = (acc << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            bits -= 5;
            values.push((acc >> bits) & 31);
        }
    }
    if (bits > 0) {
        values.push((acc << (5 - bits)) & 31);
    }
    
    // Calculate checksum
    const hrpExpanded = [];
    for (let i = 0; i < hrp.length; i++) {
        hrpExpanded.push(hrp.charCodeAt(i) >> 5);
    }
    hrpExpanded.push(0);
    for (let i = 0; i < hrp.length; i++) {
        hrpExpanded.push(hrp.charCodeAt(i) & 31);
    }
    
    const polymod = (values) => {
        const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
        let chk = 1;
        for (const value of values) {
            const b = chk >> 25;
            chk = (chk & 0x1ffffff) << 5 ^ value;
            for (let i = 0; i < 5; i++) {
                chk ^= ((b >> i) & 1) ? GEN[i] : 0;
            }
        }
        return chk;
    };
    
    const combined = hrpExpanded.concat(values).concat([0, 0, 0, 0, 0, 0]);
    const checksum = polymod(combined) ^ 1;
    const checksumValues = [];
    for (let i = 0; i < 6; i++) {
        checksumValues.push((checksum >> (5 * (5 - i))) & 31);
    }
    
    // Build the address
    let address = hrp + '1';
    for (const val of values.concat(checksumValues)) {
        address += alphabet[val];
    }
    
    return address;
}

// Read the wallet.dat file
const data = fs.readFileSync('debug-service/examples/jerome.dat');
console.log('File size:', data.length, 'bytes');
console.log('Expected address: alpha1q5fv0lcer68nk7knq5j4nwjdl8tj60vltf55xra');

// Test with known master key if BIP32
const testMasterKeys = [
    // Common test keys
    '0000000000000000000000000000000000000000000000000000000000000001',
    'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
];

// Search for any 32-byte sequences that could be private keys
const possibleKeys = [];
const keyMarkers = [
    Buffer.from('0201010420', 'hex'), // DER private key marker
    Buffer.from('key', 'utf8'),
    Buffer.from('DESC', 'utf8'),
    Buffer.from('master', 'utf8')
];

keyMarkers.forEach(marker => {
    let index = 0;
    while ((index = data.indexOf(marker, index)) !== -1) {
        // Look for 32-byte sequences after the marker
        for (let offset = index; offset < Math.min(index + 200, data.length - 32); offset++) {
            const candidate = data.slice(offset, offset + 32);
            const candidateHex = candidate.toString('hex');
            
            // Check if it could be a valid private key (not all zeros, not all FFs)
            if (candidateHex.match(/^[0-9a-f]{64}$/) && 
                candidateHex !== '0'.repeat(64) && 
                candidateHex !== 'f'.repeat(64)) {
                
                // Check if we already have this key
                if (!possibleKeys.find(k => k.hex === candidateHex)) {
                    possibleKeys.push({
                        position: offset,
                        marker: marker.toString('utf8'),
                        hex: candidateHex
                    });
                }
            }
        }
        index++;
    }
});

console.log(`\nFound ${possibleKeys.length} possible private keys`);

// Test each possible key
const expectedAddress = 'alpha1q5fv0lcer68nk7knq5j4nwjdl8tj60vltf55xra';

possibleKeys.forEach((keyInfo, idx) => {
    try {
        const privateKey = keyInfo.hex;
        
        // Test as direct key
        const keyPair = ec.keyFromPrivate(privateKey);
        const publicKey = keyPair.getPublic(true, 'hex');
        const publicKeyBuf = Buffer.from(publicKey, 'hex');
        
        const sha256 = crypto.createHash('sha256').update(publicKeyBuf).digest();
        const ripemd160 = crypto.createHash('ripemd160').update(sha256).digest();
        
        // Create bech32 address
        const address = bech32Encode('alpha', 0, ripemd160);
        
        if (address === expectedAddress) {
            console.log(`\n✓ FOUND MATCHING KEY at position ${keyInfo.position}!`);
            console.log('  Private Key:', privateKey);
            console.log('  Public Key:', publicKey);
            console.log('  Address:', address);
        }
        
        // Also test as BIP32 master key
        for (let i = 0; i < 10; i++) {
            const derivationPath = `m/44'/0'/${i}'`;
            
            // Simple HMAC derivation
            const hmac = crypto.createHmac('sha512', derivationPath);
            hmac.update(Buffer.from(privateKey, 'hex'));
            const derived = hmac.digest();
            const childPrivateKey = derived.slice(0, 32).toString('hex');
            
            const childKeyPair = ec.keyFromPrivate(childPrivateKey);
            const childPublicKey = childKeyPair.getPublic(true, 'hex');
            const childPublicKeyBuf = Buffer.from(childPublicKey, 'hex');
            
            const childSha256 = crypto.createHash('sha256').update(childPublicKeyBuf).digest();
            const childRipemd160 = crypto.createHash('ripemd160').update(childSha256).digest();
            
            const childAddress = bech32Encode('alpha', 0, childRipemd160);
            
            if (childAddress === expectedAddress) {
                console.log(`\n✓ FOUND MATCHING BIP32 KEY at position ${keyInfo.position}, index ${i}!`);
                console.log('  Master Private Key:', privateKey);
                console.log('  Derivation Path:', derivationPath);
                console.log('  Child Private Key:', childPrivateKey);
                console.log('  Child Public Key:', childPublicKey);
                console.log('  Address:', childAddress);
            }
        }
    } catch (e) {
        // Invalid key, skip
    }
});

// Also look for wpkh descriptors which might contain the key
const wpkhPattern = Buffer.from('wpkh([', 'utf8');
let wpkhIndex = data.indexOf(wpkhPattern);
if (wpkhIndex !== -1) {
    console.log('\nFound wpkh descriptor at position:', wpkhIndex);
    // Read next 200 bytes and convert to string
    const descriptorArea = data.slice(wpkhIndex, Math.min(wpkhIndex + 200, data.length));
    let descriptorStr = '';
    for (let i = 0; i < descriptorArea.length; i++) {
        const byte = descriptorArea[i];
        if (byte >= 32 && byte <= 126) {
            descriptorStr += String.fromCharCode(byte);
        } else if (descriptorStr.includes(')')) {
            break;
        }
    }
    console.log('Descriptor:', descriptorStr);
}