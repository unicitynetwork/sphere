const BIP32Factory = require('bip32').default;
const ecc = require('tiny-secp256k1');
const bip32 = BIP32Factory(ecc);

// Master key and chain code from the decrypted wallet
const masterKey = Buffer.from('460b0b6604efa6e093f8818c4a4dba035a34d2064fe98ed04a5ab890b3a159b2', 'hex');
const chainCode = Buffer.from('9744f344c0719ccd9636ee4f2bef3f15b15c13c654693f1d645c87be703456eb', 'hex');

console.log('=== BIP32 Derivation Step-by-Step ===');
console.log('Master key:', masterKey.toString('hex'));
console.log('Chain code:', chainCode.toString('hex'));
console.log('');

// Create master node
const masterNode = bip32.fromPrivateKey(masterKey, chainCode);
console.log('Master node created');
console.log('');

// Derive m/84'
const purposeNode = masterNode.deriveHardened(84);
console.log("After m/84': key=" + purposeNode.privateKey.toString('hex').substring(0, 16) + '...');
console.log("After m/84': full key=" + purposeNode.privateKey.toString('hex'));
console.log('');

// Derive m/84'/1'
const coinNode = purposeNode.deriveHardened(1);
console.log("After m/84'/1': key=" + coinNode.privateKey.toString('hex').substring(0, 16) + '...');
console.log("After m/84'/1': full key=" + coinNode.privateKey.toString('hex'));
console.log('');

// Derive m/84'/1'/0'
const accountNode = coinNode.deriveHardened(0);
console.log("After m/84'/1'/0': key=" + accountNode.privateKey.toString('hex').substring(0, 16) + '...');
console.log("After m/84'/1'/0': full key=" + accountNode.privateKey.toString('hex'));
console.log('');

// Derive m/84'/1'/0'/0 (external chain)
const externalNode = accountNode.derive(0);
console.log("After m/84'/1'/0'/0: key=" + externalNode.privateKey.toString('hex').substring(0, 16) + '...');
console.log("After m/84'/1'/0'/0: full key=" + externalNode.privateKey.toString('hex'));
console.log('');

// Derive m/84'/1'/0'/0/0 (first address)
const child0 = externalNode.derive(0);
console.log("After m/84'/1'/0'/0/0: key=" + child0.privateKey.toString('hex'));
console.log('');

console.log('Expected from Node.js: 25601b1814526ffdb1b233f1fcb6d234cd80c8790a9457b1b494a8d5788fd81a');
console.log('From GUI wallet:       c1ca59ed015f6fd0c04b9c7d36d5a2f490204336b983d7d96932eb77843a096b');
