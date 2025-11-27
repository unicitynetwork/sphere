import { useState } from "react";

interface LoadPasswordModalProps {
  show: boolean;
  onConfirm: (password: string) => void;
  onCancel: () => void;
}

export function LoadPasswordModal({ show, onConfirm, onCancel }: LoadPasswordModalProps) {
  const [password, setPassword] = useState("");

  if (!show) return null;

  const handleConfirm = () => {
    if (!password) {
      alert("Please enter password");
      return;
    }
    onConfirm(password);
    setPassword("");
  };

  const handleCancel = () => {
    setPassword("");
    onCancel();
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-40 p-6">
      <div className="bg-neutral-900 p-6 rounded-xl w-full max-w-md border border-neutral-700 shadow-2xl">
        <h3 className="text-white text-lg font-bold mb-4">
          Enter Password
        </h3>
        <p className="text-neutral-400 text-sm mb-4">
          This wallet is encrypted. Please enter your password to unlock
          it.
        </p>

        <input
          placeholder="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              handleConfirm();
            }
          }}
          className="w-full mb-6 px-3 py-2 bg-neutral-800 rounded text-neutral-200 border border-neutral-700 focus:border-blue-500 outline-none"
        />

        <div className="flex gap-3">
          <button
            onClick={handleCancel}
            className="flex-1 py-2 bg-neutral-700 rounded text-white hover:bg-neutral-600"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            className="flex-1 py-2 bg-blue-600 rounded text-white hover:bg-blue-500"
          >
            Unlock
          </button>
        </div>
      </div>
    </div>
  );
}
