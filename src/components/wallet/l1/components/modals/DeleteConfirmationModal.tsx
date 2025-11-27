import { AlertTriangle, Download } from "lucide-react";

interface DeleteConfirmationModalProps {
  show: boolean;
  onConfirmDelete: () => void;
  onSaveFirst: () => void;
  onCancel: () => void;
}

export function DeleteConfirmationModal({
  show,
  onConfirmDelete,
  onSaveFirst,
  onCancel,
}: DeleteConfirmationModalProps) {
  if (!show) return null;

  return (
    <div className="absolute inset-0 bg-black/90 flex items-center justify-center z-50 p-6">
      <div className="bg-neutral-900 p-6 rounded-xl w-full max-w-md border border-red-900/50 shadow-2xl">
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-12 h-12 bg-red-500/10 rounded-full flex items-center justify-center mb-4">
            <AlertTriangle className="w-6 h-6 text-red-500" />
          </div>
          <h3 className="text-white text-xl font-bold mb-2">
            Delete Wallet?
          </h3>
          <p className="text-neutral-400 text-sm">
            Are you sure you want to delete this wallet? <br />
            <span className="text-red-400 font-semibold">
              This action cannot be undone.
            </span>
          </p>
          <p className="text-neutral-500 text-xs mt-2">
            If you haven't saved your backup, your funds will be lost
            forever.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <button
            onClick={onSaveFirst}
            className="w-full py-3 bg-neutral-800 rounded-xl text-white font-medium border border-neutral-700 hover:bg-neutral-700 flex items-center justify-center gap-2"
          >
            <Download className="w-4 h-4" />
            Save Backup First
          </button>

          <div className="flex gap-3 mt-2">
            <button
              onClick={onCancel}
              className="flex-1 py-3 bg-neutral-800 rounded-xl text-white font-medium hover:bg-neutral-700"
            >
              Cancel
            </button>
            <button
              onClick={onConfirmDelete}
              className="flex-1 py-3 bg-red-600/20 text-red-500 border border-red-900/50 rounded-xl font-medium hover:bg-red-600 hover:text-white transition-all"
            >
              Delete Anyway
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
