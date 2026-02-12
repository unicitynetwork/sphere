import { useState, useEffect, useCallback } from 'react';
import { useSphereContext } from '../core/useSphere';
import type { IncomingPaymentRequest as SDKPaymentRequest } from '../../types';

export interface UsePaymentRequestsReturn {
  requests: SDKPaymentRequest[];
  isLoading: boolean;
  respondToRequest: (
    requestId: string,
    senderPubkey: string,
    responseType: 'accepted' | 'rejected' | 'paid',
  ) => Promise<void>;
}

export function usePaymentRequests(): UsePaymentRequestsReturn {
  const { sphere } = useSphereContext();
  const [requests, setRequests] = useState<SDKPaymentRequest[]>([]);
  const [isLoading] = useState(false);

  useEffect(() => {
    if (!sphere) return;
    const transport = sphere.getTransport();
    if (!transport.onPaymentRequest) return;

    const unsub = transport.onPaymentRequest((req) => {
      setRequests((prev) => [...prev, req as unknown as SDKPaymentRequest]);
    });

    return unsub;
  }, [sphere]);

  const respondToRequest = useCallback(
    async (
      requestId: string,
      senderPubkey: string,
      responseType: 'accepted' | 'rejected' | 'paid',
    ) => {
      if (!sphere) throw new Error('Wallet not initialized');
      const transport = sphere.getTransport();
      if (!transport.sendPaymentRequestResponse) {
        throw new Error('Payment request responses not supported');
      }
      await transport.sendPaymentRequestResponse(senderPubkey, {
        requestId,
        responseType,
      });
      setRequests((prev) =>
        prev.filter((r) => r.id !== requestId),
      );
    },
    [sphere],
  );

  return { requests, isLoading, respondToRequest };
}
