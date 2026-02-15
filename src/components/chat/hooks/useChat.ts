import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChatRepository } from '../data/ChatRepository';
import { ChatMessage, ChatConversation, MessageStatus, MessageType } from '../data/models';
import { useSphereContext } from '../../../sdk/hooks/core/useSphere';
import { STORAGE_KEYS } from '../../../config/storageKeys';

const QUERY_KEYS = {
  CONVERSATIONS: ['chat', 'conversations'],
  MESSAGES: (conversationId: string) => ['chat', 'messages', conversationId],
  UNREAD_COUNT: ['chat', 'unreadCount'],
};

const chatRepository = ChatRepository.getInstance();

export interface UseChatReturn {
  // Conversations
  conversations: ChatConversation[];
  isLoadingConversations: boolean;
  selectedConversation: ChatConversation | null;
  selectConversation: (conversation: ChatConversation | null) => void;
  startNewConversation: (pubkeyOrNametag: string) => Promise<ChatConversation | null>;
  deleteConversation: (id: string) => void;

  // Messages
  messages: ChatMessage[];
  isLoadingMessages: boolean;
  sendMessage: (content: string) => Promise<boolean>;
  isSending: boolean;

  // Input state
  messageInput: string;
  setMessageInput: (value: string) => void;

  // Unread
  totalUnreadCount: number;
  markAsRead: (conversationId: string) => void;

  // Typing indicator
  isRecipientTyping: boolean;

  // Search/Filter
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  filteredConversations: ChatConversation[];
}

