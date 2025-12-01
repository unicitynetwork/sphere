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
    <div className="fixed inset-0 bg-black/60 dark:bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="relative w-full max-w-md bg-white dark:bg-[#111] border border-neutral-200 dark:border-white/10 rounded-3xl shadow-2xl p-6 overflow-hidden">
        <h3 className="text-xl text-neutral-900 dark:text-white font-bold mb-4">
          Confirm Transaction
        </h3>

        <div className="space-y-3 mb-6">
          <div className="flex justify-between text-sm">
            <span className="text-neutral-500 dark:text-neutral-400">Recipient</span>
            <span className="text-neutral-900 dark:text-white font-mono truncate max-w-[200px]">
              {destination}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-neutral-500 dark:text-neutral-400">Amount</span>
            <span className="text-neutral-900 dark:text-white">{amount} ALPHA</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-neutral-500 dark:text-neutral-400">Transactions</span>
            <span className="text-neutral-900 dark:text-white">{txPlan.transactions.length}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-neutral-500 dark:text-neutral-400">Total Fee</span>
            <span className="text-neutral-900 dark:text-white">
              {(txPlan.transactions.length * 10000) / 100000000} ALPHA
            </span>
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-3 rounded-xl bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white font-semibold hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors"
            disabled={isSending}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 px-4 py-3 rounded-xl bg-green-600 text-white font-semibold hover:bg-green-500 flex items-center justify-center gap-2 transition-colors"
            disabled={isSending}
          >
            {isSending ? "Sending..." : "Confirm & Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
