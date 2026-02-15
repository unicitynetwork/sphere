import { useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { X, Minus, Maximize2, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { ChatRepository } from '../data/ChatRepository';
import { ChatMessage, MessageStatus, MessageType } from '../data/models';
import type { ChatConversation } from '../data/models';
import { useSphereContext } from '../../../sdk/hooks/core/useSphere';
import { useMiniChatStore } from './miniChatStore';
import { MiniChatInput } from './MiniChatInput';
import { MarkdownContent } from '../../../utils/markdown';
import { getColorFromPubkey } from '../utils/avatarColors';

const WINDOW_WIDTH = 328;
const WINDOW_HEIGHT = 455;
const WINDOW_GAP = 12;
const BUBBLES_WIDTH = 88;

const chatRepository = ChatRepository.getInstance();

interface MiniChatWindowProps {
  conversation: ChatConversation;
  index: number;
}

export function MiniChatWindow({ conversation, index }: MiniChatWindowProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { sphere } = useSphereContext();
  const { closeWindow, minimizeWindow } = useMiniChatStore();

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: messages = [], isLoading } = useQuery({
    queryKey: ['chat', 'messages', conversation.id],
    queryFn: () => chatRepository.getMessagesForConversation(conversation.id),
    staleTime: 5000,
  });

  // Listen for real-time messages and mark as read
  useEffect(() => {
    // Mark conversation as read when window is open
    chatRepository.markConversationAsRead(conversation.id);
    queryClient.invalidateQueries({ queryKey: ['chat', 'unreadCount'] });
    // Send SDK read receipts for unread incoming messages
    if (sphere) {
      const msgs = chatRepository.getMessagesForConversation(conversation.id);
      const unreadIncomingIds = msgs
        .filter(m => !m.isFromMe && m.status !== MessageStatus.READ)
        .map(m => m.id);
      if (unreadIncomingIds.length > 0) {
        sphere.communications.markAsRead(unreadIncomingIds);
      }
    }

    const handleDMReceived = (event: CustomEvent<ChatMessage>) => {
      const message = event.detail;
      if (message.conversationId === conversation.id) {
        // Refetch messages for this conversation
        queryClient.invalidateQueries({ queryKey: ['chat', 'messages', conversation.id] });
        // Auto-mark as read since window is open
        chatRepository.markConversationAsRead(conversation.id);
        queryClient.invalidateQueries({ queryKey: ['chat', 'unreadCount'] });
        // Send SDK read receipt
        if (sphere) {
          sphere.communications.markAsRead([message.id]);
        }
      }
    };

    window.addEventListener('dm-received', handleDMReceived as EventListener);
    return () => {
      window.removeEventListener('dm-received', handleDMReceived as EventListener);
    };
  }, [conversation.id, queryClient, sphere]);

  const sendMutation = useMutation({
    mutationFn: async (content: string) => {
      if (!sphere) throw new Error('Wallet not initialized');
      const dm = await sphere.communications.sendDM(
        conversation.participantPubkey,
        content,
      );

      // Save sent message to ChatRepository for local persistence
      const chatMessage = new ChatMessage({
        id: dm.id,
        conversationId: conversation.id,
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
      queryClient.invalidateQueries({ queryKey: ['chat', 'messages', conversation.id] });
      queryClient.invalidateQueries({ queryKey: ['chat', 'conversations'] });
    },
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleExpand = () => {
    closeWindow(conversation.id);
    const nametag = conversation.participantNametag || conversation.participantPubkey;
    navigate(`/agents/chat?nametag=${encodeURIComponent(nametag)}`);
  };

  const handleSend = async (content: string) => {
    return sendMutation.mutateAsync(content);
  };

  const leftOffset = BUBBLES_WIDTH + index * (WINDOW_WIDTH + WINDOW_GAP);

  return (
    <motion.div
      initial={{ opacity: 0, y: 50, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 50, scale: 0.9 }}
      transition={{ type: 'spring', damping: 25, stiffness: 300 }}
      style={{
        left: leftOffset,
        width: WINDOW_WIDTH,
        height: WINDOW_HEIGHT,
      }}
      className="fixed bottom-4 z-100000 bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-700 shadow-2xl flex flex-col overflow-hidden"
    >
      <div className="p-3 border-b border-neutral-200 dark:border-neutral-700 flex items-center gap-3 bg-linear-to-r from-white to-neutral-50 dark:from-neutral-900 dark:to-neutral-800 shrink-0">
        <div className={`w-9 h-9 rounded-lg bg-linear-to-br ${getColorFromPubkey(conversation.participantPubkey).gradient} flex items-center justify-center text-white font-medium text-sm shadow-md shrink-0`}>
          {conversation.getAvatar()}
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-neutral-900 dark:text-white text-sm truncate">
            {conversation.getDisplayName()}
          </h4>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <motion.button
            onClick={() => minimizeWindow(conversation.id)}
            className="p-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-500 dark:text-neutral-400 transition-colors"
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            title="Minimize"
          >
            <Minus className="w-4 h-4" />
          </motion.button>
          <motion.button
            onClick={handleExpand}
            className="p-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-500 dark:text-neutral-400 transition-colors"
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            title="Open in Messenger"
          >
            <Maximize2 className="w-4 h-4" />
          </motion.button>
          <motion.button
            onClick={() => closeWindow(conversation.id)}
            className="p-1.5 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 text-neutral-500 dark:text-neutral-400 hover:text-red-500 transition-colors"
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            title="Close"
          >
            <X className="w-4 h-4" />
          </motion.button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0 bg-neutral-50 dark:bg-neutral-900/50">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-6 h-6 text-orange-500 animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-center">
            <p className="text-neutral-400 text-sm">No messages yet. Say hi!</p>
          </div>
        ) : (
          <>
            {messages.map((message) => {
              const isOwn = message.isFromMe;
              return (
                <div
                  key={message.id}
                  className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[80%] rounded-2xl px-3 py-2 ${
                      isOwn
                        ? 'bg-linear-to-br from-orange-500 to-orange-600 text-white'
                        : 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white border border-neutral-200 dark:border-neutral-700'
                    }`}
                  >
                    <div className="text-sm leading-relaxed wrap-break-word whitespace-pre-wrap">
                      <MarkdownContent text={message.content} />
                    </div>
                    <div
                      className={`text-[10px] mt-1 ${isOwn ? 'text-white/60' : 'text-neutral-400'}`}
                    >
                      {message.getFormattedTime()}
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      <MiniChatInput
        onSend={handleSend}
        isSending={sendMutation.isPending}
        placeholder={`Message ${conversation.getDisplayName()}...`}
      />
    </motion.div>
  );
}
