import { useEffect, useState, useCallback, useMemo } from "react";
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
  ArrowUpRight,
  ArrowDownLeft,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { useIdentity, useL1Balance, useL1Send } from "../../../../sdk";
import { useSphereContext } from "../../../../sdk/hooks/core/useSphere";
import { useL1Transactions, type L1Transaction } from "../../../../sdk/hooks/l1/useL1Transactions";
import { SPHERE_KEYS } from "../../../../sdk/queryKeys";
import { VestingDisplay } from "../components/VestingDisplay";
import {
  QRModal,
  SendModal,
} from "../components/modals";
import { MessageModal, type MessageType } from "../components/modals/MessageModal";
import { BaseModal, MenuButton } from "../../ui";

interface L1WalletModalProps {
  isOpen: boolean;
  onClose: () => void;
  showBalances: boolean;
}

type ViewMode = "main" | "history";

interface DerivedAddr {
  index: number;
  l1Address: string;
  nametag?: string;
}

export function L1WalletModal({ isOpen, onClose, showBalances }: L1WalletModalProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("main");
  const [showDropdown, setShowDropdown] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [showSendModal, setShowSendModal] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);
  const [addresses, setAddresses] = useState<DerivedAddr[]>([]);
  const [messageModal, setMessageModal] = useState<{
    show: boolean;
    type: MessageType;
    title: string;
    message: string;
    txids?: string[];
  }>({ show: false, type: "info", title: "", message: "" });

  const { sphere } = useSphereContext();
  const { l1Address, nametag } = useIdentity();
  const { balance: l1BalanceData, isLoading: isLoadingBalance } = useL1Balance();
  const { send: l1Send } = useL1Send();
  const { transactions, isLoading: isLoadingTx } = useL1Transactions();
  const queryClient = useQueryClient();

  const selectedAddress = l1Address ?? "";
  const currentAddressIndex = sphere?.getCurrentAddressIndex() ?? 0;

  // Balance values
  const balance = l1BalanceData ? Number(l1BalanceData.total) / 1e8 : 0;
  const totalBalance = balance;
  const vestingBalances = l1BalanceData ? {
    vested: BigInt(l1BalanceData.vested),
    unvested: BigInt(l1BalanceData.unvested),
    all: BigInt(l1BalanceData.total),
  } : { vested: 0n, unvested: 0n, all: 0n };

  // Derive addresses
  useEffect(() => {
    if (!sphere) return;
    try {
      const count = Math.max(3, currentAddressIndex + 1);
      const derived = sphere.deriveAddresses(count);
      setAddresses(derived.map((addr) => ({
        index: addr.index,
        l1Address: addr.address,
        nametag: addr.index === currentAddressIndex ? (sphere.identity?.nametag ?? undefined) : undefined,
      })));
    } catch (e) {
      console.error("[L1WalletModal] Failed to derive addresses:", e);
    }
  }, [sphere, currentAddressIndex]);

  // Reset view when modal opens
  useEffect(() => {
    if (isOpen) setViewMode("main");
  }, [isOpen]);

  const showMessage = useCallback((type: MessageType, title: string, message: string, txids?: string[]) => {
    setMessageModal({ show: true, type, title, message, txids });
  }, []);

  const closeMessage = useCallback(() => {
    setMessageModal((prev) => ({ ...prev, show: false }));
  }, []);

  const handleSelectAddress = useCallback(async (index: number) => {
    if (!sphere || isSwitching || index === currentAddressIndex) {
      setShowDropdown(false);
      return;
    }
    setShowDropdown(false);
    setIsSwitching(true);
    try {
      await sphere.switchToAddress(index);
      queryClient.invalidateQueries({ queryKey: SPHERE_KEYS.identity.all });
      queryClient.invalidateQueries({ queryKey: SPHERE_KEYS.l1.all });
      queryClient.invalidateQueries({ queryKey: SPHERE_KEYS.payments.all });
      window.dispatchEvent(new Event("wallet-updated"));
    } catch (e) {
      console.error("[L1WalletModal] Failed to switch address:", e);
    } finally {
      setIsSwitching(false);
    }
  }, [sphere, isSwitching, currentAddressIndex, queryClient]);

  const handleDeriveNew = useCallback(() => {
    if (!sphere) return;
    setShowDropdown(false);
    try {
      const nextIndex = addresses.length;
      const newAddr = sphere.deriveAddress(nextIndex);
      setAddresses(prev => [...prev, { index: newAddr.index, l1Address: newAddr.address }]);
    } catch (e) {
      console.error("[L1WalletModal] Failed to derive new address:", e);
    }
  }, [sphere, addresses.length]);

  const handleSend = useCallback(async (destination: string, amount: string) => {
    const amountAlpha = Number(amount);
    if (isNaN(amountAlpha) || amountAlpha <= 0) {
      showMessage("error", "Invalid Amount", "Please enter a valid amount");
      return;
    }
    try {
      const amountSatoshis = Math.round(amountAlpha * 1e8).toString();
      const result = await l1Send({ toAddress: destination, amount: amountSatoshis });
      setShowSendModal(false);
      showMessage("success", "Transaction Sent", "Transaction sent successfully!", result.txHash ? [result.txHash] : undefined);
    } catch (err) {
      showMessage("error", "Transaction Failed", "Transaction failed: " + (err instanceof Error ? err.message : String(err)));
    }
  }, [l1Send, showMessage]);

  const formatBalance = (bal: number) => bal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 });

  const sortedAddresses = useMemo(() => [...addresses].sort((a, b) => a.index - b.index), [addresses]);

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} size="lg" showOrbs={false} className="max-h-[92%]">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-neutral-200 dark:border-neutral-800 shrink-0">
        <div className="flex items-center gap-3">
          {viewMode === "history" && (
            <button
              onClick={() => setViewMode("main")}
              className="p-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
            >
              <ChevronLeft className="w-5 h-5 text-neutral-600 dark:text-neutral-400" />
            </button>
          )}
          <div className="w-10 h-10 rounded-xl bg-linear-to-br from-blue-500 to-blue-600 flex items-center justify-center">
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
        {!sphere ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
          </div>
        ) : isLoadingBalance && !l1BalanceData ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
          </div>
        ) : viewMode === "history" ? (
          /* SDK-based history view */
          <div className="p-4 space-y-2">
            {isLoadingTx ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-neutral-400" />
              </div>
            ) : transactions.length === 0 ? (
              <div className="text-center py-12 text-neutral-500">No transactions found</div>
            ) : (
              transactions.map((tx: L1Transaction) => {
                const isIncoming = tx.type === "incoming";
                return (
                  <div key={tx.txid} className="flex items-center gap-3 p-3 bg-neutral-100 dark:bg-neutral-800/50 rounded-xl">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isIncoming ? "bg-green-500/20" : "bg-red-500/20"}`}>
                      {isIncoming ? (
                        <ArrowDownLeft className="w-4 h-4 text-green-500" />
                      ) : (
                        <ArrowUpRight className="w-4 h-4 text-red-500" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-neutral-900 dark:text-white">
                          {isIncoming ? "Received" : "Sent"}
                        </span>
                        <span className={`text-sm font-medium ${isIncoming ? "text-green-500" : "text-red-500"}`}>
                          {isIncoming ? "+" : "-"}{(Number(tx.amount) / 1e8).toFixed(8)} ALPHA
                        </span>
                      </div>
                      <div className="flex items-center justify-between mt-0.5">
                        <span className="text-xs font-mono text-neutral-500 truncate mr-2">
                          {tx.txid.slice(0, 12)}...{tx.txid.slice(-6)}
                        </span>
                        <span className="text-xs text-neutral-400 shrink-0">
                          {tx.confirmations > 0 ? `${tx.confirmations} conf` : "unconfirmed"}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        ) : (
          <div className="p-4 space-y-4">
            {/* Balance */}
            <div className="text-center py-4">
              <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-1">Total Balance</p>
              <h2 className="text-3xl font-bold text-neutral-900 dark:text-white">
                {showBalances ? `${formatBalance(totalBalance)} ALPHA` : "••••••"}
              </h2>
            </div>

            {/* Vesting Display */}
            <VestingDisplay
              showBalances={showBalances}
              balances={vestingBalances}
              isClassifying={false}
            />

            {/* Active Address */}
            <div className="bg-neutral-100 dark:bg-neutral-800/50 rounded-xl p-3">
              <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-2 flex items-center gap-1.5">
                {isSwitching && <Loader2 className="w-3 h-3 animate-spin" />}
                {isSwitching ? "Switching..." : "Active Address"}
              </p>
              <div className="relative">
                <button
                  onClick={() => setShowDropdown(prev => !prev)}
                  className="w-full flex items-center justify-between gap-2 p-2 bg-white dark:bg-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-700/50 transition-colors"
                >
                  <span className="flex items-center gap-2 text-xs">
                    <span className="font-mono text-neutral-700 dark:text-neutral-300 truncate">
                      {selectedAddress.slice(0, 16)}...{selectedAddress.slice(-8)}
                    </span>
                    {nametag && (
                      <span className="font-medium text-blue-600 dark:text-blue-400">@{nametag}</span>
                    )}
                  </span>
                  <ChevronDown className={`w-4 h-4 text-neutral-500 transition-transform shrink-0 ${showDropdown ? "rotate-180" : ""}`} />
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
                        {sortedAddresses.map(addr => {
                          const isSelected = addr.index === currentAddressIndex;
                          return (
                            <button
                              key={addr.index}
                              onClick={() => handleSelectAddress(addr.index)}
                              disabled={isSwitching}
                              className={`w-full flex items-center gap-2 px-3 py-2.5 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors disabled:opacity-50 ${isSelected ? "bg-blue-50 dark:bg-blue-900/20" : ""}`}
                            >
                              <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${isSelected ? "bg-blue-500" : "bg-transparent"}`} />
                              <div className="flex-1 min-w-0">
                                <span className="flex items-center gap-2">
                                  <span className="font-mono text-neutral-700 dark:text-neutral-300 truncate">
                                    {addr.l1Address.slice(0, 12)}...{addr.l1Address.slice(-6)}
                                  </span>
                                  {addr.nametag && (
                                    <span className="text-blue-600 dark:text-blue-400 font-medium">@{addr.nametag}</span>
                                  )}
                                </span>
                              </div>
                            </button>
                          );
                        })}

                        {/* New address button */}
                        <button
                          onClick={handleDeriveNew}
                          className="w-full flex items-center gap-2 px-3 py-2.5 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors border-t border-neutral-200 dark:border-neutral-700"
                        >
                          <Plus className="w-3 h-3 text-orange-500" />
                          <span className="text-orange-600 dark:text-orange-400 font-medium">New Address</span>
                        </button>
                      </motion.div>
                    </>
                  )}
                </AnimatePresence>
              </div>

              <div className="flex items-center gap-2 mt-2">
                <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                  {showBalances ? `${formatBalance(balance)} ALPHA` : "••••••"}
                </span>
                <div className="flex-1" />
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(selectedAddress);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className={`p-1.5 rounded-lg transition-colors ${copied ? "bg-green-500 text-white" : "hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-500"}`}
                >
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
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
              <MenuButton
                icon={QrCode}
                color="blue"
                label="Receive (Show QR)"
                showChevron={false}
                onClick={() => setShowQR(true)}
              />
              <MenuButton
                icon={Send}
                color="green"
                label="Send ALPHA"
                showChevron={false}
                onClick={() => setShowSendModal(true)}
              />
              <MenuButton
                icon={History}
                color="purple"
                label="Transaction History"
                showChevron={false}
                onClick={() => setViewMode("history")}
              />
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
        onSend={handleSend}
      />

      <MessageModal
        show={messageModal.show}
        type={messageModal.type}
        title={messageModal.title}
        message={messageModal.message}
        txids={messageModal.txids}
        onClose={closeMessage}
      />
    </BaseModal>
  );
}
