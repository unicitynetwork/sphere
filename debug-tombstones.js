/**
 * Debug script to examine tombstone data format
 * Run with: node debug-tombstones.js
 */

// Read localStorage data (simulated)
const STORAGE_KEY_PREFIX = 'sphere_l3_inventory_';

console.log('Tombstone Debug Script');
console.log('======================\n');

// Sample data structure based on code
const sampleTombstone = {
  tokenId: 'abc123...',
  stateHash: 'some-hash-value',
  timestamp: Date.now()
};

console.log('Expected tombstone structure:');
console.log(JSON.stringify(sampleTombstone, null, 2));

console.log('\n\nChecks to perform:');
console.log('1. Does stateHash start with "0000"?');
console.log('2. Does the Sent token have a transaction with matching newStateHash?');
console.log('3. Is computeFinalStateHashCached returning the expected value?');

console.log('\n\nTo investigate in browser console:');
console.log('-----------------------------------');
console.log('// Get storage key for your address');
console.log('const address = "your-l3-address";');
console.log('const storageKey = `sphere_l3_inventory_${address}`;');
console.log('');
console.log('// Load data');
console.log('const rawData = localStorage.getItem(storageKey);');
console.log('const data = JSON.parse(rawData);');
console.log('');
console.log('// Check tombstones');
console.log('console.log("Tombstones:", data._tombstones);');
console.log('');
console.log('// Check Sent tokens');
console.log('console.log("Sent tokens:", data._sent);');
console.log('');
console.log('// Verify format');
console.log('data._tombstones?.forEach((ts, i) => {');
console.log('  console.log(`Tombstone ${i}:`, {');
console.log('    tokenId: ts.tokenId.slice(0, 16) + "...",');
console.log('    stateHash: ts.stateHash?.slice(0, 20) + "...",');
console.log('    startsWithZeros: ts.stateHash?.startsWith("0000"),');
console.log('    isTokenId: ts.stateHash === ts.tokenId');
console.log('  });');
console.log('});');
console.log('');
console.log('// Check Sent tokens for matching states');
console.log('data._sent?.forEach((sent, i) => {');
console.log('  const tokenId = sent.token?.genesis?.data?.tokenId;');
console.log('  const txs = sent.token?.transactions || [];');
console.log('  console.log(`Sent ${i}: ${tokenId?.slice(0, 16)}... has ${txs.length} transactions`);');
console.log('  txs.forEach((tx, j) => {');
console.log('    console.log(`  Tx ${j}: newStateHash = ${tx.newStateHash?.slice(0, 20)}...`);');
console.log('  });');
console.log('});');
