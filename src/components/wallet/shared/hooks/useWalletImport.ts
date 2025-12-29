/**
 * Shared hook for wallet file import logic
 * Used by both CreateWalletFlow (L3) and L1WalletView
 */
import { useState, useCallback } from "react";
import {
  importWallet as importWalletFromFile,
  importWalletFromJSON,
  isJSONWalletFormat,
  saveWalletToStorage,
  type Wallet as L1Wallet,
  type ScannedAddress,
} from "../../L1/sdk";
import { UnifiedKeyManager } from "../services/UnifiedKeyManager";

export type ImportFileType = "dat" | "json" | "txt" | "mnemonic" | "unknown";

export interface ImportResult {
  success: boolean;
  error?: string;
  wallet?: L1Wallet;
  mnemonic?: string;
  needsPassword?: boolean;
  needsScanning?: boolean;
  fileType: ImportFileType;
  derivationMode?: "bip32" | "wif_hmac" | "mnemonic";
}

export interface UseWalletImportState {
  isImporting: boolean;
  error: string | null;
  showScanModal: boolean;
  showPasswordModal: boolean;
  pendingWallet: L1Wallet | null;
  pendingFile: File | null;
  initialScanCount: number;
}

export interface UseWalletImportActions {
  importFile: (file: File, scanCount?: number) => Promise<ImportResult>;
  importWithPassword: (password: string) => Promise<ImportResult>;
  selectScannedAddress: (
    addr: ScannedAddress,
    keyManager: UnifiedKeyManager
  ) => Promise<L1Wallet>;
  selectAllScannedAddresses: (
    addresses: ScannedAddress[],
    keyManager: UnifiedKeyManager
  ) => Promise<L1Wallet>;
  cancelScan: () => void;
  cancelPassword: () => void;
  clearError: () => void;
  reset: () => void;
}

export type UseWalletImportReturn = UseWalletImportState & UseWalletImportActions;

/**
 * Detects the type of wallet file based on content
 */
export function detectFileType(filename: string, content: string): ImportFileType {
  if (filename.endsWith(".dat")) return "dat";
  if (filename.endsWith(".json") || isJSONWalletFormat(content)) return "json";

  // Check for mnemonic (12 or 24 words)
  const trimmed = content.trim();
  const words = trimmed.split(/\s+/);
  if ((words.length === 12 || words.length === 24) &&
      words.every(w => /^[a-z]+$/.test(w.toLowerCase()))) {
    return "mnemonic";
  }

  // Check for L1 wallet format
  if (content.includes("MASTER PRIVATE KEY")) return "txt";

  return "unknown";
}

/**
 * Checks if file needs password
 */
export function needsPassword(content: string): boolean {
  try {
    const json = JSON.parse(content);
    if (json.encrypted) return true;
  } catch {
    // Not JSON
  }
  return content.includes("ENCRYPTED MASTER KEY");
}

/**
 * Checks if file needs BIP32 scanning
 */
export function needsBIP32Scanning(content: string): boolean {
  return (
    content.includes("MASTER CHAIN CODE") ||
    content.includes("WALLET TYPE: BIP32") ||
    content.includes("WALLET TYPE: Alpha descriptor")
  );
}

/**
 * Extract mnemonic from various JSON formats
 */
export function extractMnemonicFromJSON(json: Record<string, unknown>): string | null {
  if (typeof json.mnemonic === "string") return json.mnemonic;
  if (typeof json.seed === "string") return json.seed;
  if (typeof json.recoveryPhrase === "string") return json.recoveryPhrase;
  if (Array.isArray(json.words)) return json.words.join(" ");
  return null;
}

/**
 * Hook for managing wallet file imports
 */
