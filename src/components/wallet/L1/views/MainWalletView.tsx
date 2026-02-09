import { useState, useEffect } from "react";
import {
  ArrowDownLeft,
  Send,
  Trash2,
  Copy,
  Download,
  History,
  ExternalLink,
  Check,
  ArrowRightLeft,
  Plus,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { TransactionPlan, VestingBalances } from "../sdk";
import {
  QRModal,
  SaveWalletModal,
  DeleteConfirmationModal,
  TransactionConfirmationModal,
  BridgeModal,
  SendModal,
} from "../components/modals";
import { VestingDisplay } from "../components/VestingDisplay";
import { AddressSelector } from "../../shared/components/AddressSelector";
import { CreateAddressModal } from "../../shared/modals/CreateAddressModal";

// Animated balance display component
function AnimatedBalance({ value, show }: { value: number; show: boolean }) {
  const [displayValue, setDisplayValue] = useState(value);
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    if (value === displayValue) return;

    setIsAnimating(true);
    const startValue = displayValue;
    const endValue = value;
    const duration = 600;
    const startTime = Date.now();

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Easing function for smooth animation
      const easeOutExpo = 1 - Math.pow(2, -10 * progress);

      const currentValue = startValue + (endValue - startValue) * easeOutExpo;
      setDisplayValue(Math.round(currentValue * 100) / 100);

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        setDisplayValue(endValue);
        setIsAnimating(false);
      }
    };

    requestAnimationFrame(animate);
  }, [value, displayValue]);

  if (!show) {
    return <span>••••••</span>;
  }

  return (
    <span className={isAnimating ? "transition-opacity" : ""}>
      {displayValue} ALPHA
    </span>
  );
}

interface MainWalletViewProps {
  selectedAddress: string;
  selectedPrivateKey: string;
  addresses: string[];
  balance: number;
  totalBalance: number;
  showBalances: boolean;
  onShowHistory: () => void;
  onSaveWallet: (filename: string, password?: string) => void;
  /** Whether mnemonic is available for export */
  hasMnemonic?: boolean;
  onDeleteWallet: () => void;
  onSendTransaction: (destination: string, amount: string) => Promise<void>;
  txPlan: TransactionPlan | null;
  isSending: boolean;
  onConfirmSend: () => Promise<void>;
  vestingBalances?: VestingBalances;
}

