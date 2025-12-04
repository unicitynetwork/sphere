import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Search, Loader2, Wallet, Check } from "lucide-react";
import { scanWalletAddresses, type ScannedAddress, type ScanProgress, type Wallet as WalletType } from "../../sdk";

interface WalletScanModalProps {
  show: boolean;
  wallet: WalletType | null;
  initialScanCount?: number;
  onSelectAddress: (address: ScannedAddress) => void;
  onCancel: () => void;
}

export function WalletScanModal({ show, wallet, initialScanCount = 100, onSelectAddress, onCancel }: WalletScanModalProps) {
  const [isScanning, setIsScanning] = useState(false);
  const [progress, setProgress] = useState<ScanProgress>({ current: 0, total: initialScanCount, found: 0, totalBalance: 0, foundAddresses: [] });
  const [foundAddresses, setFoundAddresses] = useState<ScannedAddress[]>([]);
  const [scanCount, setScanCount] = useState(initialScanCount);
  const stopScanRef = useRef(false);

  // Reset state when modal opens
  useEffect(() => {
    if (show && wallet) {
      setScanCount(initialScanCount);
      setFoundAddresses([]);
      setProgress({ current: 0, total: initialScanCount, found: 0, totalBalance: 0, foundAddresses: [] });
      stopScanRef.current = false;
      // Auto-start scanning with initial count
      startScan(initialScanCount);
    }
    return () => {
      stopScanRef.current = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, wallet, initialScanCount]);

  const startScan = async (count?: number) => {
    if (!wallet) return;

    const scanLimit = count ?? scanCount;
    setIsScanning(true);
    setFoundAddresses([]);
    setProgress({ current: 0, total: scanLimit, found: 0, totalBalance: 0, foundAddresses: [] });
    stopScanRef.current = false;

    try {
      const result = await scanWalletAddresses(
        wallet,
        scanLimit,
        (p) => {
          setProgress(p);
          // Update found addresses in real-time from progress callback
          if (p.foundAddresses && p.foundAddresses.length > 0) {
            setFoundAddresses(p.foundAddresses);
          }
        },
        () => stopScanRef.current
      );

      setFoundAddresses(result.addresses);
    } catch (error) {
      console.error("Scan error:", error);
    } finally {
      setIsScanning(false);
    }
  };

  const stopScan = () => {
    stopScanRef.current = true;
  };

  const handleCancel = () => {
    stopScanRef.current = true;
    onCancel();
  };

  if (!show) return null;

  const progressPercent = progress.total > 0 ? (progress.current / progress.total) * 100 : 0;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 dark:bg-black/80 backdrop-blur-sm flex items-center justify-center z-40 p-4"
      onClick={handleCancel}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.9, opacity: 0, y: 20 }}
        transition={{ type: "spring", duration: 0.4 }}
        className="relative w-full max-w-md bg-white dark:bg-[#111] border border-neutral-200 dark:border-white/10 rounded-2xl shadow-2xl p-4 overflow-hidden max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 mb-3">
          <div className="w-9 h-9 bg-blue-500/10 rounded-full flex items-center justify-center shrink-0">
            <Search className="w-4 h-4 text-blue-500" />
          </div>
          <div>
            <h3 className="text-neutral-900 dark:text-white text-base font-bold">Scanning Wallet</h3>
            <p className="text-neutral-500 dark:text-neutral-400 text-xs">
              Searching for addresses with balances...
            </p>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="mb-3">
          <div className="h-2 bg-neutral-200 dark:bg-neutral-800 rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-blue-500"
              initial={{ width: 0 }}
              animate={{ width: `${progressPercent}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>
          <div className="flex justify-between mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
            <span>
              {isScanning ? (
                <span className="flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Found {progress.found}
                </span>
              ) : (
                `Found ${foundAddresses.length}`
              )}
            </span>
            <span>{progress.current}/{progress.total}</span>
          </div>
          {progress.totalBalance > 0 && (
            <div className="text-xs text-center text-green-600 dark:text-green-400 font-medium">
              Total: {progress.totalBalance.toFixed(8)} ALPHA
            </div>
          )}
        </div>

        {/* Stop Scan Button */}
        {isScanning && (
          <button
            onClick={stopScan}
            className="mb-2 py-1.5 px-3 bg-neutral-200 dark:bg-neutral-700 rounded-lg text-neutral-700 dark:text-white text-xs hover:bg-neutral-300 dark:hover:bg-neutral-600 transition-colors"
          >
            Stop Scan
          </button>
        )}

        {/* Found Addresses List */}
        <div className="flex-1 overflow-y-auto min-h-[100px] max-h-[200px] border border-neutral-200 dark:border-neutral-700 rounded-lg mb-3">
          {foundAddresses.length === 0 ? (
            <div className="h-full flex items-center justify-center text-neutral-400 dark:text-neutral-500 text-xs p-4">
              {isScanning ? "Searching..." : "No addresses found"}
            </div>
          ) : (
            <div className="divide-y divide-neutral-200 dark:divide-neutral-700">
              {foundAddresses.map((addr) => (
                <div
                  key={addr.address}
                  onClick={() => onSelectAddress(addr)}
                  className="p-2 cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-800/50 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <Wallet className="w-3 h-3 text-blue-500 shrink-0" />
                        <span className="text-neutral-900 dark:text-white font-medium text-xs">
                          {addr.isChange ? "Change" : "Address"} #{addr.index}
                        </span>
                        {addr.isChange && (
                          <span className="px-1 py-0.5 bg-amber-500/20 text-amber-600 dark:text-amber-400 text-[9px] font-bold rounded">
                            CHANGE
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-neutral-400 dark:text-neutral-500 font-mono truncate">
                        {addr.address}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-green-600 dark:text-green-400 font-bold text-sm">
                        {addr.balance.toFixed(8)}
                      </div>
                      <div className="text-[10px] text-neutral-500">ALPHA</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Scan Settings */}
        <div className="mb-3 p-2 bg-neutral-50 dark:bg-neutral-800/30 rounded-lg">
          <div className="flex items-center gap-2">
            <label className="text-xs text-neutral-600 dark:text-neutral-400">
              Scan:
            </label>
            <input
              type="number"
              value={scanCount}
              onChange={(e) => setScanCount(Math.min(1000, Math.max(1, parseInt(e.target.value) || 100)))}
              disabled={isScanning}
              className="w-16 px-2 py-1 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded text-xs text-neutral-900 dark:text-white disabled:opacity-50"
              min={1}
              max={1000}
            />
            {!isScanning && (
              <button
                onClick={() => startScan()}
                className="px-2 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-500 transition-colors"
              >
                Rescan
              </button>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          <button
            onClick={handleCancel}
            className="flex-1 py-1.5 bg-neutral-200 dark:bg-neutral-700 rounded-lg text-neutral-700 dark:text-white text-sm hover:bg-neutral-300 dark:hover:bg-neutral-600 transition-colors"
          >
            Cancel
          </button>
          {foundAddresses.length > 0 && (
            <button
              onClick={() => onSelectAddress(foundAddresses[0])}
              className="flex-1 py-1.5 bg-blue-600 rounded-lg text-white text-sm hover:bg-blue-500 transition-colors flex items-center justify-center gap-1"
            >
              <Check className="w-3 h-3" />
              Load First
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
