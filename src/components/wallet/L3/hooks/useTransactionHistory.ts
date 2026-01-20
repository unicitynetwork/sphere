import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getTransactionHistory } from "../../../../services/TransactionHistoryService";
import { useEffect } from "react";

const KEYS = {
  TRANSACTION_HISTORY: ["wallet", "transaction-history"],
};

export const useTransactionHistory = () => {
  const queryClient = useQueryClient();

  useEffect(() => {
    const handleHistoryUpdate = () => {
      console.log("♻️ Transaction history update detected! Refreshing...");
      queryClient.refetchQueries({ queryKey: KEYS.TRANSACTION_HISTORY });
    };

    // Listen to both wallet updates (legacy) and transaction-history-updated (new)
    window.addEventListener("wallet-updated", handleHistoryUpdate);
    window.addEventListener("transaction-history-updated", handleHistoryUpdate);

    return () => {
      window.removeEventListener("wallet-updated", handleHistoryUpdate);
      window.removeEventListener("transaction-history-updated", handleHistoryUpdate);
    };
  }, [queryClient]);

  const historyQuery = useQuery({
    queryKey: KEYS.TRANSACTION_HISTORY,
    queryFn: () => getTransactionHistory(),
    staleTime: 30000,
  });

  return {
    history: historyQuery.data || [],
    isLoading: historyQuery.isLoading,
  };
};
