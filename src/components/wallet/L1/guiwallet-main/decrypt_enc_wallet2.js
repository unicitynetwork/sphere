const crypto = require('crypto');

// From SQLite query:
// key = 046D6B657901000000
// value = 308FD08BF122C37EFB095B8D1C22FFDFAD2AFB95A64A27D5C304B20464A44FEFB362B14A023DEC020AF95E15B3AE6C27A6080642746CC76F92F9000000002A83040000

const mkeyValue = Buffer.from('308FD08BF122C37EFB095B8D1C22FFDFAD2AFB95A64A27D5C304B20464A44FEFB362B14A023DEC020AF95E15B3AE6C27A6080642746CC76F92F9000000002A83040000', 'hex');
const password = '123456';

console.log('=== Decrypting enc_wallet2.dat ===');
console.log('Expected address: alpha1qf56wcqllntdg03dhrds67ka24aeek7ju76h0qj');
console.log('Password:', password);
console.log('\nmkey value length:', mkeyValue.length, 'bytes');
console.log('mkey value hex:', mkeyValue.toString('hex'));

// Parse CMasterKey structure
// Serialization format: vchCryptedKey, vchSalt, nDerivationMethod, nDeriveIterations, vchOtherDerivationParameters

function readCompactSize(buffer, offset) {
    const first = buffer[offset];
    if (first < 253) return { value: first, bytes: 1 };
    if (first === 253) return { value: buffer.readUInt16LE(offset + 1), bytes: 3 };
    if (first === 254) return { value: buffer.readUInt32LE(offset + 1), bytes: 5 };
    throw new Error('CompactSize too large');
}

let pos = 0;

// vchCryptedKey (vector)
const cryptedKeyLen = readCompactSize(mkeyValue, pos);
console.log('\nvchCryptedKey length:', cryptedKeyLen.value, 'bytes');
pos += cryptedKeyLen.bytes;

const vchCryptedKey = mkeyValue.slice(pos, pos + cryptedKeyLen.value);
console.log('vchCryptedKey:', vchCryptedKey.toString('hex'));
pos += cryptedKeyLen.value;

// vchSalt (vector)
const saltLen = readCompactSize(mkeyValue, pos);
console.log('\nvchSalt length:', saltLen.value, 'bytes');
pos += saltLen.bytes;

const vchSalt = mkeyValue.slice(pos, pos + saltLen.value);
console.log('vchSalt:', vchSalt.toString('hex'));
pos += saltLen.value;

// nDerivationMethod (uint32)
const nDerivationMethod = mkeyValue.readUInt32LE(pos);
console.log('\nnDerivationMethod:', nDerivationMethod, '(0 = EVP_sha512)');
pos += 4;

// nDeriveIterations (uint32)
const nDeriveIterations = mkeyValue.readUInt32LE(pos);
console.log('nDeriveIterations:', nDeriveIterations);
pos += 4;

// vchOtherDerivationParameters (vector) - should be empty for method 0
const otherParamsLen = readCompactSize(mkeyValue, pos);
console.log('vchOtherDerivationParameters length:', otherParamsLen.value);

// Decrypt the master key
console.log('\n=== Decrypting Master Key ===');

function bytesToKeySHA512AES(password, salt, count) {
    // Bitcoin Core's implementation
    let hash = crypto.createHash('sha512')
        .update(Buffer.from(password))
        .update(salt)
        .digest();

    for (let i = 0; i < count - 1; i++) {
        hash = crypto.createHash('sha512').update(hash).digest();
    }

    const key = hash.slice(0, 32);  // WALLET_CRYPTO_KEY_SIZE = 32
    const iv = hash.slice(32, 48);   // WALLET_CRYPTO_IV_SIZE = 16

    return { key, iv };
}

const { key, iv } = bytesToKeySHA512AES(password, vchSalt, nDeriveIterations);
console.log('Derived key:', key.toString('hex'));
console.log('Derived IV:', iv.toString('hex'));

try {
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    decipher.setAutoPadding(true);

    const decryptedMasterKey = Buffer.concat([
        decipher.update(vchCryptedKey),
        decipher.final()
    ]);

    console.log('\n✓ Master key decryption successful!');
    console.log('Master key length:', decryptedMasterKey.length, 'bytes');
    console.log('Master key:', decryptedMasterKey.toString('hex'));

    // Now find encrypted keys (ckey or walletdescriptorckey)
    console.log('\n=== Looking for encrypted private keys ===');

    const sqlite3 = require('sqlite3');
    const db = new sqlite3.Database('/home/vrogojin/guiwallet/ref_materials/enc_wallet2.dat');

    db.all("SELECT hex(key) as hexkey, hex(value) as hexvalue, length(value) as len FROM main WHERE hex(key) LIKE '%77616C6C657464657363726970746F72636B6579%' LIMIT 5", (err, rows) => {
        if (err) {
            console.error('Error:', err);
            db.close();
            return;
        }

        if (rows.length === 0) {
            console.log('No walletdescriptorckey found, checking for regular ckey...');

            db.all("SELECT hex(key) as hexkey, hex(value) as hexvalue FROM main WHERE hex(key) LIKE '%636B6579%' LIMIT 5", (err, rows2) => {
                if (err) {
                    console.error('Error:', err);
                    db.close();
                    return;
                }

                console.log('Found', rows2.length, 'ckey records');
                rows2.forEach((row, i) => {
                    console.log(`\nckey ${i + 1}:`, row.hexkey);
                });
                db.close();
            });
        } else {
            console.log('Found', rows.length, 'walletdescriptorckey records');

            rows.forEach((row, i) => {
                console.log(`\nRecord ${i + 1}:`);
                console.log('Key (hex):', row.hexkey);
                console.log('Value (hex):', row.hexvalue);
                console.log('Value length:', row.len);

                // Parse the encrypted key
                const keyData = Buffer.from(row.hexkey, 'hex');
                const valueData = Buffer.from(row.hexvalue, 'hex');

                // Try to decrypt this key
                decryptPrivateKey(valueData, decryptedMasterKey);
            });

            db.close();
        }
    });

} catch (e) {
    console.log('\n✗ Master key decryption failed:', e.message);
    process.exit(1);
}

function decryptPrivateKey(encryptedData, masterKey) {
    try {
        // The encrypted private key format:
        // It's encrypted using the master key with the public key hash as IV

        // For descriptor wallets, the structure might be different
        // Let's try to parse it

        console.log('\nAttempting to decrypt private key...');
        console.log('Encrypted data length:', encryptedData.length);
        console.log('Encrypted data:', encryptedData.toString('hex').substring(0, 100) + '...');

        // We need the public key to use as IV
        // This is more complex - we'll need to parse the descriptor format

    } catch (e) {
        console.log('Error decrypting private key:', e.message);
    }
}
