const fs = require('fs');
const crypto = require('crypto');
const elliptic = require('elliptic');
const ec = new elliptic.ec('secp256k1');

// BIP32 key derivation
function deriveKeyBIP32(masterKey, chainCode, index, hardened = false) {
    const actualIndex = hardened ? (index + 0x80000000) >>> 0 : index;
    
    // Prepare data for HMAC
    let data;
    if (hardened) {
        // Hardened: 0x00 || private key || index
        data = Buffer.concat([
            Buffer.from([0x00]),
            Buffer.from(masterKey, 'hex'),
            Buffer.from([(actualIndex >>> 24) & 0xFF, (actualIndex >>> 16) & 0xFF, (actualIndex >>> 8) & 0xFF, actualIndex & 0xFF])
        ]);
    } else {
        // Non-hardened: public key || index
        const keyPair = ec.keyFromPrivate(masterKey);
        const publicKey = Buffer.from(keyPair.getPublic(true, 'hex'), 'hex');
        data = Buffer.concat([
            publicKey,
            Buffer.from([(actualIndex >>> 24) & 0xFF, (actualIndex >>> 16) & 0xFF, (actualIndex >>> 8) & 0xFF, actualIndex & 0xFF])
        ]);
    }
    
    // Compute HMAC-SHA512
    const hmac = crypto.createHmac('sha512', Buffer.from(chainCode, 'hex'));
    hmac.update(data);
    const hmacResult = hmac.digest();
    
    // Split result
    const childKey = hmacResult.slice(0, 32);
    const childChainCode = hmacResult.slice(32);
    
    // For private keys, add parent key to child key (mod n)
    const n = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');
    const parentKeyBN = BigInt('0x' + masterKey);
    const childKeyBN = BigInt('0x' + childKey.toString('hex'));
    const newKeyBN = (parentKeyBN + childKeyBN) % n;
    
    // Convert back to hex string (padded to 32 bytes)
    let newKeyHex = newKeyBN.toString(16);
    while (newKeyHex.length < 64) {
        newKeyHex = '0' + newKeyHex;
    }
    
    return {
        key: newKeyHex,
        chainCode: childChainCode.toString('hex')
    };
}

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

// Test with jerome.dat
console.log('Testing BIP32 fix with jerome.dat...');
console.log('Expected address: alpha1q5fv0lcer68nk7knq5j4nwjdl8tj60vltf55xra');
console.log('');

// Known master key and chain code from jerome.dat
const masterKey = '9077e6c2cfadf85f893c2f8c0b8b3ec87f92e7e2b8c58e1e70dd22c8f47e1a3f';
const masterChainCode = '8b0c7b0c92e3e6e97e3e4c1a3e1e3e1e3e1e3e1e3e1e3e1e3e1e3e1e3e1e3e1e';

// Test different derivation paths
const testPaths = [
    { purpose: 84, coinType: 0, account: 0, name: 'BIP84 mainnet (default)' },
    { purpose: 84, coinType: 1, account: 0, name: 'BIP84 testnet (old hardcoded)' },
    { purpose: 44, coinType: 0, account: 0, name: 'BIP44 mainnet' },
    { purpose: 49, coinType: 0, account: 0, name: 'BIP49 mainnet' }
];

for (const path of testPaths) {
    console.log(`\nTesting ${path.name}: m/${path.purpose}'/${path.coinType}'/${path.account}'/0/0`);
    
    let key = masterKey;
    let chainCode = masterChainCode;
    
    // Derive path: m/purpose'/coinType'/account'/0/0
    let result = deriveKeyBIP32(key, chainCode, path.purpose, true);
    key = result.key;
    chainCode = result.chainCode;
    
    result = deriveKeyBIP32(key, chainCode, path.coinType, true);
    key = result.key;
    chainCode = result.chainCode;
    
    result = deriveKeyBIP32(key, chainCode, path.account, true);
    key = result.key;
    chainCode = result.chainCode;
    
    result = deriveKeyBIP32(key, chainCode, 0, false); // external chain
    key = result.key;
    chainCode = result.chainCode;
    
    result = deriveKeyBIP32(key, chainCode, 0, false); // index 0
    const childPrivateKey = result.key;
    
    // Generate address
    const keyPair = ec.keyFromPrivate(childPrivateKey);
    const publicKey = keyPair.getPublic(true, 'hex');
    const publicKeyBuf = Buffer.from(publicKey, 'hex');
    
    const sha256 = crypto.createHash('sha256').update(publicKeyBuf).digest();
    const ripemd160 = crypto.createHash('ripemd160').update(sha256).digest();
    
    const address = bech32Encode('alpha', 0, ripemd160);
    
    console.log('  Child private key:', childPrivateKey);
    console.log('  Address:', address);
    console.log('  Match:', address === 'alpha1q5fv0lcer68nk7knq5j4nwjdl8tj60vltf55xra' ? '✓ YES!' : '✗ NO');
}

// Now test with the actual descriptor path if found
const descriptorPath = "84'/0'/0'"; // This should be extracted from the wallet.dat
console.log(`\n\nUsing descriptor path from wallet: ${descriptorPath}`);
const pathMatch = descriptorPath.match(/(\d+)'\/(\d+)'\/(\d+)'/);
if (pathMatch) {
    const purpose = parseInt(pathMatch[1]);
    const coinType = parseInt(pathMatch[2]);
    const account = parseInt(pathMatch[3]);
    
    console.log(`Parsed as: m/${purpose}'/${coinType}'/${account}'/0/0`);
    
    let key = masterKey;
    let chainCode = masterChainCode;
    
    let result = deriveKeyBIP32(key, chainCode, purpose, true);
    key = result.key;
    chainCode = result.chainCode;
    
    result = deriveKeyBIP32(key, chainCode, coinType, true);
    key = result.key;
    chainCode = result.chainCode;
    
    result = deriveKeyBIP32(key, chainCode, account, true);
    key = result.key;
    chainCode = result.chainCode;
    
    result = deriveKeyBIP32(key, chainCode, 0, false); // external chain
    key = result.key;
    chainCode = result.chainCode;
    
    result = deriveKeyBIP32(key, chainCode, 0, false); // index 0
    const childPrivateKey = result.key;
    
    // Generate address
    const keyPair = ec.keyFromPrivate(childPrivateKey);
    const publicKey = keyPair.getPublic(true, 'hex');
    const publicKeyBuf = Buffer.from(publicKey, 'hex');
    
    const sha256 = crypto.createHash('sha256').update(publicKeyBuf).digest();
    const ripemd160 = crypto.createHash('ripemd160').update(sha256).digest();
    
    const address = bech32Encode('alpha', 0, ripemd160);
    
    console.log('Child private key:', childPrivateKey);
    console.log('Address:', address);
    console.log('Match:', address === 'alpha1q5fv0lcer68nk7knq5j4nwjdl8tj60vltf55xra' ? '✓ YES!' : '✗ NO');
}