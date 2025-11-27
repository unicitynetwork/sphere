const crypto = require('crypto');
const sqlite3 = require('sqlite3');
const EC = require('elliptic').ec;
const ec = new EC('secp256k1');

// Master key from previous decryption
const masterKey = Buffer.from('460b0b6604efa6e093f8818c4a4dba035a34d2064fe98ed04a5ab890b3a159b2', 'hex');
const password = '123456';

console.log('=== Decrypting Private Keys from enc_wallet2.dat ===');
console.log('Expected first address: alpha1qf56wcqllntdg03dhrds67ka24aeek7ju76h0qj\n');
console.log('Master key:', masterKey.toString('hex'));

const db = new sqlite3.Database('/home/vrogojin/guiwallet/ref_materials/enc_wallet2.dat');

// Get walletdescriptorckey records
db.all("SELECT hex(key) as hexkey, hex(value) as hexvalue FROM main WHERE hex(key) LIKE '%77616C6C657464657363726970746F72636B6579%' ORDER BY rowid LIMIT 10", (err, rows) => {
    if (err) {
        console.error('Error:', err);
        db.close();
        return;
    }

    console.log(`Found ${rows.length} encrypted key records\n`);

    rows.forEach((row, i) => {
        const keyData = Buffer.from(row.hexkey, 'hex');
        const valueData = Buffer.from(row.hexvalue, 'hex');

        console.log(`=== Record ${i + 1} ===`);

        // Parse the key structure
        // Format: compact_size + "walletdescriptorckey" + descriptor_id (32 bytes) + compact_size + pubkey (33 bytes)
        const prefixLen = keyData[0];
        const prefix = keyData.slice(1, 1 + prefixLen).toString();
        console.log('Prefix:', prefix);

        const descriptorId = keyData.slice(1 + prefixLen, 1 + prefixLen + 32);
        console.log('Descriptor ID:', descriptorId.toString('hex'));

        // Public key is also prefixed with compact size
        const pubkeyLen = keyData[1 + prefixLen + 32];
        const pubkey = keyData.slice(1 + prefixLen + 32 + 1, 1 + prefixLen + 32 + 1 + pubkeyLen);
        console.log('Public key:', pubkey.toString('hex'));
        console.log('Public key length:', pubkey.length);

        // Parse the value (encrypted private key)
        // Format: compact_size + encrypted_data
        function readCompactSize(buffer, offset) {
            const first = buffer[offset];
            if (first < 253) return { value: first, bytes: 1 };
            if (first === 253) return { value: buffer.readUInt16LE(offset + 1), bytes: 3 };
            if (first === 254) return { value: buffer.readUInt32LE(offset + 1), bytes: 5 };
            throw new Error('CompactSize too large');
        }

        const encKeyLen = readCompactSize(valueData, 0);
        console.log('Encrypted key length:', encKeyLen.value);

        const encryptedKey = valueData.slice(encKeyLen.bytes, encKeyLen.bytes + encKeyLen.value);
        console.log('Encrypted key data:', encryptedKey.toString('hex'));

        // Decrypt using master key and pubkey hash as IV
        // From Bitcoin Core: IV is sha256(sha256(pubkey))[0:16]
        const pubkeyHash = crypto.createHash('sha256').update(
            crypto.createHash('sha256').update(pubkey).digest()
        ).digest();
        const iv = pubkeyHash.slice(0, 16);

        console.log('IV (from pubkey double-SHA256):', iv.toString('hex'));

        try {
            const decipher = crypto.createDecipheriv('aes-256-cbc', masterKey, iv);
            decipher.setAutoPadding(true);

            const decryptedKey = Buffer.concat([
                decipher.update(encryptedKey),
                decipher.final()
            ]);

            console.log('✓ Decrypted private key:', decryptedKey.toString('hex'));
            console.log('Private key length:', decryptedKey.length);

            // Verify the private key matches the public key
            if (decryptedKey.length === 32) {
                const keyPair = ec.keyFromPrivate(decryptedKey);
                const derivedPubkey = Buffer.from(keyPair.getPublic().encodeCompressed());

                console.log('Derived public key:', derivedPubkey.toString('hex'));

                if (derivedPubkey.equals(pubkey)) {
                    console.log('✓ Public key verification PASSED!');

                    // Derive address
                    const address = deriveAddress(derivedPubkey);
                    console.log('✓ Address:', address);

                    if (i === 0 && address === 'alpha1qf56wcqllntdg03dhrds67ka24aeek7ju76h0qj') {
                        console.log('✓✓✓ ADDRESS MATCH! Decryption successful!');
                    }
                } else {
                    console.log('✗ Public key verification FAILED');
                }
            }

        } catch (e) {
            console.log('✗ Decryption failed:', e.message);
        }

        console.log('');
    });

    db.close();
});

function deriveAddress(pubkey) {
    // P2WPKH address derivation for Alpha (Bech32 with 'alpha' prefix)
    const pubkeyHash = crypto.createHash('sha256').update(pubkey).digest();
    const hash160 = crypto.createHash('ripemd160').update(pubkeyHash).digest();

    // Bech32 encoding
    const words = bech32_convertBits(Array.from(hash160), 8, 5, true);
    if (!words) return null;

    return bech32_encode('alpha', [0].concat(words));
}

// Bech32 encoding functions
function bech32_polymod(values) {
    const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
    let chk = 1;
    for (let value of values) {
        const b = chk >> 25;
        chk = (chk & 0x1ffffff) << 5 ^ value;
        for (let i = 0; i < 5; i++) {
            if ((b >> i) & 1) {
                chk ^= GENERATOR[i];
            }
        }
    }
    return chk;
}

function bech32_hrpExpand(hrp) {
    const ret = [];
    for (let i = 0; i < hrp.length; i++) {
        ret.push(hrp.charCodeAt(i) >> 5);
    }
    ret.push(0);
    for (let i = 0; i < hrp.length; i++) {
        ret.push(hrp.charCodeAt(i) & 31);
    }
    return ret;
}

function bech32_createChecksum(hrp, data) {
    const values = bech32_hrpExpand(hrp).concat(data).concat([0, 0, 0, 0, 0, 0]);
    const mod = bech32_polymod(values) ^ 1;
    const ret = [];
    for (let i = 0; i < 6; i++) {
        ret.push((mod >> 5 * (5 - i)) & 31);
    }
    return ret;
}

function bech32_encode(hrp, data) {
    const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
    const combined = data.concat(bech32_createChecksum(hrp, data));
    let ret = hrp + '1';
    for (let d of combined) {
        ret += CHARSET.charAt(d);
    }
    return ret;
}

function bech32_convertBits(data, frombits, tobits, pad) {
    let acc = 0;
    let bits = 0;
    const ret = [];
    const maxv = (1 << tobits) - 1;
    for (let value of data) {
        if (value < 0 || (value >> frombits) !== 0) {
            return null;
        }
        acc = (acc << frombits) | value;
        bits += frombits;
        while (bits >= tobits) {
            bits -= tobits;
            ret.push((acc >> bits) & maxv);
        }
    }
    if (pad) {
        if (bits > 0) {
            ret.push((acc << (tobits - bits)) & maxv);
        }
    } else if (bits >= frombits || ((acc << (tobits - bits)) & maxv)) {
        return null;
    }
    return ret;
}
