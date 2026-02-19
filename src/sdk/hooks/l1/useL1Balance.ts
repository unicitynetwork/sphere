import { useQuery } from '@tanstack/react-query';
import { useSphereContext } from '../core/useSphere';
import { SPHERE_KEYS } from '../../queryKeys';
import { formatAmount } from '../../utils/format';

export interface L1BalanceData {
  confirmed: string;
  unconfirmed: string;
  total: string;
  vested: string;
  unvested: string;
}

export interface UseL1BalanceReturn {
  balance: L1BalanceData | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
  totalFormatted: string;
  vestedFormatted: string;
  unvestedFormatted: string;
}

export function useL1Balance(): UseL1BalanceReturn {
  const { sphere } = useSphereContext();

  const query = useQuery({
    queryKey: SPHERE_KEYS.l1.balance,
    queryFn: async (): Promise<L1BalanceData | null> => {
      if (!sphere) return null;
      const l1 = sphere.payments.l1;
      if (!l1) return null;
      const bal = await Promise.race([
        l1.getBalance(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('L1 balance timeout')), 15_000),
        ),
      ]);
      return {
        confirmed: bal.confirmed,
        unconfirmed: bal.unconfirmed,
        total: bal.total,
        vested: bal.vested ?? '0',
        unvested: bal.unvested ?? '0',
      };
    },
    enabled: !!sphere,
    staleTime: 30_000,
    retry: 1,
    retryDelay: 2_000,
  });

  const balance = query.data ?? null;

  return {
    balance,
    isLoading: query.isLoading,
    error: query.error,
    refetch: () => query.refetch(),
    totalFormatted: balance ? formatAmount(balance.total, 8) : '0',
    vestedFormatted: balance ? formatAmount(balance.vested, 8) : '0',
    unvestedFormatted: balance ? formatAmount(balance.unvested, 8) : '0',
  };
}
