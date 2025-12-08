import { useState, useEffect } from "react";
import { X, ArrowRight } from "lucide-react";
import { motion } from "framer-motion";
import { vestingState } from "../../sdk/vestingState";

interface SendModalProps {
  show: boolean;
  selectedAddress: string;
  onClose: () => void;
  onSend: (destination: string, amount: string) => Promise<void>;
}

export function SendModal({ show, selectedAddress, onClose, onSend }: SendModalProps) {
  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Reset on close
  useEffect(() => {
    if (!show) {
      setDestination("");
      setAmount("");
      setError(null);
    }
  }, [show]);

  const handleSend = async () => {
    if (!destination.trim() || !amount.trim()) {
      setError("Please fill in all fields");
      return;
    }

    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      setError("Please enter a valid amount");
      return;
    }

    setError(null);

    try {
      // Call onSend which will create transaction plan and show confirmation modal
      await onSend(destination, amount);
      // Close this modal - the transaction confirmation modal will handle the rest
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transaction creation failed");
    }
  };

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/60 dark:bg-black/80 backdrop-blur-sm"
      />

      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="relative w-full max-w-md bg-white dark:bg-[#111] border border-neutral-200 dark:border-white/10 rounded-3xl shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="p-6 border-b border-neutral-200 dark:border-white/5 flex justify-between items-center">
          <h3 className="text-lg font-semibold text-neutral-900 dark:text-white">
            Send ALPHA
          </h3>
          <button
            onClick={onClose}
            className="p-2 hover:bg-neutral-100 dark:hover:bg-white/5 rounded-full transition-colors"
          >
            <X className="w-5 h-5 text-neutral-500 dark:text-neutral-400" />
          </button>
        </div>

        <div className="p-6">
          <motion.div
            initial={{ x: 20, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
          >
                <div className="mb-6">
                  <label className="text-sm text-neutral-500 dark:text-neutral-400 block mb-2">
                    Destination Address
                  </label>
                  <input
                    autoFocus
                    value={destination}
                    onChange={(e) => setDestination(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                    className="w-full bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-white/10 rounded-xl py-3 px-4 text-neutral-900 dark:text-white focus:border-green-500 outline-none font-mono text-sm"
                    placeholder="Enter wallet address"
                  />
                </div>

                <div className="mb-6">
                  <div className="flex justify-between text-sm mb-2">
                    <label className="text-neutral-500 dark:text-neutral-400">Amount</label>
                    <span className="text-neutral-500 dark:text-neutral-400">
                      Available:{" "}
                      <span className="text-neutral-900 dark:text-white">
                        {(Number(vestingState.getBalance(selectedAddress)) / 1e8).toFixed(8)} ALPHA
                      </span>
                    </span>
                  </div>
                  <div className="relative">
                    <input
                      type="number"
                      step="any"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                      className="w-full bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-white/10 rounded-xl py-3 px-4 pr-32 text-neutral-900 dark:text-white text-2xl font-mono focus:border-green-500 outline-none"
                      placeholder="0.00"
                    />
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          const balance = Number(vestingState.getBalance(selectedAddress)) / 1e8;
                          setAmount(String(Math.floor(balance * 0.25 * 1e8) / 1e8));
                        }}
                        className="px-2 py-1 text-xs bg-neutral-200 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 rounded hover:bg-neutral-300 dark:hover:bg-neutral-700"
                      >
                        25%
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const balance = Number(vestingState.getBalance(selectedAddress)) / 1e8;
                          setAmount(String(Math.floor(balance * 0.5 * 1e8) / 1e8));
                        }}
                        className="px-2 py-1 text-xs bg-neutral-200 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 rounded hover:bg-neutral-300 dark:hover:bg-neutral-700"
                      >
                        50%
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const balance = Number(vestingState.getBalance(selectedAddress)) / 1e8;
                          setAmount(String(balance));
                        }}
                        className="px-2 py-1 text-xs bg-green-600 hover:bg-green-500 text-white rounded"
                      >
                        MAX
                      </button>
                    </div>
                  </div>
                  {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
                </div>

            <button
              onClick={handleSend}
              disabled={!destination || !amount}
              className="w-full py-3 bg-linear-to-br from-green-600 to-green-700 hover:from-green-500 hover:to-green-600 text-white font-medium rounded-xl flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-xl shadow-green-500/20"
            >
              Send Transaction
              <ArrowRight size={18} />
            </button>
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
}
