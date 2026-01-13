/**
 * L1 Address Generation and Key Derivation
 *
 * This module re-exports core BIP32 functions from WalletCore and adds
 * L1-specific address generation utilities.
 *
 * For pure wallet operations (create, restore, derive), use WalletCore directly.
 * This module is for L1 (Alpha blockchain) specific functionality.
 */

import { generateAddressInfo } from "../../shared/utils/cryptoUtils";

// Re-export core BIP32 functions from WalletCore (single source of truth)
export {
  generateMasterKeyFromSeed,
  deriveChildKeyBIP32,
  deriveKeyAtPath,
  deriveChildKeyLegacy,
  deriveKeyWifHmac,
} from "../../core/WalletCore";

// Import for internal use
import {
  deriveKeyAtPath,
  deriveChildKeyLegacy,
  deriveKeyWifHmac,
} from "../../core/WalletCore";

/**
 * Generate HD address using standard BIP32
 * Standard path: m/44'/0'/0'/0/{index} (external chain, non-hardened)
 * For change addresses, use isChange = true to get m/44'/0'/0'/1/{index}
 */
export function generateHDAddressBIP32(
  masterPriv: string,
  chainCode: string,
  index: number,
  basePath: string = "m/44'/0'/0'",
  isChange: boolean = false
) {
  // Chain: 0 = external (receiving), 1 = internal (change)
  const chain = isChange ? 1 : 0;
  const fullPath = `${basePath}/${chain}/${index}`;

  const derived = deriveKeyAtPath(masterPriv, chainCode, fullPath);

  return generateAddressInfo(derived.privateKey, index, fullPath);
}

/**
 * Generate address from master private key using HMAC-SHA512 derivation
 * This matches exactly the original index.html implementation
 * @param masterPrivateKey - 32-byte hex private key (64 chars)
 * @param index - Address index
 */
export function generateAddressFromMasterKey(
  masterPrivateKey: string,
  index: number
) {
  const derivationPath = `m/44'/0'/${index}'`;
  const childPrivateKey = deriveKeyWifHmac(masterPrivateKey, index);

  return generateAddressInfo(childPrivateKey, index, derivationPath);
}

// ============================================
// Legacy functions for backward compatibility
// ============================================

/**
 * @deprecated Use deriveChildKeyBIP32 for new wallets
 * Legacy HMAC-SHA512 derivation (non-standard)
 */
export function deriveChildKey(
  masterPriv: string,
  chainCode: string,
  index: number
) {
  const result = deriveChildKeyLegacy(masterPriv, chainCode, index);
  return {
    privateKey: result.privateKey,
    nextChainCode: result.chainCode,
  };
}

/**
 * @deprecated Use generateHDAddressBIP32 for new wallets
 * Legacy HD address generation (non-standard derivation)
 */
export function generateHDAddress(
  masterPriv: string,
  chainCode: string,
  index: number
) {
  const child = deriveChildKey(masterPriv, chainCode, index);
  const path = `m/44'/0'/0'/${index}`;

  return generateAddressInfo(child.privateKey, index, path);
}
