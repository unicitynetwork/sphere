/**
 * Wallet Creation and Restoration
 *
 * Pure functions for creating and restoring wallets from mnemonic.
 * No side effects, no browser APIs - can run anywhere.
 */

import * as bip39 from 'bip39';
import { generateMasterKeyFromSeed } from './derivation';
import type { WalletKeys } from '../types';

/**
 * Create a new wallet with fresh mnemonic
 *
 * @param wordCount - Number of words (12 or 24)
 * @returns Wallet keys including mnemonic
 *
 * @example
 * const { mnemonic, masterKey, chainCode } = createWallet(12);
 * // Save mnemonic securely for backup
 */
export function createWallet(wordCount: 12 | 24 = 12): WalletKeys {
  const strength = wordCount === 24 ? 256 : 128;
  const mnemonic = bip39.generateMnemonic(strength);

  const keys = restoreFromMnemonic(mnemonic);

  return {
    ...keys,
    mnemonic,
  };
}

/**
 * Restore wallet from BIP39 mnemonic phrase
 *
 * @param mnemonic - 12 or 24 word recovery phrase
 * @returns Master key and chain code
 * @throws Error if mnemonic is invalid
 *
 * @example
 * const { masterKey, chainCode } = restoreFromMnemonic("word1 word2 ...");
 */
export function restoreFromMnemonic(mnemonic: string): WalletKeys {
  if (!bip39.validateMnemonic(mnemonic)) {
    throw new Error('Invalid mnemonic phrase');
  }

  // Convert mnemonic to seed (sync version for simplicity)
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const seedHex = Buffer.from(seed).toString('hex');

  // Derive master key using BIP32 standard
  const { masterKey, chainCode } = generateMasterKeyFromSeed(seedHex);

  return {
    masterKey,
    chainCode,
    mnemonic,
  };
}

/**
 * Validate mnemonic phrase
 */
export function validateMnemonic(mnemonic: string): boolean {
  return bip39.validateMnemonic(mnemonic);
}
