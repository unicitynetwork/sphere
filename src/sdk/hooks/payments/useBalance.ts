import { useQuery } from '@tanstack/react-query';
import { useSphereContext } from '../core/useSphere';
import { SPHERE_KEYS } from '../../queryKeys';
import type { Asset } from '../..';
import { formatAmount } from '../../utils/format';

export interface UseBalanceReturn {
  asset: Asset | null;
  isLoading: boolean;
  error: Error | null;
  total: string;
  totalRaw: string;
  fiatValueUsd: number | null;
}

/**
 * Get balance for a specific coin or total portfolio value
 * @param coinId - Coin ID to get balance for, or undefined for total portfolio value in USD
 */
export function useBalance(coinId?: string): UseBalanceReturn {
  const { sphere } = useSphereContext();

  const query = useQuery({
    queryKey: coinId
      ? SPHERE_KEYS.payments.balance.byCoin(coinId)
      : SPHERE_KEYS.payments.balance.total,
    queryFn: async () => {
      if (!sphere) return null;

      if (coinId) {
        // Get specific asset
        const assets = await sphere.payments.getAssets(coinId);
        return assets.length > 0 ? assets[0] : null;
      } else {
        // Get total portfolio value - not returning an asset, just the value
        return await sphere.payments.getFiatBalance();
      }
    },
    enabled: !!sphere,
    staleTime: 30_000,
    structuralSharing: false,
  });

  const asset = (coinId && query.data && typeof query.data !== 'number') ? query.data as Asset : null;
  const totalValue = !coinId && typeof query.data === 'number' ? query.data : null;

  return {
    asset,
    isLoading: query.isLoading,
    error: query.error,
    total: asset ? formatAmount(asset.totalAmount, asset.decimals) : '0',
    totalRaw: asset?.totalAmount ?? '0',
    fiatValueUsd: asset?.fiatValueUsd ?? totalValue,
  };
}
