import { useEffect, useState, useCallback } from "react";
import {
  connect,
  generateAddress,
  loadWalletFromStorage,
  createTransactionPlan,
  createAndSignTransaction,
  broadcast,
  type VestingMode,
  type TransactionPlan,
} from "../sdk";
import { useL1Wallet } from "../hooks";
import { NoWalletView, HistoryView, MainWalletView } from ".";
import { MessageModal, type MessageType } from "../components/modals/MessageModal";

type ViewMode = "main" | "history";

export function L1WalletView({ showBalances }: { showBalances: boolean }) {
  const [selectedAddress, setSelectedAddress] = useState<string>("");
  const [viewMode, setViewMode] = useState<ViewMode>("main");
  const [showLoadPasswordModal, setShowLoadPasswordModal] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [isConnecting, setIsConnecting] = useState(true);
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
    transactions,
    transactionDetails,
    isLoadingTransactions,
    currentBlockHeight,
    vestingBalances,
    isClassifyingVesting,
    createWallet,
    importWallet,
    deleteWallet,
    exportWallet,
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

  // Connect on mount
  useEffect(() => {
    (async () => {
      try {
        setIsConnecting(true);
        await connect();
      } finally {
        setIsConnecting(false);
      }
    })();
  }, []);

  // Set initial selected address when wallet loads
  useEffect(() => {
    if (wallet && !selectedAddress && wallet.addresses.length > 0) {
      setSelectedAddress(wallet.addresses[0].address);
    }
  }, [wallet, selectedAddress]);

  // Vesting progress for UI
  const vestingProgress = isClassifyingVesting
    ? { current: 0, total: 1 } // Simplified progress indicator
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

  // Load wallet from file
  const onLoadWallet = async (file: File) => {
    try {
      const content = await file.text();

      if (content.includes("ENCRYPTED MASTER KEY")) {
        setPendingFile(file);
        setShowLoadPasswordModal(true);
      } else {
        const newWallet = await importWallet({ file });
        if (newWallet.addresses.length > 0) {
          setSelectedAddress(newWallet.addresses[0].address);
        }
        showMessage("success", "Wallet Loaded", "Wallet loaded successfully!");
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

  // Confirm load with password
  const onConfirmLoadWithPassword = async (password: string) => {
    if (!pendingFile) return;

    try {
      const newWallet = await importWallet({ file: pendingFile, password });
      if (newWallet.addresses.length > 0) {
        setSelectedAddress(newWallet.addresses[0].address);
      }
      setShowLoadPasswordModal(false);
      setPendingFile(null);
      showMessage("success", "Wallet Loaded", "Wallet loaded successfully!");
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

  // Save wallet
  const onSaveWallet = (filename: string, password?: string) => {
    if (!wallet) {
      showMessage("warning", "No Wallet", "No wallet to save");
      return;
    }

    const result = exportWallet(wallet, filename, password);
    if (result.success) {
      showMessage("success", "Wallet Saved", "Wallet saved successfully!");
    } else {
      showMessage("error", "Save Error", "Error saving wallet: " + result.error);
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

  // Select address
  const onSelectAddress = (address: string) => {
    setSelectedAddress(address);
  };

  // Show loading state while connecting
  if (isConnecting || isLoadingWallet) {
    return (
      <div className="flex items-center justify-center h-full flex-col gap-3">
        <div className="text-3xl animate-spin text-neutral-900 dark:text-white">⟳</div>
        <div className="text-neutral-500 dark:text-neutral-400">Connecting to network...</div>
      </div>
    );
  }

  // No wallet view
  if (!wallet) {
    return (
      <div className="h-full overflow-y-auto">
        <NoWalletView
          onCreateWallet={onCreateWallet}
          onLoadWallet={onLoadWallet}
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
        balance={balance}
        showBalances={showBalances}
        onNewAddress={onNewAddress}
        onSelectAddress={onSelectAddress}
        onShowHistory={onShowHistory}
        onSaveWallet={onSaveWallet}
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