export function useWalletImport(): UseWalletImportReturn {
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showScanModal, setShowScanModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [pendingWallet, setPendingWallet] = useState<L1Wallet | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [initialScanCount, setInitialScanCount] = useState(10);

  const clearError = useCallback(() => setError(null), []);

  const reset = useCallback(() => {
    setIsImporting(false);
    setError(null);
    setShowScanModal(false);
    setShowPasswordModal(false);
    setPendingWallet(null);
    setPendingFile(null);
    setInitialScanCount(10);
  }, []);

  const cancelScan = useCallback(() => {
    setShowScanModal(false);
    setPendingWallet(null);
  }, []);

  const cancelPassword = useCallback(() => {
    setShowPasswordModal(false);
    setPendingFile(null);
  }, []);

  /**
   * Import a wallet file
   * Returns result indicating next steps (password needed, scanning needed, etc.)
   */
  const importFile = useCallback(async (
    file: File,
    scanCount: number = 10
  ): Promise<ImportResult> => {
    setIsImporting(true);
    setError(null);

    try {
      // Handle .dat files - always need scanning
      if (file.name.endsWith(".dat")) {
        const result = await importWalletFromFile(file);
        if (!result.success || !result.wallet) {
          throw new Error(result.error || "Import failed");
        }

        setPendingWallet(result.wallet);
        setInitialScanCount(scanCount || 100);
        setShowScanModal(true);
        setIsImporting(false);

        return {
          success: true,
          wallet: result.wallet,
          needsScanning: true,
          fileType: "dat",
        };
      }

      const content = await file.text();
      const fileType = detectFileType(file.name, content);

      // Check if needs password
      if (needsPassword(content)) {
        setPendingFile(file);
        setInitialScanCount(scanCount);
        setShowPasswordModal(true);
        setIsImporting(false);

        return {
          success: true,
          needsPassword: true,
          fileType,
        };
      }

      // Handle JSON files
      if (fileType === "json") {
        const json = JSON.parse(content);
        const result = await importWalletFromJSON(content);

        if (!result.success || !result.wallet) {
          throw new Error(result.error || "Import failed");
        }

        // Check for mnemonic
        const mnemonic = extractMnemonicFromJSON(json) || result.mnemonic;
        if (mnemonic) {
          setIsImporting(false);
          return {
            success: true,
            mnemonic,
            wallet: result.wallet,
            fileType: "json",
            derivationMode: "mnemonic",
          };
        }

        // Check if BIP32 needs scanning
        if (result.derivationMode === "bip32" || result.wallet.chainCode) {
          setPendingWallet(result.wallet);
          setInitialScanCount(scanCount);
          setShowScanModal(true);
          setIsImporting(false);

          return {
            success: true,
            wallet: result.wallet,
            needsScanning: true,
            fileType: "json",
            derivationMode: "bip32",
          };
        }

        // Standard wallet
        setIsImporting(false);
        return {
          success: true,
          wallet: result.wallet,
          fileType: "json",
          derivationMode: "wif_hmac",
        };
      }

      // Handle mnemonic text file
      if (fileType === "mnemonic") {
        setIsImporting(false);
        return {
          success: true,
          mnemonic: content.trim(),
          fileType: "mnemonic",
          derivationMode: "mnemonic",
        };
      }

      // Handle TXT wallet files
      if (fileType === "txt") {
        // Check if BIP32 needs scanning
        if (needsBIP32Scanning(content)) {
          const result = await importWalletFromFile(file);
          if (!result.success || !result.wallet) {
            throw new Error(result.error || "Import failed");
          }

          setPendingWallet(result.wallet);
          setInitialScanCount(scanCount);
          setShowScanModal(true);
          setIsImporting(false);

          return {
            success: true,
            wallet: result.wallet,
            needsScanning: true,
            fileType: "txt",
            derivationMode: "bip32",
          };
        }

        // Standard L1 wallet
        const result = await importWalletFromFile(file);
        if (!result.success || !result.wallet) {
          throw new Error(result.error || "Import failed");
        }

        setIsImporting(false);
        return {
          success: true,
          wallet: result.wallet,
          fileType: "txt",
          derivationMode: "wif_hmac",
        };
      }

      throw new Error("Could not import wallet from file - unknown format");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to import wallet";
      setError(message);
      setIsImporting(false);
      return {
        success: false,
        error: message,
        fileType: "unknown",
      };
    }
  }, []);

  /**
   * Import with password (for encrypted files)
   */
  const importWithPassword = useCallback(async (
    password: string
  ): Promise<ImportResult> => {
    if (!pendingFile) {
      return {
        success: false,
        error: "No pending file",
        fileType: "unknown",
      };
    }

    setIsImporting(true);
    setError(null);

    try {
      const content = await pendingFile.text();
      const fileType = detectFileType(pendingFile.name, content);

      // Handle encrypted JSON
      if (fileType === "json" || isJSONWalletFormat(content)) {
        const result = await importWalletFromJSON(content, password);
        if (!result.success || !result.wallet) {
          throw new Error(result.error || "Import failed");
        }

        setShowPasswordModal(false);
        setPendingFile(null);

        // Check for mnemonic
        if (result.mnemonic) {
          setIsImporting(false);
          return {
            success: true,
            mnemonic: result.mnemonic,
            wallet: result.wallet,
            fileType: "json",
            derivationMode: "mnemonic",
          };
        }

        // Check if BIP32 needs scanning
        if (result.derivationMode === "bip32" || result.wallet.chainCode) {
          setPendingWallet(result.wallet);
          setShowScanModal(true);
          setIsImporting(false);

          return {
            success: true,
            wallet: result.wallet,
            needsScanning: true,
            fileType: "json",
            derivationMode: "bip32",
          };
        }

        setIsImporting(false);
        return {
          success: true,
          wallet: result.wallet,
          fileType: "json",
          derivationMode: "wif_hmac",
        };
      }

      // Handle encrypted TXT
      const result = await importWalletFromFile(pendingFile, password);
      if (!result.success || !result.wallet) {
        throw new Error(result.error || "Import failed");
      }

      setShowPasswordModal(false);
      setPendingFile(null);

      // Check if BIP32 needs scanning
      if (result.wallet.masterChainCode || result.wallet.isImportedAlphaWallet) {
        setPendingWallet(result.wallet);
        setShowScanModal(true);
        setIsImporting(false);

        return {
          success: true,
          wallet: result.wallet,
          needsScanning: true,
          fileType: "txt",
          derivationMode: "bip32",
        };
      }

      setIsImporting(false);
      return {
        success: true,
        wallet: result.wallet,
        fileType: "txt",
        derivationMode: "wif_hmac",
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to decrypt wallet";
      setError(message);
      setIsImporting(false);
      return {
        success: false,
        error: message,
        fileType: "unknown",
      };
    }
  }, [pendingFile]);

  /**
   * Select a single scanned address
   */
  const selectScannedAddress = useCallback(async (
    addr: ScannedAddress,
    keyManager: UnifiedKeyManager
  ): Promise<L1Wallet> => {
    if (!pendingWallet) {
      throw new Error("No pending wallet");
    }

    const walletWithAddress: L1Wallet = {
      ...pendingWallet,
      addresses: [{
        index: addr.index,
        address: addr.address,
        privateKey: addr.privateKey,
        publicKey: addr.publicKey,
        path: addr.path,
        createdAt: new Date().toISOString(),
      }],
    };

    // Save to L1 storage
    saveWalletToStorage("main", walletWithAddress);

    // Note: Nametag saving should be done by the calling component
    // using IdentityManager.deriveIdentityFromPath() for L3 identity

    // Import to key manager
    const basePath = pendingWallet.descriptorPath
      ? `m/${pendingWallet.descriptorPath}`
      : undefined;

    if (pendingWallet.masterPrivateKey && pendingWallet.masterChainCode) {
      await keyManager.importWithMode(
        pendingWallet.masterPrivateKey,
        pendingWallet.masterChainCode,
        "bip32",
        basePath
      );
    } else if (pendingWallet.masterPrivateKey) {
      await keyManager.importWithMode(
        pendingWallet.masterPrivateKey,
        null,
        "wif_hmac"
      );
    }

    setShowScanModal(false);
    setPendingWallet(null);

    return walletWithAddress;
  }, [pendingWallet]);

  /**
   * Select all scanned addresses
   */
  const selectAllScannedAddresses = useCallback(async (
    addresses: ScannedAddress[],
    keyManager: UnifiedKeyManager
  ): Promise<L1Wallet> => {
    if (!pendingWallet || addresses.length === 0) {
      throw new Error("No pending wallet or addresses");
    }

    const walletWithAddresses: L1Wallet = {
      ...pendingWallet,
      addresses: addresses.map((addr) => ({
        index: addr.index,
        address: addr.address,
        privateKey: addr.privateKey,
        publicKey: addr.publicKey,
        path: addr.path,
        createdAt: new Date().toISOString(),
        isChange: addr.isChange,
      })),
    };

    // Save to L1 storage
    saveWalletToStorage("main", walletWithAddresses);

    // Note: Nametag saving should be done by the calling component
    // using IdentityManager.deriveIdentityFromPath() for L3 identity

    // Import to key manager
    const basePath = pendingWallet.descriptorPath
      ? `m/${pendingWallet.descriptorPath}`
      : undefined;

    if (pendingWallet.masterPrivateKey && pendingWallet.masterChainCode) {
      await keyManager.importWithMode(
        pendingWallet.masterPrivateKey,
        pendingWallet.masterChainCode,
        "bip32",
        basePath
      );
    } else if (pendingWallet.masterPrivateKey) {
      await keyManager.importWithMode(
        pendingWallet.masterPrivateKey,
        null,
        "wif_hmac"
      );
    }

    setShowScanModal(false);
    setPendingWallet(null);

    return walletWithAddresses;
  }, [pendingWallet]);

  return {
    // State
    isImporting,
    error,
    showScanModal,
    showPasswordModal,
    pendingWallet,
    pendingFile,
    initialScanCount,
    // Actions
    importFile,
    importWithPassword,
    selectScannedAddress,
    selectAllScannedAddresses,
    cancelScan,
    cancelPassword,
    clearError,
    reset,
  };
}
