import { useState, useEffect } from 'react';
import { NostrService } from '../services/NostrService';
import { IdentityManager } from '../services/IdentityManager';
import { type IncomingPaymentRequest } from '../data/model/';

const SESSION_KEY = "user-pin-1234";

export const useIncomingPaymentRequests = () => {
    const [requests, setRequests] = useState<IncomingPaymentRequest[]>([]);

    useEffect(() => {
        const identityManager = new IdentityManager(SESSION_KEY);
        const service = NostrService.getInstance(identityManager);

        const update = () => {
            setRequests([...service.getPaymentRequests()]);
        };

        update();

        window.addEventListener('payment-requests-updated', update);

        return () => {
            window.removeEventListener('payment-requests-updated', update);
        };
    }, []);

    const identityManager = new IdentityManager(SESSION_KEY);
    const service = NostrService.getInstance(identityManager);

    return {
        requests,
        pendingCount: requests.filter(r => r.status === 'PENDING').length,
        accept: (request: IncomingPaymentRequest) => service.acceptPaymentRequest(request),
        reject: (request: IncomingPaymentRequest) => service.rejectPaymentRequest(request),
        paid: (request: IncomingPaymentRequest) => service.paidPaymentRequest(request),
        clearProcessed: () => service.clearProcessedPaymentRequests()
    };
};