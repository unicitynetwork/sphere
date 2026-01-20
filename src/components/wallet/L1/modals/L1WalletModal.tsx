import { useEffect, useState, useCallback } from "react";
import {
  X,
  Loader2,
  ChevronLeft,
  ChevronDown,
  Copy,
  Check,
  ExternalLink,
  Plus,
  QrCode,
  Send,
  History,
  ArrowRightLeft,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  generateAddress,
  loadWalletFromStorage,
  createTransactionPlan,
  createAndSignTransaction,
  broadcast,
  type TransactionPlan,
} from "../sdk";
import { useL1Wallet, useConnectionStatus } from "../hooks";
import { useAddressNametags } from "../hooks/useAddressNametags";
import { ConnectionStatus } from "../components/ConnectionStatus";
import { STORAGE_KEYS } from "../../../../config/storageKeys";
import {
  QRModal,
  TransactionConfirmationModal,
  BridgeModal,
  SendModal,
} from "../components/modals";
import { MessageModal, type MessageType } from "../components/modals/MessageModal";
import { VestingDisplay } from "../components/VestingDisplay";
import { HistoryView } from "../views";

interface L1WalletModalProps {
  isOpen: boolean;
  onClose: () => void;
  showBalances: boolean;
}

type ViewMode = "main" | "history";

