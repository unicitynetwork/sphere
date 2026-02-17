import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useSphereContext } from '../../../sdk/hooks/core/useSphere';
import { useIdentity } from '../../../sdk/hooks/core/useIdentity';
import {
  type Conversation,
  type DisplayMessage,
  type DmReceivedDetail,
  buildConversations,
  toDisplayMessage,
  getDisplayName,
  CHAT_KEYS,
} from '../data/chatTypes';
import { STORAGE_KEYS } from '../../../config/storageKeys';

// Local type mirroring SDK's DirectMessage (SDK DTS not always available)
interface SDKDirectMessage {
  id: string;
  senderPubkey: string;
  senderNametag?: string;
  recipientPubkey: string;
  recipientNametag?: string;
  content: string;
  timestamp: number;
  isRead: boolean;
}

function buildAddressId(directAddress: string): string {
  let hash = directAddress;
  if (hash.startsWith('DIRECT://')) hash = hash.slice(9);
  else if (hash.startsWith('DIRECT:')) hash = hash.slice(7);
  const first = hash.slice(0, 6).toLowerCase();
  const last = hash.slice(-6).toLowerCase();
  return `DIRECT_${first}_${last}`;
}

export interface UseChatReturn {
  // Conversations
  conversations: Conversation[];
  isLoadingConversations: boolean;
  selectedConversation: Conversation | null;
  selectConversation: (conversation: Conversation | null) => void;
  startNewConversation: (pubkeyOrNametag: string) => Promise<Conversation | null>;

  // Messages
  messages: DisplayMessage[];
  isLoadingMessages: boolean;
  sendMessage: (content: string) => Promise<boolean>;
  isSending: boolean;

  // Lazy loading
  hasMore: boolean;
  loadMore: () => void;

  // Input state
  messageInput: string;
  setMessageInput: (value: string) => void;

  // Unread
  totalUnreadCount: number;
  markAsRead: (peerPubkey: string) => void;

  // Typing indicator
  isRecipientTyping: boolean;

  // Search/Filter
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  filteredConversations: Conversation[];
}

