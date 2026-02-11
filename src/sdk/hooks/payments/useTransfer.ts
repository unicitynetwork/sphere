import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSphereContext } from '../core/useSphere';
import { SPHERE_KEYS } from '../../queryKeys';
import type { TransferResult } from '@unicitylabs/sphere-sdk';

export interface TransferParams {
  coinId: string;
  amount: string;
  recipient: string;
  memo?: string;
}

export interface UseTransferReturn {
  transfer: (params: TransferParams) => Promise<TransferResult>;
  isLoading: boolean;
  error: Error | null;
  lastResult: TransferResult | null;
  reset: () => void;
}

export function useTransfer(): UseTransferReturn {
  const { sphere } = useSphereContext();
  const queryClient = useQueryClient();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [lastResult, setLastResult] = useState<TransferResult | null>(null);

  const transfer = useCallback(
    async (params: TransferParams): Promise<TransferResult> => {
      if (!sphere) throw new Error('Wallet not initialized');
      setIsLoading(true);
      setError(null);
      try {
        const result = await sphere.payments.send({
          coinId: params.coinId,
          amount: params.amount,
          recipient: params.recipient,
          memo: params.memo,
        });

        setLastResult(result);

        // Force refetch all payment queries with fresh data.
        // Use refetchQueries (not invalidateQueries) to guarantee a new fetch
        // even if a previous refetch from the transfer:confirmed event is in-flight.
        await Promise.all([
          queryClient.refetchQueries({
            queryKey: SPHERE_KEYS.payments.tokens.all,
          }),
          queryClient.refetchQueries({
            queryKey: SPHERE_KEYS.payments.balance.all,
          }),
          queryClient.refetchQueries({
            queryKey: SPHERE_KEYS.payments.assets.all,
          }),
          queryClient.refetchQueries({
            queryKey: SPHERE_KEYS.payments.transactions.all,
          }),
        ]);

        return result;
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        throw e;
      } finally {
        setIsLoading(false);
      }
    },
    [sphere, queryClient],
  );

  const reset = useCallback(() => {
    setError(null);
    setLastResult(null);
  }, []);

  return { transfer, isLoading, error, lastResult, reset };
}
