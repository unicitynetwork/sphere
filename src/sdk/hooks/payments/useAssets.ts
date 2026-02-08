import { useQuery } from '@tanstack/react-query';
import { useSphereContext } from '../core/useSphere';
import { SPHERE_KEYS } from '../../queryKeys';

export interface Asset {
  coinId: string;
  symbol: string;
  name: string;
  totalAmount: string;
  decimals: number;
  tokenCount: number;
}

export interface UseAssetsReturn {
  assets: Asset[];
  isLoading: boolean;
  error: Error | null;
  assetCount: number;
}

export function useAssets(): UseAssetsReturn {
  const { sphere } = useSphereContext();

  const query = useQuery({
    queryKey: SPHERE_KEYS.payments.assets.list,
    queryFn: (): Asset[] => {
      if (!sphere) return [];
      // getBalance() with no args returns all coin balances
      const balances = sphere.payments.getBalance();
      return balances.map((b) => ({
        coinId: b.coinId,
        symbol: b.symbol,
        name: b.symbol,
        totalAmount: b.totalAmount,
        decimals: b.decimals,
        tokenCount: b.tokenCount,
      }));
    },
    enabled: !!sphere,
    staleTime: 30_000,
  });

  const assets = query.data ?? [];

  return {
    assets,
    isLoading: query.isLoading,
    error: query.error,
    assetCount: assets.length,
  };
}
