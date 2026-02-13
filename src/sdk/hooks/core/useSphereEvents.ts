import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSphereContext } from './useSphere';
import { SPHERE_KEYS } from '../../queryKeys';
import { ChatRepository } from '../../../components/chat/data/ChatRepository';
import { ChatMessage, MessageStatus, MessageType } from '../../../components/chat/data/models';
import type { DirectMessage } from '@unicitylabs/sphere-sdk';

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
    };

    const handleSyncCompleted = invalidatePayments;

    const handleSyncRemoteUpdate = invalidatePayments;

    // Bridge incoming SDK DMs to ChatRepository and fire custom event
    const handleDmReceived = (dm: DirectMessage) => {
      const chatRepo = ChatRepository.getInstance();

      // Get or create conversation for the sender
      const conversation = chatRepo.getOrCreateConversation(
        dm.senderPubkey,
        dm.senderNametag ?? undefined,
      );

      // Create ChatMessage from SDK DirectMessage
      const chatMessage = new ChatMessage({
        id: dm.id,
        conversationId: conversation.id,
        content: dm.content,
        timestamp: dm.timestamp,
        isFromMe: false,
        status: MessageStatus.DELIVERED,
        type: MessageType.TEXT,
        senderPubkey: dm.senderPubkey,
        senderNametag: dm.senderNametag ?? undefined,
      });

      // Persist to ChatRepository
      chatRepo.saveMessage(chatMessage);
      chatRepo.incrementUnreadCount(conversation.id);

      // Dispatch custom event for UI components (useChat, MiniChatWindow)
      window.dispatchEvent(new CustomEvent('dm-received', { detail: chatMessage }));

      // Invalidate SDK communication queries
      queryClient.invalidateQueries({
        queryKey: SPHERE_KEYS.communications.all,
      });
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
      sphere.off('payment_request:incoming', handlePaymentRequestIncoming);
    };
  }, [sphere, queryClient]);
}
