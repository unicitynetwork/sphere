import { useQuery } from '@tanstack/react-query';
import { useSphereContext } from '../core/useSphere';
import { SPHERE_KEYS } from '../../queryKeys';
import type { TokenBalance } from '@unicitylabs/sphere-sdk';
import { formatAmount } from '../../utils/format';

export interface UseBalanceReturn {
  balance: TokenBalance | null;
  isLoading: boolean;
  error: Error | null;
  total: string;
  confirmed: string;
  unconfirmed: string;
  totalRaw: string;
  confirmedRaw: string;
  unconfirmedRaw: string;
}

export function useBalance(coinId: string = 'ALPHA'): UseBalanceReturn {
  const { sphere } = useSphereContext();

  const query = useQuery({
    queryKey: SPHERE_KEYS.payments.balance.byCoin(coinId),
    queryFn: () => {
      if (!sphere) return null;
      // getBalance returns TokenBalance[], find the one for our coinId
      const balances = sphere.payments.getBalance(coinId);
      return balances.length > 0 ? balances[0] : null;
    },
    enabled: !!sphere,
    staleTime: 30_000,
  });

  const balance = query.data ?? null;

  return {
    balance,
    isLoading: query.isLoading,
    error: query.error,
    total: balance ? formatAmount(balance.totalAmount, balance.decimals) : '0',
    confirmed: balance
      ? formatAmount(balance.confirmedAmount, balance.decimals)
      : '0',
    unconfirmed: balance
      ? formatAmount(balance.unconfirmedAmount, balance.decimals)
      : '0',
    totalRaw: balance?.totalAmount ?? '0',
    confirmedRaw: balance?.confirmedAmount ?? '0',
    unconfirmedRaw: balance?.unconfirmedAmount ?? '0',
  };
}
