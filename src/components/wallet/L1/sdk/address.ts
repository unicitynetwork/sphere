import CryptoJS from "crypto-js";
import elliptic from "elliptic";
import { createBech32 } from "./bech32";

const ec = new elliptic.ec("secp256k1");

// secp256k1 curve order
const CURVE_ORDER = BigInt(
  "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141"
);

/**
 * Standard BIP32 child key derivation
 * @param parentPrivKey - Parent private key (hex string, 64 chars)
 * @param parentChainCode - Parent chain code (hex string, 64 chars)
 * @param index - Child index (use >= 0x80000000 for hardened)
 * @returns Child private key and chain code
 */
export function deriveChildKeyBIP32(
  parentPrivKey: string,
  parentChainCode: string,
  index: number
): { privateKey: string; chainCode: string } {
  const isHardened = index >= 0x80000000;
  let data: string;

  if (isHardened) {
    // Hardened derivation: 0x00 || parentPrivKey || index
    const indexHex = index.toString(16).padStart(8, "0");
    data = "00" + parentPrivKey + indexHex;
  } else {
    // Non-hardened derivation: compressedPubKey || index
    const keyPair = ec.keyFromPrivate(parentPrivKey, "hex");
    const compressedPubKey = keyPair.getPublic(true, "hex");
    const indexHex = index.toString(16).padStart(8, "0");
    data = compressedPubKey + indexHex;
  }

  // HMAC-SHA512 with chain code as key
  const I = CryptoJS.HmacSHA512(
    CryptoJS.enc.Hex.parse(data),
    CryptoJS.enc.Hex.parse(parentChainCode)
  ).toString();

  const IL = I.substring(0, 64); // Left 32 bytes
  const IR = I.substring(64); // Right 32 bytes (new chain code)

  // Add IL to parent key mod n (curve order)
  const ilBigInt = BigInt("0x" + IL);
  const parentKeyBigInt = BigInt("0x" + parentPrivKey);

  // Check IL is valid (less than curve order)
  if (ilBigInt >= CURVE_ORDER) {
    throw new Error("Invalid key: IL >= curve order");
  }

  const childKeyBigInt = (ilBigInt + parentKeyBigInt) % CURVE_ORDER;

  // Check child key is valid (not zero)
  if (childKeyBigInt === 0n) {
    throw new Error("Invalid key: child key is zero");
  }

  const childPrivKey = childKeyBigInt.toString(16).padStart(64, "0");

  return {
    privateKey: childPrivKey,
    chainCode: IR,
  };
}

/**
 * Derive key at a full BIP44 path
 * @param masterPrivKey - Master private key
 * @param masterChainCode - Master chain code
 * @param path - BIP44 path like "m/44'/0'/0'/0/0"
 */
