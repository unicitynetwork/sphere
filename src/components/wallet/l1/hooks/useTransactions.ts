import { useState, useCallback } from "react";
import {
  createTransactionPlan,
  createAndSignTransaction,
  broadcast,
  getTransactionHistory,
  getTransaction,
  getCurrentBlockHeight,
  type Wallet,
  type TransactionPlan,
  type TransactionHistoryItem,
  type TransactionDetail,
} from "../sdk";

export function useTransactions() {
  const [txPlan, setTxPlan] = useState<TransactionPlan | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [transactions, setTransactions] = useState<TransactionHistoryItem[]>([]);
  const [loadingTransactions, setLoadingTransactions] = useState(false);
  const [currentBlockHeight, setCurrentBlockHeight] = useState(0);
  const [transactionDetails, setTransactionDetails] = useState<Record<string, TransactionDetail>>({});

  const createTxPlan = useCallback(
    async (wallet: Wallet, destination: string, amount: string) => {
      try {
        if (!wallet) return { success: false, error: "No wallet" };
        if (!destination || !amount) {
          return { success: false, error: "Enter destination and amount" };
        }

        const amountAlpha = Number(amount);
        if (isNaN(amountAlpha) || amountAlpha <= 0) {
          return { success: false, error: "Invalid amount" };
        }

        const plan = await createTransactionPlan(wallet, destination, amountAlpha);

        if (!plan.success) {
          return { success: false, error: plan.error };
        }

        setTxPlan(plan);
        return { success: true, plan };
      } catch (err: unknown) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    []
  );

  const sendTransaction = useCallback(
    async (wallet: Wallet, plan: TransactionPlan) => {
      if (!plan || !wallet) return { success: false, error: "No plan or wallet" };

      setIsSending(true);
      try {
        const results = [];
        const errors = [];

        for (const tx of plan.transactions) {
          try {
            const signed = createAndSignTransaction(wallet, tx);
            const result = await broadcast(signed.raw);
            results.push({ txid: signed.txid, raw: signed.raw, result });
          } catch (e: unknown) {
            console.error("Broadcast failed for tx", e);
            errors.push(e instanceof Error ? e.message : String(e));
          }
        }

        setTxPlan(null);

        if (errors.length > 0) {
          return {
            success: false,
            error: `Some transactions failed:\n${errors.join("\n")}`,
            results,
          };
        }

        return { success: true, results };
      } catch (err: unknown) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      } finally {
        setIsSending(false);
      }
    },
    []
  );

  const loadTransactionHistory = useCallback(async (address: string) => {
    if (!address) return;

    setLoadingTransactions(true);
    try {
      const height = await getCurrentBlockHeight();
      setCurrentBlockHeight(height);

      const history = await getTransactionHistory(address);
      const sorted = [...history].sort((a, b) => {
        if (a.height === 0 && b.height === 0) return 0;
        if (a.height === 0) return -1;
        if (b.height === 0) return 1;
        return b.height - a.height;
      });
      setTransactions(sorted);

      const details: Record<string, TransactionDetail> = {};
      for (const tx of sorted) {
        try {
          const detail = (await getTransaction(tx.tx_hash)) as TransactionDetail;
          details[tx.tx_hash] = detail;
        } catch (err) {
          console.error(`Error loading transaction ${tx.tx_hash}:`, err);
        }
      }
      setTransactionDetails(details);
    } catch (err) {
      console.error("Error loading transactions:", err);
      setTransactions([]);
    } finally {
      setLoadingTransactions(false);
    }
  }, []);

  const analyzeTransaction = useCallback(
    (tx: TransactionHistoryItem, detail: TransactionDetail | undefined, wallet: Wallet) => {
      if (!detail || !wallet) {
        return {
          direction: "unknown" as const,
          amount: 0,
          fromAddresses: [] as string[],
          toAddresses: [] as string[],
        };
      }

      const walletAddresses = new Set(wallet.addresses.map((a) => a.address.toLowerCase()));

      let isOutgoing = false;
      const fromAddresses: string[] = [];

      for (const output of detail.vout) {
        const addresses =
          output.scriptPubKey.addresses ||
          (output.scriptPubKey.address ? [output.scriptPubKey.address] : []);
        for (const addr of addresses) {
          if (!walletAddresses.has(addr.toLowerCase())) {
            isOutgoing = true;
          }
        }
      }

      let totalInput = 0;
      let totalOutput = 0;
      const toAddresses: string[] = [];

      for (const output of detail.vout) {
        const addresses =
          output.scriptPubKey.addresses ||
          (output.scriptPubKey.address ? [output.scriptPubKey.address] : []);
        const isOurOutput = addresses.some((addr) =>
          walletAddresses.has(addr.toLowerCase())
        );

        if (isOurOutput) {
          totalInput += output.value;
        } else {
          totalOutput += output.value;
          toAddresses.push(...addresses);
        }
      }

      const direction = isOutgoing ? "sent" : "received";
      const amount = direction === "sent" ? totalOutput : totalInput;

      return {
        direction,
        amount: amount / 100_000_000,
        fromAddresses,
        toAddresses,
      };
    },
    []
  );

  return {
    txPlan,
    setTxPlan,
    isSending,
    transactions,
    loadingTransactions,
    currentBlockHeight,
    transactionDetails,
    createTxPlan,
    sendTransaction,
    loadTransactionHistory,
    analyzeTransaction,
  };
}
