import { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { X, Search, MessageCirclePlus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { ChatRepository } from '../data/ChatRepository';
import { useMiniChatStore } from './miniChatStore';
import type { ChatConversation } from '../data/models';

interface MiniChatListProps {
  onClose: () => void;
}

const chatRepository = ChatRepository.getInstance();

export function MiniChatList({ onClose }: MiniChatListProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { openWindow } = useMiniChatStore();
  const [searchQuery, setSearchQuery] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  const { data: conversations = [] } = useQuery({
    queryKey: ['chat', 'conversations'],
    queryFn: () => chatRepository.getConversations(),
    staleTime: 30000,
  });

  const filteredConversations = useMemo(() => {
    if (!searchQuery.trim()) return conversations;
    const query = searchQuery.toLowerCase();
    return conversations.filter(
      (c) =>
        c.getDisplayName().toLowerCase().includes(query) ||
        c.lastMessageText.toLowerCase().includes(query)
    );
  }, [conversations, searchQuery]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (listRef.current && !listRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleConversationClick = (conversation: ChatConversation) => {
    chatRepository.markConversationAsRead(conversation.id);
    queryClient.invalidateQueries({ queryKey: ['chat', 'unreadCount'] });
    queryClient.invalidateQueries({ queryKey: ['chat', 'conversations'] });
    openWindow(conversation);
  };

  const handleNewConversation = () => {
    onClose();
    navigate('/agents/chat?mode=dm&new=true');
  };

  return (
    <motion.div
      ref={listRef}
      initial={{ opacity: 0, x: -20, scale: 0.95 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: -20, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      className="fixed left-4 bottom-20 z-100000 w-80 max-h-[70vh] bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-700 shadow-2xl overflow-hidden flex flex-col"
    >
      <div className="p-4 border-b border-neutral-200 dark:border-neutral-700 flex items-center justify-between shrink-0">
        <h3 className="text-lg font-semibold text-neutral-900 dark:text-white">Messages</h3>
        <div className="flex items-center gap-2">
          <motion.button
            onClick={handleNewConversation}
            className="p-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-500 dark:text-neutral-400 transition-colors"
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            title="New conversation"
          >
            <MessageCirclePlus className="w-5 h-5" />
          </motion.button>
          <motion.button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-500 dark:text-neutral-400 transition-colors"
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
          >
            <X className="w-5 h-5" />
          </motion.button>
        </div>
      </div>

      <div className="p-3 border-b border-neutral-200 dark:border-neutral-700 shrink-0">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search conversations..."
            className="w-full pl-10 pr-4 py-2 bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white placeholder-neutral-400 rounded-xl outline-none text-sm border border-transparent focus:border-orange-500 transition-colors"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {filteredConversations.length === 0 ? (
          <div className="p-8 text-center text-neutral-500 dark:text-neutral-400">
            <p className="text-sm">No conversations found</p>
          </div>
        ) : (
          <div className="p-2">
            {filteredConversations.map((conversation) => (
                <motion.button
                  key={conversation.id}
                  onClick={() => handleConversationClick(conversation)}
                  className="w-full p-3 rounded-xl flex items-center gap-3 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                >
                  <div className="w-10 h-10 rounded-xl bg-linear-to-br from-orange-500 to-orange-600 flex items-center justify-center text-white font-medium text-sm shrink-0 shadow-md">
                    {conversation.getAvatar()}
                  </div>
                  <div className="flex-1 min-w-0 text-left">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-neutral-900 dark:text-white truncate text-sm">
                        {conversation.getDisplayName()}
                      </span>
                      <span className="text-xs text-neutral-500 dark:text-neutral-400 shrink-0">
                        {conversation.getFormattedLastMessageTime()}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <p className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
                        {conversation.lastMessageText || 'No messages yet'}
                      </p>
                      {conversation.unreadCount > 0 && (
                        <span className="text-xs px-1.5 py-0.5 rounded-full bg-orange-500 text-white shrink-0">
                          {conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                </motion.button>
              ))}
          </div>
        )}
      </div>

      <div className="p-3 border-t border-neutral-200 dark:border-neutral-700 shrink-0">
        <motion.button
          onClick={() => {
            onClose();
            navigate('/agents/chat');
          }}
          className="w-full py-2 text-sm text-orange-500 hover:text-orange-600 font-medium transition-colors"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          View all in Messenger
        </motion.button>
      </div>
    </motion.div>
  );
}
