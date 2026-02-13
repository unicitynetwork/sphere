/**
 * ImportFileScreen - File import screen with drag & drop
 */
import { motion } from "framer-motion";
import {
  Upload,
  FileText,
  FileJson,
  X,
  ArrowLeft,
  ArrowRight,
  Loader2,
} from "lucide-react";

interface ImportFileScreenProps {
  selectedFile: File | null;
  scanCount: number;
  needsScanning: boolean;
  isDragging: boolean;
  isBusy: boolean;
  error: string | null;
  onFileSelect: (file: File) => void;
  onClearFile: () => void;
  onScanCountChange: (count: number) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onImport: () => void;
  onBack: () => void;
}

export function ImportFileScreen({
  selectedFile,
  scanCount,
  needsScanning,
  isDragging,
  isBusy,
  error,
  onFileSelect,
  onClearFile,
  onScanCountChange,
  onDragOver,
  onDragLeave,
  onDrop,
  onImport,
  onBack,
}: ImportFileScreenProps) {
  return (
    <motion.div
      key="importFile"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ duration: 0.1 }}
      className="relative z-10 w-full max-w-90"
    >
      {/* Icon */}
      <motion.div
        className="relative w-18 h-18 mx-auto mb-6"
        whileHover={{ scale: 1.05 }}
      >
        <div className="absolute inset-0 bg-orange-500/30 rounded-2xl blur-xl" />
        <div className="relative w-full h-full rounded-2xl bg-linear-to-br from-orange-500 to-orange-600 flex items-center justify-center shadow-xl shadow-orange-500/25">
          <Upload className="w-9 h-9 text-white" />
        </div>
      </motion.div>

      <h2 className="text-2xl font-bold text-neutral-900 dark:text-white mb-2 tracking-tight">
        Import Wallet
      </h2>
      <p className="text-neutral-500 dark:text-neutral-400 text-sm mb-6 mx-auto leading-relaxed">
        Select a wallet file to import
      </p>

      {!selectedFile ? (
        <>
          {/* File Upload Area */}
          <div
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            className={`w-full border-2 border-dashed rounded-xl p-6 text-center transition-colors mb-5 ${
              isDragging
                ? "border-orange-500 bg-orange-500/10"
                : "border-neutral-300 dark:border-neutral-600 hover:border-orange-400 hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
            }`}
          >
            <Upload
              className={`w-10 h-10 mx-auto mb-3 ${
                isDragging ? "text-orange-500" : "text-neutral-400"
              }`}
            />
            <p className="text-sm text-neutral-700 dark:text-neutral-300 font-medium mb-1">
              Select wallet file
            </p>
            <p className="text-xs text-neutral-400 dark:text-neutral-500 mb-3">
              .json, .txt or .dat
            </p>
            <label className="inline-block cursor-pointer">
              <input
                type="file"
                className="hidden"
                accept=".json,.txt,.dat"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onFileSelect(file);
                }}
              />
              <span className="inline-flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium rounded-lg transition-colors">
                <Upload className="w-4 h-4" />
                Choose File
              </span>
            </label>
            <p className="text-[10px] text-neutral-400 dark:text-neutral-600 mt-3 hidden sm:block">
              or drag & drop here
            </p>
          </div>
        </>
      ) : (
        <>
          {/* Selected File Display */}
          <div className="p-3 bg-neutral-100 dark:bg-neutral-800/50 border border-neutral-200 dark:border-neutral-700 rounded-xl mb-3">
            <div className="flex items-center gap-3">
              {selectedFile.name.endsWith(".json") ? (
                <FileJson className="w-5 h-5 text-orange-500 shrink-0" />
              ) : (
                <FileText className="w-5 h-5 text-orange-500 shrink-0" />
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
                onClick={onClearFile}
                className="p-1.5 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded-lg transition-colors"
              >
                <X className="w-4 h-4 text-neutral-400" />
              </button>
            </div>
          </div>

          {/* Scan Count (for BIP32/.dat files) */}
          {needsScanning ? (
            <div className="p-3 bg-neutral-100 dark:bg-neutral-800/50 border border-neutral-200 dark:border-neutral-700 rounded-xl mb-3">
              <p className="text-xs text-neutral-700 dark:text-neutral-300 mb-2 font-medium">
                How many addresses to scan?
              </p>
              <input
                type="number"
                value={scanCount}
                onChange={(e) =>
                  onScanCountChange(Math.max(1, parseInt(e.target.value) || 10))
                }
                className="w-full px-3 py-2 bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-600 rounded-lg text-sm text-neutral-900 dark:text-white focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                min={1}
              />
            </div>
          ) : (
            <div className="p-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl mb-3">
              <p className="text-xs text-emerald-700 dark:text-emerald-300 font-medium">
                Addresses will be imported from file
              </p>
            </div>
          )}
        </>
      )}

      {/* Buttons */}
      <div className="flex gap-3">
        <motion.button
          onClick={onBack}
          disabled={isBusy}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="flex-1 py-3.5 px-5 rounded-xl bg-neutral-100 dark:bg-neutral-800/50 text-neutral-700 dark:text-neutral-300 text-sm font-bold border border-neutral-200 dark:border-neutral-700/50 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-neutral-200 dark:hover:bg-neutral-700/50 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </motion.button>

        {selectedFile && (
          <motion.button
            onClick={onImport}
            disabled={isBusy}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="flex-2 relative py-3.5 px-5 rounded-xl bg-linear-to-r from-orange-500 to-orange-600 text-white text-sm font-bold shadow-xl shadow-orange-500/25 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden group"
          >
            <div className="absolute inset-0 bg-linear-to-r from-orange-400 to-orange-500 opacity-0 group-hover:opacity-100 transition-opacity" />
            <span className="relative z-10 flex items-center gap-2">
              {isBusy ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Importing...
                </>
              ) : (
                <>
                  Import
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </span>
          </motion.button>
        )}
      </div>

      {error && (
        <motion.p
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-3 text-red-500 dark:text-red-400 text-xs bg-red-500/10 border border-red-500/20 p-2 rounded-lg"
        >
          {error}
        </motion.p>
      )}
    </motion.div>
  );
}
