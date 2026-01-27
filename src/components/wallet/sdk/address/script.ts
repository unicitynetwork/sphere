/**
 * Script utilities for Bitcoin/Alpha blockchain
 *
 * Pure functions for script operations.
 * No browser APIs - can run anywhere.
 */

import { decodeBech32 } from './bech32';
import { bytesToHex } from '../core/utils';
import CryptoJS from 'crypto-js';

/**
 * Convert bech32 address to Electrum script hash
 *
 * Required for Electrum protocol RPC calls:
 *  - blockchain.scripthash.get_history
 *  - blockchain.scripthash.listunspent
 *  - blockchain.scripthash.get_balance
 *
 * @param address - Bech32 address (e.g., "alpha1...")
 * @returns Electrum script hash (reversed SHA256 of scriptPubKey)
 */
export function addressToScriptHash(address: string): string {
  const decoded = decodeBech32(address);
  if (!decoded) throw new Error('Invalid bech32 address: ' + address);

  // witness program always starts with OP_0 + PUSH20 (for P2WPKH)
  const scriptHex = '0014' + bytesToHex(decoded.data);

  // SHA256
  const sha = CryptoJS.SHA256(CryptoJS.enc.Hex.parse(scriptHex)).toString();

  // Electrum requires reversed byte order
  return sha.match(/../g)!.reverse().join('');
}

/**
 * Create scriptPubKey for address (P2WPKH for bech32)
 *
 * @param address - Bech32 address
 * @returns scriptPubKey hex string
 */
export function createScriptPubKey(address: string): string {
  if (!address || typeof address !== 'string') {
    throw new Error('Invalid address: must be a string');
  }

  const decoded = decodeBech32(address);
  if (!decoded) {
    throw new Error('Invalid bech32 address: ' + address);
  }

  // Convert data array to hex string
  const dataHex = Array.from(decoded.data)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

  // P2WPKH scriptPubKey: OP_0 <20-byte-key-hash>
  return '0014' + dataHex;
}
