import { useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageCircle, ChevronUp } from 'lucide-react';
import { type DisplayMessage, formatMessageDate } from '../data/chatTypes';
import { DMMessageBubble } from './DMMessageBubble';

interface DMMessageListProps {
  messages: DisplayMessage[];
  isLoading?: boolean;
  isRecipientTyping?: boolean;
  hasMore?: boolean;
  loadMore?: () => void;
}

export function DMMessageList({ messages, isLoading, isRecipientTyping, hasMore, loadMore }: DMMessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevMessagesLenRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const scrollStateBeforeLoadRef = useRef({ scrollHeight: 0, scrollTop: 0 });

  // Auto-scroll to bottom for new messages, or restore position after load-more
  useEffect(() => {
    if (!scrollRef.current) return;

    if (loadingMoreRef.current) {
      // Restore scroll position after loading older messages at the top
      const el = scrollRef.current;
      const { scrollHeight: prevHeight, scrollTop: prevTop } = scrollStateBeforeLoadRef.current;
      el.scrollTop = prevTop + (el.scrollHeight - prevHeight);
      loadingMoreRef.current = false;
      prevMessagesLenRef.current = messages.length;
      return;
    }

    if (messages.length > prevMessagesLenRef.current) {
      const el = scrollRef.current;
      const wasNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
      if (wasNearBottom || prevMessagesLenRef.current === 0) {
        el.scrollTop = el.scrollHeight;
      }
    }
    prevMessagesLenRef.current = messages.length;
  }, [messages]);

  // Scroll to bottom when typing indicator appears
  useEffect(() => {
    if (isRecipientTyping && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [isRecipientTyping]);

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
  const groupedMessages = messages.reduce((groups, message) => {
    const date = formatMessageDate(message.timestamp);
    if (!groups[date]) {
      groups[date] = [];
    }
    groups[date].push(message);
    return groups;
  }, {} as Record<string, DisplayMessage[]>);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-0">
        <div className="animate-spin w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center p-8 min-h-0">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="w-20 h-20 rounded-2xl bg-neutral-100 dark:bg-neutral-800/50 flex items-center justify-center mb-4"
        >
          <MessageCircle className="w-10 h-10 text-neutral-400" />
        </motion.div>
        <p className="text-neutral-500 dark:text-neutral-400">No messages yet</p>
        <p className="text-neutral-400 dark:text-neutral-500 text-sm mt-1">
          Start the conversation by sending a message
        </p>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="overflow-y-auto px-4 py-4 space-y-4 min-h-0"
    >
      {/* Load earlier messages */}
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

      <AnimatePresence mode="popLayout">
        {Object.entries(groupedMessages).map(([date, dateMessages]) => (
          <motion.div
            key={date}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-3"
          >
            {/* Date separator */}
            <div className="flex items-center justify-center my-4">
              <div className="px-3 py-1 rounded-full bg-neutral-100 dark:bg-neutral-800/50 text-xs text-neutral-500 dark:text-neutral-400 border border-neutral-200 dark:border-neutral-700/50">
                {date}
              </div>
            </div>

            {/* Messages for this date */}
            {dateMessages.map((message, index) => (
              <DMMessageBubble
                key={message.id}
                message={message}
                delay={(dateMessages.length - 1 - index) * 0.05}
              />
            ))}
          </motion.div>
        ))}
      </AnimatePresence>

      {/* Typing indicator */}
      <AnimatePresence>
        {isRecipientTyping && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="flex items-center gap-2 px-4 py-2"
          >
            <div className="bg-neutral-100 dark:bg-neutral-800/50 rounded-2xl rounded-bl-sm px-3 py-2 border border-neutral-200 dark:border-neutral-700/50">
              <div className="flex gap-0.75">
                <span className="w-1.5 h-1.5 bg-neutral-400 dark:bg-neutral-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 bg-neutral-400 dark:bg-neutral-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 bg-neutral-400 dark:bg-neutral-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div ref={bottomRef} />
    </div>
  );
}
