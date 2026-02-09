import { useQuery } from '@tanstack/react-query';
import { useSphereContext } from '../core/useSphere';
import { SPHERE_KEYS } from '../../queryKeys';
import type { Asset } from '../..';

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
    queryFn: async (): Promise<Asset[]> => {
      if (!sphere) return [];
      return await sphere.payments.getAssets();
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
