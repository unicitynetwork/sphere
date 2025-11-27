const fs = require('fs');
const crypto = require('crypto');

const data = fs.readFileSync('/home/vrogojin/guiwallet/ref_materials/enc_wallet2.dat');
const password = '123456';

console.log('=== Testing enc_wallet2.dat ===');
console.log('Expected address: alpha1qf56wcqllntdg03dhrds67ka24aeek7ju76h0qj\n');

const mkeyPos = data.indexOf(Buffer.from('mkey'));
console.log('mkey at position:', mkeyPos);

// Show the hex around it
const context = data.slice(mkeyPos - 10, mkeyPos + 100);
console.log('\nContext hex:');
for (let i = 0; i < context.length; i += 16) {
    const slice = context.slice(i, i + 16);
    const hex = slice.toString('hex').match(/.{2}/g).join(' ');
    const ascii = slice.toString('ascii').replace(/[^\x20-\x7E]/g, '.');
    console.log(`${(mkeyPos - 10 + i).toString().padStart(5)}: ${hex.padEnd(48)} ${ascii}`);
}

// From the hex output above: 046d6b6579 01 00000030
// This is: 04 (length) + "mkey" + 01 (key index) + 00000030 (value length = 48)

console.log('\n=== Parsing mkey value ===');

const valueLengthPos = mkeyPos + 4 + 1; // Skip "mkey" (4) + index byte (1)
const valueLength = data.readUInt32LE(valueLengthPos);
console.log('Value length:', valueLength, 'bytes');

const valueStart = valueLengthPos + 4;
const mkeyValue = data.slice(valueStart, valueStart + valueLength);
console.log('Value hex:', mkeyValue.toString('hex'));
console.log('Value length:', mkeyValue.length);

// Now parse the CMasterKey serialization
// Format: vchCryptedKey (vector) + vchSalt (vector) + nDerivationMethod (uint32) + nDeriveIterations (uint32) + vchOtherDerivationParameters (vector)

function readCompactSize(buffer, offset) {
    const first = buffer[offset];
    if (first < 253) return { value: first, bytes: 1 };
    if (first === 253) return { value: buffer.readUInt16LE(offset + 1), bytes: 3 };
    if (first === 254) return { value: buffer.readUInt32LE(offset + 1), bytes: 5 };
    return null; // Too large
}

let pos = 0;

// vchCryptedKey
const cryptedKeyLen = readCompactSize(mkeyValue, pos);
if (!cryptedKeyLen) {
    console.log('Error reading crypted key length');
    process.exit(1);
}
console.log('\n Crypted key length:', cryptedKeyLen.value);
pos += cryptedKeyLen.bytes;

const vchCryptedKey = mkeyValue.slice(pos, pos + cryptedKeyLen.value);
console.log('Encrypted master key:', vchCryptedKey.toString('hex'));
pos += cryptedKeyLen.value;

// vchSalt
const saltLen = readCompactSize(mkeyValue, pos);
console.log('\nSalt length:', saltLen.value);
pos += saltLen.bytes;

const vchSalt = mkeyValue.slice(pos, pos + saltLen.value);
console.log('Salt:', vchSalt.toString('hex'));
pos += saltLen.value;

// nDerivationMethod
const nDerivationMethod = mkeyValue.readUInt32LE(pos);
console.log('\nDerivation method:', nDerivationMethod);
pos += 4;

// nDeriveIterations
const nDeriveIterations = mkeyValue.readUInt32LE(pos);
console.log('Iterations:', nDeriveIterations);

// Decrypt
console.log('\n=== Attempting Decryption ===');

function bytesToKeySHA512AES(password, salt, count) {
    let hash = crypto.createHash('sha512')
        .update(Buffer.from(password))
        .update(salt)
        .digest();

    for (let i = 0; i < count - 1; i++) {
        hash = crypto.createHash('sha512').update(hash).digest();
    }

    const key = hash.slice(0, 32);
    const iv = hash.slice(32, 48);
    return { key, iv };
}

const { key, iv } = bytesToKeySHA512AES(password, vchSalt, nDeriveIterations);
console.log('Derived key:', key.toString('hex'));
console.log('Derived IV:', iv.toString('hex'));

try {
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    decipher.setAutoPadding(true);

    const decrypted = Buffer.concat([
        decipher.update(vchCryptedKey),
        decipher.final()
    ]);

    console.log('\n✓ Decryption successful!');
    console.log('Master key length:', decrypted.length);
    console.log('Master key:', decrypted.toString('hex'));

    // Now find and decrypt a ckey to verify
    console.log('\n=== Looking for encrypted keys (ckey) ===');
    const ckeyPattern = Buffer.from('walletdescriptorckey');
    let ckeyPos = data.indexOf(ckeyPattern);
    if (ckeyPos !== -1) {
        console.log('Found walletdescriptorckey at:', ckeyPos);
    }

} catch (e) {
    console.log('\n✗ Decryption failed:', e.message);
}
