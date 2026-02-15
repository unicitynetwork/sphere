/**
 * Wallet file parsing utilities
 * Provides helpers for parsing and validating wallet file formats
 */

export type WalletFileType = "dat" | "json" | "txt" | "mnemonic" | "unknown";

function isJSONWalletFormat(content: string): boolean {
  try {
    const json = JSON.parse(content);
    return json.version === "1.0" && (json.masterPrivateKey || json.encrypted);
  } catch {
    return false;
  }
}

export interface ParsedWalletInfo {
  fileType: WalletFileType;
  isEncrypted: boolean;
  isBIP32: boolean;
  hasMnemonic: boolean;
  needsScanning: boolean;
}

/**
 * Detects the type of wallet file based on filename and content
 */
export function detectWalletFileType(filename: string, content: string): WalletFileType {
  // .dat files are binary wallet dumps
  if (filename.endsWith(".dat")) {
    return "dat";
  }

  // Check for JSON format
  if (filename.endsWith(".json") || isJSONWalletFormat(content)) {
    return "json";
  }

  // Check for mnemonic (12 or 24 words)
  const trimmed = content.trim();
  const words = trimmed.split(/\s+/);
  if (
    (words.length === 12 || words.length === 24) &&
    words.every((w) => /^[a-z]+$/.test(w.toLowerCase()))
  ) {
    return "mnemonic";
  }

  // Check for L1 wallet text format
  if (content.includes("MASTER PRIVATE KEY")) {
    return "txt";
  }

  return "unknown";
}

/**
 * Checks if a file content is encrypted
 */
export function isEncryptedWallet(content: string): boolean {
  // Check JSON encryption
  try {
    const json = JSON.parse(content);
    if (json.encrypted) {
      return true;
    }
  } catch {
    // Not JSON, continue
  }

  // Check TXT encryption marker
  return content.includes("ENCRYPTED MASTER KEY");
}

/**
 * Checks if a wallet file uses BIP32 derivation (needs address scanning)
 */
export function isBIP32Wallet(content: string): boolean {
  // Check JSON format
  try {
    const json = JSON.parse(content);
    if (json.derivationMode === "bip32" || json.chainCode) {
      return true;
    }
  } catch {
    // Not JSON, continue
  }

  // Check TXT format markers
  return (
    content.includes("MASTER CHAIN CODE") ||
    content.includes("WALLET TYPE: BIP32") ||
    content.includes("WALLET TYPE: Alpha descriptor")
  );
}

/**
 * Checks if a JSON wallet contains a mnemonic
 */
export function hasMnemonicInJSON(content: string): boolean {
  try {
    const json = JSON.parse(content);
    return !!(
      json.mnemonic ||
      json.seed ||
      json.recoveryPhrase ||
      (Array.isArray(json.words) && json.words.length >= 12) ||
      json.encrypted?.mnemonic
    );
  } catch {
    return false;
  }
}

/**
 * Extracts mnemonic from JSON content
 */
export function extractMnemonic(json: Record<string, unknown>): string | null {
  if (typeof json.mnemonic === "string") return json.mnemonic;
  if (typeof json.seed === "string") return json.seed;
  if (typeof json.recoveryPhrase === "string") return json.recoveryPhrase;
  if (Array.isArray(json.words)) return json.words.join(" ");
  return null;
}

/**
 * Determines if a file needs blockchain scanning
 * Returns true for:
 * - .dat files (always need scanning)
 * - BIP32 wallets without mnemonic (derive addresses from master key)
 */
export function needsBlockchainScanning(filename: string, content: string): boolean {
  // .dat files always need scanning
  if (filename.endsWith(".dat")) {
    return true;
  }

  // JSON files with mnemonic don't need scanning - restore directly from seed
  // JSON files with BIP32 but no mnemonic need scanning
  if (filename.endsWith(".json") || isJSONWalletFormat(content)) {
    const hasMnemonic = hasMnemonicInJSON(content);
    const isBip32 = isBIP32Wallet(content);
    return !hasMnemonic && isBip32;
  }

  // TXT files with BIP32 markers need scanning
  return isBIP32Wallet(content);
}

/**
 * Parses wallet file and returns info about its format
 */
export async function parseWalletFile(file: File): Promise<ParsedWalletInfo> {
  const filename = file.name;

  // .dat files are special - can't read content easily
  if (filename.endsWith(".dat")) {
    return {
      fileType: "dat",
      isEncrypted: false, // Determined during import
      isBIP32: true, // .dat files are typically BIP32
      hasMnemonic: false,
      needsScanning: true,
    };
  }

  const content = await file.text();
  const fileType = detectWalletFileType(filename, content);

  return {
    fileType,
    isEncrypted: isEncryptedWallet(content),
    isBIP32: isBIP32Wallet(content),
    hasMnemonic: fileType === "mnemonic" || hasMnemonicInJSON(content),
    needsScanning: needsBlockchainScanning(filename, content),
  };
}

/**
 * Validates mnemonic phrase
 * Returns true if the phrase has valid structure (12 or 24 lowercase words)
 */
export function isValidMnemonicFormat(phrase: string): boolean {
  const words = phrase.trim().split(/\s+/);
  if (words.length !== 12 && words.length !== 24) {
    return false;
  }
  return words.every((word) => /^[a-z]+$/.test(word.toLowerCase()));
}

/**
 * Normalizes mnemonic phrase
 * - Trims whitespace
 * - Converts to lowercase
 * - Normalizes spaces
 */
export function normalizeMnemonic(phrase: string): string {
  return phrase
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .join(" ");
}

/**
 * Truncates address for display
 */
export function truncateAddress(address: string, startChars = 12, endChars = 8): string {
  if (!address) return "";
  if (address.length <= startChars + endChars + 3) return address;
  return `${address.slice(0, startChars)}...${address.slice(-endChars)}`;
}
