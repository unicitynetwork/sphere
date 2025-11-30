import { useEffect, useState, useCallback } from "react";
import {
  connect,
  loadWallet,
  generateAddress,
  exportWallet,
  downloadWalletFile,
  getUtxo,
  vestingState,
  type Wallet,
  type VestingMode,
} from "../sdk";
import { useWalletOperations, useTransactions, useBalance } from "../hooks";
import { NoWalletView, HistoryView, MainWalletView } from ".";
import { MessageModal, type MessageType } from "../components/modals/MessageModal";

type ViewMode = "main" | "history";

export function L1WalletView({ showBalances }: { showBalances: boolean }) {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [addresses, setAddresses] = useState<string[]>([]);
  const [selectedAddress, setSelectedAddress] = useState<string>("");
  const [viewMode, setViewMode] = useState<ViewMode>("main");
  const [showLoadPasswordModal, setShowLoadPasswordModal] = useState(false);
  const [isConnecting, setIsConnecting] = useState(true);
  const [vestingProgress, setVestingProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [messageModal, setMessageModal] = useState<{
    show: boolean;
    type: MessageType;
    title: string;
    message: string;
    txids?: string[];
  }>({ show: false, type: "info", title: "", message: "" });

  const showMessage = useCallback((type: MessageType, title: string, message: string, txids?: string[]) => {
    setMessageModal({ show: true, type, title, message, txids });
  }, []);

  const closeMessage = useCallback(() => {
    setMessageModal((prev) => ({ ...prev, show: false }));
  }, []);

  const { balance, refreshBalance } = useBalance(selectedAddress);

  // Classify UTXOs for vesting when address changes
  const classifyVesting = useCallback(async (address: string) => {
    if (!address) return;

    try {
      const utxos = await getUtxo(address);
      if (utxos.length === 0) return;

      await vestingState.classifyAddressUtxos(
        address,
        utxos,
        (current, total) => {
          setVestingProgress({ current, total });
        }
      );
      setVestingProgress(null);
    } catch (err) {
      console.error("Vesting classification error:", err);
      setVestingProgress(null);
    }
  }, []);

  // Handle vesting mode change
  const handleVestingModeChange = useCallback((_mode: VestingMode) => {
    // Mode is already set in vestingState by the VestingSelector
    // Could trigger balance recalculation if needed
  }, []);

  const {
    pendingFile,
    setPendingFile,
    handleCreateWallet,
    handleDeleteWallet,
    handleImportWallet,
  } = useWalletOperations();

  const {
    txPlan,
    isSending,
    transactions,
    loadingTransactions,
    currentBlockHeight,
    transactionDetails,
    createTxPlan,
    sendTransaction,
    loadTransactionHistory,
    analyzeTransaction,
  } = useTransactions();

  // Initialize wallet on mount
  useEffect(() => {
    (async () => {
      try {
        setIsConnecting(true);
        await connect();

        const w = loadWallet();
        if (!w) {
          setIsConnecting(false);
          return;
        }

        setWallet(w);

        const list = w.addresses.map((a) => a.address);
        setAddresses(list);
        setSelectedAddress(list[0]);

        await refreshBalance(list[0]);
      } finally {
        setIsConnecting(false);
      }
    })();
  }, [refreshBalance]);

  // Refresh balance and classify vesting when address changes
  useEffect(() => {
    if (selectedAddress) {
      refreshBalance(selectedAddress);
      classifyVesting(selectedAddress);
    }
  }, [selectedAddress, refreshBalance, classifyVesting]);

  // Create new wallet
  const onCreateWallet = async () => {
    const w = await handleCreateWallet();
    setWallet(w);

    const list = w.addresses.map((a) => a.address);
    setAddresses(list);
    setSelectedAddress(list[0]);

    await refreshBalance(list[0]);
  };

  // Load wallet from file
  const onLoadWallet = async (file: File) => {
    try {
      const content = await file.text();

      if (content.includes("ENCRYPTED MASTER KEY")) {
        setPendingFile(file);
        setShowLoadPasswordModal(true);
      } else {
        const result = await handleImportWallet(file);

        if (result.success && result.wallet) {
          setWallet(result.wallet);
          const list = result.wallet.addresses.map((a) => a.address);
          setAddresses(list);
          setSelectedAddress(list[0]);
          await refreshBalance(list[0]);
          showMessage("success", "Wallet Loaded", "Wallet loaded successfully!");
        } else {
          showMessage("error", "Load Error", "Error loading wallet: " + result.error);
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

  // Confirm load with password
  const onConfirmLoadWithPassword = async (password: string) => {
    if (!pendingFile) return;

    const result = await handleImportWallet(pendingFile, password);

    if (result.success && result.wallet) {
      setWallet(result.wallet);
      const list = result.wallet.addresses.map((a) => a.address);
      setAddresses(list);
      setSelectedAddress(list[0]);
      await refreshBalance(list[0]);

      setShowLoadPasswordModal(false);
      setPendingFile(null);
      showMessage("success", "Wallet Loaded", "Wallet loaded successfully!");
    } else {
      showMessage("error", "Load Error", "Error loading wallet: " + result.error);
    }
  };

  // Delete wallet
  const onDeleteWallet = () => {
    handleDeleteWallet();
    setWallet(null);
    setAddresses([]);
    setSelectedAddress("");
  };

  // Generate new address
  const onNewAddress = async () => {
    if (!wallet) return;

    const addr = generateAddress(wallet);
    const updated = loadWallet();
    if (!updated) return;

    const list = updated.addresses.map((a) => a.address);
    setAddresses(list);
    setSelectedAddress(addr.address);

    await refreshBalance(addr.address);
  };

  // Save wallet
  const onSaveWallet = (filename: string, password?: string) => {
    if (!wallet) {
      showMessage("warning", "No Wallet", "No wallet to save");
      return;
    }

    try {
      const content = exportWallet(wallet, {
        password: password || undefined,
        filename: filename,
      });

      downloadWalletFile(content, filename);
      showMessage("success", "Wallet Saved", "Wallet saved successfully!");
    } catch (err: unknown) {
      showMessage(
        "error",
        "Save Error",
        "Error saving wallet: " + (err instanceof Error ? err.message : String(err))
      );
      console.error(err);
    }
  };

  // Send transaction
  const onSendTransaction = async (destination: string, amount: string) => {
    if (!wallet) return;

    // Use selected address as sender
    const result = await createTxPlan(wallet, destination, amount, selectedAddress);

    if (!result.success) {
      showMessage("error", "Transaction Failed", "Transaction failed: " + result.error);
    }
  };

  // Confirm send
  const onConfirmSend = async () => {
    if (!wallet || !txPlan) return;

    const result = await sendTransaction(wallet, txPlan);

    if (result.success) {
      const txids = result.results?.map((r) => r.txid) || [];
      showMessage(
        "success",
        "Transaction Sent",
        `Sent ${result.results?.length} transaction(s)!`,
        txids
      );
    } else {
      if (result.results && result.results.length > 0) {
        const txids = result.results.map((r) => r.txid);
        showMessage(
          "warning",
          "Partial Success",
          result.error || "Some transactions failed",
          txids
        );
      } else {
        showMessage("error", "Transaction Failed", "Transaction failed: " + result.error);
      }
    }

    refreshBalance(selectedAddress);
  };

  // Show history
  const onShowHistory = () => {
    setViewMode("history");
    loadTransactionHistory(selectedAddress);
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
  if (isConnecting) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '200px',
        flexDirection: 'column',
        gap: '12px'
      }}>
        <div style={{
          fontSize: '32px',
          animation: 'spin 1s linear infinite'
        }}>⟳</div>
        <div style={{ color: '#888' }}>Connecting to network...</div>
        <style>{`
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  // No wallet view
  if (!wallet) {
    return (
      <>
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
      </>
    );
  }

  // History view
  if (viewMode === "history") {
    return (
      <>
        <HistoryView
          wallet={wallet}
          selectedAddress={selectedAddress}
          transactions={transactions}
          loadingTransactions={loadingTransactions}
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
      </>
    );
  }

  // Main view
  return (
    <>
      <MainWalletView
        selectedAddress={selectedAddress}
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
      />
      <MessageModal
        show={messageModal.show}
        type={messageModal.type}
        title={messageModal.title}
        message={messageModal.message}
        txids={messageModal.txids}
        onClose={closeMessage}
      />
    </>
  );
}