export const useChat = (): UseChatReturn => {
  const queryClient = useQueryClient();
  const { sphere } = useSphereContext();
  const [selectedConversation, setSelectedConversation] = useState<ChatConversation | null>(null);
  const [messageInput, setMessageInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isRecipientTyping, setIsRecipientTyping] = useState(false);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Listen for chat updates
  useEffect(() => {
    const handleChatUpdate = () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.CONVERSATIONS });
      if (selectedConversation) {
        queryClient.invalidateQueries({
          queryKey: QUERY_KEYS.MESSAGES(selectedConversation.id),
        });
      }
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.UNREAD_COUNT });
    };

    const handleDMReceived = (event: CustomEvent<ChatMessage>) => {
      const message = event.detail;
      // If we're viewing this conversation, refetch messages
      if (selectedConversation && message.conversationId === selectedConversation.id) {
        queryClient.invalidateQueries({
          queryKey: QUERY_KEYS.MESSAGES(selectedConversation.id),
        });
        // Auto-mark as read since user is viewing
        chatRepository.markConversationAsRead(selectedConversation.id);
        // Send SDK read receipt
        if (sphere) {
          sphere.communications.markAsRead([message.id]);
        }
        // Clear typing indicator — they sent their message
        if (!message.isFromMe) {
          setIsRecipientTyping(false);
          clearTimeout(typingTimeoutRef.current);
        }
      }
      // Always refetch conversations for updated last message
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.CONVERSATIONS });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.UNREAD_COUNT });
    };

    // Listen for typing indicator events
    const handleTyping = (e: CustomEvent) => {
      if (selectedConversation && e.detail.senderPubkey === selectedConversation.participantPubkey) {
        setIsRecipientTyping(true);
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => setIsRecipientTyping(false), 1500);
      }
    };

    window.addEventListener('chat-updated', handleChatUpdate);
    window.addEventListener('dm-received', handleDMReceived as EventListener);
    window.addEventListener('dm-typing', handleTyping as EventListener);

    return () => {
      window.removeEventListener('chat-updated', handleChatUpdate);
      window.removeEventListener('dm-received', handleDMReceived as EventListener);
      window.removeEventListener('dm-typing', handleTyping as EventListener);
      clearTimeout(typingTimeoutRef.current);
    };
  }, [queryClient, selectedConversation, sphere]);

  // Query conversations
  const conversationsQuery = useQuery({
    queryKey: QUERY_KEYS.CONVERSATIONS,
    queryFn: () => chatRepository.getConversations(),
    staleTime: 30000,
  });

  // Restore selected conversation from localStorage when conversations are loaded
  useEffect(() => {
    if (conversationsQuery.data && conversationsQuery.data.length > 0 && !selectedConversation) {
      const savedConversationId = localStorage.getItem(STORAGE_KEYS.CHAT_SELECTED_DM);
      if (savedConversationId) {
        const savedConversation = conversationsQuery.data.find((c) => c.id === savedConversationId);
        if (savedConversation) {
          setSelectedConversation(savedConversation);
        }
      }
    }
  }, [conversationsQuery.data, selectedConversation]);

  // Query messages for selected conversation
  const messagesQuery = useQuery({
    queryKey: QUERY_KEYS.MESSAGES(selectedConversation?.id || ''),
    queryFn: () => {
      if (!selectedConversation) return [];
      return chatRepository.getMessagesForConversation(selectedConversation.id);
    },
    enabled: !!selectedConversation,
    staleTime: 10000,
  });

  // Query total unread count
  const unreadCountQuery = useQuery({
    queryKey: QUERY_KEYS.UNREAD_COUNT,
    queryFn: () => chatRepository.getTotalUnreadCount(),
    staleTime: 30000,
  });

  // Send message mutation
  const sendMessageMutation = useMutation({
    mutationFn: async (content: string) => {
      if (!selectedConversation || !sphere) throw new Error('No conversation selected');

      const dm = await sphere.communications.sendDM(
        selectedConversation.participantPubkey,
        content,
      );

      // Save sent message to ChatRepository for local persistence
      const chatMessage = new ChatMessage({
        id: dm.id,
        conversationId: selectedConversation.id,
        content: dm.content,
        timestamp: dm.timestamp,
        isFromMe: true,
        status: MessageStatus.SENT,
        type: MessageType.TEXT,
        senderPubkey: dm.senderPubkey,
        senderNametag: dm.senderNametag ?? undefined,
      });
      chatRepository.saveMessage(chatMessage);

      return true;
    },
    onSuccess: () => {
      setMessageInput('');
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.MESSAGES(selectedConversation?.id || ''),
      });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.CONVERSATIONS });
    },
  });

  // Start new conversation
  const startNewConversation = useCallback(
    async (identifier: string): Promise<ChatConversation | null> => {
      try {
        if (!sphere) return null;

        // Normalize: add @ for bare nametags (not an address or pubkey)
        const input = identifier.startsWith('@') || identifier.startsWith('DIRECT:') || identifier.startsWith('PROXY:')
          || identifier.startsWith('alpha') || /^[0-9a-fA-F]{64,66}$/.test(identifier)
          ? identifier
          : `@${identifier}`;

        const peerInfo = await sphere.resolve(input);
        if (!peerInfo?.transportPubkey) {
          console.error(`Could not resolve: ${identifier}`);
          return null;
        }

        const conversation = chatRepository.getOrCreateConversation(peerInfo.transportPubkey, peerInfo.nametag);
        setSelectedConversation(conversation);
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.CONVERSATIONS });
        return conversation;
      } catch (error) {
        console.error('Failed to start conversation', error);
        return null;
      }
    },
    [sphere, queryClient]
  );

  // Select conversation
  const selectConversation = useCallback(
    (conversation: ChatConversation | null) => {
      setSelectedConversation(conversation);
      setIsRecipientTyping(false);
      // Persist selected conversation ID
      if (conversation) {
        localStorage.setItem(STORAGE_KEYS.CHAT_SELECTED_DM, conversation.id);
        chatRepository.markConversationAsRead(conversation.id);
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.UNREAD_COUNT });
        // Send SDK read receipts for unread incoming messages
        if (sphere) {
          const messages = chatRepository.getMessagesForConversation(conversation.id);
          const unreadIncomingIds = messages
            .filter(m => !m.isFromMe && m.status !== MessageStatus.READ)
            .map(m => m.id);
          if (unreadIncomingIds.length > 0) {
            sphere.communications.markAsRead(unreadIncomingIds);
          }
        }
      } else {
        localStorage.removeItem(STORAGE_KEYS.CHAT_SELECTED_DM);
      }
    },
    [queryClient, sphere]
  );

  // Delete conversation
  const deleteConversation = useCallback(
    (id: string) => {
      chatRepository.deleteConversation(id);
      if (selectedConversation?.id === id) {
        setSelectedConversation(null);
      }
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.CONVERSATIONS });
    },
    [queryClient, selectedConversation]
  );

  // Mark as read
  const markAsRead = useCallback(
    (conversationId: string) => {
      chatRepository.markConversationAsRead(conversationId);
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.UNREAD_COUNT });
      // Send SDK read receipts for unread incoming messages
      if (sphere) {
        const messages = chatRepository.getMessagesForConversation(conversationId);
        const unreadIncomingIds = messages
          .filter(m => !m.isFromMe && m.status !== MessageStatus.READ)
          .map(m => m.id);
        if (unreadIncomingIds.length > 0) {
          sphere.communications.markAsRead(unreadIncomingIds);
        }
      }
    },
    [queryClient, sphere]
  );

  // Send message
  const sendMessage = useCallback(
    async (content: string): Promise<boolean> => {
      if (!content.trim()) return false;
      return sendMessageMutation.mutateAsync(content);
    },
    [sendMessageMutation]
  );

  // Filter conversations by search query
  const filteredConversations = useMemo(() => {
    const conversations = conversationsQuery.data || [];
    if (!searchQuery.trim()) return conversations;

    const query = searchQuery.toLowerCase();
    return conversations.filter(
      (c) =>
        c.getDisplayName().toLowerCase().includes(query) ||
        c.lastMessageText.toLowerCase().includes(query)
    );
  }, [conversationsQuery.data, searchQuery]);

  return {
    // Conversations
    conversations: conversationsQuery.data || [],
    isLoadingConversations: conversationsQuery.isLoading,
    selectedConversation,
    selectConversation,
    startNewConversation,
    deleteConversation,

    // Messages
    messages: messagesQuery.data || [],
    isLoadingMessages: messagesQuery.isLoading,
    sendMessage,
    isSending: sendMessageMutation.isPending,

    // Input state
    messageInput,
    setMessageInput,

    // Unread
    totalUnreadCount: unreadCountQuery.data || 0,
    markAsRead,

    // Typing indicator
    isRecipientTyping,

    // Search/Filter
    searchQuery,
    setSearchQuery,
    filteredConversations,
  };
};
