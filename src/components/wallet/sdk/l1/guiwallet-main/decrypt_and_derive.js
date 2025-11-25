const crypto = require('crypto');
const sqlite3 = require('sqlite3');
const EC = require('elliptic').ec;
const ec = new EC('secp256k1');
const BIP32Factory = require('bip32').default;
const ecc = require('tiny-secp256k1');
const bip32 = BIP32Factory(ecc);

const password = '123456';
const expectedAddress = 'alpha1qf56wcqllntdg03dhrds67ka24aeek7ju76h0qj';

console.log('=== Decrypting and Deriving Addresses from enc_wallet2.dat ===');
console.log('Expected address:', expectedAddress);
console.log('Password:', password);
console.log('');

const db = new sqlite3.Database('/home/vrogojin/guiwallet/ref_materials/enc_wallet2.dat');

// Step 1: Decrypt master key
db.get("SELECT hex(value) as hexvalue FROM main WHERE hex(key) LIKE '%046D6B6579%'", (err, row) => {
    if (err) {
        console.error('Error:', err);
        db.close();
        return;
    }

    const mkeyValue = Buffer.from(row.hexvalue, 'hex');

    function readCompactSize(buffer, offset) {
        const first = buffer[offset];
        if (first < 253) return { value: first, bytes: 1 };
        if (first === 253) return { value: buffer.readUInt16LE(offset + 1), bytes: 3 };
        if (first === 254) return { value: buffer.readUInt32LE(offset + 1), bytes: 5 };
        throw new Error('CompactSize too large');
    }

    let pos = 0;
    const cryptedKeyLen = readCompactSize(mkeyValue, pos);
    pos += cryptedKeyLen.bytes;
    const vchCryptedKey = mkeyValue.slice(pos, pos + cryptedKeyLen.value);
    pos += cryptedKeyLen.value;

    const saltLen = readCompactSize(mkeyValue, pos);
    pos += saltLen.bytes;
    const vchSalt = mkeyValue.slice(pos, pos + saltLen.value);
    pos += saltLen.value;

    const nDerivationMethod = mkeyValue.readUInt32LE(pos);
    pos += 4;
    const nDeriveIterations = mkeyValue.readUInt32LE(pos);

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
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    const masterKey = Buffer.concat([decipher.update(vchCryptedKey), decipher.final()]);

    console.log('✓ Master key decrypted:', masterKey.toString('hex'));
    console.log('');

    // Step 2: Get descriptors to find the native SegWit (wpkh) descriptor
    db.all("SELECT hex(key) as hexkey, hex(value) as hexvalue FROM main WHERE hex(key) LIKE '1077616C6C657464657363726970746F72%'", (err, descriptors) => {
        if (err) {
            console.error('Error:', err);
            db.close();
            return;
        }

        console.log(`Found ${descriptors.length} wallet descriptors`);
        console.log('');

        // Parse each descriptor to find the wpkh one
        let wpkhDescriptorId = null;
        let xpubString = null;
        let derivationPath = null;

        for (const desc of descriptors) {
            const valueData = Buffer.from(desc.hexvalue, 'hex');
            const descriptorLen = valueData[0];
            const descriptorStr = valueData.slice(1, 1 + descriptorLen).toString();

            console.log('Descriptor:', descriptorStr);

            // Look for native SegWit RECEIVE descriptor: wpkh(xpub.../84h/1h/0h/0/*)
            // Not sh(wpkh(...)) which is nested SegWit
            // Not tr(...) which is taproot
            // Not /1/* which is change addresses
            if ((descriptorStr.startsWith('wpkh(xpub') || descriptorStr.includes('wpkh([')) &&
                descriptorStr.includes('/0/*)')) {
                // Extract descriptor ID from key
                const keyData = Buffer.from(desc.hexkey, 'hex');
                const prefixLen = keyData[0];
                wpkhDescriptorId = keyData.slice(1 + prefixLen, 1 + prefixLen + 32);

                // Extract xpub
                const xpubMatch = descriptorStr.match(/xpub[1-9A-HJ-NP-Za-km-z]{100,}/);
                if (xpubMatch) {
                    xpubString = xpubMatch[0];
                }

                // Extract derivation path
                const pathMatch = descriptorStr.match(/\/(\d+h\/\d+h\/\d+h\/\d+\/\*)/);
                if (pathMatch) {
                    derivationPath = pathMatch[1];
                }

                console.log('✓ Found native SegWit descriptor!');
                console.log('  Descriptor ID:', wpkhDescriptorId.toString('hex'));
                console.log('  XPub:', xpubString);
                console.log('  Path suffix:', derivationPath);
                break;
            }
        }

        if (!wpkhDescriptorId || !xpubString) {
            console.log('✗ Could not find native SegWit (wpkh) descriptor');
            db.close();
            return;
        }

        console.log('');

        // Step 3: Get the encrypted private key for this descriptor
        db.get("SELECT hex(key) as hexkey, hex(value) as hexvalue FROM main WHERE hex(key) LIKE '1477616C6C657464657363726970746F72636B6579' || ? || '%'",
            [wpkhDescriptorId.toString('hex').toUpperCase()],
            (err, ckeyRow) => {
                if (err || !ckeyRow) {
                    console.error('Error finding encrypted key:', err);
                    db.close();
                    return;
                }

                // Parse the encrypted key record
                const keyData = Buffer.from(ckeyRow.hexkey, 'hex');
                const valueData = Buffer.from(ckeyRow.hexvalue, 'hex');

                const prefixLen = keyData[0];
                const pubkeyLen = keyData[1 + prefixLen + 32];
                const pubkey = keyData.slice(1 + prefixLen + 32 + 1, 1 + prefixLen + 32 + 1 + pubkeyLen);

                console.log('Encrypted key record:');
                console.log('  Public key:', pubkey.toString('hex'));

                // Decrypt the private key
                const encKeyLen = readCompactSize(valueData, 0);
                const encryptedKey = valueData.slice(encKeyLen.bytes, encKeyLen.bytes + encKeyLen.value);

                const pubkeyHash = crypto.createHash('sha256').update(
                    crypto.createHash('sha256').update(pubkey).digest()
                ).digest();
                const ivForPrivKey = pubkeyHash.slice(0, 16);

                const decipher2 = crypto.createDecipheriv('aes-256-cbc', masterKey, ivForPrivKey);
                decipher2.setAutoPadding(true);
                const decryptedPrivKey = Buffer.concat([decipher2.update(encryptedKey), decipher2.final()]);

                console.log('  Decrypted private key:', decryptedPrivKey.toString('hex'));

                // Verify it matches the public key
                const keyPair = ec.keyFromPrivate(decryptedPrivKey);
                const derivedPubkey = Buffer.from(keyPair.getPublic().encodeCompressed());

                if (!derivedPubkey.equals(pubkey)) {
                    console.log('✗ Public key verification failed!');
                    db.close();
                    return;
                }

                console.log('✓ Public key verification passed!');
                console.log('');

                // Step 4: Decode xpub to get chain code using bip32
                let chainCode;
                let xpubNode;

                try {
                    xpubNode = bip32.fromBase58(xpubString);
                    chainCode = xpubNode.chainCode;
                    console.log('Chain code from xpub:', chainCode.toString('hex'));
                    console.log('XPub depth:', xpubNode.depth);
                    console.log('XPub index:', xpubNode.index);
                } catch (e) {
                    console.error('Failed to decode xpub:', e);
                    db.close();
                    return;
                }

                // Step 5: Derive child addresses using BIP32
                console.log('');
                console.log('=== Deriving Child Addresses ===');

                // The xpub is at depth 0 (master key)
                // The decrypted private key corresponds to this xpub
                // But wait - the descriptor shows a derivation path AFTER the xpub
                // This means the xpub is actually at m/84'/1'/0' and we need to derive /0/i from it

                // Let me check if the decrypted key matches the xpub
                const testKeyPair = ec.keyFromPrivate(decryptedPrivKey);
                const testPubkey = Buffer.from(testKeyPair.getPublic().encodeCompressed());

                console.log('Decrypted privkey pubkey:', testPubkey.toString('hex'));
                console.log('XPub pubkey:', xpubNode.publicKey.toString('hex'));
                console.log('Match:', testPubkey.equals(xpubNode.publicKey) ? 'YES' : 'NO');
                console.log('');

                // The decrypted key is the MASTER key
                // We need to derive the full BIP32 path: m/84'/1'/0'/0/i
                const masterNode = bip32.fromPrivateKey(decryptedPrivKey, chainCode);

                // Derive m/84'/1'/0'/0/*
                const purposeNode = masterNode.deriveHardened(84);
                const coinNode = purposeNode.deriveHardened(1);
                const accountNode = coinNode.deriveHardened(0);
                const externalNode = accountNode.derive(0); // 0 for receive, 1 for change

                console.log('Deriving addresses from m/84\'/1\'/0\'/0/*');
                console.log('');

                for (let i = 0; i < 5; i++) {
                    const child = externalNode.derive(i);
                    const childPubkey = child.publicKey;
                    const childPrivkey = child.privateKey;

                    // Derive address (P2WPKH)
                    const address = deriveAddress(childPubkey);

                    console.log(`Address ${i}: ${address}`);
                    if (i === 0) {
                        console.log(`  Private key (hex): ${Buffer.from(childPrivkey).toString('hex')}`);
                        console.log(`  Public key (hex): ${Buffer.from(childPubkey).toString('hex')}`);
                    }

                    if (address === expectedAddress) {
                        console.log('✓✓✓ MATCH! Found the expected address!');
                    }
                }

                db.close();
            }
        );
    });
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
