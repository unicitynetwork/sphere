import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSphereContext } from './useSphere';
import { SPHERE_KEYS } from '../../queryKeys';

export interface UseNametagReturn {
  nametag: string | null;
  isLoading: boolean;
  register: (name: string) => Promise<void>;
  isRegistering: boolean;
  registerError: Error | null;
  resolve: (name: string) => Promise<string | null>;
}

export function useNametag(): UseNametagReturn {
  const { sphere } = useSphereContext();
  const queryClient = useQueryClient();
  const [isRegistering, setIsRegistering] = useState(false);
  const [registerError, setRegisterError] = useState<Error | null>(null);

  const nametag = sphere?.identity?.nametag ?? null;

  const register = useCallback(
    async (name: string) => {
      if (!sphere) throw new Error('Wallet not initialized');
      setIsRegistering(true);
      setRegisterError(null);
      try {
        await sphere.registerNametag(name);
        queryClient.invalidateQueries({ queryKey: SPHERE_KEYS.identity.all });
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setRegisterError(error);
        throw error;
      } finally {
        setIsRegistering(false);
      }
    },
    [sphere, queryClient],
  );

  const resolve = useCallback(
    async (name: string): Promise<string | null> => {
      if (!sphere) return null;
      const transport = sphere.getTransport();
      if (transport.resolveNametag) {
        return transport.resolveNametag(name);
      }
      return null;
    },
    [sphere],
  );

  return {
    nametag,
    isLoading: false,
    register,
    isRegistering,
    registerError,
    resolve,
  };
}
