import { describe, it, expect } from 'vitest';
import {
  createWallet,
  restoreFromMnemonic,
  validateMnemonic,
} from '@/components/wallet/sdk/core/wallet';

describe('wallet', () => {
  describe('createWallet', () => {
    it('should create wallet with 12 word mnemonic by default', () => {
      const wallet = createWallet();

      expect(wallet.mnemonic).toBeDefined();
      expect(wallet.mnemonic!.split(' ')).toHaveLength(12);
      expect(wallet.masterKey).toBeDefined();
      expect(wallet.chainCode).toBeDefined();
      expect(wallet.masterKey).toHaveLength(64); // 32 bytes hex
      expect(wallet.chainCode).toHaveLength(64); // 32 bytes hex
    });

    it('should create wallet with 24 word mnemonic when specified', () => {
      const wallet = createWallet(24);

      expect(wallet.mnemonic).toBeDefined();
      expect(wallet.mnemonic!.split(' ')).toHaveLength(24);
      expect(wallet.masterKey).toBeDefined();
      expect(wallet.chainCode).toBeDefined();
    });

    it('should create unique wallets each time', () => {
      const wallet1 = createWallet();
      const wallet2 = createWallet();

      expect(wallet1.mnemonic).not.toBe(wallet2.mnemonic);
      expect(wallet1.masterKey).not.toBe(wallet2.masterKey);
    });
  });

  describe('restoreFromMnemonic', () => {
    const testMnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

    it('should restore wallet from valid mnemonic', () => {
      const wallet = restoreFromMnemonic(testMnemonic);

      expect(wallet.masterKey).toBeDefined();
      expect(wallet.chainCode).toBeDefined();
      expect(wallet.mnemonic).toBe(testMnemonic);
    });

    it('should produce deterministic keys from same mnemonic', () => {
      const wallet1 = restoreFromMnemonic(testMnemonic);
      const wallet2 = restoreFromMnemonic(testMnemonic);

      expect(wallet1.masterKey).toBe(wallet2.masterKey);
      expect(wallet1.chainCode).toBe(wallet2.chainCode);
    });

    it('should throw error for invalid mnemonic', () => {
      expect(() => restoreFromMnemonic('invalid mnemonic phrase')).toThrow('Invalid mnemonic phrase');
    });

    it('should throw error for empty mnemonic', () => {
      expect(() => restoreFromMnemonic('')).toThrow('Invalid mnemonic phrase');
    });
  });

  describe('validateMnemonic', () => {
    it('should return true for valid 12-word mnemonic', () => {
      const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
      expect(validateMnemonic(mnemonic)).toBe(true);
    });

    it('should return true for valid 24-word mnemonic', () => {
      const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art';
      expect(validateMnemonic(mnemonic)).toBe(true);
    });

    it('should return false for invalid mnemonic', () => {
      expect(validateMnemonic('invalid mnemonic')).toBe(false);
      expect(validateMnemonic('abandon abandon abandon')).toBe(false);
      expect(validateMnemonic('')).toBe(false);
    });

    it('should return false for mnemonic with invalid checksum', () => {
      // Last word changed to break checksum
      const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon';
      expect(validateMnemonic(mnemonic)).toBe(false);
    });
  });
});
