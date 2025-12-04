import { useRef } from "react";
import { Upload } from "lucide-react";
import { motion } from "framer-motion";
import { LoadPasswordModal } from "../components/modals";

interface NoWalletViewProps {
  onCreateWallet: () => void;
  onLoadWallet: (file: File) => void;
  showLoadPasswordModal: boolean;
  onConfirmLoadWithPassword: (password: string) => void;
  onCancelLoadPassword: () => void;
}

export function NoWalletView({
  onCreateWallet,
  onLoadWallet,
  showLoadPasswordModal,
  onConfirmLoadWithPassword,
  onCancelLoadPassword,
}: NoWalletViewProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    onLoadWallet(file);
    event.target.value = "";
  };

  return (
    <div className="flex flex-col items-center justify-center h-full p-6 text-center">
      <h2 className="text-xl text-neutral-900 dark:text-white font-semibold mb-2">
        No wallet found
      </h2>
      <p className="text-neutral-500 dark:text-neutral-400 mb-6">
        Create a new wallet or import an existing one to continue
      </p>

      <div className="flex flex-col sm:flex-row gap-4 w-full max-w-xs">
        <motion.button
          whileTap={{ scale: 0.97 }}
          className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-xl text-sm font-semibold shadow-lg shadow-blue-500/20"
          onClick={onCreateWallet}
        >
          Create Wallet
        </motion.button>

        <motion.button
          whileTap={{ scale: 0.97 }}
          className="flex-1 px-6 py-3 bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-900 dark:text-white rounded-xl text-sm font-semibold hover:bg-neutral-200 dark:hover:bg-neutral-700 flex items-center justify-center gap-2 transition-colors"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="w-4 h-4" />
          Import
        </motion.button>
      </div>

      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        accept=".json,.txt,.dat"
        onChange={handleFileSelect}
      />

      <LoadPasswordModal
        show={showLoadPasswordModal}
        onConfirm={onConfirmLoadWithPassword}
        onCancel={onCancelLoadPassword}
      />
    </div>
  );
}
