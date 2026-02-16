import { useCallback, useEffect, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import { ChevronUp, Loader2 } from 'lucide-react';
import type { GroupMessageData } from '@unicitylabs/sphere-sdk';
import { GroupMessageBubble } from './GroupMessageBubble';
import { getMessageFormattedDate } from '../utils/groupChatHelpers';

interface GroupMessageListProps {
  messages: GroupMessageData[];
  isLoading: boolean;
  myPubkey: string | null;
  canDeleteMessages?: boolean;
  onDeleteMessage?: (messageId: string) => Promise<boolean>;
  isDeletingMessage?: boolean;
  onReplyToMessage?: (message: GroupMessageData) => void;
  hasMore?: boolean;
  loadMore?: () => void;
}

export function GroupMessageList({
  messages,
  isLoading,
  myPubkey,
  canDeleteMessages = false,
  onDeleteMessage,
  isDeletingMessage = false,
  onReplyToMessage,
  hasMore,
  loadMore,
}: GroupMessageListProps) {
  // Create a map for quick lookup of messages by ID (for reply-to)
  const messagesById = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const loadingMoreRef = useRef(false);
  const scrollStateBeforeLoadRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);

  // Auto-scroll to bottom when messages change (skip when loading more)
  useEffect(() => {
    if (scrollRef.current) {
      if (loadingMoreRef.current && scrollStateBeforeLoadRef.current) {
        // Restore scroll position after loading older messages
        const { scrollHeight: prevHeight, scrollTop: prevTop } = scrollStateBeforeLoadRef.current;
        scrollRef.current.scrollTop = prevTop + (scrollRef.current.scrollHeight - prevHeight);
        loadingMoreRef.current = false;
        scrollStateBeforeLoadRef.current = null;
      } else {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    }
  }, [messages]);

  const handleLoadMore = useCallback(() => {
    if (!loadMore || !scrollRef.current) return;
    loadingMoreRef.current = true;
    scrollStateBeforeLoadRef.current = {
      scrollHeight: scrollRef.current.scrollHeight,
      scrollTop: scrollRef.current.scrollTop,
    };
    loadMore();
  }, [loadMore]);

  // Group messages by date
  const groupedMessages: { date: string; messages: GroupMessageData[] }[] = [];
  let currentDate = '';

  messages.forEach((message) => {
    const messageDate = getMessageFormattedDate(message);
    if (messageDate !== currentDate) {
      currentDate = messageDate;
      groupedMessages.push({ date: messageDate, messages: [] });
    }
    groupedMessages[groupedMessages.length - 1].messages.push(message);
  });

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-0">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
        >
          <Loader2 className="w-8 h-8 text-blue-500" />
        </motion.div>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-y-auto px-4 py-4 space-y-6 min-h-0"
    >
      {hasMore && (
        <div className="flex items-center justify-center py-2">
          <button
            onClick={handleLoadMore}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-medium text-neutral-500 dark:text-neutral-400 bg-neutral-100 dark:bg-neutral-800/50 border border-neutral-200 dark:border-neutral-700/50 hover:bg-neutral-200 dark:hover:bg-neutral-700/50 transition-colors"
          >
            <ChevronUp className="w-3.5 h-3.5" />
            Load earlier messages
          </button>
        </div>
      )}
      {groupedMessages.map((group, groupIndex) => (
        <div key={group.date} className="space-y-4">
          {/* Date separator */}
          <div className="flex items-center justify-center">
            <div className="px-3 py-1 rounded-full bg-neutral-100 dark:bg-neutral-800/50 text-neutral-500 dark:text-neutral-400 text-xs font-medium">
              {group.date}
            </div>
          </div>

          {/* Messages */}
          {group.messages.map((message, messageIndex) => (
            <GroupMessageBubble
              key={message.id ?? `${message.timestamp}-${message.senderPubkey}`}
              message={message}
              isOwnMessage={message.senderPubkey === myPubkey}
              delay={groupIndex === groupedMessages.length - 1 ? messageIndex * 0.05 : 0}
              canDelete={canDeleteMessages}
              onDelete={onDeleteMessage}
              isDeleting={isDeletingMessage}
              onReply={onReplyToMessage}
              replyToMessage={message.replyToId ? messagesById.get(message.replyToId) : null}
            />
          ))}
        </div>
      ))}

      {messages.length === 0 && (
        <div className="flex flex-col items-center justify-center h-full text-center">
          <p className="text-neutral-500 dark:text-neutral-400">No messages yet</p>
          <p className="text-neutral-400 dark:text-neutral-500 text-sm mt-1">
            Be the first to send a message!
          </p>
        </div>
      )}
    </div>
  );
}
