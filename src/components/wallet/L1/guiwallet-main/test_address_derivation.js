// Test address derivation for the failing wallet
const crypto = require('crypto');

// The failing address
const failingAddress = "alpha1qllh2t42ytsgnx8fferxwms6npec7whvnaxta7d";

// Extract the pubkey hash from the bech32 address
// alpha1qllh2t42ytsgnx8fferxwms6npec7whvnaxta7d
// After decoding bech32, the witness program (pubkey hash) should be:
// This would need proper bech32 decoding, but let's check the witness data

// From the failed transaction witness:
const publicKeyFromWitness = "024622cf9e9826e887e0b9e5c43b3565775c94411388e201868761e3a61337f259";

// Calculate what address this public key should produce
const publicKeyBuffer = Buffer.from(publicKeyFromWitness, 'hex');
const sha256 = crypto.createHash('sha256').update(publicKeyBuffer).digest();
const ripemd160 = crypto.createHash('ripemd160').update(sha256).digest();

console.log("Public key from witness:", publicKeyFromWitness);
console.log("Calculated pubkey hash:", ripemd160.toString('hex'));
console.log("This should match the witness program in the address");

// Now let's verify if HMAC derivation would produce this key
// Standard wallet uses HMAC-SHA512 with path m/44'/0'/0'
function deriveChildKey(masterKey, index) {
    const path = `m/44'/0'/${index}'`;
    const hmac = crypto.createHmac('sha512', path);
    hmac.update(Buffer.from(masterKey, 'hex'));
    const output = hmac.digest('hex');
    return output.substring(0, 64); // First 32 bytes
}

console.log("\nTo debug: We need to know the master private key to verify the derivation");
