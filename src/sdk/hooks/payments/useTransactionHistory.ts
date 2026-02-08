import { useQuery } from '@tanstack/react-query';
import { useSphereContext } from '../core/useSphere';
import { SPHERE_KEYS } from '../../queryKeys';

export interface Transaction {
  id: string;
  type: 'incoming' | 'outgoing';
  coinId: string;
  symbol: string;
  amount: string;
  counterparty: string;
  timestamp: number;
  status: 'completed' | 'pending' | 'failed';
  memo?: string;
}

export interface UseTransactionHistoryReturn {
  transactions: Transaction[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
  incoming: Transaction[];
  outgoing: Transaction[];
}

export function useTransactionHistory(): UseTransactionHistoryReturn {
  const { sphere } = useSphereContext();

  const query = useQuery({
    queryKey: SPHERE_KEYS.payments.transactions.history,
    queryFn: (): Transaction[] => {
      if (!sphere) return [];
      // SDK uses getHistory() returning TransactionHistoryEntry[]
      const history = sphere.payments.getHistory();
      return history.map((tx) => ({
        id: tx.id,
        type: (tx.type === 'RECEIVED' ? 'incoming' : 'outgoing') as
          | 'incoming'
          | 'outgoing',
        coinId: tx.coinId,
        symbol: tx.symbol,
        amount: tx.amount,
        counterparty: tx.counterparty ?? '',
        timestamp: tx.timestamp,
        status: 'completed' as const,
        memo: tx.memo,
      }));
    },
    enabled: !!sphere,
    staleTime: 30_000,
  });

  const transactions = query.data ?? [];

  return {
    transactions,
    isLoading: query.isLoading,
    error: query.error,
    refetch: () => query.refetch(),
    incoming: transactions.filter((t) => t.type === 'incoming'),
    outgoing: transactions.filter((t) => t.type === 'outgoing'),
  };
}
