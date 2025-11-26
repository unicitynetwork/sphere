import { useEffect, useState, useRef } from "react";
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
  connect,
  getBalance,
  subscribeBlocks,
  createTransactionPlan,
  createAndSignTransaction,
  broadcast,
  exportWallet,
  importWallet,
  downloadWalletFile,
  generateHDAddress,
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

  const [txPlan, setTxPlan] = useState<any>(null);
  const [showConfirmation, setShowConfirmation] = useState(false);

  // Save/Load state
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveFilename, setSaveFilename] = useState("alpha_wallet_backup");
  const [savePassword, setSavePassword] = useState("");
  const [savePasswordConfirm, setSavePasswordConfirm] = useState("");
  const [showLoadPasswordModal, setShowLoadPasswordModal] = useState(false);
  const [loadPassword, setLoadPassword] = useState("");
  const [pendingImportData, setPendingImportData] = useState<string | null>(
    null
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isSending, setIsSending] = useState(false);

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
    if (!updated) return;

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
    } catch (err: any) {
      alert("Error creating transaction: " + err.message);
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
        } catch (e: any) {
          console.error("Broadcast failed for tx", e);
          errors.push(e.message || e);
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
    } catch (err: any) {
      alert("Transaction failed: " + err.message);
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
    } catch (err: any) {
      alert("Error saving wallet: " + err.message);
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
        setPendingImportData(content);
        setShowLoadPasswordModal(true);
      } else {
        // Unencrypted - import directly
        const { wallet: importedWallet, addressCount } = importWallet(content);

        // Regenerate addresses
        const addresses = [];
        for (let i = 0; i < (addressCount || 1); i++) {
          const addr = generateHDAddress(
            importedWallet.masterPrivateKey,
            importedWallet.chainCode,
            i
          );
          addresses.push(addr);
        }
        importedWallet.addresses = addresses;

        setWallet(importedWallet);
        const list = addresses.map((a) => a.address);
        setAddresses(list);
        setSelectedAddress(list[0]);
        await refreshBalance(list[0]);

        alert("Wallet loaded successfully!");
      }
    } catch (err: any) {
      alert("Error loading wallet: " + err.message);
      console.error(err);
    }

    // Reset file input
    event.target.value = "";
  }

  async function handleConfirmLoadWithPassword() {
    if (!pendingImportData || !loadPassword) {
      alert("Please enter password");
      return;
    }

    try {
      const { wallet: importedWallet, addressCount } = importWallet(
        pendingImportData,
        loadPassword
      );

      // Regenerate addresses
      const addresses = [];
      for (let i = 0; i < (addressCount || 1); i++) {
        const addr = generateHDAddress(
          importedWallet.masterPrivateKey,
          importedWallet.chainCode,
          i
        );
        addresses.push(addr);
      }
      importedWallet.addresses = addresses;

      setWallet(importedWallet);
      const list = addresses.map((a) => a.address);
      setAddresses(list);
      setSelectedAddress(list[0]);
      await refreshBalance(list[0]);

      setShowLoadPasswordModal(false);
      setPendingImportData(null);
      setLoadPassword("");
      alert("Wallet loaded successfully!");
    } catch (err: any) {
      alert("Error loading wallet: " + err.message);
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

      {/* SAVE & LOAD  */}
      <div className="px-6 mt-4 flex gap-3">
        <button
          onClick={handleSaveWallet}
          className="flex-1 px-4 py-3 bg-neutral-800 rounded-xl border border-neutral-700 text-neutral-300"
        >
          Save Wallet
        </button>

        <button
          onClick={handleLoadWallet}
          className="flex-1 px-4 py-3 bg-neutral-800 rounded-xl border border-neutral-700 text-neutral-300"
        >
          Load Wallet
        </button>

        <input
          type="file"
          ref={fileInputRef}
          className="hidden"
          accept=".json,.txt"
          onChange={handleFileSelect}
        />
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
      {showSaveModal && (
        <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-40 p-6">
          <div className="bg-neutral-900 p-6 rounded-xl w-full max-w-md border border-neutral-700">
            <h3 className="text-white text-lg font-bold mb-4">Save Wallet</h3>

            <input
              placeholder="Filename"
              value={saveFilename}
              onChange={(e) => setSaveFilename(e.target.value)}
              className="w-full mb-3 px-3 py-2 bg-neutral-800 rounded text-neutral-200"
            />

            <input
              placeholder="Password (optional)"
              type="password"
              value={savePassword}
              onChange={(e) => setSavePassword(e.target.value)}
              className="w-full mb-3 px-3 py-2 bg-neutral-800 rounded text-neutral-200"
            />

            <input
              placeholder="Confirm Password"
              type="password"
              value={savePasswordConfirm}
              onChange={(e) => setSavePasswordConfirm(e.target.value)}
              className="w-full mb-6 px-3 py-2 bg-neutral-800 rounded text-neutral-200"
            />

            <div className="flex gap-3">
              <button
                onClick={() => setShowSaveModal(false)}
                className="flex-1 py-2 bg-neutral-700 rounded text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmSave}
                className="flex-1 py-2 bg-blue-600 rounded text-white"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
      {showLoadPasswordModal && (
        <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-40 p-6">
          <div className="bg-neutral-900 p-6 rounded-xl w-full max-w-md border border-neutral-700">
            <h3 className="text-white text-lg font-bold mb-4">
              Enter Password
            </h3>
            <p className="text-neutral-400 text-sm mb-4">
              This wallet is encrypted. Please enter your password to unlock it.
            </p>

            <input
              placeholder="Password"
              type="password"
              value={loadPassword}
              onChange={(e) => setLoadPassword(e.target.value)}
              className="w-full mb-6 px-3 py-2 bg-neutral-800 rounded text-neutral-200"
            />

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowLoadPasswordModal(false);
                  setPendingImportData(null);
                  setLoadPassword("");
                }}
                className="flex-1 py-2 bg-neutral-700 rounded text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmLoadWithPassword}
                className="flex-1 py-2 bg-blue-600 rounded text-white"
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
