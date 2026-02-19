import { useQuery } from '@tanstack/react-query';
import { useState, useEffect, useMemo } from 'react';
import { useSphereContext } from '../core/useSphere';
import { SPHERE_KEYS } from '../../queryKeys';
import { TokenRegistry } from '@unicitylabs/sphere-sdk';
import type { Asset } from '../..';

export interface UseAssetsReturn {
  assets: Asset[];
  isLoading: boolean;
  error: Error | null;
  assetCount: number;
}

export function useAssets(): UseAssetsReturn {
  const { sphere } = useSphereContext();
  const [registryReady, setRegistryReady] = useState(
    () => TokenRegistry.getInstance().getAllDefinitions().length > 0,
  );

  // Wait for TokenRegistry to load from remote, then trigger re-render
  // so asset symbols get resolved from the registry.
  useEffect(() => {
    if (registryReady) return;
    let cancelled = false;
    TokenRegistry.waitForReady(15_000).then((loaded) => {
      if (!cancelled && loaded) setRegistryReady(true);
    });
    return () => { cancelled = true; };
  }, [registryReady]);

  const query = useQuery({
    queryKey: SPHERE_KEYS.payments.assets.list,
    queryFn: async (): Promise<Asset[]> => {
      if (!sphere) return [];
      return await sphere.payments.getAssets();
    },
    enabled: !!sphere,
    staleTime: 30_000,
  });

  // Enrich assets with registry data — SDK bakes symbol at token creation
  // time before the registry has loaded, so we override here.
  const assets = useMemo(() => {
    const rawAssets = query.data ?? [];
    if (!registryReady) return rawAssets;
    const registry = TokenRegistry.getInstance();
    return rawAssets.map((a) => {
      const def = registry.getDefinition(a.coinId);
      if (!def) return a;
      return {
        ...a,
        symbol: def.symbol || a.symbol,
        name: def.name
          ? def.name.charAt(0).toUpperCase() + def.name.slice(1)
          : a.name,
        decimals: def.decimals ?? a.decimals,
        iconUrl: registry.getIconUrl(a.coinId) || a.iconUrl,
      };
    });
  }, [query.data, registryReady]);

  return {
    assets,
    isLoading: query.isLoading,
    error: query.error,
    assetCount: assets.length,
  };
}
