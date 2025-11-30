import { useState, useEffect } from "react";
import {
  ArrowDownLeft,
  Send,
  Trash2,
  Copy,
  ChevronDown,
  Download,
  History,
  ExternalLink,
  Check,
  Plus,
  X,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { TransactionPlan, VestingMode, VestingBalances } from "../sdk";
import { vestingState } from "../sdk/vestingState";
import {
  QRModal,
  SaveWalletModal,
  DeleteConfirmationModal,
  TransactionConfirmationModal,
} from "../components/modals";
import { VestingSelector } from "../components/VestingSelector";

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
  addresses: string[];
  balance: number;
  showBalances: boolean;
  onNewAddress: () => void;
  onSelectAddress: (address: string) => void;
  onShowHistory: () => void;
  onSaveWallet: (filename: string, password?: string) => void;
  onDeleteWallet: () => void;
  onSendTransaction: (destination: string, amount: string) => Promise<void>;
  txPlan: TransactionPlan | null;
  isSending: boolean;
  onConfirmSend: () => Promise<void>;
  vestingProgress?: { current: number; total: number } | null;
  onVestingModeChange?: (mode: VestingMode) => void;
  vestingBalances?: VestingBalances;
}

export function MainWalletView({
  selectedAddress,
  addresses,
  balance,
  showBalances,
  onNewAddress,
  onSelectAddress,
  onShowHistory,
  onSaveWallet,
  onDeleteWallet,
  onSendTransaction,
  txPlan,
  isSending,
  onConfirmSend,
  vestingProgress,
  onVestingModeChange,
  vestingBalances,
}: MainWalletViewProps) {
  const [showQR, setShowQR] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("");
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showSendForm, setShowSendForm] = useState(false);

  const handleSend = async () => {
    await onSendTransaction(destination, amount);
    setShowConfirmation(true);
  };

  const handleConfirmSend = async () => {
    await onConfirmSend();
    setShowConfirmation(false);
    setDestination("");
    setAmount("");
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
        destination={destination}
        amount={amount}
        isSending={isSending}
        onConfirm={handleConfirmSend}
        onCancel={() => setShowConfirmation(false)}
      />

      <QRModal
        show={showQR}
        address={selectedAddress}
        onClose={() => setShowQR(false)}
      />

      {/* Address Selector */}
      <div className="px-6 mb-4">
        <div className="relative">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowDropdown((prev) => !prev)}
              className="flex-1 bg-neutral-800 text-neutral-200 px-3 py-2 rounded-lg border border-neutral-700 flex items-center justify-between hover:bg-neutral-700/50 transition-colors"
            >
              <span className="font-mono text-sm">
                {selectedAddress.slice(0, 12) + "..." + selectedAddress.slice(-8)}
              </span>
              <ChevronDown className={`w-4 h-4 text-neutral-400 transition-transform ${showDropdown ? "rotate-180" : ""}`} />
            </button>

            <motion.button
              onClick={onNewAddress}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="p-2 rounded-lg bg-neutral-800 border border-neutral-700 hover:bg-neutral-700 text-neutral-300"
              title="Generate new address"
            >
              <Plus className="w-4 h-4" />
            </motion.button>

            <button
              onClick={() => {
                navigator.clipboard.writeText(selectedAddress);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className={`p-2 rounded-lg border transition-colors ${
                copied
                  ? "bg-green-600 border-green-500 text-white"
                  : "bg-neutral-800 border-neutral-700 hover:bg-neutral-700 text-neutral-300"
              }`}
              title={copied ? "Copied!" : "Copy address"}
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </button>

            <a
              href={`https://www.unicity.network/address/${selectedAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 rounded-lg bg-neutral-800 border border-neutral-700 hover:bg-neutral-700 text-neutral-300"
              title="View in explorer"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
          </div>

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
                  initial={{ opacity: 0, y: -10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -10, scale: 0.95 }}
                  transition={{ duration: 0.2 }}
                  className="absolute z-20 mt-2 w-full bg-neutral-900 border border-neutral-700 rounded-xl shadow-xl max-h-52 overflow-y-auto custom-scrollbar"
                >
                  {addresses.map((a) => (
                    <div
                      key={a}
                      className={`flex items-center gap-2 px-3 py-2 hover:bg-neutral-800 transition-colors cursor-pointer ${
                        a === selectedAddress ? "bg-neutral-800/50" : ""
                      }`}
                      onClick={() => {
                        onSelectAddress(a);
                        setShowDropdown(false);
                      }}
                    >
                      <span className="flex-1 text-left text-xs text-neutral-200 font-mono truncate">
                        {a}
                      </span>
                      <a
                        href={`https://www.unicity.network/address/${a}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1 text-blue-400 hover:text-blue-300 transition-colors"
                        title="View in explorer"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  ))}
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Balance */}
      <div className="px-6 mb-4">
        <div className="flex items-center gap-2 mb-1">
          <p className="text-xs text-blue-300/70">Mainnet Balance</p>
          <span className="flex h-2 w-2 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
          </span>
        </div>

        <AnimatePresence mode="wait">
          <motion.h2
            key={selectedAddress}
            initial={{ opacity: 0, y: -20, filter: "blur(10px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: 20, filter: "blur(10px)" }}
            transition={{ type: "spring", duration: 0.6, bounce: 0.2 }}
            className="text-3xl text-white font-bold tracking-tight"
          >
            <AnimatedBalance value={balance} show={showBalances} />
          </motion.h2>
        </AnimatePresence>
      </div>

      {/* Vesting Selector */}
      <div className="px-6 mb-4">
        <VestingSelector
          address={selectedAddress}
          onModeChange={onVestingModeChange}
          classificationProgress={vestingProgress}
          showBalances={showBalances}
          balances={vestingBalances}
        />
      </div>

      {/* Action Buttons */}
      <div className="px-6 mb-4">
        <div className="grid grid-cols-2 gap-3">
          <motion.button
            onClick={() => setShowQR(true)}
            whileHover={{ scale: 1.02, y: -2 }}
            whileTap={{ scale: 0.98 }}
            className="relative px-4 py-3 rounded-xl bg-linear-to-br from-blue-500 to-blue-600 text-white text-sm shadow-xl shadow-blue-500/20 flex items-center justify-center gap-2 overflow-hidden group"
          >
            <div className="absolute inset-0 bg-linear-to-r from-transparent via-white/10 to-transparent translate-x-[-200%] group-hover:translate-x-[200%] transition-transform duration-1000" />
            <ArrowDownLeft className="w-4 h-4 relative z-10" />
            <span className="relative z-10">Receive</span>
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.02, y: -2 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setShowSendForm(!showSendForm)}
            className="relative px-4 py-3 rounded-xl bg-linear-to-br from-green-600 to-green-700 text-white text-sm shadow-xl shadow-green-500/20 flex items-center justify-center gap-2 overflow-hidden group"
          >
            <div className="absolute inset-0 bg-linear-to-r from-transparent via-white/10 to-transparent translate-x-[-200%] group-hover:translate-x-[200%] transition-transform duration-1000" />
            {showSendForm ? <X className="w-4 h-4 relative z-10" /> : <Send className="w-4 h-4 relative z-10" />}
            <span className="relative z-10">{showSendForm ? "Cancel" : "Send"}</span>
          </motion.button>
        </div>
      </div>

      {/* Send Form */}
      <AnimatePresence mode="wait">
        {showSendForm ? (
          <motion.div
            key="send-form"
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            transition={{ type: "spring", duration: 0.3, bounce: 0.1 }}
            className="px-6 mb-4"
          >
            <div className="flex flex-col gap-3 bg-neutral-900/50 p-4 rounded-xl border border-neutral-800/50 backdrop-blur-sm">
              <div className="relative">
                <input
                  placeholder="Destination Address"
                  className="w-full px-3 py-2 bg-neutral-800/50 rounded-lg text-neutral-200 border border-neutral-700/50 focus:border-green-500 focus:bg-neutral-800 outline-none transition-all"
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                />
              </div>

              <div className="relative">
                <input
                  placeholder="Amount (ALPHA)"
                  type="number"
                  step="any"
                  className="w-full px-3 py-2 pr-32 bg-neutral-800/50 rounded-lg text-neutral-200 border border-neutral-700/50 focus:border-green-500 focus:bg-neutral-800 outline-none transition-all"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      const filteredBalance = Number(vestingState.getBalance(selectedAddress)) / 1e8;
                      setAmount(String(Math.floor(filteredBalance * 0.25 * 1e8) / 1e8));
                    }}
                    className="px-2 py-1 text-[10px] font-medium bg-neutral-700 hover:bg-neutral-600 text-neutral-300 rounded transition-colors"
                  >
                    25%
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const filteredBalance = Number(vestingState.getBalance(selectedAddress)) / 1e8;
                      setAmount(String(Math.floor(filteredBalance * 0.5 * 1e8) / 1e8));
                    }}
                    className="px-2 py-1 text-[10px] font-medium bg-neutral-700 hover:bg-neutral-600 text-neutral-300 rounded transition-colors"
                  >
                    50%
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const filteredBalance = Number(vestingState.getBalance(selectedAddress)) / 1e8;
                      setAmount(String(filteredBalance));
                    }}
                    className="px-2 py-1 text-[10px] font-medium bg-green-600 hover:bg-green-500 text-white rounded transition-colors"
                  >
                    MAX
                  </button>
                </div>
              </div>

              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleSend}
                className="px-4 py-3 bg-linear-to-br from-green-500 to-green-600 rounded-xl text-white font-semibold flex items-center justify-center gap-2 shadow-lg shadow-green-500/20 hover:shadow-green-500/30 transition-shadow"
              >
                <Send className="w-4 h-4" /> Send Transaction
              </motion.button>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="history-button"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ type: "spring", duration: 0.3, bounce: 0.1 }}
            className="px-6 mb-4"
          >
            <motion.button
              onClick={onShowHistory}
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
              className="w-full px-4 py-2.5 rounded-xl bg-neutral-800/50 text-neutral-300 text-sm border border-neutral-700/50 flex items-center justify-center gap-2 hover:bg-neutral-800 hover:text-white transition-colors"
            >
              <History className="w-4 h-4" />
              Transaction History
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="mt-auto px-6 pb-6 pt-4 flex items-center justify-between border-t border-neutral-800/50"
      >
        <motion.button
          whileHover={{ scale: 1.05, x: 2 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setShowSaveModal(true)}
          className="flex items-center gap-2 text-xs text-neutral-500 hover:text-blue-400 transition-colors group"
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
          className="flex items-center gap-2 text-xs text-neutral-500 hover:text-red-400 transition-colors group"
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
    </div>
  );
}
