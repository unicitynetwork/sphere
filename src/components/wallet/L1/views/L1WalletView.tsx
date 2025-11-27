import { useEffect, useState } from "react";
import {
  connect,
  loadWallet,
  generateAddress,
  exportWallet,
  downloadWalletFile,
  type Wallet,
} from "../sdk";
import { useWalletOperations, useTransactions, useBalance } from "../hooks";
import { NoWalletView, HistoryView, MainWalletView } from ".";

type ViewMode = "main" | "history";

export function L1WalletView({ showBalances }: { showBalances: boolean }) {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [addresses, setAddresses] = useState<string[]>([]);
  const [selectedAddress, setSelectedAddress] = useState<string>("");
  const [viewMode, setViewMode] = useState<ViewMode>("main");
  const [showLoadPasswordModal, setShowLoadPasswordModal] = useState(false);
  const [isConnecting, setIsConnecting] = useState(true);

  const { balance, refreshBalance } = useBalance(selectedAddress);

  const {
    pendingFile,
    setPendingFile,
    handleCreateWallet,
    handleDeleteWallet,
    handleImportWallet,
  } = useWalletOperations();

  const {
    txPlan,
    setTxPlan,
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

  // Refresh balance when address changes
  useEffect(() => {
    if (selectedAddress) {
      refreshBalance(selectedAddress);
    }
  }, [selectedAddress, refreshBalance]);

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
          alert("Wallet loaded successfully!");
        } else {
          alert("Error loading wallet: " + result.error);
        }
      }
    } catch (err: unknown) {
      alert(
        "Error loading wallet: " +
          (err instanceof Error ? err.message : String(err))
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
      alert("Wallet loaded successfully!");
    } else {
      alert("Error loading wallet: " + result.error);
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
      alert("No wallet to save");
      return;
    }

    try {
      const content = exportWallet(wallet, {
        password: password || undefined,
        filename: filename,
      });

      downloadWalletFile(content, filename);
      alert("Wallet saved successfully!");
    } catch (err: unknown) {
      alert(
        "Error saving wallet: " +
          (err instanceof Error ? err.message : String(err))
      );
      console.error(err);
    }
  };

  // Send transaction
  const onSendTransaction = async (destination: string, amount: string) => {
    if (!wallet) return;

    const result = await createTxPlan(wallet, destination, amount);

    if (!result.success) {
      alert("Transaction failed: " + result.error);
    }
  };

  // Confirm send
  const onConfirmSend = async () => {
    if (!wallet || !txPlan) return;

    const result = await sendTransaction(wallet, txPlan);

    if (result.success) {
      alert(
        `Sent ${result.results?.length} transaction(s)!\n\nTXIDs:\n${result.results
          ?.map((r) => r.txid)
          .join("\n")}`
      );
    } else {
      if (result.results && result.results.length > 0) {
        alert(
          `${result.error}\n\nSuccessful TXIDs:\n${result.results
            .map((r) => r.txid)
            .join("\n")}`
        );
      } else {
        alert("Transaction failed: " + result.error);
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
    );
  }

  // History view
  if (viewMode === "history") {
    return (
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
    );
  }

  // Main view
  return (
    <MainWalletView
      wallet={wallet}
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
      onCancelSend={() => setTxPlan(null)}
    />
  );
}
