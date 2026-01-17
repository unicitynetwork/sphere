/**
 * useWalletImport - Handles wallet file import logic
 *
 * NOTE: Nametag handling during import has been removed to prevent data corruption.
 * The scan process only discovers nametag NAMES, not the full token data.
 * Saving nametags with empty token objects (token: {}) causes corruption.
 * Instead, nametags are now populated correctly via IPFS sync after import.
 */
import { useState, useCallback } from "react";
import { UnifiedKeyManager } from "../../shared/services/UnifiedKeyManager";
import {
  importWallet as importWalletFromFile,
  importWalletFromJSON,
  isJSONWalletFormat,
  saveWalletToStorage,
  type Wallet as L1Wallet,
  type ScannedAddress,
} from "../../L1/sdk";
import {
  needsBlockchainScanning,
  isEncryptedWallet,
  isBIP32Wallet,
  extractMnemonic,
  isValidMnemonicFormat,
} from "../../shared/utils/walletFileParser";
import { STORAGE_KEYS } from "../../../../config/storageKeys";
import { WalletRepository } from "../../../../repositories/WalletRepository";

export interface UseWalletImportReturn {
  // Modal state
  showScanModal: boolean;
  showLoadPasswordModal: boolean;
  pendingWallet: L1Wallet | null;
  pendingFile: File | null;
  initialScanCount: number;

  // File state
  selectedFile: File | null;
  scanCount: number;
  needsScanning: boolean;
  isDragging: boolean;

  // Setters
  setSelectedFile: (file: File | null) => void;
  setScanCount: (count: number) => void;
  setShowScanModal: (show: boolean) => void;
  setShowLoadPasswordModal: (show: boolean) => void;

  // Actions
  handleFileSelect: (file: File) => Promise<void>;
  handleDragOver: (e: React.DragEvent) => void;
  handleDragLeave: (e: React.DragEvent) => void;
  handleDrop: (e: React.DragEvent) => Promise<void>;
  handleConfirmImport: () => void;
  handleImportFromFile: (file: File, scanCountParam?: number) => Promise<void>;
  onSelectScannedAddress: (scannedAddr: ScannedAddress) => Promise<void>;
  onSelectAllScannedAddresses: (scannedAddresses: ScannedAddress[]) => Promise<void>;
  onCancelScan: () => void;
  onConfirmLoadWithPassword: (password: string) => Promise<void>;
}

interface UseWalletImportOptions {
  getUnifiedKeyManager: () => UnifiedKeyManager;
  goToAddressSelection: (skipIpnsCheck?: boolean) => Promise<void>;
  setError: (error: string | null) => void;
  setIsBusy: (busy: boolean) => void;
}

