import { useEffect, useRef } from 'react';
import { useSphereContext } from '../core/useSphere';
import { ChatRepository } from '../../../components/chat/data/ChatRepository';
import { ChatMessage, MessageStatus, MessageType } from '../../../components/chat/data/models';

/**
 * Hydrate ChatRepository from SDK message store on login.
 *
 * SDK persists DMs in localStorage (survives logout).
 * This hook rebuilds the app-level ChatRepository from that data,
 * preserving correct unread counts (read messages stay read).
 */
export function useHydrateChatFromSDK(): void {
  const { sphere } = useSphereContext();
  const hydratedRef = useRef(false);

  useEffect(() => {
    if (!sphere || hydratedRef.current) return;
    hydratedRef.current = true;

    const chatRepo = ChatRepository.getInstance();
    const sdkConversations = sphere.communications.getConversations();

    if (sdkConversations.size === 0) return;

    let hydrated = 0;

    for (const [peerPubkey, messages] of sdkConversations) {
      // Find nametag from any message in the conversation
      const peerNametag = messages.find(
        (m) => m.senderPubkey === peerPubkey && m.senderNametag,
      )?.senderNametag
        ?? messages.find((m) => m.recipientPubkey === peerPubkey && m.recipientNametag)
          ?.recipientNametag;

      const conversation = chatRepo.getOrCreateConversation(
        peerPubkey,
        peerNametag ?? undefined,
      );

      let unreadCount = 0;

      for (const dm of messages) {
        // Dedup: skip if already in ChatRepository
        if (chatRepo.getMessage(dm.id)) continue;

        const isFromMe = dm.senderPubkey !== peerPubkey;

        let status: MessageStatus;
        if (isFromMe) {
          // Own sent messages
          status = dm.isRead ? MessageStatus.READ : MessageStatus.SENT;
        } else {
          // Incoming messages
          status = MessageStatus.DELIVERED;
          if (!dm.isRead) {
            unreadCount++;
          }
        }

        const chatMessage = new ChatMessage({
          id: dm.id,
          conversationId: conversation.id,
          content: dm.content,
          timestamp: dm.timestamp,
          isFromMe,
          status,
          type: MessageType.TEXT,
          senderPubkey: dm.senderPubkey,
          senderNametag: dm.senderNametag ?? undefined,
        });

        chatRepo.saveMessage(chatMessage);
        hydrated++;
      }

      // Set correct unread count from SDK state
      if (unreadCount !== conversation.unreadCount) {
        conversation.unreadCount = unreadCount;
        chatRepo.saveConversation(conversation);
      }
    }

    if (hydrated > 0) {
      console.log(`[useHydrateChatFromSDK] Hydrated ${hydrated} messages from SDK`);
      window.dispatchEvent(new CustomEvent('chat-updated'));
    }
  }, [sphere]);
}