export function deriveKeyAtPath(
  masterPrivKey: string,
  masterChainCode: string,
  path: string
): { privateKey: string; chainCode: string } {
  const pathParts = path.replace("m/", "").split("/");

  let currentKey = masterPrivKey;
  let currentChainCode = masterChainCode;

  for (const part of pathParts) {
    const isHardened = part.endsWith("'") || part.endsWith("h");
    const indexStr = part.replace(/['h]$/, "");
    let index = parseInt(indexStr, 10);

    if (isHardened) {
      index += 0x80000000; // Add hardened offset
    }

    const derived = deriveChildKeyBIP32(currentKey, currentChainCode, index);
    currentKey = derived.privateKey;
    currentChainCode = derived.chainCode;
  }

  return {
    privateKey: currentKey,
    chainCode: currentChainCode,
  };
}

/**
 * Generate master key and chain code from seed (BIP32 standard)
 * @param seedHex - Random seed (typically 64 bytes from BIP39 mnemonic)
 */
export function generateMasterKeyFromSeed(seedHex: string): {
  masterPrivateKey: string;
  masterChainCode: string;
} {
  // BIP32: HMAC-SHA512 with key "Bitcoin seed"
  const I = CryptoJS.HmacSHA512(
    CryptoJS.enc.Hex.parse(seedHex),
    CryptoJS.enc.Utf8.parse("Bitcoin seed")
  ).toString();

  const IL = I.substring(0, 64); // Master private key
  const IR = I.substring(64); // Master chain code

  // Validate master key
  const masterKeyBigInt = BigInt("0x" + IL);
  if (masterKeyBigInt === 0n || masterKeyBigInt >= CURVE_ORDER) {
    throw new Error("Invalid master key generated");
  }

  return {
    masterPrivateKey: IL,
    masterChainCode: IR,
  };
}

/**
 * Generate HD address using standard BIP32
 * Standard path: m/44'/0'/0'/0/{index} (external chain, non-hardened)
 */
export function generateHDAddressBIP32(
  masterPriv: string,
  chainCode: string,
  index: number,
  basePath: string = "m/44'/0'/0'"
) {
  // Standard path: m/44'/0'/0'/0/{index} (external chain, non-hardened)
  const fullPath = `${basePath}/0/${index}`;

  const derived = deriveKeyAtPath(masterPriv, chainCode, fullPath);

  const keyPair = ec.keyFromPrivate(derived.privateKey);
  const publicKey = keyPair.getPublic(true, "hex");

  // HASH160 (SHA256 -> RIPEMD160)
  const sha = CryptoJS.SHA256(CryptoJS.enc.Hex.parse(publicKey)).toString();
  const hash160 = CryptoJS.RIPEMD160(CryptoJS.enc.Hex.parse(sha)).toString();

  const programBytes = Uint8Array.from(
    hash160.match(/../g)!.map((x) => parseInt(x, 16))
  );

  const address = createBech32("alpha", 0, programBytes);

  return {
    address,
    privateKey: derived.privateKey,
    publicKey,
    index,
    path: fullPath,
  };
}

// ============================================
// Original index.html compatible derivation
// ============================================

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

  // HMAC-SHA512 with path as key (matching index.html exactly)
  const hmacInput = CryptoJS.enc.Hex.parse(masterPrivateKey);
  const hmacKey = CryptoJS.enc.Utf8.parse(derivationPath);
  const hmacOutput = CryptoJS.HmacSHA512(hmacInput, hmacKey).toString();

  // Use left 32 bytes for private key
  const childPrivateKey = hmacOutput.substring(0, 64);

  // Generate key pair from the derived key
  const keyPair = ec.keyFromPrivate(childPrivateKey);
  const publicKey = keyPair.getPublic(true, "hex");

  // HASH160 (SHA256 -> RIPEMD160)
  const sha = CryptoJS.SHA256(CryptoJS.enc.Hex.parse(publicKey)).toString();
  const hash160 = CryptoJS.RIPEMD160(CryptoJS.enc.Hex.parse(sha)).toString();

  // Witness program = 20 bytes of HASH160
  const programBytes = Uint8Array.from(
    hash160.match(/../g)!.map((x) => parseInt(x, 16))
  );

  // Bech32 encode with alpha prefix
  const address = createBech32("alpha", 0, programBytes);

  return {
    address,
    privateKey: childPrivateKey,
    publicKey,
    index,
    path: derivationPath,
  };
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
  const data = masterPriv + index.toString(16).padStart(8, "0");

  const I = CryptoJS.HmacSHA512(
    CryptoJS.enc.Hex.parse(data),
    CryptoJS.enc.Hex.parse(chainCode)
  ).toString();

  return {
    privateKey: I.substring(0, 64),
    nextChainCode: I.substring(64),
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

  const keyPair = ec.keyFromPrivate(child.privateKey);
  const publicKey = keyPair.getPublic(true, "hex");

  // HASH160 (SHA256 -> RIPEMD)
  const sha = CryptoJS.SHA256(CryptoJS.enc.Hex.parse(publicKey)).toString();
  const hash160 = CryptoJS.RIPEMD160(CryptoJS.enc.Hex.parse(sha)).toString();

  // witness program = 20 bytes of HASH160
  const programBytes = Uint8Array.from(
    hash160.match(/../g)!.map((x) => parseInt(x, 16))
  );

  // Bech32 encode
  const address = createBech32("alpha", 0, programBytes);

  return {
    address,
    privateKey: child.privateKey,
    publicKey,
    index,
    path: `m/44'/0'/0'/${index}`,
  };
}
