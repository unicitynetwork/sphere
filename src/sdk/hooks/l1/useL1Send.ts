import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSphereContext } from '../core/useSphere';
import { SPHERE_KEYS } from '../../queryKeys';

export interface L1SendParams {
  toAddress: string;
  amount: string;
  feeRate?: number;
  useVested?: boolean;
}

export interface L1SendResult {
  txHash: string;
  fee: string;
}

export interface UseL1SendReturn {
  send: (params: L1SendParams) => Promise<L1SendResult>;
  isLoading: boolean;
  error: Error | null;
  lastResult: L1SendResult | null;
}

export function useL1Send(): UseL1SendReturn {
  const { sphere } = useSphereContext();
  const queryClient = useQueryClient();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [lastResult, setLastResult] = useState<L1SendResult | null>(null);

  const send = useCallback(
    async (params: L1SendParams): Promise<L1SendResult> => {
      if (!sphere) throw new Error('Wallet not initialized');
      const l1 = sphere.payments.l1;
      if (!l1) throw new Error('L1 not available');

      setIsLoading(true);
      setError(null);
      try {
        // SDK L1SendRequest uses `to` not `toAddress`
        const result = await l1.send({
          to: params.toAddress,
          amount: params.amount,
          feeRate: params.feeRate,
          useVested: params.useVested,
        });

        if (!result.success) {
          throw new Error(result.error ?? 'L1 send failed');
        }

        const sendResult: L1SendResult = {
          txHash: result.txHash ?? '',
          fee: result.fee ?? '0',
        };
        setLastResult(sendResult);

        queryClient.invalidateQueries({ queryKey: SPHERE_KEYS.l1.all });

        return sendResult;
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

  return { send, isLoading, error, lastResult };
}
