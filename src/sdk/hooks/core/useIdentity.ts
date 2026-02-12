import { useQuery } from '@tanstack/react-query';
import { useSphereContext } from './useSphere';
import { SPHERE_KEYS } from '../../queryKeys';
import type { Identity } from '@unicitylabs/sphere-sdk';

export interface UseIdentityReturn {
  identity: Identity | null;
  isLoading: boolean;
  error: Error | null;
  directAddress: string | null;
  l1Address: string | null;
  nametag: string | null;
  displayName: string;
  shortAddress: string;
}

export function useIdentity(): UseIdentityReturn {
  const { sphere } = useSphereContext();

  const query = useQuery({
    queryKey: SPHERE_KEYS.identity.current,
    queryFn: () => sphere?.identity ?? null,
    enabled: !!sphere,
    staleTime: Infinity,
  });

  const identity = query.data ?? null;

  return {
    identity,
    isLoading: query.isLoading,
    error: query.error,
    directAddress: identity?.directAddress ?? null,
    l1Address: identity?.l1Address ?? null,
    nametag: identity?.nametag ?? null,
    displayName: identity?.nametag
      ? `@${identity.nametag}`
      : identity?.directAddress?.slice(0, 12) ?? 'Unknown',
    shortAddress: identity?.directAddress?.slice(0, 12) ?? '',
  };
}
