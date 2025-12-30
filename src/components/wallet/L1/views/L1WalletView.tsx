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
  type VestingMode,
  type TransactionPlan,
} from "../sdk";
import { useL1Wallet } from "../hooks";
import { HistoryView, MainWalletView } from ".";
import { MessageModal, type MessageType } from "../components/modals/MessageModal";
import { WalletRepository } from "../../../../repositories/WalletRepository";
import { UnifiedKeyManager } from "../../shared/services/UnifiedKeyManager";
import { STORAGE_KEYS } from "../../../../config/storageKeys";

type ViewMode = "main" | "history";

export function L1WalletView({ showBalances }: { showBalances: boolean }) {
  const [selectedAddress, setSelectedAddress] = useState<string>("");
  const [viewMode, setViewMode] = useState<ViewMode>("main");
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
      const storedPath = localStorage.getItem(STORAGE_KEYS.L3_SELECTED_ADDRESS_PATH);

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
      localStorage.setItem(STORAGE_KEYS.L3_SELECTED_ADDRESS_PATH, selectedAddr.path);
    } else {
      // Fallback: remove path to trigger default behavior
      localStorage.removeItem(STORAGE_KEYS.L3_SELECTED_ADDRESS_PATH);
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

  // No wallet - return null, WalletGate handles the onboarding flow
  if (!wallet) {
    return null;
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
    </div>
  );
}