export function useWalletImport({
  getUnifiedKeyManager,
  goToAddressSelection,
  setError,
  setIsBusy,
}: UseWalletImportOptions): UseWalletImportReturn {
  // File import state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [scanCount, setScanCount] = useState(10);
  const [needsScanning, setNeedsScanning] = useState(true);
  const [isDragging, setIsDragging] = useState(false);

  // Modal state
  const [showScanModal, setShowScanModal] = useState(false);
  const [showLoadPasswordModal, setShowLoadPasswordModal] = useState(false);
  const [pendingWallet, setPendingWallet] = useState<L1Wallet | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [initialScanCount, setInitialScanCount] = useState(10);

  // Check if file needs blockchain scanning
  const checkIfNeedsScanning = useCallback(async (file: File) => {
    try {
      if (file.name.endsWith(".dat")) {
        setNeedsScanning(true);
        setScanCount(10);
        return;
      }

      const content = await file.text();
      setNeedsScanning(needsBlockchainScanning(file.name, content));
      setScanCount(10);
    } catch (err) {
      console.error("Error checking file type:", err);
      setNeedsScanning(true);
    }
  }, []);

  // Handle file selection
  const handleFileSelect = useCallback(
    async (file: File) => {
      setSelectedFile(file);
      await checkIfNeedsScanning(file);
    },
    [checkIfNeedsScanning]
  );

  // Drag handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);

      const file = e.dataTransfer.files[0];
      if (
        file &&
        (file.name.endsWith(".txt") || file.name.endsWith(".dat") || file.name.endsWith(".json"))
      ) {
        await handleFileSelect(file);
      }
    },
    [handleFileSelect]
  );

  // Confirm import with current file and scan count
  const handleConfirmImport = useCallback(() => {
    if (!selectedFile) return;
    handleImportFromFile(selectedFile, scanCount);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFile, scanCount]);

  // Main import handler
  const handleImportFromFile = useCallback(
    async (file: File, scanCountParam?: number) => {
      setIsBusy(true);
      setError(null);

      // Mark that we're in an active import flow to allow wallet creation
      WalletRepository.setImportInProgress();

      try {
        // Clear any existing wallet data
        const existingKeyManager = getUnifiedKeyManager();
        if (existingKeyManager?.isInitialized()) {
          console.log("🔐 Clearing existing wallet before importing from file");
          existingKeyManager.clear();
          UnifiedKeyManager.resetInstance();
        }

        localStorage.removeItem(STORAGE_KEYS.WALLET_MAIN);

        // For .dat files, use direct SDK import and show scan modal
        if (file.name.endsWith(".dat")) {
          const result = await importWalletFromFile(file);

          // Check if the .dat file is encrypted and needs a password
          if (!result.success && result.isEncryptedDat) {
            console.log("📦 .dat file is encrypted, showing password modal");
            setPendingFile(file);
            setInitialScanCount(scanCountParam || 100);
            setShowLoadPasswordModal(true);
            setIsBusy(false);
            return;
          }

          if (!result.success || !result.wallet) {
            throw new Error(result.error || "Import failed");
          }
          console.log("📦 .dat file imported, showing scan modal");
          setPendingWallet(result.wallet);
          setInitialScanCount(scanCountParam || 100);
          setShowScanModal(true);
          setIsBusy(false);
          return;
        }

        const content = await file.text();

        // Handle JSON wallet files
        if (file.name.endsWith(".json") || isJSONWalletFormat(content)) {
          try {
            const json = JSON.parse(content);

            if (json.encrypted) {
              setPendingFile(file);
              setInitialScanCount(scanCountParam || 10);
              setShowLoadPasswordModal(true);
              setIsBusy(false);
              return;
            }

            const result = await importWalletFromJSON(content);
            if (!result.success || !result.wallet) {
              throw new Error(result.error || "Import failed");
            }

            if (result.mnemonic) {
              const keyManager = getUnifiedKeyManager();
              await keyManager.createFromMnemonic(result.mnemonic);
              localStorage.removeItem(STORAGE_KEYS.L3_SELECTED_ADDRESS_PATH);
              localStorage.removeItem(STORAGE_KEYS.L3_SELECTED_ADDRESS_INDEX_LEGACY);
              await goToAddressSelection();
              return;
            }

            const isJsonBIP32 = result.derivationMode === "bip32" || result.wallet.chainCode;
            if (isJsonBIP32) {
              const keyManager = getUnifiedKeyManager();
              const chainCode = result.wallet.chainCode || result.wallet.masterChainCode || null;
              const basePath = result.wallet.descriptorPath
                ? `m/${result.wallet.descriptorPath}`
                : undefined;
              await keyManager.importWithMode(
                result.wallet.masterPrivateKey,
                chainCode,
                result.derivationMode || "bip32",
                basePath
              );

              setPendingWallet(result.wallet);
              setInitialScanCount(scanCountParam || 10);
              setShowScanModal(true);
              setIsBusy(false);
              return;
            }

            // Standard JSON wallet
            const keyManager = getUnifiedKeyManager();
            await keyManager.importWithMode(result.wallet.masterPrivateKey, null, "wif_hmac");
            saveWalletToStorage("main", result.wallet);
            await goToAddressSelection();
            return;
          } catch (e) {
            if (file.name.endsWith(".json")) {
              throw new Error(`Invalid JSON wallet file: ${e instanceof Error ? e.message : String(e)}`);
            }
          }
        }

        // Check if encrypted TXT file
        if (isEncryptedWallet(content)) {
          setPendingFile(file);
          setInitialScanCount(scanCountParam || 10);
          setShowLoadPasswordModal(true);
          setIsBusy(false);
          return;
        }

        // Check if BIP32 wallet
        if (isBIP32Wallet(content) && content.includes("MASTER PRIVATE KEY")) {
          const result = await importWalletFromFile(file);
          if (!result.success || !result.wallet) {
            throw new Error(result.error || "Import failed");
          }
          setPendingWallet(result.wallet);
          setInitialScanCount(scanCountParam || 10);
          setShowScanModal(true);
          setIsBusy(false);
          return;
        }

        // Try mnemonic formats
        let imported = false;

        try {
          const json = JSON.parse(content);
          const mnemonic = extractMnemonic(json as Record<string, unknown>);

          if (mnemonic) {
            const keyManager = getUnifiedKeyManager();
            await keyManager.createFromMnemonic(mnemonic);
            imported = true;
          }
        } catch {
          // Not JSON
        }

        if (!imported) {
          const trimmed = content.trim();
          if (isValidMnemonicFormat(trimmed)) {
            const keyManager = getUnifiedKeyManager();
            await keyManager.createFromMnemonic(trimmed);
            imported = true;
          }
        }

        if (!imported && content.includes("MASTER PRIVATE KEY")) {
          const result = await importWalletFromFile(file);
          if (!result.success || !result.wallet) {
            throw new Error(result.error || "Import failed");
          }

          const keyManager = getUnifiedKeyManager();
          await keyManager.importFromFileContent(content);

          if (result.wallet.addresses.length > 0) {
            saveWalletToStorage("main", result.wallet);
          }

          imported = true;
        }

        if (!imported) {
          throw new Error("Could not import wallet from file");
        }

        await goToAddressSelection();
      } catch (e) {
        // Clear import flag on error
        WalletRepository.clearImportInProgress();
        const message = e instanceof Error ? e.message : "Failed to import wallet from file";
        setError(message);
        setIsBusy(false);
      }
    },
    [getUnifiedKeyManager, goToAddressSelection, setError, setIsBusy]
  );

  // Handle scanned address selection
  const onSelectScannedAddress = useCallback(
    async (scannedAddr: ScannedAddress) => {
      if (!pendingWallet) return;

      // Mark that we're in an active import flow to allow wallet creation
      WalletRepository.setImportInProgress();

      try {
        setIsBusy(true);
        setError(null);

        const walletWithAddress: L1Wallet = {
          ...pendingWallet,
          addresses: [
            {
              index: scannedAddr.index,
              address: scannedAddr.address,
              privateKey: scannedAddr.privateKey,
              publicKey: scannedAddr.publicKey,
              path: scannedAddr.path,
              createdAt: new Date().toISOString(),
            },
          ],
        };

        saveWalletToStorage("main", walletWithAddress);

        // NOTE: Do NOT save nametag here with empty token data!
        // The scan only provides the nametag NAME, not the full token data.
        // Saving with `token: {}` corrupts the wallet data.
        // Instead, let IPFS sync populate the nametag correctly on first sync.
        // See: https://github.com/anthropics/claude-code/issues/XXX
        if (scannedAddr.l3Nametag) {
          console.log(`📝 Found nametag "${scannedAddr.l3Nametag}" for address - will be populated via IPFS sync`);
        }

        const keyManager = getUnifiedKeyManager();
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
          await keyManager.importWithMode(pendingWallet.masterPrivateKey, null, "wif_hmac");
        }

        setShowScanModal(false);
        setPendingWallet(null);
        await goToAddressSelection(true);
      } catch (e) {
        // Clear import flag on error
        WalletRepository.clearImportInProgress();
        const message = e instanceof Error ? e.message : "Failed to import wallet";
        setError(message);
        setIsBusy(false);
      }
    },
    [pendingWallet, getUnifiedKeyManager, goToAddressSelection, setError, setIsBusy]
  );

  // Handle loading all scanned addresses
  const onSelectAllScannedAddresses = useCallback(
    async (scannedAddresses: ScannedAddress[]) => {
      if (!pendingWallet || scannedAddresses.length === 0) return;

      // Mark that we're in an active import flow to allow wallet creation
      WalletRepository.setImportInProgress();

      try {
        setIsBusy(true);
        setError(null);

        const walletWithAddresses: L1Wallet = {
          ...pendingWallet,
          addresses: scannedAddresses.map((addr) => ({
            index: addr.index,
            address: addr.address,
            privateKey: addr.privateKey,
            publicKey: addr.publicKey,
            path: addr.path,
            createdAt: new Date().toISOString(),
            isChange: addr.isChange,
          })),
        };

        saveWalletToStorage("main", walletWithAddresses);

        // NOTE: Do NOT save nametags here with empty token data!
        // The scan only provides the nametag NAME, not the full token data.
        // Saving with `token: {}` corrupts the wallet data.
        // Instead, let IPFS sync populate nametags correctly on first sync.
        const addressesWithNametags = scannedAddresses.filter(addr => addr.l3Nametag);
        if (addressesWithNametags.length > 0) {
          console.log(`📝 Found ${addressesWithNametags.length} addresses with nametags - will be populated via IPFS sync`);
        }

        const keyManager = getUnifiedKeyManager();
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
          await keyManager.importWithMode(pendingWallet.masterPrivateKey, null, "wif_hmac");
        }

        setShowScanModal(false);
        setPendingWallet(null);
        await goToAddressSelection(true);
      } catch (e) {
        // Clear import flag on error
        WalletRepository.clearImportInProgress();
        const message = e instanceof Error ? e.message : "Failed to import wallet";
        setError(message);
        setIsBusy(false);
      }
    },
    [pendingWallet, getUnifiedKeyManager, goToAddressSelection, setError, setIsBusy]
  );

  // Cancel scan modal
  const onCancelScan = useCallback(() => {
    // Clear import flag when user cancels
    WalletRepository.clearImportInProgress();
    setShowScanModal(false);
    setPendingWallet(null);
  }, []);

  // Handle password confirmation for encrypted files
  const onConfirmLoadWithPassword = useCallback(
    async (password: string) => {
      if (!pendingFile) return;

      // Mark that we're in an active import flow to allow wallet creation
      WalletRepository.setImportInProgress();

      try {
        setIsBusy(true);
        setError(null);
        setShowLoadPasswordModal(false);

        const content = await pendingFile.text();

        if (pendingFile.name.endsWith(".json") || isJSONWalletFormat(content)) {
          const result = await importWalletFromJSON(content, password);
          if (!result.success || !result.wallet) {
            throw new Error(result.error || "Import failed");
          }

          setPendingFile(null);

          if (result.mnemonic) {
            const keyManager = getUnifiedKeyManager();
            await keyManager.createFromMnemonic(result.mnemonic);
            localStorage.removeItem(STORAGE_KEYS.L3_SELECTED_ADDRESS_PATH);
            localStorage.removeItem(STORAGE_KEYS.L3_SELECTED_ADDRESS_INDEX_LEGACY);
            await goToAddressSelection();
            return;
          }

          const isBIP32 = result.derivationMode === "bip32" || result.wallet.chainCode;
          if (isBIP32) {
            const keyManager = getUnifiedKeyManager();
            const chainCode = result.wallet.chainCode || result.wallet.masterChainCode || null;
            const basePath = result.wallet.descriptorPath
              ? `m/${result.wallet.descriptorPath}`
              : undefined;
            await keyManager.importWithMode(
              result.wallet.masterPrivateKey,
              chainCode,
              result.derivationMode || "bip32",
              basePath
            );

            setPendingWallet(result.wallet);
            setShowScanModal(true);
            setIsBusy(false);
            return;
          }

          const keyManager = getUnifiedKeyManager();
          await keyManager.importWithMode(result.wallet.masterPrivateKey, null, "wif_hmac");
          saveWalletToStorage("main", result.wallet);
          await goToAddressSelection();
          return;
        }

        // Handle TXT files with password
        const result = await importWalletFromFile(pendingFile, password);
        if (!result.success || !result.wallet) {
          throw new Error(result.error || "Import failed");
        }

        setPendingFile(null);

        if (result.wallet.masterChainCode || result.wallet.isImportedAlphaWallet) {
          setPendingWallet(result.wallet);
          setShowScanModal(true);
          setIsBusy(false);
        } else {
          const keyManager = getUnifiedKeyManager();
          const basePath = result.wallet.descriptorPath
            ? `m/${result.wallet.descriptorPath}`
            : undefined;
          if (result.wallet.masterPrivateKey && result.wallet.masterChainCode) {
            await keyManager.importWithMode(
              result.wallet.masterPrivateKey,
              result.wallet.masterChainCode,
              "bip32",
              basePath
            );
          } else if (result.wallet.masterPrivateKey) {
            await keyManager.importWithMode(result.wallet.masterPrivateKey, null, "wif_hmac");
          }

          if (result.wallet.addresses.length > 0) {
            saveWalletToStorage("main", result.wallet);
          }

          await goToAddressSelection();
        }
      } catch (e) {
        // Clear import flag on error
        WalletRepository.clearImportInProgress();
        const message = e instanceof Error ? e.message : "Failed to decrypt wallet";
        setError(message);
        setIsBusy(false);
      }
    },
    [pendingFile, getUnifiedKeyManager, goToAddressSelection, setError, setIsBusy]
  );

  return {
    // Modal state
    showScanModal,
    showLoadPasswordModal,
    pendingWallet,
    pendingFile,
    initialScanCount,

    // File state
    selectedFile,
    scanCount,
    needsScanning,
    isDragging,

    // Setters
    setSelectedFile,
    setScanCount,
    setShowScanModal,
    setShowLoadPasswordModal,

    // Actions
    handleFileSelect,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleConfirmImport,
    handleImportFromFile,
    onSelectScannedAddress,
    onSelectAllScannedAddresses,
    onCancelScan,
    onConfirmLoadWithPassword,
  };
}
