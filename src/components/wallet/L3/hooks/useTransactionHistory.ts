import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getTransactionHistory } from "../../../../services/TransactionHistoryService";
import { useEffect } from "react";
import { SPHERE_KEYS } from "../../../../sdk/queryKeys";

export const useTransactionHistory = () => {
  const queryClient = useQueryClient();

  useEffect(() => {
    const handleHistoryUpdate = () => {
      if (import.meta.env.DEV) console.log("♻️ Transaction history update detected! Refreshing...");
      queryClient.refetchQueries({ queryKey: SPHERE_KEYS.payments.transactions.history });
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
    queryKey: SPHERE_KEYS.payments.transactions.history,
    queryFn: () => getTransactionHistory(),
    staleTime: 30000,
  });

  return {
    history: historyQuery.data || [],
    isLoading: historyQuery.isLoading,
  };
};
