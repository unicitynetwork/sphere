import { useQuery } from '@tanstack/react-query';
import { useSphereContext } from '../core/useSphere';
import { SPHERE_KEYS } from '../../queryKeys';
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

  const query = useQuery({
    queryKey: SPHERE_KEYS.payments.tokens.list,
    queryFn: async () => {
      if (!sphere) return [];
      return sphere.payments.getTokens();
    },
    enabled: !!sphere,
    staleTime: Infinity,
  });

  const tokens = query.data ?? [];

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
