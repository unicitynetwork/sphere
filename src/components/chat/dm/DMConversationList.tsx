import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquarePlus, Search, X, PanelLeftClose, Sparkles, Hash, User } from 'lucide-react';
import { ChatConversation } from '../data/models';
import { DMConversationItem } from './DMConversationItem';
import type { ChatModeChangeHandler } from '../../../types';

interface DMConversationListProps {
  conversations: ChatConversation[];
  selectedConversation: ChatConversation | null;
  onSelect: (conversation: ChatConversation) => void;
  onDelete: (id: string) => void;
  onNewConversation: () => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  isOpen: boolean;
  onClose: () => void;
  isCollapsed: boolean;
  onCollapse: () => void;
  totalUnreadCount: number;
  onModeChange: ChatModeChangeHandler;
}

export function DMConversationList({
  conversations,
  selectedConversation,
  onSelect,
  onDelete,
  onNewConversation,
  searchQuery,
  onSearchChange,
  isOpen,
  onClose,
  isCollapsed,
  onCollapse,
  totalUnreadCount,
  onModeChange,
}: DMConversationListProps) {
  return (
    <>
      {/* Mobile overlay */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="lg:hidden absolute inset-0 bg-black/50 z-40 rounded-3xl"
            onClick={onClose}
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <div
        className={`
        w-72 border-r border-neutral-200 dark:border-neutral-800/50 flex flex-col z-50 overflow-hidden
        absolute lg:relative inset-y-0 left-0 min-h-0
        transform transition-all duration-300 ease-in-out
        ${isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        ${isCollapsed ? 'lg:w-0 lg:border-0 lg:min-w-0' : 'lg:w-72'}
        bg-white/95 dark:bg-neutral-900/95 lg:bg-transparent backdrop-blur-xl lg:backdrop-blur-none rounded-l-3xl lg:rounded-none
      `}
      >
        {/* Header */}
        <div className="shrink-0 p-4 border-b border-neutral-200 dark:border-neutral-800/50 bg-linear-to-br from-white/80 dark:from-neutral-900/80 to-neutral-50/40 dark:to-neutral-800/40 backdrop-blur-sm relative">
          <div className="absolute top-0 right-0 w-24 h-24 bg-orange-500/5 rounded-bl-full" />

          <div className="flex items-center justify-between mb-3 relative z-10">
            <div className="flex items-center gap-2">
              <h3 className="text-neutral-900 dark:text-white font-medium">Messages</h3>
              <Sparkles className="w-4 h-4 text-orange-500 animate-pulse" />
              {totalUnreadCount > 0 && (
                <span className="px-1.5 py-0.5 text-xs rounded-full bg-orange-500 text-white">
                  {totalUnreadCount > 99 ? '99+' : totalUnreadCount}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {/* New conversation button */}
              <motion.button
                onClick={onNewConversation}
                className="p-2 rounded-lg bg-linear-to-br from-orange-500 to-orange-600 text-white shadow-lg shadow-orange-500/30"
                title="New conversation"
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
              >
                <MessageSquarePlus className="w-4 h-4" />
              </motion.button>
              {/* Collapse button for desktop */}
              <motion.button
                onClick={onCollapse}
                className="hidden lg:flex p-2 rounded-lg bg-neutral-100 dark:bg-neutral-800/50 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-200 dark:hover:bg-neutral-700/50 transition-colors border border-neutral-200 dark:border-neutral-700/50"
                title="Collapse sidebar"
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
              >
                <PanelLeftClose className="w-4 h-4" />
              </motion.button>
              {/* Close button for mobile */}
              <motion.button
                onClick={onClose}
                className="lg:hidden p-2 rounded-lg bg-neutral-100 dark:bg-neutral-800/50 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-200 dark:hover:bg-neutral-700/50 transition-colors border border-neutral-200 dark:border-neutral-700/50"
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
              >
                <X className="w-4 h-4" />
              </motion.button>
            </div>
          </div>

          {/* Mode Toggle */}
          <div className="grid grid-cols-2 gap-2 relative z-10 mb-3">
            <motion.button
              onClick={() => onModeChange('global')}
              className="px-4 py-3 rounded-xl text-sm transition-all relative overflow-hidden bg-neutral-100 dark:bg-neutral-800/50 text-neutral-500 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-800 border border-neutral-200 dark:border-neutral-700/50"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <Hash className="w-4 h-4 inline mr-2" />
              <span>Global</span>
            </motion.button>
            <motion.button
              className="px-4 py-3 rounded-xl text-sm transition-all relative overflow-hidden bg-linear-to-br from-orange-500 to-orange-600 text-white shadow-lg shadow-orange-500/30"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <div className="absolute inset-0 bg-linear-to-tr from-white/0 via-white/20 to-white/0" />
              <User className="w-4 h-4 inline mr-2" />
              <span className="relative z-10">DM</span>
            </motion.button>
          </div>

          {/* Search */}
          <div className="relative z-10">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search conversations..."
              className="w-full pl-9 pr-3 py-2 bg-neutral-100 dark:bg-neutral-800/50 text-neutral-900 dark:text-white placeholder-neutral-400 rounded-xl text-sm border border-neutral-200 dark:border-neutral-700/50 focus:outline-none focus:border-orange-500 transition-colors"
            />
          </div>
        </div>

        {/* Conversation List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-4">
              <div className="w-16 h-16 rounded-2xl bg-neutral-100 dark:bg-neutral-800/50 flex items-center justify-center mb-4">
                <MessageSquarePlus className="w-8 h-8 text-neutral-400" />
              </div>
              <p className="text-neutral-500 dark:text-neutral-400 text-sm">
                No conversations yet
              </p>
              <p className="text-neutral-400 dark:text-neutral-500 text-xs mt-1">
                Start a new conversation to begin
              </p>
            </div>
          ) : (
            <AnimatePresence mode="popLayout">
              {conversations.map((conversation) => (
                <motion.div
                  key={conversation.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -100 }}
                  layout
                >
                  <DMConversationItem
                    conversation={conversation}
                    isSelected={selectedConversation?.id === conversation.id}
                    onClick={() => onSelect(conversation)}
                    onDelete={() => onDelete(conversation.id)}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          )}
        </div>
      </div>
    </>
  );
}
