import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSphereContext } from './useSphere';
import { SPHERE_KEYS } from '../../queryKeys';
import type { DmReceivedDetail } from '../../../components/chat/data/chatTypes';

// SDK DM shape (local mirror — SDK DTS not always available)
interface SDKDirectMessage {
  id: string;
  senderPubkey: string;
  recipientPubkey: string;
}

export function useSphereEvents(): void {
  const { sphere } = useSphereContext();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!sphere) return;

    const invalidatePayments = () => {
      queryClient.invalidateQueries({
        queryKey: SPHERE_KEYS.payments.tokens.all,
      });
      queryClient.invalidateQueries({
        queryKey: SPHERE_KEYS.payments.balance.all,
      });
      queryClient.invalidateQueries({
        queryKey: SPHERE_KEYS.payments.assets.all,
      });
      queryClient.invalidateQueries({
        queryKey: SPHERE_KEYS.payments.transactions.all,
      });
    };

    const handleIncomingTransfer = invalidatePayments;
    const handleTransferConfirmed = invalidatePayments;

    const handleNametagChange = () => {
      queryClient.invalidateQueries({ queryKey: SPHERE_KEYS.identity.all });
    };

    const handleIdentityChange = () => {
      queryClient.invalidateQueries({ queryKey: SPHERE_KEYS.identity.all });
      queryClient.invalidateQueries({ queryKey: SPHERE_KEYS.payments.all });
      queryClient.invalidateQueries({ queryKey: SPHERE_KEYS.l1.all });
      // Invalidate all chat queries so UI re-fetches for the new address
      queryClient.invalidateQueries({ queryKey: ['chat'] });
    };

    const handleSyncCompleted = invalidatePayments;

    const handleSyncRemoteUpdate = invalidatePayments;

    // Bridge incoming SDK DMs to lightweight custom event + query invalidation
    const handleDmReceived = (dm: SDKDirectMessage) => {
      const myPubkey = sphere.identity?.chainPubkey;
      const isFromMe = dm.senderPubkey === myPubkey;
      const peerPubkey = isFromMe ? dm.recipientPubkey : dm.senderPubkey;

      // Invalidate chat queries so UI re-reads from SDK
      queryClient.invalidateQueries({ queryKey: ['chat'] });

      // Dispatch lightweight event for UI components (useChat, MiniChatWindow)
      const detail: DmReceivedDetail = { peerPubkey, messageId: dm.id, isFromMe };
      window.dispatchEvent(new CustomEvent('dm-received', { detail }));

      // Invalidate SDK communication queries
      queryClient.invalidateQueries({
        queryKey: SPHERE_KEYS.communications.all,
      });
    };

    // Bridge read receipts — SDK already updated isRead, just invalidate
    const handleMessageRead = () => {
      queryClient.invalidateQueries({ queryKey: ['chat'] });
    };

    // Bridge composing indicators to custom event
    const handleComposingStarted = (data: { senderPubkey: string; senderNametag?: string; expiresIn: number }) => {
      window.dispatchEvent(new CustomEvent('dm-typing', { detail: data }));
    };

    // Bridge incoming payment requests to custom event
    const handlePaymentRequestIncoming = () => {
      window.dispatchEvent(new Event('payment-requests-updated'));
    };

    sphere.on('transfer:incoming', handleIncomingTransfer);
    sphere.on('transfer:confirmed', handleTransferConfirmed);
    sphere.on('nametag:registered', handleNametagChange);
    sphere.on('nametag:recovered', handleNametagChange);
    sphere.on('identity:changed', handleIdentityChange);
    sphere.on('sync:completed', handleSyncCompleted);
    sphere.on('sync:remote-update', handleSyncRemoteUpdate);
    sphere.on('message:dm', handleDmReceived);
    sphere.on('message:read', handleMessageRead);
    sphere.on('composing:started', handleComposingStarted);
    sphere.on('payment_request:incoming', handlePaymentRequestIncoming);

    return () => {
      sphere.off('transfer:incoming', handleIncomingTransfer);
      sphere.off('transfer:confirmed', handleTransferConfirmed);
      sphere.off('nametag:registered', handleNametagChange);
      sphere.off('nametag:recovered', handleNametagChange);
      sphere.off('identity:changed', handleIdentityChange);
      sphere.off('sync:completed', handleSyncCompleted);
      sphere.off('sync:remote-update', handleSyncRemoteUpdate);
      sphere.off('message:dm', handleDmReceived);
      sphere.off('message:read', handleMessageRead);
      sphere.off('composing:started', handleComposingStarted);
      sphere.off('payment_request:incoming', handlePaymentRequestIncoming);
    };
  }, [sphere, queryClient]);
}
