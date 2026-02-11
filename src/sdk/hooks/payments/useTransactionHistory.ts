import { useQuery } from '@tanstack/react-query';
import { useSphereContext } from '../core/useSphere';
import { SPHERE_KEYS } from '../../queryKeys';
import type { TransactionHistoryEntry } from '@unicitylabs/sphere-sdk';

export interface UseTransactionHistoryReturn {
  history: TransactionHistoryEntry[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useTransactionHistory(): UseTransactionHistoryReturn {
  const { sphere } = useSphereContext();

  const query = useQuery({
    queryKey: SPHERE_KEYS.payments.transactions.history,
    queryFn: (): TransactionHistoryEntry[] => {
      if (!sphere) return [];
      return sphere.payments.getHistory();
    },
    enabled: !!sphere,
    staleTime: 30_000,
  });

  return {
    history: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: () => query.refetch(),
  };
}
