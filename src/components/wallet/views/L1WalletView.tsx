import { useEffect, useState, useRef } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Send,
  Trash2,
  Copy,
  ChevronDown,
  Download,
  AlertTriangle,
  Upload,
  History,
  ArrowLeft,
} from "lucide-react";
import { motion } from "framer-motion";
import QRCodeStyling from "qr-code-styling";

import {
  createWallet,
  loadWallet,
  deleteWallet,
  generateAddress,
  connect,
  getBalance,
  subscribeBlocks,
  createTransactionPlan,
  createAndSignTransaction,
  broadcast,
  exportWallet,
  downloadWalletFile,
  generateHDAddress,
  importWallet,
  getTransactionHistory,
  getTransaction,
  getCurrentBlockHeight,
  saveWalletToStorage,
  type Wallet,
  type TransactionPlan,
  type TransactionHistoryItem,
  type TransactionDetail,
} from "../l1/sdk";

type ViewMode = "main" | "history";

export function L1WalletView({ showBalances }: { showBalances: boolean }) {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [addresses, setAddresses] = useState<string[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);

  const [selectedAddress, setSelectedAddress] = useState<string>("");
  const [viewMode, setViewMode] = useState<ViewMode>("main");

  const [balance, setBalance] = useState<number>(0);
  const [showQR, setShowQR] = useState(false);

  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("");

  const [txPlan, setTxPlan] = useState<TransactionPlan | null>(null);
  const [showConfirmation, setShowConfirmation] = useState(false);

  // Transaction History State
  const [transactions, setTransactions] = useState<TransactionHistoryItem[]>([]);
  const [loadingTransactions, setLoadingTransactions] = useState(false);
  const [currentBlockHeight, setCurrentBlockHeight] = useState(0);
  const [transactionDetails, setTransactionDetails] = useState<Record<string, TransactionDetail>>({});

  // Save/Load state
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveFilename, setSaveFilename] = useState("alpha_wallet_backup");
  const [savePassword, setSavePassword] = useState("");
  const [savePasswordConfirm, setSavePasswordConfirm] = useState("");
  const [showLoadPasswordModal, setShowLoadPasswordModal] = useState(false);
  const [loadPassword, setLoadPassword] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isSending, setIsSending] = useState(false);

  // Delete Modal State
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  // Use ref to avoid stale closure in subscribeBlocks callback
  const selectedAddressRef = useRef<string>("");

  // QR Code ref
  const qrCodeRef = useRef<HTMLDivElement>(null);

  // Keep ref in sync with state
  useEffect(() => {
    selectedAddressRef.current = selectedAddress;
  }, [selectedAddress]);

  // Generate QR Code when modal opens
  useEffect(() => {
    if (showQR && selectedAddress && qrCodeRef.current) {
      // Clear previous QR code
      qrCodeRef.current.innerHTML = "";

      const qrCode = new QRCodeStyling({
        width: 240,
        height: 240,
        data: selectedAddress,
        margin: 5,
        qrOptions: {
          typeNumber: 0,
          mode: "Byte",
          errorCorrectionLevel: "H",
        },
        imageOptions: {
          hideBackgroundDots: true,
          imageSize: 0.25,
          margin: 3,
        },
        dotsOptions: {
          type: "rounded",
          color: "#ffffff",
        },
        backgroundOptions: {
          color: "#1a1a1a",
        },
        cornersSquareOptions: {
          type: "extra-rounded",
          color: "#ffffff",
        },
        cornersDotOptions: {
          type: "dot",
          color: "#ffffff",
        },
        image: "/images/unicity_logo.svg",
      });

      qrCode.append(qrCodeRef.current);
    }
  }, [showQR, selectedAddress]);

  // -------------------------------
  // INIT: connect to RPC + load wallet
  // -------------------------------
  useEffect(() => {
    (async () => {
      await connect(); // <-- Needed for RPC to work

      const w = loadWallet();
      if (!w) return;

      setWallet(w);

      const list = w.addresses.map((a) => a.address);
      setAddresses(list);
      setSelectedAddress(list[0]);

      await refreshBalance(list[0]);

      // Auto-refresh on new block - use ref to get current value
      subscribeBlocks((header) => {
        setCurrentBlockHeight(header.height);
        if (selectedAddressRef.current) {
          refreshBalance(selectedAddressRef.current);
        }
      });
    })();
  }, []);

  // -------------------------------
  // Refresh Address Balance
  // -------------------------------
  async function refreshBalance(addr: string) {
    if (!addr) return;

    const bal = await getBalance(addr);
    setBalance(bal);
  }

  // -------------------------------
  // Load Transaction History
  // -------------------------------
  async function loadTransactions(addr: string) {
    if (!addr) return;

    setLoadingTransactions(true);
    try {
      // Get current block height first
      const height = await getCurrentBlockHeight();
      setCurrentBlockHeight(height);

      const history = await getTransactionHistory(addr);
      // Sort by height (most recent first)
      const sorted = [...history].sort((a, b) => {
        if (a.height === 0 && b.height === 0) return 0;
        if (a.height === 0) return -1;
        if (b.height === 0) return 1;
        return b.height - a.height;
      });
      setTransactions(sorted);

      // Load transaction details for all transactions
      const details: Record<string, TransactionDetail> = {};
      for (const tx of sorted) {
        try {
          const detail = await getTransaction(tx.tx_hash) as TransactionDetail;
          details[tx.tx_hash] = detail;
        } catch (err) {
          console.error(`Error loading transaction ${tx.tx_hash}:`, err);
        }
      }
      setTransactionDetails(details);
    } catch (err) {
      console.error("Error loading transactions:", err);
      setTransactions([]);
    } finally {
      setLoadingTransactions(false);
    }
  }

  // -------------------------------
  // Analyze Transaction
  // -------------------------------
  function analyzeTransaction(tx: TransactionHistoryItem, detail: TransactionDetail | undefined) {
    if (!detail || !wallet) {
      return {
        direction: "unknown" as const,
        amount: 0,
        fromAddresses: [] as string[],
        toAddresses: [] as string[],
      };
    }

    // Get all wallet addresses
    const walletAddresses = new Set(wallet.addresses.map(a => a.address.toLowerCase()));

    // Check inputs to see if we sent this transaction
    let isOutgoing = false;
    const fromAddresses: string[] = [];

    // We need to fetch input transaction details to get sender addresses
    // For now, we'll mark as outgoing if any output goes to an address we don't own
    for (const output of detail.vout) {
      const addresses = output.scriptPubKey.addresses || (output.scriptPubKey.address ? [output.scriptPubKey.address] : []);
      for (const addr of addresses) {
        if (!walletAddresses.has(addr.toLowerCase())) {
          isOutgoing = true;
        }
      }
    }

    // Calculate net amount
    let totalInput = 0;
    let totalOutput = 0;
    const toAddresses: string[] = [];

    for (const output of detail.vout) {
      const addresses = output.scriptPubKey.addresses || (output.scriptPubKey.address ? [output.scriptPubKey.address] : []);
      const isOurOutput = addresses.some(addr => walletAddresses.has(addr.toLowerCase()));

      if (isOurOutput) {
        totalInput += output.value;
      } else {
        totalOutput += output.value;
        toAddresses.push(...addresses);
      }
    }

    const direction = isOutgoing ? "sent" : "received";
    const amount = direction === "sent" ? totalOutput : totalInput;

    return {
      direction,
      amount: amount / 100_000_000, // Convert satoshis to ALPHA
      fromAddresses,
      toAddresses,
    };
  }

  // -------------------------------
  // Format timestamp
  // -------------------------------
  function formatTimestamp(time: number | undefined) {
    if (!time) return "";
    const date = new Date(time * 1000);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  // -------------------------------
  // Switch to History View
  // -------------------------------
  function handleShowHistory() {
    setViewMode("history");
    loadTransactions(selectedAddress);
  }

  // -------------------------------
  // Back to Main View
  // -------------------------------
  function handleBackToMain() {
    setViewMode("main");
  }

  // -------------------------------
  // Create a new wallet
  // -------------------------------
  async function handleCreateWallet() {
    const w = createWallet();
    setWallet(w);

    const list = w.addresses.map((a) => a.address);
    setAddresses(list);
    setSelectedAddress(list[0]);

    await refreshBalance(list[0]);
  }

  // -------------------------------
  // Delete wallet
  // -------------------------------
  function handleDeleteRequest() {
    setShowDeleteModal(true);
  }

  function handleConfirmDelete() {
    deleteWallet();

    setWallet(null);
    setAddresses([]);
    setSelectedAddress("");
    setBalance(0);
    setDestination("");
    setAmount("");
    setShowDropdown(false);
    setShowDeleteModal(false);
  }

  // -------------------------------
  // Generate new HD address
  // -------------------------------
  async function handleNewAddress() {
    if (!wallet) return;

    const addr = generateAddress(wallet);
    const updated = loadWallet();
    if (!updated) return;

    const list = updated.addresses.map((a) => a.address);
    setAddresses(list);
    setSelectedAddress(addr.address);

    await refreshBalance(addr.address);
  }

  // -------------------------------
  // Send
  // -------------------------------
  async function handleSend() {
    try {
      if (!wallet) return;
      if (!destination || !amount) {
        alert("Enter destination and amount");
        return;
      }

      const amountAlpha = Number(amount);
      if (isNaN(amountAlpha) || amountAlpha <= 0) {
        alert("Invalid amount");
        return;
      }

      const plan = await createTransactionPlan(
        wallet,
        destination,
        amountAlpha
      );

      if (!plan.success) {
        alert("Transaction failed: " + plan.error);
        return;
      }

      setTxPlan(plan);
      setShowConfirmation(true);
    } catch (err: unknown) {
      alert(
        "Error creating transaction: " +
          (err instanceof Error ? err.message : String(err))
      );
      console.error(err);
    }
  }

  async function handleConfirmSend() {
    if (!txPlan || !wallet) return;

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

      if (errors.length > 0) {
        alert(
          `Some transactions failed to broadcast:\n${errors.join(
            "\n"
          )}\n\nSuccessful TXIDs:\n${results.map((r) => r.txid).join("\n")}`
        );
      } else {
        alert(
          `Sent ${results.length} transaction(s)!\n\nTXIDs:\n${results
            .map((r) => r.txid)
            .join("\n")}`
        );
      }

      setShowConfirmation(false);
      setTxPlan(null);
      setDestination("");
      setAmount("");
      refreshBalance(selectedAddress);
    } catch (err: unknown) {
      alert(
        "Transaction failed: " +
          (err instanceof Error ? err.message : String(err))
      );
      console.error(err);
    } finally {
      setIsSending(false);
    }
  }

  // -------------------------------
  // Save Wallet
  // -------------------------------
  function handleSaveWallet() {
    if (!wallet) {
      alert("No wallet to save");
      return;
    }
    // If called from delete modal, close it temporarily (optional, but cleaner)
    setShowDeleteModal(false);
    setShowSaveModal(true);
  }

  function handleConfirmSave() {
    if (!wallet) return;

    // Validate password if provided
    if (savePassword) {
      if (savePassword !== savePasswordConfirm) {
        alert("Passwords do not match!");
        return;
      }
      if (savePassword.length < 4) {
        alert("Password must be at least 4 characters");
        return;
      }
    }

    try {
      const content = exportWallet(wallet, {
        password: savePassword || undefined,
        filename: saveFilename,
      });

      downloadWalletFile(content, saveFilename);

      setShowSaveModal(false);
      setSavePassword("");
      setSavePasswordConfirm("");
      alert("Wallet saved successfully!");
    } catch (err: unknown) {
      alert(
        "Error saving wallet: " +
          (err instanceof Error ? err.message : String(err))
      );
      console.error(err);
    }
  }

  // -------------------------------
  // Load Wallet
  // -------------------------------
  function handleLoadWallet() {
    fileInputRef.current?.click();
  }

  async function handleFileSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const content = await file.text();

      // Check if encrypted
      if (content.includes("ENCRYPTED MASTER KEY")) {
        // Needs password
        setPendingFile(file);
        setShowLoadPasswordModal(true);
      } else {
        // Unencrypted - use importWallet
        const result = await importWallet(file);

        if (result.success && result.wallet) {
          // Regenerate addresses for BIP32 wallets
          if (result.wallet.isImportedAlphaWallet && result.wallet.chainCode) {
            const addresses = [];
            for (let i = 0; i < (result.wallet.addresses.length || 1); i++) {
              const addr = generateHDAddress(
                result.wallet.masterPrivateKey,
                result.wallet.chainCode,
                i
              );
              addresses.push(addr);
            }
            result.wallet.addresses = addresses;
          }

          // Save to localStorage
          saveWalletToStorage("main", result.wallet);

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

    // Reset file input
    event.target.value = "";
  }

  async function handleConfirmLoadWithPassword() {
    if (!pendingFile || !loadPassword) {
      alert("Please enter password");
      return;
    }

    try {
      // Use importWallet with password
      const result = await importWallet(pendingFile, loadPassword);

      if (result.success && result.wallet) {
        // Regenerate addresses for BIP32 wallets
        if (result.wallet.isImportedAlphaWallet && result.wallet.chainCode) {
          const addresses = [];
          for (let i = 0; i < (result.wallet.addresses.length || 1); i++) {
            const addr = generateHDAddress(
              result.wallet.masterPrivateKey,
              result.wallet.chainCode,
              i
            );
            addresses.push(addr);
          }
          result.wallet.addresses = addresses;
        }

        // Save to localStorage
        saveWalletToStorage("main", result.wallet);

        setWallet(result.wallet);
        const list = result.wallet.addresses.map((a) => a.address);
        setAddresses(list);
        setSelectedAddress(list[0]);
        await refreshBalance(list[0]);

        setShowLoadPasswordModal(false);
        setPendingFile(null);
        setLoadPassword("");
        alert("Wallet loaded successfully!");
      } else {
        alert("Error loading wallet: " + result.error);
      }
    } catch (err: unknown) {
      alert(
        "Error loading wallet: " +
          (err instanceof Error ? err.message : String(err))
      );
      console.error(err);
    }
  }

  // -------------------------------
  // NO WALLET UI
  // -------------------------------
  if (!wallet) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center">
        <h2 className="text-xl text-white font-semibold mb-2">
          No wallet found
        </h2>
        <p className="text-neutral-400 mb-6">
          Create a new wallet or import an existing one to continue
        </p>

        <div className="flex flex-col sm:flex-row gap-4 w-full max-w-xs">
          <motion.button
            whileTap={{ scale: 0.97 }}
            className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-xl text-sm font-semibold shadow-lg shadow-blue-500/20"
            onClick={handleCreateWallet}
          >
            Create Wallet
          </motion.button>

          <motion.button
            whileTap={{ scale: 0.97 }}
            className="flex-1 px-6 py-3 bg-neutral-800 border border-neutral-700 text-white rounded-xl text-sm font-semibold hover:bg-neutral-700 flex items-center justify-center gap-2"
            onClick={handleLoadWallet}
          >
            <Upload className="w-4 h-4" />
            Import
          </motion.button>
        </div>

        {/* Hidden File Input for Import */}
        <input
          type="file"
          ref={fileInputRef}
          className="hidden"
          accept=".json,.txt"
          onChange={handleFileSelect}
        />

        {/* Load Password Modal (Can trigger during import) */}
        {showLoadPasswordModal && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-40 p-6">
            <div className="bg-neutral-900 p-6 rounded-xl w-full max-w-md border border-neutral-700 shadow-2xl">
              <h3 className="text-white text-lg font-bold mb-4">
                Enter Password
              </h3>
              <p className="text-neutral-400 text-sm mb-4">
                This wallet is encrypted. Please enter your password to unlock
                it.
              </p>

              <input
                placeholder="Password"
                type="password"
                value={loadPassword}
                onChange={(e) => setLoadPassword(e.target.value)}
                className="w-full mb-6 px-3 py-2 bg-neutral-800 rounded text-neutral-200 border border-neutral-700 focus:border-blue-500 outline-none"
              />

              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowLoadPasswordModal(false);
                    setPendingFile(null);
                    setLoadPassword("");
                  }}
                  className="flex-1 py-2 bg-neutral-700 rounded text-white hover:bg-neutral-600"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmLoadWithPassword}
                  className="flex-1 py-2 bg-blue-600 rounded text-white hover:bg-blue-500"
                >
                  Unlock
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // -------------------------------
  // WALLET UI
  // -------------------------------

  // Render History View
  if (viewMode === "history") {
    return (
      <div className="flex flex-col h-full relative">
        {/* HEADER */}
        <div className="px-6 mb-4">
          <div className="flex items-center gap-3 mb-4">
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={handleBackToMain}
              className="p-2 rounded-lg bg-neutral-800 border border-neutral-700 hover:bg-neutral-700 text-white"
            >
              <ArrowLeft className="w-5 h-5" />
            </motion.button>
            <h2 className="text-xl text-white font-bold">Transaction History</h2>
          </div>

          <p className="text-xs text-neutral-400">
            {selectedAddress.slice(0, 10)}...{selectedAddress.slice(-6)}
          </p>
        </div>

        {/* TRANSACTION LIST */}
        <div className="flex-1 overflow-y-auto px-6">
          {loadingTransactions ? (
            <div className="flex items-center justify-center h-32">
              <p className="text-neutral-400">Loading transactions...</p>
            </div>
          ) : transactions.length === 0 ? (
            <div className="flex items-center justify-center h-32">
              <p className="text-neutral-400">No transactions found</p>
            </div>
          ) : (
            <div className="space-y-3">
              {transactions.map((tx) => {
                const confirmations =
                  tx.height > 0 && currentBlockHeight > 0
                    ? Math.max(0, currentBlockHeight - tx.height + 1)
                    : 0;
                const statusColor = confirmations > 0 ? "#10b981" : "#fbbf24";
                const statusText =
                  confirmations > 0
                    ? `${confirmations} confirmations`
                    : "Unconfirmed";
                const truncatedTxid =
                  tx.tx_hash.substring(0, 6) +
                  "..." +
                  tx.tx_hash.substring(tx.tx_hash.length - 6);

                const detail = transactionDetails[tx.tx_hash];
                const analysis = analyzeTransaction(tx, detail);
                const isSent = analysis.direction === "sent";
                const directionText = isSent ? "Sent" : "Received";
                const directionColor = isSent ? "#ef4444" : "#10b981";

                return (
                  <div
                    key={tx.tx_hash}
                    className="bg-neutral-900 border border-neutral-800 rounded-xl p-4"
                  >
                    {/* Header: Direction + TXID + Amount */}
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex items-center gap-2">
                        <span
                          className="text-sm font-semibold"
                          style={{ color: directionColor }}
                        >
                          {isSent ? "↑" : "↓"} {directionText}
                        </span>
                        <a
                          href={`https://www.unicity.network/tx/${tx.tx_hash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-xs text-blue-400 hover:text-blue-300"
                        >
                          {truncatedTxid}
                        </a>
                      </div>
                      <div className="text-right">
                        <div
                          className="font-bold text-sm"
                          style={{ color: directionColor }}
                        >
                          {isSent ? "-" : ""}
                          {analysis.amount.toFixed(8)} ALPHA
                        </div>
                      </div>
                    </div>

                    {/* Status + Block + Time */}
                    <div className="flex items-center gap-2 text-xs mb-2">
                      <span style={{ color: statusColor }}>{statusText}</span>
                      {tx.height > 0 && (
                        <>
                          <span className="text-neutral-600">•</span>
                          <span className="text-neutral-400">
                            Block {tx.height}
                          </span>
                        </>
                      )}
                      {detail?.blocktime && (
                        <>
                          <span className="text-neutral-600">•</span>
                          <span className="text-neutral-400">
                            {formatTimestamp(detail.blocktime)}
                          </span>
                        </>
                      )}
                    </div>

                    {/* From/To Addresses */}
                    {detail && (
                      <div className="space-y-1">
                        {analysis.fromAddresses.length > 0 && (
                          <div className="text-xs text-neutral-400">
                            From:{" "}
                            <a
                              href={`https://www.unicity.network/address/${analysis.fromAddresses[0]}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-400 hover:text-blue-300 font-mono"
                            >
                              {analysis.fromAddresses[0].substring(0, 11)}...
                              {analysis.fromAddresses[0].substring(
                                analysis.fromAddresses[0].length - 6
                              )}
                            </a>
                          </div>
                        )}
                        {analysis.toAddresses.length > 0 && (
                          <div className="text-xs text-neutral-400">
                            To:{" "}
                            <a
                              href={`https://www.unicity.network/address/${analysis.toAddresses[0]}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-400 hover:text-blue-300 font-mono"
                            >
                              {analysis.toAddresses[0].substring(0, 11)}...
                              {analysis.toAddresses[0].substring(
                                analysis.toAddresses[0].length - 6
                              )}
                            </a>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Render Main View
  return (
    <div className="flex flex-col h-full relative">
      {/* CONFIRMATION MODAL */}
      {showConfirmation && txPlan && (
        <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-30 p-4">
          <div className="bg-neutral-900 border border-neutral-700 p-6 rounded-xl shadow-2xl max-w-md w-full">
            <h3 className="text-xl text-white font-bold mb-4">
              Confirm Transaction
            </h3>

            <div className="space-y-3 mb-6">
              <div className="flex justify-between text-sm">
                <span className="text-neutral-400">Recipient</span>
                <span className="text-white font-mono truncate max-w-[200px]">
                  {destination}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-neutral-400">Amount</span>
                <span className="text-white">{amount} ALPHA</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-neutral-400">Transactions</span>
                <span className="text-white">{txPlan.transactions.length}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-neutral-400">Total Fee</span>
                <span className="text-white">
                  {(txPlan.transactions.length * 10000) / 100000000} ALPHA
                </span>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirmation(false)}
                className="flex-1 px-4 py-3 rounded-xl bg-neutral-800 text-white font-semibold hover:bg-neutral-700"
                disabled={isSending}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmSend}
                className="flex-1 px-4 py-3 rounded-xl bg-green-600 text-white font-semibold hover:bg-green-500 flex items-center justify-center gap-2"
                disabled={isSending}
              >
                {isSending ? "Sending..." : "Confirm & Send"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* QR Modal */}
      {showQR && (
        <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-20 p-4">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.2 }}
            className="bg-linear-to-br from-neutral-900 to-neutral-800 p-8 rounded-2xl shadow-2xl border border-neutral-700 max-w-sm w-full"
          >
            {/* Header */}
            <div className="text-center mb-6">
              <h3 className="text-xl font-bold text-white mb-2">Receive ALPHA</h3>
              <p className="text-sm text-neutral-400">
                Scan QR code to receive payment
              </p>
            </div>

            {/* QR Code Container with custom design */}
            <div className="relative bg-neutral-900 p-4 rounded-2xl shadow-inner mb-6 flex items-center justify-center">
              {/* Decorative corners */}
              <div className="absolute top-2 left-2 w-6 h-6 border-t-4 border-l-4 border-orange-500 rounded-tl-lg"></div>
              <div className="absolute top-2 right-2 w-6 h-6 border-t-4 border-r-4 border-orange-500 rounded-tr-lg"></div>
              <div className="absolute bottom-2 left-2 w-6 h-6 border-b-4 border-l-4 border-orange-500 rounded-bl-lg"></div>
              <div className="absolute bottom-2 right-2 w-6 h-6 border-b-4 border-r-4 border-orange-500 rounded-br-lg"></div>

              {/* QR Code with rounded elements */}
              <div ref={qrCodeRef} className="flex items-center justify-center"></div>
            </div>

            {/* Address Display */}
            <div className="bg-neutral-800/50 rounded-xl p-4 mb-6 border border-neutral-700">
              <p className="text-xs text-neutral-400 mb-2 text-center">
                Your Address
              </p>
              <div className="flex items-center gap-2">
                <p className="flex-1 text-xs font-mono text-white break-all text-center">
                  {selectedAddress}
                </p>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(selectedAddress);
                  }}
                  className="p-2 rounded-lg bg-neutral-700 hover:bg-neutral-600 text-white transition-colors"
                >
                  <Copy className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Close Button */}
            <motion.button
              whileTap={{ scale: 0.98 }}
              onClick={() => setShowQR(false)}
              className="w-full px-4 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold shadow-lg shadow-blue-500/20 transition-colors"
            >
              Close
            </motion.button>
          </motion.div>
        </div>
      )}

      {/* HEADER */}
      <div className="px-6 mb-6">
        <p className="text-xs text-blue-300/70 mb-1">Mainnet Balance</p>

        <h2 className="text-3xl text-white font-bold tracking-tight mb-4">
          {showBalances ? `${balance} ALPHA` : "••••••"}
        </h2>

        {/* ACTION BUTTONS */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <motion.button
            onClick={() => setShowQR(true)}
            whileHover={{ scale: 1.02, y: -2 }}
            className="px-4 py-3 rounded-xl bg-blue-600 text-white text-sm flex items-center justify-center gap-2 shadow-blue-500/20"
          >
            <ArrowDownLeft className="w-4 h-4" />
            Receive
          </motion.button>

          <motion.button
            onClick={handleNewAddress}
            whileHover={{ scale: 1.02, y: -2 }}
            className="px-4 py-3 rounded-xl bg-neutral-800 text-white text-sm border border-neutral-700 flex items-center justify-center gap-2"
          >
            <ArrowUpRight className="w-4 h-4" />
            New Address
          </motion.button>
        </div>

        {/* TRANSACTION HISTORY BUTTON */}
        <motion.button
          onClick={handleShowHistory}
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.99 }}
          className="w-full mb-4 px-4 py-3 rounded-xl bg-neutral-800/50 text-white text-sm border border-neutral-700/50 flex items-center justify-center gap-2 hover:bg-neutral-800"
        >
          <History className="w-4 h-4" />
          Transaction History
        </motion.button>

        {/* ADDRESS SELECT + COPY */}
        <div className="mb-6 relative">
          <label className="text-xs text-neutral-400">Addresses</label>

          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={() => setShowDropdown((prev) => !prev)}
              className="flex-1 bg-neutral-800 text-neutral-200 px-3 py-2 rounded border border-neutral-700 flex items-center justify-between"
            >
              <span>
                {selectedAddress.slice(0, 10) +
                  "..." +
                  selectedAddress.slice(-6)}
              </span>
              <ChevronDown className="w-4 h-4 text-neutral-400" />
            </button>

            <button
              onClick={() => navigator.clipboard.writeText(selectedAddress)}
              className="p-2 rounded-lg bg-neutral-800 border border-neutral-700 hover:bg-neutral-700 text-neutral-300"
            >
              <Copy className="w-4 h-4" />
            </button>
          </div>

          {showDropdown && (
            <div className="absolute z-20 mt-2 w-full bg-neutral-900 border border-neutral-700 rounded-xl shadow-xl max-h-52 overflow-y-auto">
              {addresses.map((a, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setSelectedAddress(a);
                    setShowDropdown(false);
                    refreshBalance(a);
                  }}
                  className={`w-full text-left px-3 py-2 text-neutral-200 hover:bg-neutral-800 ${
                    a === selectedAddress ? "bg-neutral-800" : ""
                  }`}
                >
                  {a}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* SEND BLOCK */}
      <div className="px-6">
        <div className="flex flex-col gap-3 bg-neutral-900 p-4 rounded-xl border border-neutral-800">
          <input
            placeholder="Destination"
            className="px-3 py-2 bg-neutral-800 rounded text-neutral-200 border border-neutral-700 focus:border-blue-500 outline-none"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
          />

          <input
            placeholder="Amount"
            className="px-3 py-2 bg-neutral-800 rounded text-neutral-200 border border-neutral-700 focus:border-blue-500 outline-none"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />

          <motion.button
            whileTap={{ scale: 0.98 }}
            onClick={handleSend}
            className="px-4 py-3 bg-green-600 rounded-xl text-white font-semibold flex items-center justify-center gap-2 shadow-lg shadow-green-500/10"
          >
            <Send className="w-4 h-4" /> Send
          </motion.button>
        </div>
      </div>

      {/* FOOTER ACTIONS (DELETE & SAVE) */}
      <div className="mt-auto px-6 pb-6 pt-4 flex items-center justify-between border-t border-neutral-800/50">
        {/* Subtle Save Button */}
        <button
          onClick={handleSaveWallet}
          className="flex items-center gap-2 text-xs text-neutral-500 hover:text-white transition-colors"
        >
          <Download className="w-3 h-3" />
          Backup Wallet
        </button>

        {/* Delete Button */}
        <button
          onClick={handleDeleteRequest}
          className="flex items-center gap-2 text-xs text-neutral-500 hover:text-red-400 transition-colors"
        >
          <Trash2 className="w-3 h-3" />
          Delete Wallet
        </button>
      </div>

      {/* SAVE MODAL */}
      {showSaveModal && (
        <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-40 p-6">
          <div className="bg-neutral-900 p-6 rounded-xl w-full max-w-md border border-neutral-700 shadow-2xl">
            <h3 className="text-white text-lg font-bold mb-4">Backup Wallet</h3>
            <p className="text-xs text-neutral-400 mb-4">
              Export your wallet keys to a file. Keep this safe!
            </p>

            <label className="text-xs text-neutral-500 mb-1 block">
              Filename
            </label>
            <input
              placeholder="Filename"
              value={saveFilename}
              onChange={(e) => setSaveFilename(e.target.value)}
              className="w-full mb-3 px-3 py-2 bg-neutral-800 rounded text-neutral-200 border border-neutral-700"
            />

            <label className="text-xs text-neutral-500 mb-1 block">
              Encryption Password (Optional)
            </label>
            <input
              placeholder="Password"
              type="password"
              value={savePassword}
              onChange={(e) => setSavePassword(e.target.value)}
              className="w-full mb-3 px-3 py-2 bg-neutral-800 rounded text-neutral-200 border border-neutral-700"
            />

            <input
              placeholder="Confirm Password"
              type="password"
              value={savePasswordConfirm}
              onChange={(e) => setSavePasswordConfirm(e.target.value)}
              className="w-full mb-6 px-3 py-2 bg-neutral-800 rounded text-neutral-200 border border-neutral-700"
            />

            <div className="flex gap-3">
              <button
                onClick={() => setShowSaveModal(false)}
                className="flex-1 py-2 bg-neutral-700 rounded text-white hover:bg-neutral-600"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmSave}
                className="flex-1 py-2 bg-blue-600 rounded text-white hover:bg-blue-500"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DELETE CONFIRMATION MODAL */}
      {showDeleteModal && (
        <div className="absolute inset-0 bg-black/90 flex items-center justify-center z-50 p-6">
          <div className="bg-neutral-900 p-6 rounded-xl w-full max-w-md border border-red-900/50 shadow-2xl">
            <div className="flex flex-col items-center text-center mb-6">
              <div className="w-12 h-12 bg-red-500/10 rounded-full flex items-center justify-center mb-4">
                <AlertTriangle className="w-6 h-6 text-red-500" />
              </div>
              <h3 className="text-white text-xl font-bold mb-2">
                Delete Wallet?
              </h3>
              <p className="text-neutral-400 text-sm">
                Are you sure you want to delete this wallet? <br />
                <span className="text-red-400 font-semibold">
                  This action cannot be undone.
                </span>
              </p>
              <p className="text-neutral-500 text-xs mt-2">
                If you haven't saved your backup, your funds will be lost
                forever.
              </p>
            </div>

            <div className="flex flex-col gap-3">
              <button
                onClick={handleSaveWallet}
                className="w-full py-3 bg-neutral-800 rounded-xl text-white font-medium border border-neutral-700 hover:bg-neutral-700 flex items-center justify-center gap-2"
              >
                <Download className="w-4 h-4" />
                Save Backup First
              </button>

              <div className="flex gap-3 mt-2">
                <button
                  onClick={() => setShowDeleteModal(false)}
                  className="flex-1 py-3 bg-neutral-800 rounded-xl text-white font-medium hover:bg-neutral-700"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmDelete}
                  className="flex-1 py-3 bg-red-600/20 text-red-500 border border-red-900/50 rounded-xl font-medium hover:bg-red-600 hover:text-white transition-all"
                >
                  Delete Anyway
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
