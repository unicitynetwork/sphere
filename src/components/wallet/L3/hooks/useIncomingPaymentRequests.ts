import { useState, useEffect, useCallback } from 'react';
import { type IncomingPaymentRequest, PaymentRequestStatus } from '../data/model/';
import { useSphereContext } from '../../../../sdk/hooks/core/useSphere';
import type { IncomingPaymentRequest as SDKPaymentRequest } from '@unicitylabs/sphere-sdk';

/** Bridge SDK payment request to legacy IncomingPaymentRequest model */
function bridgeRequest(sdk: SDKPaymentRequest): IncomingPaymentRequest {
    return {
        id: sdk.id,
        senderPubkey: sdk.senderPubkey,
        amount: BigInt(sdk.amount || '0'),
        coinId: sdk.coinId,
        symbol: sdk.symbol,
        message: sdk.message,
        // Legacy model uses recipientNametag to display "From" (the requester)
        recipientNametag: sdk.senderNametag ?? '',
        requestId: sdk.requestId,
        timestamp: sdk.timestamp,
        status: PaymentRequestStatus.PENDING,
    };
}

export const useIncomingPaymentRequests = () => {
    const { sphere } = useSphereContext();
    const [requests, setRequests] = useState<IncomingPaymentRequest[]>([]);

    useEffect(() => {
        if (!sphere) return;

        const handler = (sdkReq: SDKPaymentRequest) => {
            setRequests(prev => [...prev, bridgeRequest(sdkReq)]);
        };

        sphere.on('payment_request:incoming', handler);

        return () => {
            sphere.off('payment_request:incoming', handler);
        };
    }, [sphere]);

    const updateStatus = useCallback(async (
        request: IncomingPaymentRequest,
        status: typeof PaymentRequestStatus[keyof typeof PaymentRequestStatus],
        responseType: 'accepted' | 'rejected' | 'paid',
    ) => {
        if (!sphere) return;
        const transport = sphere.getTransport();
        if (transport.sendPaymentRequestResponse) {
            await transport.sendPaymentRequestResponse(request.senderPubkey, {
                requestId: request.requestId,
                responseType,
            });
        }
        setRequests(prev =>
            prev.map(r => r.id === request.id ? { ...r, status } : r)
        );
    }, [sphere]);

    return {
        requests,
        pendingCount: requests.filter(r => r.status === PaymentRequestStatus.PENDING).length,
        accept: (request: IncomingPaymentRequest) =>
            updateStatus(request, PaymentRequestStatus.ACCEPTED, 'accepted'),
        reject: (request: IncomingPaymentRequest) =>
            updateStatus(request, PaymentRequestStatus.REJECTED, 'rejected'),
        paid: (request: IncomingPaymentRequest) =>
            updateStatus(request, PaymentRequestStatus.PAID, 'paid'),
        clearProcessed: () =>
            setRequests(prev => prev.filter(r => r.status === PaymentRequestStatus.PENDING)),
    };
};
