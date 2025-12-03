import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageCircle } from 'lucide-react';
import { ChatMessage } from '../data/models';
import { DMMessageBubble } from './DMMessageBubble';
import { MessageListSkeleton } from '../../ui';

interface DMMessageListProps {
  messages: ChatMessage[];
  isLoading?: boolean;
}

export function DMMessageList({ messages, isLoading }: DMMessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Group messages by date
  const groupedMessages = messages.reduce((groups, message) => {
    const date = message.getFormattedDate();
    if (!groups[date]) {
      groups[date] = [];
    }
    groups[date].push(message);
    return groups;
  }, {} as Record<string, ChatMessage[]>);

  if (isLoading) {
    return <MessageListSkeleton count={5} />;
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
                delay={index * 0.05}
              />
            ))}
          </motion.div>
        ))}
      </AnimatePresence>
      <div ref={bottomRef} />
    </div>
  );
}
