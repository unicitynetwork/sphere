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
      transition={{ duration: 0.3 }}
      className="relative z-10 w-full max-w-[320px] md:max-w-[400px]"
    >
      {/* Icon */}
      <motion.div
        className="relative w-16 h-16 md:w-20 md:h-20 mx-auto mb-6"
        whileHover={{ scale: 1.05 }}
      >
        <div className="absolute inset-0 bg-orange-500/30 rounded-2xl md:rounded-3xl blur-xl" />
        <div className="relative w-full h-full rounded-2xl md:rounded-3xl bg-linear-to-br from-orange-500 to-orange-600 flex items-center justify-center shadow-2xl shadow-orange-500/30">
          <Upload className="w-8 h-8 md:w-10 md:h-10 text-white" />
        </div>
      </motion.div>

      <h2 className="text-2xl md:text-3xl font-black text-neutral-900 dark:text-white mb-2 md:mb-3 tracking-tight">
        Import Wallet
      </h2>
      <p className="text-neutral-500 dark:text-neutral-400 text-xs md:text-sm mb-6 md:mb-8 mx-auto leading-relaxed">
        Select a wallet file to import
      </p>

      {!selectedFile ? (
        <>
          {/* File Upload Area */}
          <div
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            className={`w-full border-2 border-dashed rounded-xl p-8 md:p-10 text-center transition-colors mb-6 ${
              isDragging
                ? "border-orange-500 bg-orange-500/10"
                : "border-neutral-300 dark:border-neutral-600 hover:border-orange-400 hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
            }`}
          >
            <Upload
              className={`w-12 h-12 md:w-14 md:h-14 mx-auto mb-4 ${
                isDragging ? "text-orange-500" : "text-neutral-400"
              }`}
            />
            <p className="text-sm md:text-base text-neutral-700 dark:text-neutral-300 font-medium mb-2">
              Select wallet file
            </p>
            <p className="text-xs md:text-sm text-neutral-400 dark:text-neutral-500 mb-3">
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
            <p className="text-[10px] md:text-xs text-neutral-400 dark:text-neutral-600 mt-3 hidden sm:block">
              or drag & drop here
            </p>
          </div>
        </>
      ) : (
        <>
          {/* Selected File Display */}
          <div className="p-4 bg-neutral-100 dark:bg-neutral-800/50 border border-neutral-200 dark:border-neutral-700 rounded-xl mb-4">
            <div className="flex items-center gap-3">
              {selectedFile.name.endsWith(".json") ? (
                <FileJson className="w-6 h-6 text-orange-500 shrink-0" />
              ) : (
                <FileText className="w-6 h-6 text-orange-500 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm md:text-base text-neutral-900 dark:text-white font-medium truncate">
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
            <div className="p-4 bg-neutral-100 dark:bg-neutral-800/50 border border-neutral-200 dark:border-neutral-700 rounded-xl mb-4">
              <p className="text-xs md:text-sm text-neutral-700 dark:text-neutral-300 mb-2 font-medium">
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
            <div className="p-4 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl mb-4">
              <p className="text-xs md:text-sm text-emerald-700 dark:text-emerald-300 font-medium">
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
          className="flex-1 py-3 md:py-3.5 px-5 md:px-6 rounded-xl bg-neutral-100 dark:bg-neutral-800/50 text-neutral-700 dark:text-neutral-300 text-sm md:text-base font-bold border-2 border-neutral-200 dark:border-neutral-700/50 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-neutral-200 dark:hover:bg-neutral-700/50 transition-colors"
        >
          <ArrowLeft className="w-4 h-4 md:w-5 md:h-5" />
          Back
        </motion.button>

        {selectedFile && (
          <motion.button
            onClick={onImport}
            disabled={isBusy}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="flex-2 relative py-3 md:py-3.5 px-5 md:px-6 rounded-xl bg-linear-to-r from-orange-500 to-orange-600 text-white text-sm md:text-base font-bold shadow-xl shadow-orange-500/30 flex items-center justify-center gap-2 md:gap-3 disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden group"
          >
            <div className="absolute inset-0 bg-linear-to-r from-orange-400 to-orange-500 opacity-0 group-hover:opacity-100 transition-opacity" />
            <span className="relative z-10 flex items-center gap-2 md:gap-3">
              {isBusy ? (
                <>
                  <Loader2 className="w-4 h-4 md:w-5 md:h-5 animate-spin" />
                  Importing...
                </>
              ) : (
                <>
                  Import
                  <ArrowRight className="w-4 h-4 md:w-5 md:h-5" />
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
          className="mt-3 md:mt-4 text-red-500 dark:text-red-400 text-xs md:text-sm bg-red-500/10 border border-red-500/20 p-2 md:p-3 rounded-lg"
        >
          {error}
        </motion.p>
      )}
    </motion.div>
  );
}
