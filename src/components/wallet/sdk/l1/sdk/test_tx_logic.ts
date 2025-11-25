
import { collectUtxosForAmount } from './tx';

// Mock UTXOs
const utxos = [
    { txid: 'tx1', vout: 0, value: 50000, address: 'addr1' },
    { txid: 'tx2', vout: 1, value: 60000, address: 'addr1' },
    { txid: 'tx3', vout: 2, value: 100000, address: 'addr1' },
];

console.log("Running tests...");

// Test 1: Simple send
console.log("\nTest 1: Send 40000 (covered by 50000 UTXO)");
const plan1 = collectUtxosForAmount(utxos, 40000, 'addr1', 'addrChange');
console.log("Success:", plan1.success);
console.log("Tx Count:", plan1.transactions.length);
plan1.transactions.forEach((tx, i) => {
    console.log(`Tx ${i}: Input Value ${tx.input.value}, Outputs:`, tx.outputs);
});

// Test 2: Multi send
console.log("\nTest 2: Send 100000 (needs multiple UTXOs)");
const plan2 = collectUtxosForAmount(utxos, 100000, 'addr1', 'addrChange');
console.log("Success:", plan2.success);
console.log("Tx Count:", plan2.transactions.length);
plan2.transactions.forEach((tx, i) => {
    console.log(`Tx ${i}: Input Value ${tx.input.value}, Outputs:`, tx.outputs);
});

// Test 3: Insufficient funds
console.log("\nTest 3: Send 1000000 (insufficient)");
const plan3 = collectUtxosForAmount(utxos, 1000000, 'addr1', 'addrChange');
console.log("Success:", plan3.success);
console.log("Error:", plan3.error);
