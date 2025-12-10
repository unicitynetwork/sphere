import { useState, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import { Upload, FileText, FileJson, X } from "lucide-react";
import { isJSONWalletFormat } from "../../sdk/import-export";

interface ImportWalletModalProps {
  show: boolean;
  onImport: (file: File, scanCount?: number) => void;
  onCancel: () => void;
}

export function ImportWalletModal({ show, onImport, onCancel }: ImportWalletModalProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [scanCount, setScanCount] = useState(10);
  const [needsScanning, setNeedsScanning] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith(".txt") || file.name.endsWith(".dat") || file.name.endsWith(".json"))) {
      setSelectedFile(file);
      await checkIfNeedsScanning(file);
    }
  }, []);

  const checkIfNeedsScanning = async (file: File) => {
    try {
      // .dat files always need scanning
      if (file.name.endsWith(".dat")) {
        setNeedsScanning(true);
        setScanCount(10);
        return;
      }

      const content = await file.text();

      // JSON wallet files - check format and derivation mode
      if (file.name.endsWith(".json") || isJSONWalletFormat(content)) {
        try {
          const json = JSON.parse(content);
          // JSON files with mnemonic don't need scanning - restore directly from seed
          // JSON files with BIP32 but no mnemonic need scanning
          const hasMnemonic = !!json.mnemonic || !!json.encrypted?.mnemonic;
          const isBIP32 = json.derivationMode === "bip32" || json.chainCode;
          setNeedsScanning(!hasMnemonic && isBIP32);
          setScanCount(10);
        } catch {
          setNeedsScanning(true);
        }
        return;
      }

      // For .txt files, check if BIP32 or standard
      const isBIP32 = content.includes("MASTER CHAIN CODE") ||
                      content.includes("WALLET TYPE: BIP32") ||
                      content.includes("WALLET TYPE: Alpha descriptor");

      setNeedsScanning(isBIP32);
      setScanCount(10);
    } catch (err) {
      console.error("Error checking file type:", err);
      setNeedsScanning(true); // Default to showing scan option
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      // Check if file needs scanning (BIP32/dat) or has addresses listed (standard)
      await checkIfNeedsScanning(file);
    }
  };

  const handleImport = () => {
    if (!selectedFile) return;
    onImport(selectedFile, scanCount);
  };

  const handleCancel = () => {
    setSelectedFile(null);
    setScanCount(10);
    setNeedsScanning(true);
    onCancel();
  };

  if (!show) return null;

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
        className="relative w-full max-w-sm bg-white dark:bg-[#111] border border-neutral-200 dark:border-white/10 rounded-2xl shadow-2xl p-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-neutral-900 dark:text-white text-base font-bold">Import Wallet</h3>
          <button
            onClick={handleCancel}
            className="p-1 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded transition-colors"
          >
            <X className="w-4 h-4 text-neutral-500" />
          </button>
        </div>

        {!selectedFile ? (
          <>
            {/* Main button - clickable, also supports drag-drop on desktop */}
            <button
              onClick={() => fileInputRef.current?.click()}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`w-full border-2 border-dashed rounded-xl p-6 text-center transition-colors cursor-pointer ${
                isDragging
                  ? "border-blue-500 bg-blue-500/10"
                  : "border-neutral-300 dark:border-neutral-600 hover:border-blue-400 hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
              }`}
            >
              <Upload className={`w-10 h-10 mx-auto mb-3 ${isDragging ? "text-blue-500" : "text-neutral-400"}`} />
              <p className="text-sm text-neutral-700 dark:text-neutral-300 font-medium mb-1">
                Select wallet file
              </p>
              <p className="text-xs text-neutral-400 dark:text-neutral-500">
                .json, .txt or .dat
              </p>
              <p className="text-[10px] text-neutral-400 dark:text-neutral-600 mt-2 hidden sm:block">
                or drag & drop here
              </p>
            </button>

            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              accept=".json,.txt,.dat"
              onChange={handleFileSelect}
            />
          </>
        ) : (
          <>
            {/* Selected file */}
            <div className="p-3 bg-neutral-50 dark:bg-neutral-800/50 border border-neutral-200 dark:border-neutral-700 rounded-lg mb-3">
              <div className="flex items-center gap-2">
                {selectedFile.name.endsWith(".json") ? (
                  <FileJson className="w-5 h-5 text-blue-500 shrink-0" />
                ) : (
                  <FileText className="w-5 h-5 text-blue-500 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-neutral-900 dark:text-white font-medium truncate">
                    {selectedFile.name}
                  </p>
                  <p className="text-xs text-neutral-500">
                    {(selectedFile.size / 1024).toFixed(1)} KB
                  </p>
                </div>
                <button
                  onClick={() => setSelectedFile(null)}
                  className="p-1 hover:bg-neutral-200 dark:hover:bg-neutral-600 rounded"
                >
                  <X className="w-3 h-3 text-neutral-400" />
                </button>
              </div>
            </div>

            {/* Scan count for address scanning (only for BIP32/.dat files) */}
            {needsScanning ? (
              <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg mb-3">
                <p className="text-xs text-blue-700 dark:text-blue-300 mb-2">
                  How many addresses to scan?
                </p>
                <input
                  type="number"
                  value={scanCount}
                  onChange={(e) => setScanCount(Math.max(1, parseInt(e.target.value) || 10))}
                  className="w-full px-2 py-1.5 bg-white dark:bg-neutral-800 border border-blue-300 dark:border-blue-700 rounded text-sm text-neutral-900 dark:text-white"
                  min={1}
                />
              </div>
            ) : (
              <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg mb-3">
                <p className="text-xs text-green-700 dark:text-green-300">
                  Addresses will be imported from file
                </p>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-2">
              <button
                onClick={() => setSelectedFile(null)}
                className="flex-1 py-2 bg-neutral-200 dark:bg-neutral-700 rounded-lg text-neutral-700 dark:text-white text-sm hover:bg-neutral-300 dark:hover:bg-neutral-600 transition-colors"
              >
                Back
              </button>
              <button
                onClick={handleImport}
                className="flex-1 py-2 bg-blue-600 rounded-lg text-white text-sm hover:bg-blue-500 transition-colors"
              >
                Import
              </button>
            </div>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}
