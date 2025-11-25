import { useEffect, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  QrCode,
  Send,
  Trash2,
  Copy,
  ChevronDown,
} from "lucide-react";
import { motion } from "framer-motion";

import {
  createWallet,
  loadWallet,
  deleteWallet,
  generateAddress,
  sendAlpha,
  connect,
  getBalance,
  subscribeBlocks,
} from "../sdk/l1/sdk";

export function L1WalletView({ showBalances }: { showBalances: boolean }) {
  const [wallet, setWallet] = useState<any>(null);
  const [addresses, setAddresses] = useState<string[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);

  const [selectedAddress, setSelectedAddress] = useState<string>("");

  const [balance, setBalance] = useState<number>(0);
  const [showQR, setShowQR] = useState(false);

  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("");

  // -------------------------------
  // INIT: connect to RPC + load wallet
  // -------------------------------
  useEffect(() => {
    (async () => {
      await connect(); // <-- Needed for RPC to work

      const w = loadWallet();
      if (!w) return;

      setWallet(w);

      const list = w.addresses.map((a: any) => a.address);
      setAddresses(list);
      setSelectedAddress(list[0]);

      await refreshBalance(list[0]);

      // Auto-refresh on new block
      subscribeBlocks(() => {
        refreshBalance(selectedAddress);
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
  // Create a new wallet
  // -------------------------------
  async function handleCreateWallet() {
    const w = createWallet();
    setWallet(w);

    const list = w.addresses.map((a: any) => a.address);
    setAddresses(list);
    setSelectedAddress(list[0]);

    await refreshBalance(list[0]);
  }

  // -------------------------------
  // Delete wallet
  // -------------------------------
  function handleDeleteWallet() {
    deleteWallet();

    setWallet(null);
    setAddresses([]);
    setSelectedAddress("");
    setBalance(0);
    setDestination("");
    setAmount("");
    setShowDropdown(false);
  }

  // -------------------------------
  // Generate new HD address
  // -------------------------------
  async function handleNewAddress() {
    const addr = generateAddress(wallet);
    const updated = loadWallet();

    const list = updated.addresses.map((a: any) => a.address);
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

      const result = await sendAlpha(wallet, destination, amountAlpha);

      alert(
        `Transaction sent!\n\nTXID:\n${result.txid}\n\nRaw TX:\n${result.raw}`
      );

      // обновить баланс
      refreshBalance(selectedAddress);
    } catch (err: any) {
      alert("Transaction failed: " + err.message);
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
        <p className="text-neutral-400 mb-6">Create a new wallet to continue</p>

        <motion.button
          whileTap={{ scale: 0.97 }}
          className="px-6 py-3 bg-blue-600 text-white rounded-xl text-sm font-semibold shadow-lg shadow-blue-500/20"
          onClick={handleCreateWallet}
        >
          Create Wallet
        </motion.button>
      </div>
    );
  }

  // -------------------------------
  // WALLET UI
  // -------------------------------
  return (
    <div className="flex flex-col h-full relative">
      {/* QR Modal */}
      {showQR && (
        <div className="absolute inset-0 bg-black/70 flex items-center justify-center z-20">
          <div className="bg-white p-6 rounded-xl shadow-2xl">
            <QrCode size={180} />
            <button
              onClick={() => setShowQR(false)}
              className="block mt-4 mx-auto px-4 py-2 rounded-lg bg-neutral-900 text-white"
            >
              Close
            </button>
          </div>
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
            className="px-3 py-2 bg-neutral-800 rounded text-neutral-200"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
          />

          <input
            placeholder="Amount"
            className="px-3 py-2 bg-neutral-800 rounded text-neutral-200"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />

          <motion.button
            whileTap={{ scale: 0.98 }}
            onClick={handleSend}
            className="px-4 py-3 bg-green-600 rounded-xl text-white font-semibold flex items-center justify-center gap-2"
          >
            <Send className="w-4 h-4" /> Send
          </motion.button>
        </div>
      </div>

      {/* DELETE WALLET */}
      <div className="mt-auto px-6 pb-6 pt-2">
        <button
          onClick={handleDeleteWallet}
          className="flex items-center gap-2 text-xs text-neutral-500 hover:text-red-400 transition-colors mx-auto"
        >
          <Trash2 className="w-3 h-3" />
          Delete Wallet
        </button>
      </div>
    </div>
  );
}
