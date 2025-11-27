import { useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Send,
  Trash2,
  Copy,
  ChevronDown,
  Download,
  History,
} from "lucide-react";
import { motion } from "framer-motion";
import type { Wallet, TransactionPlan } from "../../l1/sdk";
import {
  QRModal,
  SaveWalletModal,
  DeleteConfirmationModal,
  TransactionConfirmationModal,
} from "../../components/l1-modals";

interface MainWalletViewProps {
  wallet: Wallet;
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
  onCancelSend: () => void;
}

export function MainWalletView({
  wallet,
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
  onCancelSend,
}: MainWalletViewProps) {
  const [showQR, setShowQR] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("");
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

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
    <div className="flex flex-col h-full relative">
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

      <div className="px-6 mb-6">
        <p className="text-xs text-blue-300/70 mb-1">Mainnet Balance</p>

        <h2 className="text-3xl text-white font-bold tracking-tight mb-4">
          {showBalances ? `${balance} ALPHA` : "••••••"}
        </h2>

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
            onClick={onNewAddress}
            whileHover={{ scale: 1.02, y: -2 }}
            className="px-4 py-3 rounded-xl bg-neutral-800 text-white text-sm border border-neutral-700 flex items-center justify-center gap-2"
          >
            <ArrowUpRight className="w-4 h-4" />
            New Address
          </motion.button>
        </div>

        <motion.button
          onClick={onShowHistory}
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.99 }}
          className="w-full mb-4 px-4 py-3 rounded-xl bg-neutral-800/50 text-white text-sm border border-neutral-700/50 flex items-center justify-center gap-2 hover:bg-neutral-800"
        >
          <History className="w-4 h-4" />
          Transaction History
        </motion.button>

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
                    onSelectAddress(a);
                    setShowDropdown(false);
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

      <div className="mt-auto px-6 pb-6 pt-4 flex items-center justify-between border-t border-neutral-800/50">
        <button
          onClick={() => setShowSaveModal(true)}
          className="flex items-center gap-2 text-xs text-neutral-500 hover:text-white transition-colors"
        >
          <Download className="w-3 h-3" />
          Backup Wallet
        </button>

        <button
          onClick={() => setShowDeleteModal(true)}
          className="flex items-center gap-2 text-xs text-neutral-500 hover:text-red-400 transition-colors"
        >
          <Trash2 className="w-3 h-3" />
          Delete Wallet
        </button>
      </div>

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
