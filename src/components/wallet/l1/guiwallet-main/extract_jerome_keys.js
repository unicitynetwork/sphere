const fs = require('fs');
const path = require('path');

// Read the wallet.dat file
const filePath = path.join(__dirname, 'debug-service/examples/jerome.dat');
const data = fs.readFileSync(filePath);

console.log('Extracting keys from jerome.dat...');
console.log('Expected address: alpha1q5fv0lcer68nk7knq5j4nwjdl8tj60vltf55xra');
console.log('');

// Look for walletdescriptorkey pattern
const descriptorKeyPattern = Buffer.from('walletdescriptorkey');
let index = 0;
let foundKeys = [];

while ((index = data.indexOf(descriptorKeyPattern, index)) !== -1) {
    console.log(`Found descriptor key pattern at position ${index}`);
    
    // Look for DER-encoded private key after the pattern
    for (let checkPos = index + descriptorKeyPattern.length; 
         checkPos < Math.min(index + descriptorKeyPattern.length + 200, data.length - 40); 
         checkPos++) {
        
        // Pattern: d30201010420 (the pattern that works)
        if (data[checkPos] === 0xd3 &&
            data[checkPos + 1] === 0x02 &&
            data[checkPos + 2] === 0x01 &&
            data[checkPos + 3] === 0x01 &&
            data[checkPos + 4] === 0x04 &&
            data[checkPos + 5] === 0x20) {
            
            // Extract the 32-byte private key
            const privKey = data.slice(checkPos + 6, checkPos + 38);
            const privKeyHex = privKey.toString('hex');
            
            console.log(`Found private key at position ${checkPos}: ${privKeyHex}`);
            foundKeys.push(privKeyHex);
            break;
        }
    }
    
    index++;
}

// Look for xpubs to extract chain code
const xpubPattern = Buffer.from('xpub');
const base58Chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
let searchPos = 0;

console.log('\nLooking for xpubs...');
while (searchPos < data.length) {
    let xpubIndex = data.indexOf(xpubPattern, searchPos);
    if (xpubIndex === -1) break;
    
    // Extract the full xpub
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
        console.log(`Found xpub at position ${xpubIndex}: ${xpubStr.substring(0, 50)}...`);
    }
    
    searchPos = xpubIndex + 4;
}

// Look for wpkh descriptor
const wpkhPattern = Buffer.from('wpkh([');
let wpkhIndex = data.indexOf(wpkhPattern, 0);
if (wpkhIndex !== -1) {
    console.log('\nFound wpkh descriptor at position:', wpkhIndex);
    
    // Read the descriptor
    const descriptorArea = data.slice(wpkhIndex, Math.min(wpkhIndex + 200, data.length));
    let descriptorStr = '';
    
    for (let i = 0; i < descriptorArea.length; i++) {
        const byte = descriptorArea[i];
        if (byte >= 32 && byte <= 126) {
            descriptorStr += String.fromCharCode(byte);
            if (descriptorStr.includes('*))')) break;
        }
    }
    
    console.log('Descriptor:', descriptorStr);
    
    // Parse the descriptor path
    const pathMatch = descriptorStr.match(/\[[\da-f]+\/(\d+'\/\d+'\/\d+')\]/);
    if (pathMatch) {
        console.log('Extracted descriptor path:', pathMatch[1]);
    }
}

console.log('\nSummary:');
console.log('Found', foundKeys.length, 'private key(s)');
if (foundKeys.length > 0) {
    console.log('Master private key:', foundKeys[0]);
}