export function L1WalletModal({ isOpen, onClose, showBalances }: L1WalletModalProps) {
  const [selectedAddress, setSelectedAddress] = useState<string>("");
  const [viewMode, setViewMode] = useState<ViewMode>("main");
  const [txPlan, setTxPlan] = useState<TransactionPlan | null>(null);

  // Connection status hook
  const connection = useConnectionStatus();
  const [isSending, setIsSending] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [showSendModal, setShowSendModal] = useState(false);
  const [showBridgeModal, setShowBridgeModal] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [pendingDestination, setPendingDestination] = useState("");
  const [pendingAmount, setPendingAmount] = useState("");
  const [messageModal, setMessageModal] = useState<{
    show: boolean;
    type: MessageType;
    title: string;
    message: string;
    txids?: string[];
  }>({ show: false, type: "info", title: "", message: "" });

  const {
    wallet,
    isLoadingWallet,
    balance,
    totalBalance,
    transactions,
    transactionDetails,
    isLoadingTransactions,
    currentBlockHeight,
    analyzeTransaction,
    invalidateWallet,
    vestingBalances,
    isClassifyingVesting,
  } = useL1Wallet(selectedAddress);

  const addresses = wallet?.addresses.map((a) => a.address) ?? [];
  const { nametagState, addressesWithNametags } = useAddressNametags(wallet?.addresses);

  // Check if any address is still loading nametag from IPNS
  const isAnyAddressLoading = addressesWithNametags.some(addr => addr.ipnsLoading);

  const showMessage = useCallback((type: MessageType, title: string, message: string, txids?: string[]) => {
    setMessageModal({ show: true, type, title, message, txids });
  }, []);

  const closeMessage = useCallback(() => {
    setMessageModal((prev) => ({ ...prev, show: false }));
  }, []);

  // Set initial selected address
  useEffect(() => {
    if (wallet && wallet.addresses.length > 0) {
      const storedPath = localStorage.getItem(STORAGE_KEYS.L3_SELECTED_ADDRESS_PATH);
      const addressFromPath = storedPath
        ? wallet.addresses.find(a => a.path === storedPath)?.address
        : wallet.addresses[0]?.address;
      const selectedAddr = addressFromPath || wallet.addresses[0]?.address;
      if (selectedAddr && selectedAddress !== selectedAddr) {
        setSelectedAddress(selectedAddr);
      }
    }
  }, [selectedAddress, wallet]);

  // Reset view mode when modal opens
  useEffect(() => {
    if (isOpen) {
      setViewMode("main");
    }
  }, [isOpen]);

  const onNewAddress = async () => {
    if (!wallet || isAnyAddressLoading) return;
    try {
      const addr = generateAddress(wallet);
      const updated = loadWalletFromStorage("main");
      if (updated) {
        invalidateWallet();
        setSelectedAddress(addr.address);
      }
    } catch {
      showMessage("error", "Error", "Failed to generate address");
    }
  };

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

  const handleSendFromModal = async (destination: string, amount: string) => {
    setPendingDestination(destination);
    setPendingAmount(amount);
    await onSendTransaction(destination, amount);
    setShowConfirmation(true);
  };

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
          errors.push(e instanceof Error ? e.message : String(e));
        }
      }
      setTxPlan(null);
      setShowConfirmation(false);
      if (errors.length > 0) {
        if (results.length > 0) {
          showMessage("warning", "Partial Success", `Some transactions failed:\n${errors.join("\n")}`, results.map(r => r.txid));
        } else {
          showMessage("error", "Transaction Failed", `Transaction failed:\n${errors.join("\n")}`);
        }
      } else {
        showMessage("success", "Transaction Sent", `Sent ${results.length} transaction(s)!`, results.map(r => r.txid));
      }
    } finally {
      setIsSending(false);
    }
  };

  const onSelectAddress = (address: string) => {
    const selectedAddr = wallet?.addresses.find(a => a.address === address);
    if (selectedAddr?.path) {
      localStorage.setItem(STORAGE_KEYS.L3_SELECTED_ADDRESS_PATH, selectedAddr.path);
    } else {
      localStorage.removeItem(STORAGE_KEYS.L3_SELECTED_ADDRESS_PATH);
    }
    window.location.reload();
  };

  const formatBalance = (bal: number) => {
    return bal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 8 });
  };

  const selectedPrivateKey = wallet?.addresses.find(a => a.address === selectedAddress)?.privateKey ?? "";

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 z-50 flex items-center justify-center p-2"
        >
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm rounded-2xl"
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: "spring", duration: 0.5 }}
            className="relative w-[94%] max-h-[92%] bg-white dark:bg-neutral-900 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-neutral-200 dark:border-neutral-800">
              <div className="flex items-center gap-3">
                {viewMode === "history" && (
                  <button
                    onClick={() => setViewMode("main")}
                    className="p-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                  >
                    <ChevronLeft className="w-5 h-5 text-neutral-600 dark:text-neutral-400" />
                  </button>
                )}
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
                  <span className="text-white font-bold text-sm">L1</span>
                </div>
                <span className="text-lg font-semibold text-neutral-900 dark:text-white">
                  {viewMode === "history" ? "Transaction History" : "L1 Wallet"}
                </span>
              </div>
              <button
                onClick={onClose}
                className="p-2 rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
              >
                <X className="w-5 h-5 text-neutral-500" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
              {!connection.isConnected ? (
                <ConnectionStatus
                  state={connection.state}
                  message={connection.message}
                  error={connection.error}
                  onRetry={connection.manualConnect}
                  onCancel={connection.cancelConnect}
                />
              ) : isLoadingWallet ? (
                <div className="flex items-center justify-center h-64">
                  <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                </div>
              ) : !wallet ? (
                <div className="flex items-center justify-center h-64 text-neutral-500">
                  No wallet found
                </div>
              ) : viewMode === "history" ? (
                <HistoryView
                  wallet={wallet}
                  selectedAddress={selectedAddress}
                  transactions={transactions}
                  loadingTransactions={isLoadingTransactions}
                  currentBlockHeight={currentBlockHeight}
                  transactionDetails={transactionDetails}
                  analyzeTransaction={analyzeTransaction}
                  onBackToMain={() => setViewMode("main")}
                  hideBackButton
                />
              ) : (
                <div className="p-4 space-y-4">
                  {/* Balance */}
                  <div className="text-center py-4">
                    <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-1">Total Balance</p>
                    <h2 className="text-3xl font-bold text-neutral-900 dark:text-white">
                      {showBalances ? `${formatBalance(totalBalance)} ALPHA` : '••••••'}
                    </h2>
                  </div>

                  {/* Vesting Display */}
                  <VestingDisplay
                    showBalances={showBalances}
                    balances={vestingBalances}
                    isClassifying={isClassifyingVesting}
                  />

                  {/* Active Address */}
                  <div className="bg-neutral-100 dark:bg-neutral-800/50 rounded-xl p-3">
                    <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-2 flex items-center gap-1.5">
                      {isAnyAddressLoading && <Loader2 className="w-3 h-3 animate-spin" />}
                      {isAnyAddressLoading ? 'Checking nametags...' : 'Active Address'}
                    </p>
                    <div className="relative">
                      <button
                        onClick={() => setShowDropdown(prev => !prev)}
                        className="w-full flex items-center justify-between gap-2 p-2 bg-white dark:bg-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-700/50 transition-colors"
                      >
                        {(() => {
                          const currentNametagInfo = nametagState[selectedAddress];
                          if (!currentNametagInfo || currentNametagInfo.ipnsLoading) {
                            return (
                              <span className="flex items-center gap-2 text-xs">
                                <Loader2 className="w-3 h-3 animate-spin text-neutral-400" />
                                <span className="font-mono text-neutral-700 dark:text-neutral-300 truncate">
                                  {selectedAddress.slice(0, 16)}...{selectedAddress.slice(-8)}
                                </span>
                              </span>
                            );
                          }
                          if (currentNametagInfo.nametag) {
                            return (
                              <span className="flex items-center gap-2 text-xs">
                                <span className="font-mono text-neutral-700 dark:text-neutral-300">
                                  {selectedAddress.slice(0, 12)}...{selectedAddress.slice(-6)}
                                </span>
                                <span className="font-medium text-blue-600 dark:text-blue-400">@{currentNametagInfo.nametag}</span>
                              </span>
                            );
                          }
                          return (
                            <span className="text-xs font-mono text-neutral-700 dark:text-neutral-300 truncate">
                              {selectedAddress.slice(0, 16)}...{selectedAddress.slice(-8)}
                            </span>
                          );
                        })()}
                        <ChevronDown className={`w-4 h-4 text-neutral-500 transition-transform shrink-0 ${showDropdown ? 'rotate-180' : ''}`} />
                      </button>

                      <AnimatePresence>
                        {showDropdown && (
                          <>
                            <motion.div
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              exit={{ opacity: 0 }}
                              className="fixed inset-0 z-10"
                              onClick={() => setShowDropdown(false)}
                            />
                            <motion.div
                              initial={{ opacity: 0, y: -10 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -10 }}
                              className="absolute z-20 mt-2 w-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl shadow-xl max-h-40 overflow-y-auto"
                            >
                              {addresses.map(addr => {
                                const nametagInfo = nametagState[addr];
                                const isSelected = addr === selectedAddress;
                                const walletAddrInfo = wallet?.addresses.find(a => a.address === addr);
                                const isChange = walletAddrInfo?.isChange;
                                return (
                                  <button
                                    key={addr}
                                    onClick={() => {
                                      onSelectAddress(addr);
                                      setShowDropdown(false);
                                    }}
                                    className={`w-full flex items-center gap-2 px-3 py-2.5 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors ${isSelected ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
                                  >
                                    <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${isSelected ? 'bg-blue-500' : 'bg-transparent'}`} />
                                    <div className="flex-1 min-w-0">
                                      {!nametagInfo || nametagInfo.ipnsLoading ? (
                                        <span className="flex items-center gap-1.5">
                                          <Loader2 className="w-3 h-3 animate-spin text-neutral-400" />
                                          <span className="font-mono text-neutral-700 dark:text-neutral-300 truncate">{addr.slice(0, 12)}...{addr.slice(-6)}</span>
                                        </span>
                                      ) : nametagInfo.nametag ? (
                                        <span className="flex items-center gap-2">
                                          <span className="font-mono text-neutral-700 dark:text-neutral-300">{addr.slice(0, 12)}...{addr.slice(-6)}</span>
                                          <span className="text-blue-600 dark:text-blue-400 font-medium">@{nametagInfo.nametag}</span>
                                        </span>
                                      ) : nametagInfo.hasL3Inventory ? (
                                        <span className="flex items-center gap-1.5">
                                          <span className="font-mono text-neutral-700 dark:text-neutral-300 truncate">{addr.slice(0, 12)}...{addr.slice(-6)}</span>
                                          <span className="px-1 py-0.5 bg-purple-500/20 text-purple-600 dark:text-purple-400 text-[9px] font-bold rounded shrink-0">L3</span>
                                        </span>
                                      ) : (
                                        <span className="font-mono text-neutral-700 dark:text-neutral-300 truncate">{addr.slice(0, 12)}...{addr.slice(-6)}</span>
                                      )}
                                    </div>
                                    {isChange && (
                                      <span className="px-1.5 py-0.5 bg-amber-500/20 text-amber-600 dark:text-amber-400 text-[9px] font-bold rounded shrink-0">Change</span>
                                    )}
                                  </button>
                                );
                              })}
                            </motion.div>
                          </>
                        )}
                      </AnimatePresence>
                    </div>

                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                        {showBalances ? `${formatBalance(balance)} ALPHA` : '••••••'}
                      </span>
                      <div className="flex-1" />
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(selectedAddress);
                          setCopied(true);
                          setTimeout(() => setCopied(false), 2000);
                        }}
                        className={`p-1.5 rounded-lg transition-colors ${copied ? 'bg-green-500 text-white' : 'hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-500'}`}
                      >
                        {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      </button>
                      <button
                        onClick={onNewAddress}
                        disabled={isAnyAddressLoading}
                        className="p-1.5 rounded-lg hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        title={isAnyAddressLoading ? 'Wait for nametag check to complete' : 'Create new address'}
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                      <a
                        href={`https://www.unicity.network/address/${selectedAddress}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1.5 rounded-lg hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-500 transition-colors"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="space-y-2">
                    <button
                      onClick={() => setShowQR(true)}
                      className="w-full flex items-center gap-3 p-3 bg-neutral-100 dark:bg-neutral-800/50 hover:bg-neutral-200 dark:hover:bg-neutral-800 rounded-xl transition-colors"
                    >
                      <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                        <QrCode className="w-5 h-5 text-blue-500" />
                      </div>
                      <span className="font-medium text-neutral-900 dark:text-white">Receive (Show QR)</span>
                    </button>

                    <button
                      onClick={() => setShowSendModal(true)}
                      className="w-full flex items-center gap-3 p-3 bg-neutral-100 dark:bg-neutral-800/50 hover:bg-neutral-200 dark:hover:bg-neutral-800 rounded-xl transition-colors"
                    >
                      <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                        <Send className="w-5 h-5 text-green-500" />
                      </div>
                      <span className="font-medium text-neutral-900 dark:text-white">Send ALPHA</span>
                    </button>

                    <button
                      onClick={() => setViewMode("history")}
                      className="w-full flex items-center gap-3 p-3 bg-neutral-100 dark:bg-neutral-800/50 hover:bg-neutral-200 dark:hover:bg-neutral-800 rounded-xl transition-colors"
                    >
                      <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
                        <History className="w-5 h-5 text-purple-500" />
                      </div>
                      <span className="font-medium text-neutral-900 dark:text-white">Transaction History</span>
                    </button>

                    <button
                      onClick={() => setShowBridgeModal(true)}
                      className="w-full flex items-center gap-3 p-3 bg-neutral-100 dark:bg-neutral-800/50 hover:bg-neutral-200 dark:hover:bg-neutral-800 rounded-xl transition-colors"
                    >
                      <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500/10 to-blue-500/10 flex items-center justify-center">
                        <ArrowRightLeft className="w-5 h-5 text-purple-500" />
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-neutral-900 dark:text-white">Bridge to L3</span>
                        <span className="text-xs text-neutral-500 bg-neutral-200 dark:bg-neutral-700 px-1.5 py-0.5 rounded">(Demo)</span>
                      </div>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Nested Modals */}
            <QRModal
              show={showQR}
              address={selectedAddress}
              onClose={() => setShowQR(false)}
            />

            <SendModal
              show={showSendModal}
              selectedAddress={selectedAddress}
              onClose={() => setShowSendModal(false)}
              onSend={handleSendFromModal}
            />

            <TransactionConfirmationModal
              show={showConfirmation}
              txPlan={txPlan}
              destination={pendingDestination}
              amount={pendingAmount}
              isSending={isSending}
              onConfirm={onConfirmSend}
              onCancel={() => setShowConfirmation(false)}
            />

            <BridgeModal
              show={showBridgeModal}
              address={selectedAddress}
              privateKey={selectedPrivateKey}
              onClose={() => setShowBridgeModal(false)}
            />

            <MessageModal
              show={messageModal.show}
              type={messageModal.type}
              title={messageModal.title}
              message={messageModal.message}
              txids={messageModal.txids}
              onClose={closeMessage}
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
