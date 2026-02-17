import { useQuery } from '@tanstack/react-query';
import { useState, useEffect, useMemo } from 'react';
import { useSphereContext } from '../core/useSphere';
import { SPHERE_KEYS } from '../../queryKeys';
import { TokenRegistry } from '@unicitylabs/sphere-sdk';
import type { Token } from '@unicitylabs/sphere-sdk';

export interface UseTokensReturn {
  tokens: Token[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
  tokenCount: number;
  hasTokens: boolean;
  confirmedTokens: Token[];
  pendingTokens: Token[];
}

export function useTokens(): UseTokensReturn {
  const { sphere } = useSphereContext();
  const [registryReady, setRegistryReady] = useState(
    () => TokenRegistry.getInstance().getAllDefinitions().length > 0,
  );

  // Wait for TokenRegistry to load from remote, then trigger re-render
  // so token symbols get resolved from the registry.
  useEffect(() => {
    if (registryReady) return;
    let cancelled = false;
    TokenRegistry.waitForReady(15_000).then((loaded) => {
      if (!cancelled && loaded) setRegistryReady(true);
    });
    return () => { cancelled = true; };
  }, [registryReady]);

  const query = useQuery({
    queryKey: SPHERE_KEYS.payments.tokens.list,
    queryFn: async () => {
      if (!sphere) return [];
      return sphere.payments.getTokens();
    },
    enabled: !!sphere,
    staleTime: 30_000,
    structuralSharing: false,
  });

  // Enrich tokens with registry data — SDK bakes symbol at creation time
  // before the registry has loaded, so we override here.
  const tokens = useMemo(() => {
    const rawTokens = query.data ?? [];
    if (!registryReady) return rawTokens;
    const registry = TokenRegistry.getInstance();
    return rawTokens.map((t) => {
      const def = registry.getDefinition(t.coinId);
      if (!def) return t;
      return {
        ...t,
        symbol: def.symbol || t.symbol,
        name: def.name
          ? def.name.charAt(0).toUpperCase() + def.name.slice(1)
          : t.name,
        decimals: def.decimals ?? t.decimals,
        iconUrl: registry.getIconUrl(t.coinId) || t.iconUrl,
      };
    });
  }, [query.data, registryReady]);

  return {
    tokens,
    isLoading: query.isLoading,
    error: query.error,
    refetch: () => query.refetch(),
    tokenCount: tokens.length,
    hasTokens: tokens.length > 0,
    confirmedTokens: tokens.filter((t) => t.status === 'confirmed'),
    pendingTokens: tokens.filter(
      (t) => t.status === 'pending' || t.status === 'submitted',
    ),
  };
}