export const useChat = (): UseChatReturn => {
  const queryClient = useQueryClient();
  const { sphere } = useSphereContext();
  const { directAddress } = useIdentity();
  const addressId = directAddress ? buildAddressId(directAddress) : 'default';

  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [messageInput, setMessageInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isRecipientTyping, setIsRecipientTyping] = useState(false);
  const [messageLimit, setMessageLimit] = useState(20);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Ref to avoid event listener churn on conversation selection changes
  const selectedConversationRef = useRef(selectedConversation);
  selectedConversationRef.current = selectedConversation;

  // Address-scoped selected DM key
  const selectedDmKey = `${STORAGE_KEYS.CHAT_SELECTED_DM}_${addressId}`;

  // Reset UI state when address changes
  useEffect(() => {
    setSelectedConversation(null);
    setMessageInput('');
    setSearchQuery('');
    setIsRecipientTyping(false);
    setMessageLimit(20);
  }, [addressId]);

  // Listen for real-time DM events and typing indicators
  // Uses ref for selectedConversation to avoid listener re-registration churn
  useEffect(() => {
    const handleDMReceived = (event: CustomEvent<DmReceivedDetail>) => {
      const { peerPubkey, messageId, isFromMe } = event.detail;
      const current = selectedConversationRef.current;

      // If we're viewing this conversation, auto-mark as read
      if (current && peerPubkey === current.peerPubkey) {
        if (sphere && !isFromMe) {
          sphere.communications.markAsRead([messageId]);
        }
        // Clear typing indicator — they sent their message
        if (!isFromMe) {
          setIsRecipientTyping(false);
          clearTimeout(typingTimeoutRef.current);
        }
      }
      // Note: query invalidation is handled by useSphereEvents — no duplicate needed
    };

    const handleTyping = (e: CustomEvent) => {
      const current = selectedConversationRef.current;
      if (current && e.detail.senderPubkey === current.peerPubkey) {
        setIsRecipientTyping(true);
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => setIsRecipientTyping(false), 1500);
      }
    };

    window.addEventListener('dm-received', handleDMReceived as EventListener);
    window.addEventListener('dm-typing', handleTyping as EventListener);

    return () => {
      window.removeEventListener('dm-received', handleDMReceived as EventListener);
      window.removeEventListener('dm-typing', handleTyping as EventListener);
      clearTimeout(typingTimeoutRef.current);
    };
  }, [sphere]);

  // Query conversations from SDK, with fallback nametag resolution
  const conversationsQuery = useQuery({
    queryKey: CHAT_KEYS.conversations(addressId),
    queryFn: async () => {
      if (!sphere) return [];
      const sdkConvs = sphere.communications.getConversations();
      const convos = buildConversations(sdkConvs, sphere.identity!.chainPubkey);

      // Resolve missing nametags via transport (parallel, best-effort)
      const needsResolve = convos.filter(c => !c.peerNametag);
      if (needsResolve.length > 0) {
        const resolved = await Promise.all(
          needsResolve.map(c =>
            sphere.communications.resolvePeerNametag(c.peerPubkey).catch(() => undefined),
          ),
        );
        for (let i = 0; i < needsResolve.length; i++) {
          if (resolved[i]) {
            needsResolve[i].peerNametag = resolved[i];
          }
        }
      }

      return convos;
    },
    enabled: !!sphere,
    staleTime: 30000,
  });

  // Restore selected conversation from localStorage when conversations are loaded
  useEffect(() => {
    if (conversationsQuery.data && conversationsQuery.data.length > 0 && !selectedConversation) {
      const savedPeerPubkey = localStorage.getItem(selectedDmKey);
      if (savedPeerPubkey) {
        const savedConversation = conversationsQuery.data.find((c) => c.peerPubkey === savedPeerPubkey);
        if (savedConversation) {
          setSelectedConversation(savedConversation);
        }
      }
    }
  }, [conversationsQuery.data, selectedConversation, selectedDmKey]);

  // Query messages for selected conversation with lazy loading
  const selectedPeerPubkey = selectedConversation?.peerPubkey;
  const messagesQuery = useQuery({
    queryKey: [...CHAT_KEYS.messages(addressId, selectedPeerPubkey || ''), messageLimit],
    queryFn: () => {
      if (!selectedPeerPubkey || !sphere) return { messages: [] as DisplayMessage[], hasMore: false };
      const page = sphere.communications.getConversationPage(selectedPeerPubkey, { limit: messageLimit });
      const myPubkey = sphere.identity!.chainPubkey;
      return {
        messages: page.messages.map((dm: SDKDirectMessage) => toDisplayMessage(dm, myPubkey)),
        hasMore: page.hasMore,
      };
    },
    enabled: !!selectedPeerPubkey && !!sphere,
    staleTime: 10000,
    placeholderData: keepPreviousData,
  });

  // Reset limit when switching conversations
  useEffect(() => {
    setMessageLimit(20);
  }, [selectedPeerPubkey]);

  // Load more messages
  const loadMore = useCallback(() => {
    setMessageLimit((prev) => prev + 20);
  }, []);

  // Query total unread count from SDK
  const unreadCountQuery = useQuery({
    queryKey: CHAT_KEYS.unreadCount(addressId),
    queryFn: () => sphere?.communications.getUnreadCount() ?? 0,
    enabled: !!sphere,
    staleTime: 30000,
  });

  // Send message mutation — SDK auto-saves
  const sendMessageMutation = useMutation({
    mutationFn: async (content: string) => {
      if (!selectedPeerPubkey || !sphere) throw new Error('No conversation selected');
      await sphere.communications.sendDM(selectedPeerPubkey, content);
      return true;
    },
    onSuccess: () => {
      setMessageInput('');
      queryClient.invalidateQueries({ queryKey: CHAT_KEYS.all });
    },
  });

  // Start new conversation
  const startNewConversation = useCallback(
    async (identifier: string): Promise<Conversation | null> => {
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

        const conversation: Conversation = {
          peerPubkey: peerInfo.transportPubkey,
          peerNametag: peerInfo.nametag,
          lastMessageText: '',
          lastMessageTime: Date.now(),
          unreadCount: 0,
        };

        setSelectedConversation(conversation);
        localStorage.setItem(selectedDmKey, conversation.peerPubkey);
        queryClient.invalidateQueries({ queryKey: CHAT_KEYS.conversations(addressId) });
        return conversation;
      } catch (error) {
        console.error('Failed to start conversation', error);
        return null;
      }
    },
    [sphere, queryClient, addressId, selectedDmKey],
  );

  // Select conversation
  const selectConversation = useCallback(
    (conversation: Conversation | null) => {
      setSelectedConversation(conversation);
      setIsRecipientTyping(false);
      if (conversation) {
        localStorage.setItem(selectedDmKey, conversation.peerPubkey);
        // Send SDK read receipts for unread incoming messages
        if (sphere) {
          const msgs: SDKDirectMessage[] = sphere.communications.getConversation(conversation.peerPubkey);
          const unreadIncomingIds = msgs
            .filter(m => !m.isRead && m.senderPubkey === conversation.peerPubkey)
            .map(m => m.id);
          if (unreadIncomingIds.length > 0) {
            sphere.communications.markAsRead(unreadIncomingIds);
            queryClient.invalidateQueries({ queryKey: CHAT_KEYS.all });
          }
        }
      } else {
        localStorage.removeItem(selectedDmKey);
      }
    },
    [queryClient, sphere, selectedDmKey],
  );

  // Mark as read
  const markAsRead = useCallback(
    (peerPubkey: string) => {
      if (sphere) {
        const msgs: SDKDirectMessage[] = sphere.communications.getConversation(peerPubkey);
        const unreadIncomingIds = msgs
          .filter(m => !m.isRead && m.senderPubkey === peerPubkey)
          .map(m => m.id);
        if (unreadIncomingIds.length > 0) {
          sphere.communications.markAsRead(unreadIncomingIds);
          queryClient.invalidateQueries({ queryKey: CHAT_KEYS.all });
        }
      }
    },
    [queryClient, sphere],
  );

  // Send message
  const sendMessage = useCallback(
    async (content: string): Promise<boolean> => {
      if (!content.trim()) return false;
      return sendMessageMutation.mutateAsync(content);
    },
    [sendMessageMutation],
  );

  // Filter conversations by search query
  const filteredConversations = useMemo(() => {
    const conversations = conversationsQuery.data || [];
    if (!searchQuery.trim()) return conversations;

    const query = searchQuery.toLowerCase();
    return conversations.filter(
      (c) =>
        getDisplayName(c.peerPubkey, c.peerNametag).toLowerCase().includes(query) ||
        c.lastMessageText.toLowerCase().includes(query),
    );
  }, [conversationsQuery.data, searchQuery]);

  return {
    // Conversations
    conversations: conversationsQuery.data || [],
    isLoadingConversations: conversationsQuery.isLoading,
    selectedConversation,
    selectConversation,
    startNewConversation,

    // Messages
    messages: messagesQuery.data?.messages || [],
    isLoadingMessages: messagesQuery.isLoading,
    sendMessage,
    isSending: sendMessageMutation.isPending,

    // Lazy loading
    hasMore: messagesQuery.data?.hasMore ?? false,
    loadMore,

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
