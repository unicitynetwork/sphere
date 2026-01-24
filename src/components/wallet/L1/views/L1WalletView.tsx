import { useEffect, useState, useCallback } from "react";
import {
  createTransactionPlan,
  createAndSignTransaction,
  broadcast,
  vestingState,
  type TransactionPlan,
} from "../sdk";
import { useL1Wallet, useConnectionStatus } from "../hooks";
import { HistoryView, MainWalletView } from ".";
import { MessageModal, type MessageType } from "../components/modals/MessageModal";
import { ConnectionStatus } from "../components/ConnectionStatus";
import { UnifiedKeyManager } from "../../shared/services/UnifiedKeyManager";
import { STORAGE_KEYS } from "../../../../config/storageKeys";

type ViewMode = "main" | "history";

export function L1WalletView({ showBalances }: { showBalances: boolean }) {
  const [selectedAddress, setSelectedAddress] = useState<string>("");
  const [viewMode, setViewMode] = useState<ViewMode>("main");
  const [txPlan, setTxPlan] = useState<TransactionPlan | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [messageModal, setMessageModal] = useState<{
    show: boolean;
    type: MessageType;
    title: string;
    message: string;
    txids?: string[];
  }>({ show: false, type: "info", title: "", message: "" });

  // Connection status hook
  const connection = useConnectionStatus();

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
    deleteWallet,
    analyzeTransaction,
    invalidateBalance,
    invalidateTransactions,
    invalidateVesting,
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

  // Delete wallet
  const onDeleteWallet = async () => {
    try {
      await deleteWallet();
      setSelectedAddress("");
    } catch {
      showMessage("error", "Error", "Failed to delete wallet");
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

      // Invalidate queries to refresh data after sending
      if (results.length > 0) {
        vestingState.clearAddressCache(selectedAddress);
        invalidateBalance();
        invalidateTransactions();
        invalidateVesting();
      }

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

  // Show connection status while connecting or on error
  if (!connection.isConnected) {
    return (
      <ConnectionStatus
        state={connection.state}
        message={connection.message}
        error={connection.error}
        onRetry={connection.manualConnect}
        onCancel={connection.cancelConnect}
      />
    );
  }

  // No wallet - return null, WalletGate handles the onboarding flow
  if (!wallet || isLoadingWallet) {
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
        balance={balance}
        totalBalance={totalBalance}
        showBalances={showBalances}
        onShowHistory={onShowHistory}
        onSaveWallet={onSaveWallet}
        hasMnemonic={hasMnemonic}
        onDeleteWallet={onDeleteWallet}
        onSendTransaction={onSendTransaction}
        txPlan={txPlan}
        isSending={isSending}
        onConfirmSend={onConfirmSend}
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
