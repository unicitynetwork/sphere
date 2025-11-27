import CryptoJS from "crypto-js";

const SALT = "alpha_wallet_salt";
const PBKDF2_ITERATIONS = 100000;

export function encrypt(text: string, password: string): string {
  return CryptoJS.AES.encrypt(text, password).toString();
}

export function decrypt(encrypted: string, password: string): string {
  const bytes = CryptoJS.AES.decrypt(encrypted, password);
  return bytes.toString(CryptoJS.enc.Utf8);
}

export function generatePrivateKey(): string {
  return CryptoJS.lib.WordArray.random(32).toString();
}

/**
 * Encrypt wallet master key with password using PBKDF2 + AES
 */
export function encryptWallet(
  masterPrivateKey: string,
  password: string
): string {
  const passwordKey = CryptoJS.PBKDF2(password, SALT, {
    keySize: 256 / 32,
    iterations: PBKDF2_ITERATIONS,
  }).toString();

  const encrypted = CryptoJS.AES.encrypt(
    masterPrivateKey,
    passwordKey
  ).toString();

  return encrypted;
}

/**
 * Decrypt wallet master key with password
 */
export function decryptWallet(
  encryptedData: string,
  password: string
): string {
  const passwordKey = CryptoJS.PBKDF2(password, SALT, {
    keySize: 256 / 32,
    iterations: PBKDF2_ITERATIONS,
  }).toString();

  const decrypted = CryptoJS.AES.decrypt(encryptedData, passwordKey);
  return decrypted.toString(CryptoJS.enc.Utf8);
}

/**
 * Convert hex private key to WIF format
 */
export function hexToWIF(hexKey: string): string {
  // Alpha mainnet version byte is 0x80
  const versionByte = "80";
  const extendedKey = versionByte + hexKey;

  // Calculate checksum
  const hash1 = CryptoJS.SHA256(CryptoJS.enc.Hex.parse(extendedKey)).toString();
  const hash2 = CryptoJS.SHA256(CryptoJS.enc.Hex.parse(hash1)).toString();
  const checksum = hash2.substring(0, 8);

  // Combine and encode
  const finalHex = extendedKey + checksum;

  // Convert to Base58
  return base58Encode(finalHex);
}

/**
 * Base58 encoding
 */
function base58Encode(hex: string): string {
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

  // Convert hex to big integer
  let num = BigInt("0x" + hex);
  let encoded = "";

  while (num > 0n) {
    const remainder = Number(num % 58n);
    num = num / 58n;
    encoded = ALPHABET[remainder] + encoded;
  }

  // Add leading 1s for leading 0s in hex
  for (let i = 0; i < hex.length && hex.substring(i, i + 2) === "00"; i += 2) {
    encoded = "1" + encoded;
  }

  return encoded;
}