export function MainWalletView({
  selectedAddress,
  selectedPrivateKey,
  addresses,
  balance,
  totalBalance,
  showBalances,
  onShowHistory,
  onSaveWallet,
  hasMnemonic,
  onDeleteWallet,
  onSendTransaction,
  txPlan,
  isSending,
  onConfirmSend,
  vestingBalances,
}: MainWalletViewProps) {
  const [showQR, setShowQR] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showSendModal, setShowSendModal] = useState(false);
  const [showBridgeModal, setShowBridgeModal] = useState(false);
  const [showCreateAddressModal, setShowCreateAddressModal] = useState(false);
  const [pendingDestination, setPendingDestination] = useState("");
  const [pendingAmount, setPendingAmount] = useState("");

  const handleSendFromModal = async (destination: string, amount: string) => {
    setPendingDestination(destination);
    setPendingAmount(amount);
    await onSendTransaction(destination, amount);
    setShowConfirmation(true);
  };

  const handleConfirmSend = async () => {
    await onConfirmSend();
    setShowConfirmation(false);
  };

  const handleSave = (filename: string, password?: string) => {
    onSaveWallet(filename, password);
    setShowSaveModal(false);
  };

  const handleDelete = () => {
    onDeleteWallet();
    setShowDeleteModal(false);
  };

  return (
    <div className="flex flex-col h-full relative overflow-y-auto">
      <TransactionConfirmationModal
        show={showConfirmation}
        txPlan={txPlan}
        destination={pendingDestination}
        amount={pendingAmount}
        isSending={isSending}
        onConfirm={handleConfirmSend}
        onCancel={() => setShowConfirmation(false)}
      />

      <QRModal
        show={showQR}
        address={selectedAddress}
        onClose={() => setShowQR(false)}
      />

      {/* Address Selector - uses shared component with nametag modal */}
      <div className="px-3 sm:px-4 lg:px-6 mb-2 sm:mb-3">
        <div className="flex items-center gap-1.5 sm:gap-2">
          <div className="flex-1 bg-neutral-100 dark:bg-neutral-800 px-2 sm:px-3 py-1.5 sm:py-2 rounded-lg border border-neutral-200 dark:border-neutral-700">
            <AddressSelector compact={false} addressFormat="l1" />
          </div>

          <button
            onClick={() => setShowCreateAddressModal(true)}
            className="p-1.5 sm:p-2 rounded-lg bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-600 dark:text-neutral-300 transition-colors"
            title="Generate new address"
          >
            <Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          </button>

          <button
            onClick={() => {
              navigator.clipboard.writeText(selectedAddress);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            className={`p-1.5 sm:p-2 rounded-lg border transition-colors ${
              copied
                ? "bg-green-600 border-green-500 text-white"
                : "bg-neutral-100 dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-600 dark:text-neutral-300"
            }`}
            title={copied ? "Copied!" : "Copy address"}
          >
            {copied ? <Check className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> : <Copy className="w-3.5 h-3.5 sm:w-4 sm:h-4" />}
          </button>

          <a
            href={`https://www.unicity.network/address/${selectedAddress}`}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 sm:p-2 rounded-lg bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-600 dark:text-neutral-300 transition-colors"
            title="View in explorer"
          >
            <ExternalLink className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          </a>
        </div>
      </div>

      {/* Balance */}
      <div className="px-3 sm:px-4 lg:px-6 mb-2 sm:mb-3">
        <div className="flex items-center gap-2 mb-0.5 sm:mb-1">
          <p className="text-[10px] sm:text-xs text-blue-500/70 dark:text-blue-300/70">Mainnet Balance</p>
          <span className="flex h-1.5 w-1.5 sm:h-2 sm:w-2 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 sm:h-2 sm:w-2 bg-green-500"></span>
          </span>
        </div>

        <AnimatePresence mode="wait">
          <motion.h2
            key={selectedAddress}
            initial={{ opacity: 0, y: -20, filter: "blur(10px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: 20, filter: "blur(10px)" }}
            transition={{ type: "spring", duration: 0.6, bounce: 0.2 }}
            className="text-2xl sm:text-3xl text-neutral-900 dark:text-white font-bold tracking-tight"
          >
            <AnimatedBalance value={balance} show={showBalances} />
          </motion.h2>
        </AnimatePresence>

        {/* Total balance across all addresses */}
        {addresses.length > 1 && (
          <p className="text-[10px] sm:text-xs text-neutral-500 dark:text-neutral-400 mt-1">
            Total ({addresses.length} addresses):{" "}
            <span className="font-medium text-neutral-700 dark:text-neutral-300">
              {showBalances ? `${totalBalance} ALPHA` : "••••••"}
            </span>
          </p>
        )}
      </div>

      {/* Vesting Display */}
      <div className="px-3 sm:px-4 lg:px-6 mb-2 sm:mb-3">
        <VestingDisplay
          showBalances={showBalances}
          balances={vestingBalances}
        />
      </div>

      {/* Action Buttons */}
      <div className="px-3 sm:px-4 lg:px-6 mb-2 sm:mb-3">
        <div className="grid grid-cols-2 gap-2 sm:gap-3">
          <motion.button
            onClick={() => setShowQR(true)}
            whileHover={{ scale: 1.02, y: -2 }}
            whileTap={{ scale: 0.98 }}
            className="relative px-3 sm:px-4 py-2 sm:py-2.5 rounded-lg sm:rounded-xl bg-linear-to-br from-blue-500 to-blue-600 text-white text-xs sm:text-sm shadow-xl shadow-blue-500/20 flex items-center justify-center gap-1.5 sm:gap-2 overflow-hidden group"
          >
            <div className="absolute inset-0 bg-linear-to-r from-transparent via-white/10 to-transparent translate-x-[-200%] group-hover:translate-x-[200%] transition-transform duration-1000" />
            <ArrowDownLeft className="w-3.5 h-3.5 sm:w-4 sm:h-4 relative z-10" />
            <span className="relative z-10">Receive</span>
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.02, y: -2 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setShowSendModal(true)}
            className="relative px-3 sm:px-4 py-2 sm:py-2.5 rounded-lg sm:rounded-xl bg-linear-to-br from-green-600 to-green-700 text-white text-xs sm:text-sm shadow-xl shadow-green-500/20 flex items-center justify-center gap-1.5 sm:gap-2 overflow-hidden group"
          >
            <div className="absolute inset-0 bg-linear-to-r from-transparent via-white/10 to-transparent translate-x-[-200%] group-hover:translate-x-[200%] transition-transform duration-1000" />
            <Send className="w-3.5 h-3.5 sm:w-4 sm:h-4 relative z-10" />
            <span className="relative z-10">Send</span>
          </motion.button>
        </div>
      </div>

      {/* Bridge Button */}
      <div className="px-3 sm:px-4 lg:px-6 mb-2 sm:mb-3">
        <motion.button
          onClick={() => setShowBridgeModal(true)}
          whileHover={{ scale: 1.01, y: -1 }}
          whileTap={{ scale: 0.99 }}
          className="w-full relative px-3 sm:px-4 py-2 sm:py-2.5 rounded-lg sm:rounded-xl bg-linear-to-r from-purple-600/80 to-blue-600/80 text-white text-xs sm:text-sm border border-purple-500/30 flex items-center justify-center gap-1.5 sm:gap-2 overflow-hidden group hover:from-purple-500/80 hover:to-blue-500/80 transition-all"
        >
          <div className="absolute inset-0 bg-linear-to-r from-transparent via-white/5 to-transparent translate-x-[-200%] group-hover:translate-x-[200%] transition-transform duration-1000" />
          <ArrowRightLeft className="w-3.5 h-3.5 sm:w-4 sm:h-4 relative z-10" />
          <span className="relative z-10 font-medium">Bridge to L3</span>
          <span className="relative z-10 text-[10px] sm:text-xs text-purple-200/70 ml-1">(Demo)</span>
        </motion.button>
        <p className="text-[10px] sm:text-xs text-neutral-500 text-center mt-1">
          Clone L1 ALPHA tokens to L3 ALPHT for testing
        </p>
      </div>

      {/* Transaction History Button */}
      <div className="px-3 sm:px-4 lg:px-6 mb-2 sm:mb-3">
        <motion.button
          onClick={onShowHistory}
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.99 }}
          className="w-full px-3 sm:px-4 py-2 sm:py-2.5 rounded-lg sm:rounded-xl bg-neutral-100/50 dark:bg-neutral-800/50 text-neutral-600 dark:text-neutral-300 text-xs sm:text-sm border border-neutral-200/50 dark:border-neutral-700/50 flex items-center justify-center gap-1.5 sm:gap-2 hover:bg-neutral-200 dark:hover:bg-neutral-800 hover:text-neutral-900 dark:hover:text-white transition-colors"
        >
          <History className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          Transaction History
        </motion.button>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="mt-auto px-3 sm:px-4 lg:px-6 pb-3 sm:pb-4 lg:pb-6 pt-2 sm:pt-3 flex items-center justify-between border-t border-neutral-200/50 dark:border-neutral-800/50"
      >
        <motion.button
          whileHover={{ scale: 1.05, x: 2 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setShowSaveModal(true)}
          className="flex items-center gap-1.5 sm:gap-2 text-[10px] sm:text-xs text-neutral-500 hover:text-blue-400 transition-colors group"
        >
          <motion.div
            whileHover={{ y: -1 }}
            transition={{ type: "spring", stiffness: 300 }}
          >
            <Download className="w-3 h-3 group-hover:drop-shadow-[0_0_4px_rgba(59,130,246,0.5)]" />
          </motion.div>
          <span className="font-medium">Backup Wallet</span>
        </motion.button>

        <motion.button
          whileHover={{ scale: 1.05, x: -2 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setShowDeleteModal(true)}
          className="flex items-center gap-1.5 sm:gap-2 text-[10px] sm:text-xs text-neutral-500 hover:text-red-400 transition-colors group"
        >
          <motion.div
            whileHover={{ rotate: [0, -10, 10, -10, 0] }}
            transition={{ duration: 0.5 }}
          >
            <Trash2 className="w-3 h-3 group-hover:drop-shadow-[0_0_4px_rgba(239,68,68,0.5)]" />
          </motion.div>
          <span className="font-medium">Delete Wallet</span>
        </motion.button>
      </motion.div>

      <SaveWalletModal
        show={showSaveModal}
        onConfirm={handleSave}
        onCancel={() => setShowSaveModal(false)}
        hasMnemonic={hasMnemonic}
      />

      <DeleteConfirmationModal
        show={showDeleteModal}
        onConfirmDelete={handleDelete}
        onSaveFirst={() => {
          setShowDeleteModal(false);
          setShowSaveModal(true);
        }}
        onCancel={() => setShowDeleteModal(false)}
      />

      <BridgeModal
        show={showBridgeModal}
        address={selectedAddress}
        privateKey={selectedPrivateKey}
        onClose={() => setShowBridgeModal(false)}
      />

      <SendModal
        show={showSendModal}
        selectedAddress={selectedAddress}
        onClose={() => setShowSendModal(false)}
        onSend={handleSendFromModal}
        vestingBalances={vestingBalances}
      />

      <CreateAddressModal
        isOpen={showCreateAddressModal}
        onClose={() => setShowCreateAddressModal(false)}
      />
    </div>
  );
}
