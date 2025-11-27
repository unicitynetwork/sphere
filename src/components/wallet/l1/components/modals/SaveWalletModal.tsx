import { useState } from "react";

interface SaveWalletModalProps {
  show: boolean;
  onConfirm: (filename: string, password?: string) => void;
  onCancel: () => void;
}

export function SaveWalletModal({ show, onConfirm, onCancel }: SaveWalletModalProps) {
  const [filename, setFilename] = useState("alpha_wallet_backup");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");

  if (!show) return null;

  const handleConfirm = () => {
    if (password) {
      if (password !== passwordConfirm) {
        alert("Passwords do not match!");
        return;
      }
      if (password.length < 4) {
        alert("Password must be at least 4 characters");
        return;
      }
    }

    onConfirm(filename, password || undefined);

    // Reset state
    setFilename("alpha_wallet_backup");
    setPassword("");
    setPasswordConfirm("");
  };

  return (
    <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-40 p-6">
      <div className="bg-neutral-900 p-6 rounded-xl w-full max-w-md border border-neutral-700 shadow-2xl">
        <h3 className="text-white text-lg font-bold mb-4">Backup Wallet</h3>
        <p className="text-xs text-neutral-400 mb-4">
          Export your wallet keys to a file. Keep this safe!
        </p>

        <label className="text-xs text-neutral-500 mb-1 block">
          Filename
        </label>
        <input
          placeholder="Filename"
          value={filename}
          onChange={(e) => setFilename(e.target.value)}
          className="w-full mb-3 px-3 py-2 bg-neutral-800 rounded text-neutral-200 border border-neutral-700"
        />

        <label className="text-xs text-neutral-500 mb-1 block">
          Encryption Password (Optional)
        </label>
        <input
          placeholder="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full mb-3 px-3 py-2 bg-neutral-800 rounded text-neutral-200 border border-neutral-700"
        />

        <input
          placeholder="Confirm Password"
          type="password"
          value={passwordConfirm}
          onChange={(e) => setPasswordConfirm(e.target.value)}
          className="w-full mb-6 px-3 py-2 bg-neutral-800 rounded text-neutral-200 border border-neutral-700"
        />

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-2 bg-neutral-700 rounded text-white hover:bg-neutral-600"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            className="flex-1 py-2 bg-blue-600 rounded text-white hover:bg-blue-500"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
