import { ArrowLeft } from "lucide-react";
import { motion } from "framer-motion";
import type {
  TransactionHistoryItem,
  TransactionDetail,
  Wallet,
} from "../../l1/sdk";

interface HistoryViewProps {
  wallet: Wallet;
  selectedAddress: string;
  transactions: TransactionHistoryItem[];
  loadingTransactions: boolean;
  currentBlockHeight: number;
  transactionDetails: Record<string, TransactionDetail>;
  analyzeTransaction: (
    tx: TransactionHistoryItem,
    detail: TransactionDetail | undefined,
    wallet: Wallet
  ) => {
    direction: string;
    amount: number;
    fromAddresses: string[];
    toAddresses: string[];
  };
  onBackToMain: () => void;
}

function formatTimestamp(time: number | undefined) {
  if (!time) return "";
  const date = new Date(time * 1000);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function HistoryView({
  wallet,
  selectedAddress,
  transactions,
  loadingTransactions,
  currentBlockHeight,
  transactionDetails,
  analyzeTransaction,
  onBackToMain,
}: HistoryViewProps) {
  return (
    <div className="flex flex-col h-full relative">
      <div className="px-6 mb-4">
        <div className="flex items-center gap-3 mb-4">
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={onBackToMain}
            className="p-2 rounded-lg bg-neutral-800 border border-neutral-700 hover:bg-neutral-700 text-white"
          >
            <ArrowLeft className="w-5 h-5" />
          </motion.button>
          <h2 className="text-xl text-white font-bold">Transaction History</h2>
        </div>

        <p className="text-xs text-neutral-400">
          {selectedAddress.slice(0, 10)}...{selectedAddress.slice(-6)}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-6">
        {loadingTransactions ? (
          <div className="flex items-center justify-center h-32">
            <p className="text-neutral-400">Loading transactions...</p>
          </div>
        ) : transactions.length === 0 ? (
          <div className="flex items-center justify-center h-32">
            <p className="text-neutral-400">No transactions found</p>
          </div>
        ) : (
          <div className="space-y-3">
            {transactions.map((tx) => {
              const confirmations =
                tx.height > 0 && currentBlockHeight > 0
                  ? Math.max(0, currentBlockHeight - tx.height + 1)
                  : 0;
              const statusColor = confirmations > 0 ? "#10b981" : "#fbbf24";
              const statusText =
                confirmations > 0
                  ? `${confirmations} confirmations`
                  : "Unconfirmed";
              const truncatedTxid =
                tx.tx_hash.substring(0, 6) +
                "..." +
                tx.tx_hash.substring(tx.tx_hash.length - 6);

              const detail = transactionDetails[tx.tx_hash];
              const analysis = analyzeTransaction(tx, detail, wallet);
              const isSent = analysis.direction === "sent";
              const directionText = isSent ? "Sent" : "Received";
              const directionColor = isSent ? "#ef4444" : "#10b981";

              return (
                <div
                  key={tx.tx_hash}
                  className="bg-neutral-900 border border-neutral-800 rounded-xl p-4"
                >
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex items-center gap-2">
                      <span
                        className="text-sm font-semibold"
                        style={{ color: directionColor }}
                      >
                        {isSent ? "↑" : "↓"} {directionText}
                      </span>
                      <a
                        href={`https://www.unicity.network/tx/${tx.tx_hash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-xs text-blue-400 hover:text-blue-300"
                      >
                        {truncatedTxid}
                      </a>
                    </div>
                    <div className="text-right">
                      <div
                        className="font-bold text-sm"
                        style={{ color: directionColor }}
                      >
                        {isSent ? "-" : ""}
                        {analysis.amount.toFixed(8)} ALPHA
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-xs mb-2">
                    <span style={{ color: statusColor }}>{statusText}</span>
                    {tx.height > 0 && (
                      <>
                        <span className="text-neutral-600">•</span>
                        <span className="text-neutral-400">
                          Block {tx.height}
                        </span>
                      </>
                    )}
                    {detail?.blocktime && (
                      <>
                        <span className="text-neutral-600">•</span>
                        <span className="text-neutral-400">
                          {formatTimestamp(detail.blocktime)}
                        </span>
                      </>
                    )}
                  </div>

                  {detail && (
                    <div className="space-y-1">
                      {analysis.fromAddresses.length > 0 && (
                        <div className="text-xs text-neutral-400">
                          From:{" "}
                          <a
                            href={`https://www.unicity.network/address/${analysis.fromAddresses[0]}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-400 hover:text-blue-300 font-mono"
                          >
                            {analysis.fromAddresses[0].substring(0, 11)}...
                            {analysis.fromAddresses[0].substring(
                              analysis.fromAddresses[0].length - 6
                            )}
                          </a>
                        </div>
                      )}
                      {analysis.toAddresses.length > 0 && (
                        <div className="text-xs text-neutral-400">
                          To:{" "}
                          <a
                            href={`https://www.unicity.network/address/${analysis.toAddresses[0]}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-400 hover:text-blue-300 font-mono"
                          >
                            {analysis.toAddresses[0].substring(0, 11)}...
                            {analysis.toAddresses[0].substring(
                              analysis.toAddresses[0].length - 6
                            )}
                          </a>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
