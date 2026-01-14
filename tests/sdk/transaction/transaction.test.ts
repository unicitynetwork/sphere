import { describe, it, expect } from 'vitest';
import {
  createSignatureHash,
  signTransaction,
  selectUtxos,
  TX_FEE,
  DUST_THRESHOLD,
  SATS_PER_COIN,
  type TxPlan,
  type UTXOInput,
} from '@/components/wallet/sdk/transaction/transaction';
import { privateKeyToAddressInfo } from '@/components/wallet/sdk/address/address';

describe('transaction', () => {
  // Test keys
  const testPrivateKey = '0c28fca386c7a227600b2fe50b7cae11ec86d3bf1fbe471be89827e19d72aa1d';
  const { address: testAddress, publicKey: testPublicKey } = privateKeyToAddressInfo(testPrivateKey);

  // Create a second address for recipient
  const recipientPrivateKey = 'e8f32e723decf4051aefac8e2c93c9c5b214313817cdb01a1494b917c8436b35';
  const { address: recipientAddress } = privateKeyToAddressInfo(recipientPrivateKey);

  describe('constants', () => {
    it('should export TX_FEE', () => {
      expect(TX_FEE).toBe(10_000);
    });

    it('should export DUST_THRESHOLD', () => {
      expect(DUST_THRESHOLD).toBe(546);
    });

    it('should export SATS_PER_COIN', () => {
      expect(SATS_PER_COIN).toBe(100_000_000);
    });
  });

  describe('createSignatureHash', () => {
    it('should create signature hash for tx plan', () => {
      const txPlan: TxPlan = {
        input: {
          tx_hash: 'a'.repeat(64),
          tx_pos: 0,
          value: 100000,
        },
        outputs: [
          { address: recipientAddress, value: 50000 },
          { address: testAddress, value: 40000 },
        ],
      };

      const sigHash = createSignatureHash(txPlan, testPublicKey);

      expect(sigHash).toBeDefined();
      expect(sigHash).toHaveLength(64); // SHA256 = 32 bytes = 64 hex chars
    });

    it('should be deterministic', () => {
      const txPlan: TxPlan = {
        input: {
          tx_hash: 'b'.repeat(64),
          tx_pos: 1,
          value: 200000,
        },
        outputs: [{ address: recipientAddress, value: 150000 }],
      };

      const hash1 = createSignatureHash(txPlan, testPublicKey);
      const hash2 = createSignatureHash(txPlan, testPublicKey);

      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different inputs', () => {
      const txPlan1: TxPlan = {
        input: { tx_hash: 'a'.repeat(64), tx_pos: 0, value: 100000 },
        outputs: [{ address: recipientAddress, value: 50000 }],
      };

      const txPlan2: TxPlan = {
        input: { tx_hash: 'b'.repeat(64), tx_pos: 0, value: 100000 },
        outputs: [{ address: recipientAddress, value: 50000 }],
      };

      const hash1 = createSignatureHash(txPlan1, testPublicKey);
      const hash2 = createSignatureHash(txPlan2, testPublicKey);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('signTransaction', () => {
    it('should sign transaction and return hex and txid', () => {
      const txPlan: TxPlan = {
        input: {
          tx_hash: 'c'.repeat(64),
          tx_pos: 0,
          value: 100000,
        },
        outputs: [
          { address: recipientAddress, value: 50000 },
          { address: testAddress, value: 40000 },
        ],
      };

      const result = signTransaction(txPlan, testPrivateKey);

      expect(result.hex).toBeDefined();
      expect(result.txid).toBeDefined();
      expect(result.hex.length).toBeGreaterThan(0);
      expect(result.txid).toHaveLength(64);
    });

    it('should produce valid SegWit transaction format', () => {
      const txPlan: TxPlan = {
        input: {
          tx_hash: 'd'.repeat(64),
          tx_pos: 0,
          value: 100000,
        },
        outputs: [{ address: recipientAddress, value: 50000 }],
      };

      const result = signTransaction(txPlan, testPrivateKey);

      // SegWit tx starts with version (02000000) + marker (00) + flag (01)
      expect(result.hex.startsWith('0200000000')).toBe(true);
    });

    it('should be deterministic', () => {
      const txPlan: TxPlan = {
        input: {
          tx_hash: 'e'.repeat(64),
          tx_pos: 0,
          value: 100000,
        },
        outputs: [{ address: recipientAddress, value: 50000 }],
      };

      const result1 = signTransaction(txPlan, testPrivateKey);
      const result2 = signTransaction(txPlan, testPrivateKey);

      // txid should be the same
      expect(result1.txid).toBe(result2.txid);
      // hex length should be the same
      expect(result1.hex.length).toBe(result2.hex.length);
    });
  });

  describe('selectUtxos', () => {
    it('should select single sufficient UTXO', () => {
      const utxos: UTXOInput[] = [
        { tx_hash: 'a'.repeat(64), tx_pos: 0, value: 50000, address: testAddress },
        { tx_hash: 'b'.repeat(64), tx_pos: 0, value: 100000, address: testAddress },
      ];

      const result = selectUtxos(utxos, 50000, recipientAddress, testAddress);

      expect(result.success).toBe(true);
      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0].input.value).toBe(100000);
    });

    it('should select smallest sufficient UTXO', () => {
      const utxos: UTXOInput[] = [
        { tx_hash: 'a'.repeat(64), tx_pos: 0, value: 200000, address: testAddress },
        { tx_hash: 'b'.repeat(64), tx_pos: 0, value: 70000, address: testAddress },
        { tx_hash: 'c'.repeat(64), tx_pos: 0, value: 300000, address: testAddress },
      ];

      // 50000 + 10000 fee = 60000 needed, smallest sufficient is 70000
      const result = selectUtxos(utxos, 50000, recipientAddress, testAddress);

      expect(result.success).toBe(true);
      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0].input.value).toBe(70000);
    });

    it('should calculate change correctly', () => {
      const utxos: UTXOInput[] = [
        { tx_hash: 'a'.repeat(64), tx_pos: 0, value: 100000, address: testAddress },
      ];

      // 50000 amount + 10000 fee = 60000, change = 40000
      const result = selectUtxos(utxos, 50000, recipientAddress, testAddress);

      expect(result.success).toBe(true);
      expect(result.transactions[0].changeAmount).toBe(40000);
    });

    it('should fail for insufficient funds', () => {
      const utxos: UTXOInput[] = [
        { tx_hash: 'a'.repeat(64), tx_pos: 0, value: 5000, address: testAddress },
      ];

      const result = selectUtxos(utxos, 50000, recipientAddress, testAddress);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Insufficient funds');
    });

    it('should combine UTXOs when no single is sufficient', () => {
      const utxos: UTXOInput[] = [
        { tx_hash: 'a'.repeat(64), tx_pos: 0, value: 50000, address: testAddress },
        { tx_hash: 'b'.repeat(64), tx_pos: 0, value: 50000, address: testAddress },
        { tx_hash: 'c'.repeat(64), tx_pos: 0, value: 50000, address: testAddress },
      ];

      // 70000 amount needed, each UTXO is 50000 (not enough alone)
      // When combining: each UTXO can provide 40000 (50000 - 10000 fee)
      // Two UTXOs provide 80000, which covers 70000
      const result = selectUtxos(utxos, 70000, recipientAddress, testAddress);

      expect(result.success).toBe(true);
      expect(result.transactions.length).toBeGreaterThan(1);
    });

    it('should include change output when above dust', () => {
      const utxos: UTXOInput[] = [
        { tx_hash: 'a'.repeat(64), tx_pos: 0, value: 100000, address: testAddress },
      ];

      const result = selectUtxos(utxos, 50000, recipientAddress, testAddress);

      expect(result.success).toBe(true);
      // Should have 2 outputs: recipient + change
      expect(result.transactions[0].outputs).toHaveLength(2);
    });

    it('should not include change output when below dust', () => {
      const utxos: UTXOInput[] = [
        { tx_hash: 'a'.repeat(64), tx_pos: 0, value: 60500, address: testAddress },
      ];

      // 50000 + 10000 fee = 60000, change = 500 (below DUST_THRESHOLD)
      const result = selectUtxos(utxos, 50000, recipientAddress, testAddress);

      expect(result.success).toBe(true);
      // Should have only 1 output (recipient), change absorbed into fee
      expect(result.transactions[0].outputs).toHaveLength(1);
    });

    it('should use custom fee', () => {
      const utxos: UTXOInput[] = [
        { tx_hash: 'a'.repeat(64), tx_pos: 0, value: 100000, address: testAddress },
      ];

      const customFee = 20000;
      const result = selectUtxos(utxos, 50000, recipientAddress, testAddress, customFee);

      expect(result.success).toBe(true);
      expect(result.transactions[0].fee).toBe(customFee);
      // Change = 100000 - 50000 - 20000 = 30000
      expect(result.transactions[0].changeAmount).toBe(30000);
    });

    it('should handle empty UTXO list', () => {
      const result = selectUtxos([], 50000, recipientAddress, testAddress);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Insufficient funds');
    });
  });
});
