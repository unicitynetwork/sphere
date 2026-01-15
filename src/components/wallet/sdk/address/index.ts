/**
 * Address Module (Platform-Independent)
 *
 * Provides address generation and derivation:
 * - L1 address generation (bech32)
 * - L3 address derivation (Unicity network)
 * - Unified address derivation (L1 + L3)
 * - Script utilities for blockchain operations
 */

// Address generation
export {
  computeHash160,
  hash160ToBytes,
  publicKeyToAddress,
  privateKeyToAddressInfo,
  generateAddressInfo,
  generateHDAddressBIP32,
  generateAddressFromMasterKey,
  generateHDAddress,
  deriveChildKey,
  ec,
  // Address key recovery
  recoverKeyWifHmac,
  recoverKeyBIP32AtPath,
  recoverKeyBIP32Scan,
} from './address';

export type {
  RecoveredAddressKey,
  RecoverKeyResult,
} from './address';

// Unified address derivation (L1 + L3)
export {
  deriveL1Address,
  deriveDefaultL1Address,
  deriveNextL1Address,
  deriveL3Address,
  deriveUnifiedAddress,
  deriveDefaultUnifiedAddress,
  deriveNextUnifiedAddress,
  parsePathComponents,
  getAddressPath,
} from './unified';

// Bech32 encoding
export {
  createBech32,
  decodeBech32,
  convertBits,
  CHARSET,
} from './bech32';

// Script utilities
export {
  addressToScriptHash,
  createScriptPubKey,
} from './script';

// Address helpers
export { WalletAddressHelper } from './addressHelpers';
