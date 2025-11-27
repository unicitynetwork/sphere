const fs = require('fs');

const data = fs.readFileSync('debug-service/examples/enc_test.dat');

// Find mkey at position 7069 and check the surrounding structure
const mkeyPos = 7069;
console.log('Analyzing mkey record at position', mkeyPos);
console.log('');

// Get 200 bytes around mkey
const context = data.slice(mkeyPos - 20, mkeyPos + 180);
console.log('Context (hex with annotations):');

// Print hex with offsets
for (let i = 0; i < context.length; i += 16) {
    const offset = mkeyPos - 20 + i;
    const chunk = context.slice(i, Math.min(i + 16, context.length));
    const hex = chunk.toString('hex').match(/.{1,2}/g).join(' ');
    const ascii = chunk.toString('ascii').replace(/[^\x20-\x7E]/g, '.');
    console.log(`${offset.toString(16).padStart(8, '0')}: ${hex.padEnd(48)} ${ascii}`);
}

console.log('\n=== Detailed parsing ===');

// The mkey record in SQLite wallet format
const recordStart = mkeyPos + 4; // Skip "mkey"
console.log('\nBytes after "mkey":');

for (let i = 0; i < 60; i++) {
    const byte = data[recordStart + i];
    const hex = byte.toString(16).padStart(2, '0');
    const comment = getByteComment(i, byte);
    console.log(`  [${i.toString().padStart(2)}] 0x${hex} (${byte.toString().padStart(3)}) ${comment}`);
}

function getByteComment(offset, value) {
    if (offset === 0) return '← Version/type byte?';
    if (offset === 4) return '← Length byte (0x30 = 48)';
    if (offset >= 5 && offset < 13) return '← Salt byte ' + (offset - 5 + 1);
    if (offset >= 13 && offset < 17) return '← Iterations (4 bytes LE)?';
    if (offset >= 17 && offset < 49) return '← Encrypted key byte ' + (offset - 17 + 1);
    return '';
}

// Try different interpretations
console.log('\n=== Interpretation attempts ===');

// Skip version (4 bytes) and length (1 byte)
const dataStart = recordStart + 4 + 1;
const recordData = data.slice(dataStart, dataStart + 48);

console.log('\n1. Standard Bitcoin Core format (salt + method + iter + encrypted):');
console.log('   Salt (8 bytes):', recordData.slice(0, 8).toString('hex'));
console.log('   Method (4 bytes LE):', recordData.readUInt32LE(8));
console.log('   Iterations (4 bytes LE):', recordData.readUInt32LE(12));
console.log('   Encrypted (32 bytes):', recordData.slice(16, 48).toString('hex'));

console.log('\n2. Alternative format (method + iter + salt + encrypted):');
console.log('   Method (4 bytes LE):', recordData.readUInt32LE(0));
console.log('   Iterations (4 bytes LE):', recordData.readUInt32LE(4));
console.log('   Salt (8 bytes):', recordData.slice(8, 16).toString('hex'));
console.log('   Encrypted (32 bytes):', recordData.slice(16, 48).toString('hex'));

console.log('\n3. Newer format (iter + salt + encrypted):');
console.log('   Iterations (4 bytes LE):', recordData.readUInt32LE(0));
console.log('   Salt (8 bytes):', recordData.slice(4, 12).toString('hex'));
console.log('   Encrypted (36 bytes):', recordData.slice(12, 48).toString('hex'));

// Check if there's another mkey record that might be the right one
console.log('\n=== Checking all mkey records ===');
const mkeyPattern = Buffer.from('mkey');
let pos = 0;
while ((pos = data.indexOf(mkeyPattern, pos)) !== -1) {
    console.log(`Found mkey at position ${pos}`);
    const sample = data.slice(pos + 4, pos + 20);
    console.log('  First 16 bytes after mkey:', sample.toString('hex'));
    pos++;
}