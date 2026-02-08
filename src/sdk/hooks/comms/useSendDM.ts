import { useState, useCallback } from 'react';
import { useSphereContext } from '../core/useSphere';
import type { DirectMessage } from '@unicitylabs/sphere-sdk';

export interface UseSendDMReturn {
  sendDM: (recipient: string, content: string) => Promise<DirectMessage>;
  isLoading: boolean;
  error: Error | null;
}

export function useSendDM(): UseSendDMReturn {
  const { sphere } = useSphereContext();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const sendDM = useCallback(
    async (recipient: string, content: string): Promise<DirectMessage> => {
      if (!sphere) throw new Error('Wallet not initialized');
      setIsLoading(true);
      setError(null);
      try {
        return await sphere.communications.sendDM(recipient, content);
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        throw e;
      } finally {
        setIsLoading(false);
      }
    },
    [sphere],
  );

  return { sendDM, isLoading, error };
}
