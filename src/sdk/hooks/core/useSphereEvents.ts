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

      // Determine if this is our own sent message (self-wrap replay)
      const myPubkey = sphere.identity?.chainPubkey;
      const isFromMe = dm.senderPubkey === myPubkey;
      const peerPubkey = isFromMe ? dm.recipientPubkey : dm.senderPubkey;
      const peerNametag = isFromMe ? dm.recipientNametag : dm.senderNametag;

      const conversation = chatRepo.getOrCreateConversation(
        peerPubkey,
        peerNametag ?? undefined,
      );

      // Dedup: skip if already in ChatRepository
      if (chatRepo.getMessage(dm.id)) {
        return;
      }

      // Create ChatMessage from SDK DirectMessage
      const chatMessage = new ChatMessage({
        id: dm.id,
        conversationId: conversation.id,
        content: dm.content,
        timestamp: dm.timestamp,
        isFromMe,
        status: isFromMe
          ? (dm.isRead ? MessageStatus.READ : MessageStatus.SENT)
          : MessageStatus.DELIVERED,
        type: MessageType.TEXT,
        senderPubkey: dm.senderPubkey,
        senderNametag: dm.senderNametag ?? undefined,
      });

      // Persist to ChatRepository
      chatRepo.saveMessage(chatMessage);
      if (!isFromMe) {
        // Only increment unread for live messages, not relay replays.
        // Replayed messages have timestamps well in the past.
        const age = Date.now() - dm.timestamp;
        if (age < 10_000) {
          chatRepo.incrementUnreadCount(conversation.id);
        }
      }

      // Dispatch custom event for UI components (useChat, MiniChatWindow)
      window.dispatchEvent(new CustomEvent('dm-received', { detail: chatMessage }));

      // Invalidate SDK communication queries
      queryClient.invalidateQueries({
        queryKey: SPHERE_KEYS.communications.all,
      });
    };

    // Bridge read receipts to ChatRepository
    const handleMessageRead = (data: { messageIds: string[]; peerPubkey: string }) => {
      const chatRepo = ChatRepository.getInstance();
      for (const msgId of data.messageIds) {
        chatRepo.updateMessageStatus(msgId, MessageStatus.READ);
      }
      window.dispatchEvent(new CustomEvent('chat-updated'));
    };

    // Bridge typing indicators to custom event
    const handleMessageTyping = (data: { senderPubkey: string; senderNametag?: string; timestamp: number }) => {
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
    sphere.on('message:typing', handleMessageTyping);
    sphere.on('payment_request:incoming', handlePaymentRequestIncoming);

    // Hydrate ChatRepository from messages already in SDK.
    // Relay events may arrive before these handlers are registered,
    // so we catch up by reading the SDK's current state.
    const sdkConversations = sphere.communications.getConversations();
    if (sdkConversations.size > 0) {
      const chatRepo = ChatRepository.getInstance();
      const myPubkey = sphere.identity?.chainPubkey;
      for (const [peerPubkey, messages] of sdkConversations) {
        const peerNametag = messages.find(
          (m) => m.senderPubkey === peerPubkey && m.senderNametag,
        )?.senderNametag
          ?? messages.find((m) => m.recipientPubkey === peerPubkey && m.recipientNametag)
            ?.recipientNametag;

        const conversation = chatRepo.getOrCreateConversation(
          peerPubkey,
          peerNametag ?? undefined,
        );

        for (const dm of messages) {
          if (chatRepo.getMessage(dm.id)) continue;
          const isFromMe = dm.senderPubkey === myPubkey;
          const chatMessage = new ChatMessage({
            id: dm.id,
            conversationId: conversation.id,
            content: dm.content,
            timestamp: dm.timestamp,
            isFromMe,
            status: isFromMe
              ? (dm.isRead ? MessageStatus.READ : MessageStatus.SENT)
              : MessageStatus.DELIVERED,
            type: MessageType.TEXT,
            senderPubkey: dm.senderPubkey,
            senderNametag: dm.senderNametag ?? undefined,
          });
          chatRepo.saveMessage(chatMessage);
        }
      }
      window.dispatchEvent(new CustomEvent('chat-updated'));
    }

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
      sphere.off('message:typing', handleMessageTyping);
      sphere.off('payment_request:incoming', handlePaymentRequestIncoming);
    };
  }, [sphere, queryClient]);
}
