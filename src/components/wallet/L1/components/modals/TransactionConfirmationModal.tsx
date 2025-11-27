import type { TransactionPlan } from "../../sdk";

interface TransactionConfirmationModalProps {
  show: boolean;
  txPlan: TransactionPlan | null;
  destination: string;
  amount: string;
  isSending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function TransactionConfirmationModal({
  show,
  txPlan,
  destination,
  amount,
  isSending,
  onConfirm,
  onCancel,
}: TransactionConfirmationModalProps) {
  if (!show || !txPlan) return null;

  return (
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
            onClick={onCancel}
            className="flex-1 px-4 py-3 rounded-xl bg-neutral-800 text-white font-semibold hover:bg-neutral-700"
            disabled={isSending}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 px-4 py-3 rounded-xl bg-green-600 text-white font-semibold hover:bg-green-500 flex items-center justify-center gap-2"
            disabled={isSending}
          >
            {isSending ? "Sending..." : "Confirm & Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
