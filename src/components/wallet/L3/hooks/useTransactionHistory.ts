import { useQuery, useQueryClient } from "@tanstack/react-query";
import { WalletRepository } from "../../../../repositories/WalletRepository";
import { useEffect } from "react";

const KEYS = {
  TRANSACTION_HISTORY: ["wallet", "transaction-history"],
};

const walletRepo = WalletRepository.getInstance();

export const useTransactionHistory = () => {
  const queryClient = useQueryClient();

  useEffect(() => {
    const handleWalletUpdate = () => {
      console.log("♻️ Wallet update detected! Refreshing transaction history...");
      queryClient.refetchQueries({ queryKey: KEYS.TRANSACTION_HISTORY });
    };

    window.addEventListener("wallet-updated", handleWalletUpdate);
    return () => window.removeEventListener("wallet-updated", handleWalletUpdate);
  }, [queryClient]);

  const historyQuery = useQuery({
    queryKey: KEYS.TRANSACTION_HISTORY,
    queryFn: () => walletRepo.getTransactionHistory(),
    staleTime: 30000,
  });

  return {
    history: historyQuery.data || [],
    isLoading: historyQuery.isLoading,
  };
};
