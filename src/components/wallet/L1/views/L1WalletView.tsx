import { useEffect, useState, useCallback } from "react";
import { Loader2 } from "lucide-react";
import {
  connect,
  isWebSocketConnected,
  generateAddress,
  loadWalletFromStorage,
  createTransactionPlan,
  createAndSignTransaction,
  broadcast,
  saveWalletToStorage,
  importWallet as importWalletFromFile,
  importWalletFromJSON,
  isJSONWalletFormat,
  type VestingMode,
  type TransactionPlan,
  type Wallet,
  type ScannedAddress,
} from "../sdk";
import { useL1Wallet } from "../hooks";
import { NoWalletView, HistoryView, MainWalletView } from ".";
import { MessageModal, type MessageType } from "../components/modals/MessageModal";
import { WalletRepository } from "../../../../repositories/WalletRepository";
import { WalletScanModal, ImportWalletModal, LoadPasswordModal } from "../components/modals";
import { UnifiedKeyManager } from "../../shared/services/UnifiedKeyManager";

type ViewMode = "main" | "history";

export function L1WalletView({ showBalances }: { showBalances: boolean }) {
  const [selectedAddress, setSelectedAddress] = useState<string>("");
  const [viewMode, setViewMode] = useState<ViewMode>("main");
  const [showLoadPasswordModal, setShowLoadPasswordModal] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [isConnecting, setIsConnecting] = useState(() => !isWebSocketConnected());
  const [txPlan, setTxPlan] = useState<TransactionPlan | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [messageModal, setMessageModal] = useState<{
    show: boolean;
    type: MessageType;
    title: string;
    message: string;
    txids?: string[];
  }>({ show: false, type: "info", title: "", message: "" });
  const [showScanModal, setShowScanModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [pendingWallet, setPendingWallet] = useState<Wallet | null>(null);
  const [initialScanCount, setInitialScanCount] = useState(10);

  // Use TanStack Query based hook
  const {
    wallet,
    isLoadingWallet,
    balance,
    totalBalance,
    transactions,
    transactionDetails,
    isLoadingTransactions,
    currentBlockHeight,
    vestingBalances,
    isLoadingVesting,
    createWallet,
    importWallet,
    deleteWallet,
    analyzeTransaction,
    setVestingMode,
    invalidateWallet,
  } = useL1Wallet(selectedAddress);

  // Derive addresses from wallet
  const addresses = wallet?.addresses.map((a) => a.address) ?? [];

  // Message helpers
  const showMessage = useCallback((type: MessageType, title: string, message: string, txids?: string[]) => {
    setMessageModal({ show: true, type, title, message, txids });
  }, []);

  const closeMessage = useCallback(() => {
    setMessageModal((prev) => ({ ...prev, show: false }));
  }, []);

  // Connect on mount (skip if already connected)
  useEffect(() => {
    if (isWebSocketConnected()) {
      setIsConnecting(false);
      return;
    }
    (async () => {
      try {
        setIsConnecting(true);
        await connect();
      } finally {
        setIsConnecting(false);
      }
    })();
  }, []);

  // Set initial selected address when wallet loads - sync with L3's stored path
  useEffect(() => {
    if (wallet && wallet.addresses.length > 0) {
      // Read stored path (same one L3 uses) - path is the ONLY reliable identifier
      const storedPath = localStorage.getItem("l3_selected_address_path");

      // Find address by path, fallback to first address if not found
      const addressFromPath = storedPath
        ? wallet.addresses.find(a => a.path === storedPath)?.address
        : wallet.addresses[0]?.address;

      const selectedAddr = addressFromPath || wallet.addresses[0]?.address;

      // Only update if different from current selection
      if (selectedAddr && selectedAddress !== selectedAddr) {
        setSelectedAddress(selectedAddr);
      }
    }
  }, [selectedAddress, wallet]);

  // Vesting progress for UI - show loading only on initial load, not on refetch
  const vestingProgress = isLoadingVesting
    ? { current: 0, total: 1 }
    : null;

  // Handle vesting mode change
  const handleVestingModeChange = useCallback((mode: VestingMode) => {
    setVestingMode(mode);
  }, [setVestingMode]);

  // Create new wallet
  const onCreateWallet = async () => {
    try {
      const newWallet = await createWallet();
      if (newWallet.addresses.length > 0) {
        setSelectedAddress(newWallet.addresses[0].address);
      }
    } catch (err) {
      showMessage("error", "Error", "Failed to create wallet: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  // Show import modal
  const onShowImportModal = () => {
    setShowImportModal(true);
  };

  // Handle import from modal
  const onImportFromModal = async (file: File, scanCount?: number) => {
    setShowImportModal(false);

    try {
      // For .dat files, use direct SDK import (not hook) to avoid auto-save
      // Then show scan modal to find addresses with balances
      if (file.name.endsWith(".dat")) {
        const result = await importWalletFromFile(file);
        if (!result.success || !result.wallet) {
          throw new Error(result.error || "Import failed");
        }
        // Show scan modal - don't save wallet yet
        setPendingWallet(result.wallet);
        setInitialScanCount(scanCount || 100);
        setShowScanModal(true);
        return;
      }

      const content = await file.text();

      // Handle JSON wallet files
      if (file.name.endsWith(".json") || isJSONWalletFormat(content)) {
        // Check if encrypted
        try {
          const json = JSON.parse(content);
          if (json.encrypted) {
            // Encrypted JSON - show password modal
            setPendingFile(file);
            setInitialScanCount(scanCount || 10);
            setShowLoadPasswordModal(true);
            return;
          }
        } catch {
          // Not valid JSON, continue with error
          throw new Error("Invalid JSON wallet file");
        }

        // Unencrypted JSON - import directly
        const result = await importWalletFromJSON(content);
        if (!result.success || !result.wallet) {
          throw new Error(result.error || "Import failed");
        }

        // If has mnemonic, restore via UnifiedKeyManager
        if (result.mnemonic) {
          const keyManager = UnifiedKeyManager.getInstance("user-pin-1234");
          await keyManager.createFromMnemonic(result.mnemonic);

          // Reset selected address path for clean import - use first address's path
          const firstAddr = result.wallet.addresses[0];
          if (firstAddr?.path) {
            localStorage.setItem("l3_selected_address_path", firstAddr.path);
          } else {
            localStorage.removeItem("l3_selected_address_path");
          }

          // Save wallet and use directly (no scanning needed for mnemonic wallets)
          await saveWalletToStorage("main", result.wallet);
          await invalidateWallet();
          if (result.wallet.addresses.length > 0) {
            setSelectedAddress(result.wallet.addresses[0].address);
          }
          showMessage("success", "Wallet Loaded", "Wallet loaded successfully with recovery phrase!");
          return;
        }

        // No mnemonic - check if BIP32 needs scanning
        const isBIP32 = result.derivationMode === "bip32" || result.wallet.chainCode;
        if (isBIP32) {
          setPendingWallet(result.wallet);
          setInitialScanCount(scanCount || 10);
          setShowScanModal(true);
        } else {
          // Standard wallet - save and use directly
          await saveWalletToStorage("main", result.wallet);
          await invalidateWallet();
          if (result.wallet.addresses.length > 0) {
            setSelectedAddress(result.wallet.addresses[0].address);
          }
          showMessage("success", "Wallet Loaded", "Wallet loaded successfully!");
        }
        return;
      }

      // Handle TXT files
      if (content.includes("ENCRYPTED MASTER KEY")) {
        setPendingFile(file);
        setInitialScanCount(scanCount || 10);
        setShowLoadPasswordModal(true);
      } else {
        // Check if this is a BIP32 wallet that needs scanning
        const isBIP32 = content.includes("MASTER CHAIN CODE") ||
                        content.includes("WALLET TYPE: BIP32") ||
                        content.includes("WALLET TYPE: Alpha descriptor");

        if (isBIP32) {
          // For BIP32 .txt files, import and show scan modal like .dat files
          const result = await importWalletFromFile(file);
          if (!result.success || !result.wallet) {
            throw new Error(result.error || "Import failed");
          }
          // Show scan modal - don't save wallet yet
          setPendingWallet(result.wallet);
          setInitialScanCount(scanCount || 10);
          setShowScanModal(true);
        } else {
          // Standard wallet - import directly
          const newWallet = await importWallet({ file });
          if (newWallet.addresses.length > 0) {
            setSelectedAddress(newWallet.addresses[0].address);
          }
          showMessage("success", "Wallet Loaded", "Wallet loaded successfully!");
        }
      }
    } catch (err: unknown) {
      showMessage(
        "error",
        "Load Error",
        "Error loading wallet: " + (err instanceof Error ? err.message : String(err))
      );
      console.error(err);
    }
  };

  // Handle scanned address selection
  const onSelectScannedAddress = (scannedAddr: ScannedAddress) => {
    if (!pendingWallet) return;

    // Add the scanned address to wallet
    const walletWithAddress: Wallet = {
      ...pendingWallet,
      addresses: [{
        index: scannedAddr.index,
        address: scannedAddr.address,
        privateKey: scannedAddr.privateKey,
        publicKey: scannedAddr.publicKey,
        path: scannedAddr.path,
        createdAt: new Date().toISOString(),
      }],
    };

    // Save to storage
    saveWalletToStorage("main", walletWithAddress);
    invalidateWallet();
    setSelectedAddress(scannedAddr.address);
    setShowScanModal(false);
    setPendingWallet(null);
    showMessage("success", "Wallet Loaded", `Loaded address with ${scannedAddr.balance.toFixed(8)} ALPHA`);
  };

  // Handle loading all scanned addresses
  const onSelectAllScannedAddresses = (scannedAddresses: ScannedAddress[]) => {
    if (!pendingWallet || scannedAddresses.length === 0) return;

    // Add all scanned addresses to wallet (preserving isChange flag)
    const walletWithAddresses: Wallet = {
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

    // Calculate total balance
    const totalBalance = scannedAddresses.reduce((sum, addr) => sum + addr.balance, 0);

    // Save to storage
    saveWalletToStorage("main", walletWithAddresses);
    invalidateWallet();
    setSelectedAddress(scannedAddresses[0].address);
    setShowScanModal(false);
    setPendingWallet(null);
    showMessage("success", "Wallet Loaded", `Loaded ${scannedAddresses.length} addresses with ${totalBalance.toFixed(8)} ALPHA total`);
  };

  // Cancel scan modal
  const onCancelScan = () => {
    setShowScanModal(false);
    setPendingWallet(null);
  };

  // Confirm load with password
  const onConfirmLoadWithPassword = async (password: string) => {
    if (!pendingFile) return;

    try {
      const content = await pendingFile.text();

      // Check if this is an encrypted JSON file
      if (pendingFile.name.endsWith(".json") || isJSONWalletFormat(content)) {
        const result = await importWalletFromJSON(content, password);
        if (!result.success || !result.wallet) {
          throw new Error(result.error || "Import failed");
        }

        setShowLoadPasswordModal(false);
        setPendingFile(null);

        // If has mnemonic, restore via UnifiedKeyManager
        if (result.mnemonic) {
          const keyManager = UnifiedKeyManager.getInstance("user-pin-1234");
          await keyManager.createFromMnemonic(result.mnemonic);

          // Reset selected address path for clean import - use first address's path
          const firstAddr = result.wallet.addresses[0];
          if (firstAddr?.path) {
            localStorage.setItem("l3_selected_address_path", firstAddr.path);
          } else {
            localStorage.removeItem("l3_selected_address_path");
          }

          // Save wallet and use directly (no scanning needed for mnemonic wallets)
          await saveWalletToStorage("main", result.wallet);
          await invalidateWallet();
          if (result.wallet.addresses.length > 0) {
            setSelectedAddress(result.wallet.addresses[0].address);
          }
          showMessage("success", "Wallet Loaded", "Wallet loaded successfully with recovery phrase!");
          return;
        }

        // No mnemonic - check if BIP32 needs scanning
        const isBIP32 = result.derivationMode === "bip32" || result.wallet.chainCode;
        if (isBIP32) {
          setPendingWallet(result.wallet);
          // initialScanCount already set when showing password modal
          setShowScanModal(true);
        } else {
          // Standard wallet - save and use directly
          await saveWalletToStorage("main", result.wallet);
          await invalidateWallet();
          if (result.wallet.addresses.length > 0) {
            setSelectedAddress(result.wallet.addresses[0].address);
          }
          showMessage("success", "Wallet Loaded", "Wallet loaded successfully!");
        }
        return;
      }

      // Handle TXT files with password
      const result = await importWalletFromFile(pendingFile, password);
      if (!result.success || !result.wallet) {
        throw new Error(result.error || "Import failed");
      }

      setShowLoadPasswordModal(false);
      setPendingFile(null);

      // Check if BIP32 wallet - show scan modal
      if (result.wallet.masterChainCode || result.wallet.isImportedAlphaWallet) {
        setPendingWallet(result.wallet);
        // initialScanCount already set when showing password modal
        setShowScanModal(true);
      } else {
        // Standard wallet - save directly
        const newWallet = await importWallet({ file: pendingFile, password });
        if (newWallet.addresses.length > 0) {
          setSelectedAddress(newWallet.addresses[0].address);
        }
        showMessage("success", "Wallet Loaded", "Wallet loaded successfully!");
      }
    } catch (err) {
      showMessage("error", "Load Error", "Error loading wallet: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  // Delete wallet
  const onDeleteWallet = async () => {
    try {
      await deleteWallet();
      setSelectedAddress("");
    } catch {
      showMessage("error", "Error", "Failed to delete wallet");
    }
  };

  // Generate new address
  const onNewAddress = async () => {
    if (!wallet) return;

    try {
      const addr = generateAddress(wallet);
      // Reload wallet from storage to get updated addresses
      const updated = loadWalletFromStorage("main");
      if (updated) {
        // Force refresh wallet query
        invalidateWallet();
        setSelectedAddress(addr.address);
      }
    } catch {
      showMessage("error", "Error", "Failed to generate address");
    }
  };

  // Check if mnemonic is available for export
  const hasMnemonic = (() => {
    try {
      const keyManager = UnifiedKeyManager.getInstance("user-pin-1234");
      return keyManager.getMnemonic() !== null;
    } catch {
      return false;
    }
  })();

  // Save wallet as JSON (only JSON format supported)
  const onSaveWallet = (filename: string, password?: string) => {
    if (!wallet) {
      showMessage("warning", "No Wallet", "No wallet to save");
      return;
    }

    try {
      // Use UnifiedKeyManager for JSON export (includes mnemonic if available)
      const keyManager = UnifiedKeyManager.getInstance("user-pin-1234");
      keyManager.downloadJSON(filename, { password });
      showMessage("success", "Wallet Saved", "Wallet saved as JSON successfully!");
    } catch (err) {
      showMessage("error", "Save Error", `Error saving wallet: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // Create transaction plan
  const onSendTransaction = async (destination: string, amount: string) => {
    if (!wallet) return;

    try {
      const amountAlpha = Number(amount);
      if (isNaN(amountAlpha) || amountAlpha <= 0) {
        showMessage("error", "Invalid Amount", "Please enter a valid amount");
        return;
      }

      const plan = await createTransactionPlan(wallet, destination, amountAlpha, selectedAddress);

      if (!plan.success) {
        showMessage("error", "Transaction Failed", "Transaction failed: " + plan.error);
        return;
      }

      setTxPlan(plan);
    } catch (err) {
      showMessage("error", "Transaction Failed", "Transaction failed: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  // Confirm and send transaction
  const onConfirmSend = async () => {
    if (!wallet || !txPlan) return;

    setIsSending(true);
    try {
      const results = [];
      const errors = [];

      for (const tx of txPlan.transactions) {
        try {
          const signed = createAndSignTransaction(wallet, tx);
          const result = await broadcast(signed.raw);
          results.push({ txid: signed.txid, raw: signed.raw, result });
        } catch (e: unknown) {
          console.error("Broadcast failed for tx", e);
          errors.push(e instanceof Error ? e.message : String(e));
        }
      }

      setTxPlan(null);

      if (errors.length > 0) {
        if (results.length > 0) {
          const txids = results.map((r) => r.txid);
          showMessage(
            "warning",
            "Partial Success",
            `Some transactions failed:\n${errors.join("\n")}`,
            txids
          );
        } else {
          showMessage("error", "Transaction Failed", `Transaction failed:\n${errors.join("\n")}`);
        }
      } else {
        const txids = results.map((r) => r.txid);
        showMessage(
          "success",
          "Transaction Sent",
          `Sent ${results.length} transaction(s)!`,
          txids
        );
      }
    } finally {
      setIsSending(false);
    }
  };

  // Show history
  const onShowHistory = () => {
    setViewMode("history");
  };

  // Back to main
  const onBackToMain = () => {
    setViewMode("main");
  };

  // Select address - sync with L3's selected address path
  const onSelectAddress = (address: string) => {
    // Find the selected address to get its path - path is the ONLY reliable identifier
    const selectedAddr = wallet?.addresses.find(a => a.address === address);

    // Sync to L3's selected address path
    if (selectedAddr?.path) {
      localStorage.setItem("l3_selected_address_path", selectedAddr.path);
    } else {
      // Fallback: remove path to trigger default behavior
      localStorage.removeItem("l3_selected_address_path");
    }

    // Reset L3 state so it picks up new identity
    WalletRepository.getInstance().resetInMemoryState();

    // Force page reload to restart NostrService with new identity
    window.location.reload();
  };

  // Show loading state while connecting
  if (isConnecting || isLoadingWallet) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="animate-spin text-neutral-400 dark:text-neutral-600" />
      </div>
    );
  }

  // No wallet view
  if (!wallet) {
    return (
      <div className="h-full overflow-y-auto">
        <NoWalletView
          onCreateWallet={onCreateWallet}
          onImportWallet={onShowImportModal}
          showLoadPasswordModal={showLoadPasswordModal}
          onConfirmLoadWithPassword={onConfirmLoadWithPassword}
          onCancelLoadPassword={() => {
            setShowLoadPasswordModal(false);
            setPendingFile(null);
          }}
        />
        <MessageModal
          show={messageModal.show}
          type={messageModal.type}
          title={messageModal.title}
          message={messageModal.message}
          txids={messageModal.txids}
          onClose={closeMessage}
        />
        <ImportWalletModal
          show={showImportModal}
          onImport={onImportFromModal}
          onCancel={() => setShowImportModal(false)}
        />
        <WalletScanModal
          show={showScanModal}
          wallet={pendingWallet}
          initialScanCount={initialScanCount}
          onSelectAddress={onSelectScannedAddress}
          onSelectAll={onSelectAllScannedAddresses}
          onCancel={onCancelScan}
        />
      </div>
    );
  }

  // History view
  if (viewMode === "history") {
    return (
      <div className="h-full overflow-y-auto">
        <HistoryView
          wallet={wallet}
          selectedAddress={selectedAddress}
          transactions={transactions}
          loadingTransactions={isLoadingTransactions}
          currentBlockHeight={currentBlockHeight}
          transactionDetails={transactionDetails}
          analyzeTransaction={analyzeTransaction}
          onBackToMain={onBackToMain}
        />
        <MessageModal
          show={messageModal.show}
          type={messageModal.type}
          title={messageModal.title}
          message={messageModal.message}
          txids={messageModal.txids}
          onClose={closeMessage}
        />
      </div>
    );
  }

  // Get private key for selected address
  const selectedPrivateKey = wallet?.addresses.find(
    (a) => a.address === selectedAddress
  )?.privateKey ?? "";

  // Main view
  return (
    <div className="h-full">
      <MainWalletView
        selectedAddress={selectedAddress}
        selectedPrivateKey={selectedPrivateKey}
        addresses={addresses}
        walletAddresses={wallet?.addresses}
        balance={balance}
        totalBalance={totalBalance}
        showBalances={showBalances}
        onNewAddress={onNewAddress}
        onSelectAddress={onSelectAddress}
        onShowHistory={onShowHistory}
        onSaveWallet={onSaveWallet}
        hasMnemonic={hasMnemonic}
        onDeleteWallet={onDeleteWallet}
        onSendTransaction={onSendTransaction}
        txPlan={txPlan}
        isSending={isSending}
        onConfirmSend={onConfirmSend}
        vestingProgress={vestingProgress}
        onVestingModeChange={handleVestingModeChange}
        vestingBalances={vestingBalances}
      />
      <MessageModal
        show={messageModal.show}
        type={messageModal.type}
        title={messageModal.title}
        message={messageModal.message}
        txids={messageModal.txids}
        onClose={closeMessage}
      />
      <ImportWalletModal
        show={showImportModal}
        onImport={onImportFromModal}
        onCancel={() => setShowImportModal(false)}
      />
      <LoadPasswordModal
        show={showLoadPasswordModal}
        onConfirm={onConfirmLoadWithPassword}
        onCancel={() => {
          setShowLoadPasswordModal(false);
          setPendingFile(null);
        }}
      />
      <WalletScanModal
        show={showScanModal}
        wallet={pendingWallet}
        initialScanCount={initialScanCount}
        onSelectAddress={onSelectScannedAddress}
        onSelectAll={onSelectAllScannedAddresses}
        onCancel={onCancelScan}
      />
    </div>
  );
}
