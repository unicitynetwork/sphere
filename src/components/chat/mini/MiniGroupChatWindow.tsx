import { useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { X, Minus, Maximize2, Loader2, Hash } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { GroupChatRepository } from '../data/GroupChatRepository';
import type { Group, GroupMessage } from '../data/groupModels';
import { useServices } from '../../../contexts/useServices';
import { useMiniChatStore, createWindowId } from './miniChatStore';
import { MiniChatInput } from './MiniChatInput';
import { MarkdownContent } from '../../../utils/markdown';
import { getColorFromPubkey } from '../utils/avatarColors';

const WINDOW_WIDTH = 328;
const WINDOW_HEIGHT = 455;
const WINDOW_GAP = 12;
const BUBBLES_WIDTH = 88;

const groupChatRepository = GroupChatRepository.getInstance();

interface MiniGroupChatWindowProps {
  group: Group;
  index: number;
}

export function MiniGroupChatWindow({ group, index }: MiniGroupChatWindowProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { groupChatService, nostrService } = useServices();
  const { closeWindow, minimizeWindow } = useMiniChatStore();

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const windowId = createWindowId('group', group.id);
  // Try groupChatService first, fall back to nostrService (which initializes earlier)
  const myPubkey = groupChatService?.getMyPublicKey() || nostrService?.getMyPublicKey() || '';

  const { data: messages = [], isLoading } = useQuery({
    queryKey: ['groupChat', 'messages', group.id],
    queryFn: () => groupChatRepository.getMessagesForGroup(group.id),
    staleTime: 5000,
  });

  // Listen for real-time messages and mark as read
  useEffect(() => {
    // Mark group as read when window is open
    groupChatRepository.markGroupAsRead(group.id);
    queryClient.invalidateQueries({ queryKey: ['groupChat', 'unreadCount'] });

    const handleGroupMessageReceived = (event: CustomEvent<GroupMessage>) => {
      const message = event.detail;
      if (message.groupId === group.id) {
        // Refetch messages for this group
        queryClient.invalidateQueries({ queryKey: ['groupChat', 'messages', group.id] });
        // Auto-mark as read since window is open
        groupChatRepository.markGroupAsRead(group.id);
        queryClient.invalidateQueries({ queryKey: ['groupChat', 'unreadCount'] });
      }
    };

    window.addEventListener('group-message-received', handleGroupMessageReceived as EventListener);
    return () => {
      window.removeEventListener('group-message-received', handleGroupMessageReceived as EventListener);
    };
  }, [group.id, queryClient]);

  const sendMutation = useMutation({
    mutationFn: async (content: string) => {
      if (!groupChatService) throw new Error('Group chat service not available');
      const message = await groupChatService.sendMessage(group.id, content);
      return !!message;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groupChat', 'messages', group.id] });
      queryClient.invalidateQueries({ queryKey: ['groupChat', 'groups'] });
    },
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleExpand = () => {
    closeWindow(windowId);
    navigate(`/agents/chat?mode=global&group=${group.id}`);
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
        <div className="w-9 h-9 rounded-lg bg-linear-to-br from-purple-500 to-purple-600 flex items-center justify-center text-white font-medium text-sm shadow-md shrink-0">
          <Hash className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-neutral-900 dark:text-white text-sm truncate">
            {group.getDisplayName()}
          </h4>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <motion.button
            onClick={() => minimizeWindow(windowId)}
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
            onClick={() => closeWindow(windowId)}
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
              const isOwn = message.senderPubkey === myPubkey;
              return (
                <div
                  key={message.id}
                  className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}
                >
                  <div className={`max-w-[80%] ${isOwn ? '' : 'flex gap-2'}`}>
                    {!isOwn && (
                      <div className={`w-6 h-6 rounded-full bg-linear-to-br ${getColorFromPubkey(message.senderPubkey).gradient} flex items-center justify-center text-white font-medium text-[10px] shrink-0`}>
                        {message.getSenderAvatar()}
                      </div>
                    )}
                    <div>
                      {!isOwn && (
                        <div className="text-[10px] text-neutral-500 dark:text-neutral-400 mb-0.5 ml-1">
                          {message.getSenderDisplayName()}
                        </div>
                      )}
                      <div
                        className={`rounded-2xl px-3 py-2 ${
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
        placeholder={`Message ${group.getDisplayName()}...`}
      />
    </motion.div>
  );
}
