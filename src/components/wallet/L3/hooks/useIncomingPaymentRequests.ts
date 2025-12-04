import { useState, useEffect } from 'react';
import { type IncomingPaymentRequest } from '../data/model/';
import { useServices } from '../../../../contexts/useServices';

export const useIncomingPaymentRequests = () => {
    const { nostrService } = useServices();
    const [requests, setRequests] = useState<IncomingPaymentRequest[]>([]);

    useEffect(() => {
        const update = () => {
            setRequests([...nostrService.getPaymentRequests()]);
        };

        update();

        window.addEventListener('payment-requests-updated', update);

        return () => {
            window.removeEventListener('payment-requests-updated', update);
        };
    }, [nostrService]);

    return {
        requests,
        pendingCount: requests.filter(r => r.status === 'PENDING').length,
        accept: (request: IncomingPaymentRequest) => nostrService.acceptPaymentRequest(request),
        reject: (request: IncomingPaymentRequest) => nostrService.rejectPaymentRequest(request),
        paid: (request: IncomingPaymentRequest) => nostrService.paidPaymentRequest(request),
        clearProcessed: () => nostrService.clearProcessedPaymentRequests()
    };
};