const fs = require('fs');
const crypto = require('crypto');
const elliptic = require('elliptic');
const ec = new elliptic.ec('secp256k1');

const data = fs.readFileSync('debug-service/examples/jerome.dat');
console.log('Searching for master private key in jerome.dat (optimized)...\n');

// From the xpub, we know:
const masterPublicKey = '023dd9af882b75bda02fad844de00ad10d72b4e4957f7886e7202990bb993604';
const masterChainCode = '3a6b5c2dee915adb83dfa2d3acff1e4f420c9712503d6871082c348b5ff8879d';

console.log('Master public key from xpub:', masterPublicKey);
console.log('Master chain code from xpub:', masterChainCode);
console.log('');

// In legacy wallets, keys are often stored after "key!" or "ckey!" markers
const keyMarkers = [
    Buffer.from('key!'),
    Buffer.from('ckey!'),
    Buffer.from('keymeta'),
    Buffer.from([0x04, 0x20]), // OCTET STRING 32 bytes
    Buffer.from([0x04, 0x21]) // OCTET STRING 33 bytes (compressed pubkey)
];

const candidates = [];
let tested = 0;

keyMarkers.forEach(marker => {
    console.log(`\nSearching with marker: ${marker.toString('hex')} (${marker.toString('ascii').replace(/[^\x20-\x7E]/g, '.')})`);
    
    let index = 0;
    while ((index = data.indexOf(marker, index)) !== -1) {
        // Check 32-byte sequences after the marker
        for (let offset = 0; offset < 50 && index + marker.length + offset + 32 <= data.length; offset++) {
            const pos = index + marker.length + offset;
            const candidate = data.slice(pos, pos + 32);
            const candidateHex = candidate.toString('hex');
            
            // Quick filter
            if (!candidateHex.match(/^[0-9a-f]{64}$/)) continue;
            if (candidateHex.startsWith('00000000')) continue;
            if (candidateHex === 'f'.repeat(64)) continue;
            
            tested++;
            
            try {
                const keyPair = ec.keyFromPrivate(candidateHex);
                const pubKey = keyPair.getPublic(true, 'hex');
                
                if (pubKey === masterPublicKey) {
                    console.log('✓ FOUND MASTER PRIVATE KEY!');
                    console.log('  Position:', pos);
                    console.log('  Private key:', candidateHex);
                    console.log('  Marker position:', index);
                    console.log('  Offset from marker:', offset);
                    candidates.push({ 
                        position: pos, 
                        privateKey: candidateHex, 
                        marker: marker.toString('hex'),
                        markerPos: index,
                        offset: offset
                    });
                    
                    // Show context
                    const contextStart = Math.max(0, index - 20);
                    const contextEnd = Math.min(data.length, pos + 32 + 20);
                    const context = data.slice(contextStart, contextEnd);
                    console.log('  Context (hex):', context.toString('hex'));
                    console.log('  Context (ascii):', context.toString('ascii').replace(/[^\x20-\x7E]/g, '.'));
                }
            } catch (e) {
                // Invalid key
            }
        }
        
        index++;
    }
});

console.log(`\nTested ${tested} candidate keys`);

if (candidates.length === 0) {
    console.log('✗ Master private key not found');
    console.log('\nLet me check what type of wallet this might be...');
    
    // Check for specific wallet markers
    const walletTypes = [
        { marker: 'walletdescriptor', type: 'Descriptor wallet (modern)' },
        { marker: 'hdchain', type: 'HD wallet with hdchain' },
        { marker: 'hdseed', type: 'HD wallet with seed' },
        { marker: 'mkey', type: 'Encrypted wallet' },
        { marker: 'defaultkey', type: 'Legacy wallet with default key' }
    ];
    
    walletTypes.forEach(({ marker, type }) => {
        if (data.indexOf(Buffer.from(marker)) !== -1) {
            console.log(`  ✓ Found "${marker}" - ${type}`);
        }
    });
    
    // Special check: is the wallet encrypted?
    const mkeyPos = data.indexOf(Buffer.from('mkey'));
    if (mkeyPos !== -1) {
        console.log('\n⚠️  This wallet appears to be ENCRYPTED');
        console.log('  The master private key is encrypted and cannot be extracted without the password');
    }
} else {
    console.log(`\n✓ Found ${candidates.length} master private key(s)`);
}